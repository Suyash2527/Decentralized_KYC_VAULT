# Security Architecture

How key material, PII and database access work after the Cloud KMS / Cloud SQL
migration, and why each piece is shaped the way it is.

---

## What changed, and why it mattered

The pre-migration design had two secrets that, if read once, compromised the
entire system permanently:

| Secret | Where it lived | What reading it gave an attacker |
|---|---|---|
| `ENCRYPTION_KEY` | Plaintext in `backend/env.yaml` and in the Cloud Run environment | Every customer's PII, past and future, forever |
| `DEPLOYER_PRIVATE_KEY` | Same | Permanent control of the contract's `operator` role: forge verifications, grant consent to any partner |

Both were readable by anything that could read the process environment: a
dependency with a postinstall script, a log statement that dumped `process.env`,
an SSRF against the metadata server, or anyone with `roles/run.viewer` on the
project. `env.yaml` also sat unencrypted on developer laptops.

Neither secret exists anymore.

---

## Key hierarchy

```
Cloud KMS keyring  kycvault-prod-keyring  (asia-south1, HSM)
│
├── pii-kek                symmetric, 90-day rotation
│     └── wraps a unique per-record data key. Never sees plaintext PII.
│
├── operator-signing       EC_SIGN_SECP256K1_SHA256
│     └── the Ethereum operator private key. Generated inside the HSM,
│         non-exportable. No plaintext copy exists anywhere on earth.
│
├── sql-cmek               symmetric → Cloud SQL data, backups, WAL
├── secrets-cmek           symmetric → Secret Manager payloads
└── artifact-cmek          symmetric → container images
```

Separate keys per purpose, so a single over-broad IAM binding cannot cross
domains, and so each key's audit log describes exactly one system.

---

## PII: envelope encryption

Writing a record:

```
1. dek        := 32 random bytes  (KMS HSM RNG, local CSPRNG as fallback)
2. ciphertext := AES-256-GCM(dek, iv, plaintext)          — in-process
3. wrapped    := KMS.Encrypt(pii-kek, dek, aad=publicId)  — one API call
4. store      "v2:<wrapped>:<iv>:<tag>:<ciphertext>"
5. zero the dek in memory
```

Reading reverses it: unwrap the DEK with KMS, decrypt locally, zero the DEK.

Four properties follow from this shape:

**KMS never sees PII.** It only handles 32 bytes of key material. There is no
payload size limit, no PII in KMS audit logs, and no throughput ceiling tied to
record size.

**No long-lived plaintext key in memory.** A DEK exists for the duration of one
request. A heap dump of a running container yields the one record being handled
at that instant — not the key to the entire database. Compare with the old
design, where `ENCRYPTION_KEY` sat in `process.env` for the container's whole
lifetime.

**Rotation is a metadata operation.** When `pii-kek` rotates, new writes use the
new version and existing wrapped DEKs keep decrypting under the version that
created them. Nothing has to be re-encrypted for rotation to take effect.

**Every decryption is logged.** Cloud Audit Logs record principal, key version
and timestamp for each `Decrypt` call. "Who read this customer's data, and
when" is a log query, not an inference from application logs the application
itself could have skipped writing.

### Encryption context

The customer's `publicId` is passed to KMS as Additional Authenticated Data.
This binds a wrapped DEK to one specific row: an operator with database write
access who copies customer A's wrapped key onto customer B's row gets a
decryption failure, not a working key. Without AAD, that row-swap is a valid
attack, and the on-chain hash check would not catch it — the attacker controls
both halves of the row.

---

## The Ethereum operator key

`operator-signing` is an `EC_SIGN_SECP256K1_SHA256` key generated inside the
HSM. There is no export API for it. A fully compromised container can ask KMS
to sign transactions — which is why the signing-rate alert exists — but cannot
steal the key, so the blast radius ends when the breach is closed. Under the
old design, a single leaked private key meant permanent, unrevocable control.

Two implementation details in `src/services/kmsSigner.ts`:

- Ethereum digests are keccak256, not SHA-256. KMS signs whatever 32-byte
  digest it is handed for a SHA256 key, so the keccak digest goes in the
  `digest.sha256` field. The field name describes the expected digest length,
  not a hash KMS recomputes.
- KMS returns DER `(r, s)` with no recovery id and no low-s enforcement. The
  signer normalises `s` into the lower half of the curve order (EIP-2) and
  recovers the parity bit by trying both candidates against its own address.

