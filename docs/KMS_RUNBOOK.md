# KMS & Cloud SQL Runbook

Cutover, rotation and incident procedures. Read `SECURITY_ARCHITECTURE.md`
first for the why.

---

## 0. Before anything: contain the old secrets

The current `backend/env.yaml`, `backend/.env` and `backend/gcp-key.json.json`
contain live credentials in plaintext. Even after this migration they remain
valid until revoked. Treat all of them as compromised:

1. In the IAM console, delete the service-account key in `gcp-key.json.json`.
2. Regenerate the Vision API key and restrict it to the Vision API.
3. Move the current operator wallet's Sepolia balance out once the new contract
   is live (step 3 below).
4. Delete `env.yaml`, `.env` and `gcp-key.json.json` from disk. Confirm they
   are not in git history: `git log --all --full-history -- backend/env.yaml`.
   If they are, the secrets are public regardless of `.gitignore` and every one
   of them must be rotated, not just removed.

---

## 1. Provision the infrastructure

```bash
cd infra/terraform

# One-time: state bucket
gsutil mb -l asia-south1 gs://<project>-tfstate
gsutil versioning set on gs://<project>-tfstate

cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars           # project_id, cors_origin, alert_email

terraform init -backend-config="bucket=<project>-tfstate"
terraform plan -out=tfplan
terraform apply tfplan
```

`backend_image` and `contract_address` are not known yet. For the first apply,
point `backend_image` at any placeholder image and set `contract_address` to
the existing contract; both are corrected in steps 3 and 4.

Expect ~15 minutes, most of it the Cloud SQL instance and the VPC peering.

---

## 2. Derive the new operator address

```bash
cd backend
export GCP_PROJECT_ID=<project>
export KMS_LOCATION=asia-south1
export KMS_KEY_RING=$(terraform -chdir=../infra/terraform output -raw kms_signing_key_version | cut -d/ -f6)
export KMS_SIGNING_KEY=operator-signing
export KMS_SIGNING_KEY_VERSION=1

gcloud auth application-default login
npm run kms:address
```

This prints the Ethereum address the HSM key controls. Fund it from a Sepolia
faucet — it needs gas before it can do anything.

---

## 3. Redeploy the contract with the KMS operator

`KYCVault.sol` sets `operator` in the constructor and never lets it change, so
a new operator means a new deployment.

```bash
cd blockchain
# deploy.js currently passes deployer.address. Pass the KMS address instead:
npx hardhat run scripts/deploy.js --network sepolia --operator <kms-address>
```

Record the new contract address into `terraform.tfvars` as `contract_address`.

**Existing on-chain proofs do not migrate.** They live in the old contract's
storage. Customers verified against the old contract will read as unverified
against the new one. Options, in order of preference:

- Re-run verification for the existing customer set (small dataset — this is
  the clean choice).
- Keep the old contract address configured for reads and the new one for
  writes during a transition. This needs a code change in `blockchain.ts` and
  doubles the surface; only do it if the customer set is large.

---

## 4. Build, push, deploy

```bash
REPO=$(terraform -chdir=infra/terraform output -raw artifact_repository)
cd backend
gcloud auth configure-docker asia-south1-docker.pkg.dev

docker build -t $REPO/backend:$(git rev-parse --short HEAD) .
docker push $REPO/backend:$(git rev-parse --short HEAD)

# Deploy by digest, never by tag.
DIGEST=$(gcloud artifacts docker images describe \
  $REPO/backend:$(git rev-parse --short HEAD) --format='value(image_summary.digest)')
```

Put `$REPO/backend@$DIGEST` in `terraform.tfvars` as `backend_image`, then
`terraform apply`.

---

## 5. Migrate the data

Run against Cloud SQL as the migrator identity, with the **legacy**
`ENCRYPTION_KEY` still exported — it is the only way to read the old rows.

```bash
# Terminal 1: tunnel to the private instance
cloud-sql-proxy $(terraform -chdir=infra/terraform output -raw sql_connection_name) \
  --private-ip --auto-iam-authn --port 5432 \
  --impersonate-service-account=$(terraform -chdir=infra/terraform output -raw migrator_service_account)

# Terminal 2
cd backend
export DATABASE_URL="postgresql://<migrator-sa>@127.0.0.1:5432/kycvault?sslmode=disable"
export ENCRYPTION_KEY=<the old 64-hex key>
export GCP_PROJECT_ID=... KMS_LOCATION=... KMS_KEY_RING=... KMS_PII_KEK=pii-kek

npx prisma migrate deploy          # adds Customer.kmsKeyVersion
npm run backfill:encryption -- --dry
npm run backfill:encryption
```