**`operator` is immutable in `KYCVault.sol`.** Moving to a KMS-held key
therefore requires a fresh contract deployment. See `KMS_RUNBOOK.md`.

---

## Database

| Property | Setting | Reason |
|---|---|---|
| Public IP | none | The instance is unreachable from the internet by construction, not by firewall rule |
| Connectivity | private IP over VPC peering, reached through a Serverless VPC connector | Traffic never leaves Google's network |
| Authentication | Cloud SQL IAM auth via the Auth Proxy sidecar (`--auto-iam-authn`) | No database password exists to leak. The "password" is a short-lived OAuth token minted per connection |
| Encryption at rest | CMEK (`sql-cmek`) covering data, backups and WAL | Destroying the key crypto-shreds the instance — the lever for a full-tenant erasure order |
| Transport | `ssl_mode = ENCRYPTED_ONLY` | Rejects unencrypted connections at the instance |
| Backups | daily + PITR, 7-day transaction log retention, 30 backups | Ransomware and fat-finger recovery |
| Availability | `REGIONAL` (synchronous standby in a second zone) | Zone failure does not take the vault offline |
| `log_statement` | `ddl` only | Statement text would put encrypted-PII parameters into Cloud Logging, creating a second data store to protect |

Prisma has no native Cloud SQL connector, which is why the Auth Proxy runs as a
Cloud Run sidecar rather than being embedded. `DATABASE_URL` uses
`sslmode=disable` — correct *only* here, because the hop is a loopback socket
inside the same instance and the proxy holds the mTLS tunnel. Setting `require`
would make Prisma try to negotiate TLS with the local proxy, which does not
terminate it.

---

## What is still in Secret Manager

Envelope encryption removes the two catastrophic secrets. What remains are
values that must reach the process as plaintext to be useful at all:

- `jwt-secret` — HS256 session signing secret
- `verifier-registration-code`, `partner-registration-code` — shared codes
- `gcp-vision-api-key` — OCR

All are CMEK-encrypted, versioned, generated by Terraform (so no human pastes
them), and mounted by reference in the Cloud Run service — the values never
appear in the service YAML, in `terraform plan` output, or in deployment
history.

The break-glass Postgres password is stored separately and is **not** granted to
the backend service account. Reading it fires an alert.

---

## Identities

| Principal | Can do | Cannot do |
|---|---|---|
| `kycvault-*-backend` | Wrap/unwrap DEKs, ask the signing key to sign, connect to Cloud SQL as an IAM user, write logs and metrics | Read signing key material (no such API), create or destroy key versions, touch the CMEK keys, read the break-glass password |
| `kycvault-*-migrator` | Same KEK access plus schema migrations | Sign anything on-chain |

No exported service-account JSON key files exist. Cloud Run gets credentials
from the metadata server. **`backend/gcp-key.json.json` in the repository is a
leftover from the old design and should be deleted, and the key it contains
revoked in the IAM console.**

---

## Detection

Prevention is the encryption; detection is how you learn it was tested.

| Alert | Fires when | Meaning |
|---|---|---|
| PII KEK used by an unexpected principal | Any `Encrypt`/`Decrypt` on `pii-kek` by anyone but the backend or migrator | Treat as compromise. Revoke the principal's binding first, investigate second |
| Operator signing rate anomaly | >60 signatures in 5 minutes | Compromised JWT, a stuck retry loop in the nonce queue, or an attacker driving `/api/kyc/verify` |
| Break-glass password accessed | Any read of that secret | Confirm it maps to an approved change ticket, then rotate |

`DATA_READ` audit logging on Cloud KMS is enabled explicitly in `iam.tf`.
Without it, key usage is invisible — admin-activity logs alone do not record
`Decrypt` calls.

---

## Honest remaining limitations

- The API is publicly reachable; JWT and per-route role checks are the
  authorization boundary, not network position. A stolen JWT is still a valid
  session for up to 2 hours.
- The operator is a single KMS key, not a multi-sig. It is now unstealable, but
  it is still a single point of authorization.
- Rate limiting is per-IP and in-process; it does not survive a horizontal
  scale-out coordinated attack. Cloud Armor in front of Cloud Run is the next
  step.
- `AccessLog` deliberately survives customer erasure. It stores only the
  pseudonymous `publicId`, but it is still a retained record.
- Every PII read costs one KMS `Decrypt` call (~1ms, billed per operation).
  This is the price of per-read auditability. Caching unwrapped DEKs would cut
  it, and would also hollow out the audit trail — so it is deliberately absent.