The backfill is idempotent and verifies each row twice before committing: the
decrypted plaintext must still hash to the value anchored on-chain, and the new
ciphertext must round-trip. Rows that fail either check are reported and left
untouched — investigate those individually rather than forcing them.

When it reports `already v2` for every row and `failed: 0`:

1. Remove `ENCRYPTION_KEY` and `ENCRYPTION_KEY_PREVIOUS` from every
   environment.
2. Delete `decryptLegacy`, `legacyKeys` and `isLegacyPayload` from
   `src/utils/crypto.ts`.
3. Delete `DEPLOYER_PRIVATE_KEY` from every environment.

Until step 1 is done, the old key still decrypts nothing new but is still a
live secret — finish the cutover promptly.

---

## Rotation

### PII KEK — automatic, 90 days

Nothing to do. New writes use the new version; existing rows keep decrypting
under the version that wrapped them. To see the spread:

```sql
SELECT "kmsKeyVersion", count(*) FROM "Customer" GROUP BY 1 ORDER BY 2 DESC;
```

To force every row onto the current version (only needed if a specific key
version is suspected compromised), re-run the backfill after temporarily
changing `isLegacyPayload` to also treat old key versions as stale.

### Operator signing key — manual, deliberate

Rotating changes the derived Ethereum address, which means a new contract
deployment. It is a planned migration, not a schedule. Add a key version, run
`npm run kms:address` with `KMS_SIGNING_KEY_VERSION` pointing at it, then repeat
steps 3–4.

### Break-glass Postgres password

```bash
terraform -chdir=infra/terraform taint random_password.breakglass
terraform -chdir=infra/terraform apply
```

---

## Incident: "PII KEK used by an unexpected principal"

1. **Revoke first.** Find the principal in the audit log entry and remove its
   binding on `pii-kek`. Do not investigate first — every second it holds the
   binding is more rows it can decrypt.

   ```bash
   gcloud kms keys remove-iam-policy-binding pii-kek \
     --keyring=kycvault-prod-keyring --location=asia-south1 \
     --member="<principal>" --role=roles/cloudkms.cryptoKeyEncrypterDecrypter
   ```

2. Scope the exposure — the audit log tells you exactly how many `Decrypt`
   calls succeeded and when:

   ```
   resource.type="cloudkms_cryptokey"
   resource.labels.crypto_key_id="pii-kek"
   protoPayload.authenticationInfo.principalEmail="<principal>"
   ```

   The count is the number of customer records read. Cross-reference the
   timestamps against `AccessLog` to see which ones.

3. If the principal was a compromised service account, disable it, then rotate
   the KEK and re-run the backfill so future reads need the new version.

4. Notify per DPDP breach timelines. The audit log gives you the exact affected
   record count, which is what the notification requires.

---

## Incident: operator signing spike

The key cannot be stolen, so the question is what is driving it:

1. Check `AccessLog` and the Cloud Run request log for a burst on
   `/api/kyc/verify`, `/api/consent/grant` or `/api/consent/revoke`.
2. If it is a stuck retry loop, the nonce queue in `blockchain.ts` resets
   `nextNonce` to `null` after any failure — a persistent RPC error will look
   like a signing storm. Check RPC health first.
3. To stop signing immediately without a deploy, remove the backend's
   `roles/cloudkms.signerVerifier` binding on `operator-signing`. Reads and
   PII access continue working; only on-chain writes fail.

---

## Disaster recovery

| Scenario | Recovery |
|---|---|
| Instance corruption | Point-in-time restore, 7-day window. CMEK key must still exist |
| Region outage | `REGIONAL` availability gives an automatic zonal failover. A full-region loss needs a cross-region backup restore — not configured; add `backup_configuration.location` in a second region if the RTO demands it |
| KEK accidentally scheduled for destruction | 30-day `destroy_scheduled_duration`. Restore with `gcloud kms keys versions restore`. **Past 30 days every PII record is permanently unreadable** |
| Signing key destroyed | The contract's operator role becomes permanently unusable. Redeploy the contract with a new key and re-verify customers |

The 30-day destroy window on every key is the single most important guardrail
here. Do not shorten it.
