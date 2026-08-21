<p align="center">
  <img src="https://img.shields.io/badge/Solidity-^0.8.19-363636?logo=solidity" alt="Solidity" />
  <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/PostgreSQL-Prisma_ORM-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Ethereum-Sepolia_Testnet-3C3C3D?logo=ethereum" alt="Ethereum" />
</p>

# Decentralized KYC Vault

A blockchain-backed identity verification platform that stores encrypted PII off-chain and anchors SHA-256 integrity hashes and consent records on an Ethereum smart contract, so customers verify once and share selectively with consenting partners.

---

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running Locally](#running-locally)
- [API Reference](#api-reference)
- [Smart Contract Reference](#smart-contract-reference)
- [Security Model](#security-model)
- [Known Limitations / Roadmap](#known-limitations--roadmap)
- [License](#license)

---

## Architecture

The system separates data across three layers so that no single layer holds enough to be a breach risk on its own.

```
┌─────────────────┐       ┌──────────────────────┐       ┌────────────────────┐
│   React SPA     │──────▶│  Node.js / Express   │──────▶│    PostgreSQL      │
│  (Tailwind CSS) │ JWT   │    Backend API        │ PII   │   (via Prisma)     │
│                 │◀──────│                      │◀──────│   AES-256-GCM      │
└─────────────────┘       └──────────┬───────────┘       └────────────────────┘
                                     │
                                     │ ethers.js (operator wallet)
                                     ▼
                          ┌──────────────────────┐
                          │  Ethereum Sepolia     │
                          │  KYCVault.sol         │
                          │  (SHA-256 Hash +      │
                          │   Consent ACL)        │
                          └──────────────────────┘
```

| Layer | What it stores | Why |
|---|---|---|
| **Blockchain** | SHA-256 hash of PII, consent flags (grant/revoke per partner), verification timestamp, verifier address | Tamper-evident proof; no PII on-chain |
| **Database** | AES-256-GCM encrypted PII, user accounts (scrypt-hashed passwords), consent records, access logs, OTP challenges | Mutable storage that can be erased for DPDP compliance |
| **Frontend** | JWT in `sessionStorage`; nothing persisted to disk | Stateless client |

**Operator-relayer model:** Every on-chain write (`verifyKYC`, `grantConsent`, `revokeConsent`) is restricted to a single `operator` address set at contract deployment. The backend holds the operator's private key and signs all transactions on behalf of authenticated users. End users never interact with the blockchain directly; they authenticate via JWT and the backend relays their intent to the contract.

---

## Tech Stack

| Component | Technology | Version (from package.json) |
|---|---|---|
| Smart Contract | Solidity, Hardhat | `^0.8.19`, Hardhat `^2.17.0` |
| Backend API | Node.js, Express, TypeScript | Express `^4.18.2`, TypeScript `^5.1.6` |
| ORM | Prisma | `@prisma/client ^5.2.0` |
| Database | PostgreSQL (any provider) | — |
| Frontend | React, Vite, Tailwind CSS | React `^18.2.0`, Vite `^4.4.5`, Tailwind `^3.3.3` |
| Blockchain RPC | ethers.js | `^6.7.1` |
| Encryption | AES-256-GCM (`node:crypto`) | — |
| Password hashing | scrypt (`node:crypto`) | 64-byte key, 16-byte salt |
| Auth | JSON Web Tokens | `jsonwebtoken ^9.0.3` |
| HTTP security | Helmet, express-rate-limit | Helmet `^8.3.0`, rate-limit `^8.6.2` |
| OCR | Google Cloud Vision API (REST) | Called via `fetch` with `GCP_API_KEY` |
| File upload | Multer (in-memory, 10 MB limit) | `^2.2.0` |

---

## Project Structure

```
idbi/
├── README.md
├── .gitignore
│
├── blockchain/                     # Smart contract layer
│   ├── contracts/
│   │   └── KYCVault.sol            # Core contract (operator-gated)
│   ├── scripts/
│   │   └── deploy.js               # Deploys with deployer as operator
│   ├── test/
│   │   └── KYCVault.test.js         # Hardhat unit tests
│   ├── hardhat.config.js            # Sepolia network config
│   ├── .env.example
│   └── package.json
│
├── backend/                        # API layer
│   ├── src/
│   │   ├── index.ts                 # Express server, all routes, JWT auth, rate limiting
│   │   ├── services/
│   │   │   ├── blockchain.ts        # ethers.js contract calls, nonce queue
│   │   │   ├── kms.ts               # Cloud KMS client, DEK generate/wrap/unwrap
│   │   │   └── kmsSigner.ts         # ethers v6 Signer backed by a KMS HSM key
│   │   └── utils/
│   │       ├── crypto.ts            # Envelope encryption (per-record DEK + KMS KEK)
│   │       └── password.ts          # scrypt hash and verify with timing-safe compare
│   ├── prisma/
│   │   └── schema.prisma            # Customer, Consent, BankUser, AccessLog, OtpChallenge
│   ├── scripts/
│   │   ├── backfill-envelope.ts     # Re-encrypts pre-KMS rows under per-record DEKs
│   │   └── kms-operator-address.ts  # Derives the Ethereum address of the KMS signing key
│   ├── Dockerfile                   # Multi-stage, non-root, used for Cloud Run
│   ├── .env.example
│   ├── tsconfig.json
│   └── package.json
│
├── infra/
│   └── terraform/                  # Infrastructure as code
│       ├── kms.tf                   # Keyring, PII KEK, secp256k1 signing key, CMEK keys
│       ├── cloudsql.tf              # Private-IP Postgres, CMEK, IAM auth, PITR
│       ├── cloudrun.tf              # Service + Cloud SQL Auth Proxy sidecar
│       ├── network.tf               # VPC, private service access, VPC connector
│       ├── secrets.tf               # Secret Manager under CMEK
│       ├── iam.tf                   # Service accounts, least privilege, audit logs
│       └── monitoring.tf            # Key-misuse and signing-rate alerts
│
├── docs/
│   ├── SECURITY_ARCHITECTURE.md    # Key hierarchy and threat model
│   └── KMS_RUNBOOK.md              # Cutover, rotation, incident response
│
└── frontend/                       # UI layer
    ├── src/
    │   ├── App.jsx                  # Router: /, /bank, /customer, /partner
    │   ├── main.jsx                 # Entry point
    │   ├── index.css                # Design system (Tailwind + custom)
    │   ├── screens/
    │   │   ├── Auth.jsx             # Login / register (role picker + auth codes)
    │   │   ├── VerifierDashboard.jsx # OCR upload, KYC verification
    │   │   ├── CustomerVault.jsx    # Identity view, consent, OTP, audit, self-destruct
    │   │   └── PartnerConsole.jsx   # Consent-based and OTP-based data access
    │   ├── components/
    │   │   ├── Nav.jsx              # Header with network name + contract link
    │   │   ├── AuditEvent.jsx       # Audit trail entry renderer
    │   │   ├── OtpDisplay.jsx       # OTP code display with countdown
    │   │   ├── PartnerSelect.jsx    # Partner account dropdown
    │   │   ├── SecretValue.jsx      # Click-to-reveal for sensitive values
    │   │   ├── TxLink.jsx           # Etherscan link for transaction hashes
    │   │   ├── TxProgress.jsx       # Transaction progress indicator
    │   │   └── ui/
    │   │       └── index.jsx        # Reusable UI primitives (Card, Button, Input, etc.)
    │   ├── hooks/
    │   │   ├── useAuth.jsx          # AuthContext + provider (sessionStorage)
    │   │   └── useToast.jsx         # Toast notification system
    │   └── lib/
    │       ├── api.js               # Axios instance, interceptors, error helper
    │       └── format.js            # Date, hash, gov-ID formatting, role constants
    ├── index.html
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── firebase.json                # Firebase Hosting config
    ├── .firebaserc
    ├── .env.example
    └── package.json
```

---

## Prerequisites

- **Node.js** v18 or higher
- **npm** (bundled with Node.js)
- **PostgreSQL** database (any provider — Supabase, Cloud SQL, local, etc.)
- A funded **Ethereum Sepolia wallet** for contract deployment and transaction signing ([faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia))
- *Optional:* A **Google Cloud Vision API key** if you want OCR document extraction

---

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd idbi

# Smart contracts
cd blockchain && npm install && cd ..

# Backend
cd backend && npm install && cd ..

# Frontend
cd frontend && npm install && cd ..
```

### 2. Environment variables

Create `.env` files in each workspace by copying the examples:

```bash
cp blockchain/.env.example blockchain/.env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Then fill in the values. See the tables below for every variable.

#### `blockchain/.env`

| Variable | Required | Purpose |
|---|---|---|
| `DEPLOYER_PRIVATE_KEY` | Yes (for deploy) | Private key of the Sepolia wallet that will become the contract operator |
| `PRIVATE_KEY` | No | Alias for `DEPLOYER_PRIVATE_KEY`; either is accepted by `hardhat.config.js` |

#### `backend/.env`

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | No | HTTP listen port (defaults to `3001`) |
| `DATABASE_URL` | Yes | PostgreSQL connection string for Prisma |
| `RPC_URL` | No | Ethereum JSON-RPC endpoint (defaults to `https://ethereum-sepolia-rpc.publicnode.com` in `blockchain.ts`, `http://127.0.0.1:8545` at runtime) |
| `CONTRACT_ADDRESS` | Yes | Deployed `KYCVault` contract address |
| `GCP_PROJECT_ID` | Yes | Project holding the KMS keyring |
| `KMS_LOCATION` | Yes | KMS location, e.g. `asia-south1` |
| `KMS_KEY_RING` | Yes | Keyring name from `terraform output` |
| `KMS_PII_KEK` | Yes | Symmetric key that wraps per-record data keys. The server refuses to start in production without it |
| `KMS_SIGNING_KEY` | Yes | Asymmetric secp256k1 key holding the Ethereum operator identity |
| `KMS_SIGNING_KEY_VERSION` | No | Key version to sign with (defaults to `1`) |
| `DEPLOYER_PRIVATE_KEY` | No | Legacy raw operator key. Used only if `KMS_SIGNING_KEY` is unset, and logs a warning when it is |
| `ENCRYPTION_KEY` | No | Legacy PII key. Needed only during the migration window, to read pre-KMS rows |
| `ENCRYPTION_KEY_PREVIOUS` | No | Second legacy key, same purpose |
| `JWT_SECRET` | Yes | Secret for signing/verifying JWTs; the server throws at boot if this is empty |
| `GCP_API_KEY` | No | Google Cloud Vision API key; the `/api/ocr/extract` route returns 503 if unset |
| `CORS_ORIGIN` | No | Comma-separated allowed origins; if unset, CORS is open |
| `VERIFIER_REGISTRATION_CODE` | No | Authorization code required to register a `VERIFIER` account; if unset, verifier registration is blocked |
| `PARTNER_REGISTRATION_CODE` | No | Authorization code required to register a `PARTNER` account; if unset, partner registration is blocked |
| `WAIT_FOR_CONFIRMATION` | No | Set to `"false"` to skip waiting for on-chain transaction confirmation (defaults to true) |
| `LIVE_RPC_URL` | No | Read by `.env` but not referenced in source code [verify] |

> **Never commit `.env` files.** The `.gitignore` already excludes them.

#### `frontend/.env`

| Variable | Required | Purpose |
|---|---|---|
| `VITE_API_URL` | No | Backend API base URL (defaults to a hardcoded Cloud Run URL in `api.js`) |
| `VITE_EXPLORER_URL` | No | Block explorer base URL (defaults to `https://sepolia.etherscan.io`) |
| `VITE_NETWORK_NAME` | No | Displayed in the header (defaults to `Sepolia Testnet`) |
| `VITE_CONTRACT_ADDRESS` | No | If set, the header renders a link to the contract on the explorer |

### 3. Deploy the smart contract

```bash
cd blockchain
npx hardhat run scripts/deploy.js --network sepolia
```

The deploy script passes `deployer.address` as the constructor argument, making the deployer the contract's immutable `operator`. Copy the printed contract address into `backend/.env` as `CONTRACT_ADDRESS`.

### 4. Push the database schema

```bash
cd backend
npx prisma generate
npx prisma db push
```

This creates five tables: `Customer`, `Consent`, `BankUser`, `AccessLog`, and `OtpChallenge`.

### 5. Register accounts

There are no pre-seeded accounts. Register via the UI or the `/api/auth/register` endpoint.

- **Customer** accounts require no authorization code.
- **Verifier** accounts require the value of `VERIFIER_REGISTRATION_CODE` from the backend `.env`.
- **Partner** accounts require the value of `PARTNER_REGISTRATION_CODE` from the backend `.env`.

---

## Running Locally

Open two terminals:

```bash
# Terminal 1 — Backend (default port 3001)
cd backend
npm run dev

# Terminal 2 — Frontend (Vite dev server)
cd frontend
npm run dev
```

Open the URL printed by Vite (typically `http://localhost:5173`).

---

## API Reference

All protected endpoints require `Authorization: Bearer <JWT>`. Rate limiting is applied to auth endpoints (20 requests / 15 min) and OTP verification (30 requests / 15 min).

### Authentication

| Method | Endpoint | Auth | Body | Response |
|---|---|---|---|---|
| `POST` | `/api/auth/register` | None (rate-limited) | `{ username, password, role, registrationCode? }` | `{ token, user: { username, role, bankId } }` |
| `POST` | `/api/auth/login` | None (rate-limited) | `{ username, password }` | `{ token, user: { username, role, bankId } }` |

- `role` must be one of `VERIFIER`, `CUSTOMER`, `PARTNER` (case-insensitive).
- `password` minimum length: 8 characters.
- Non-`CUSTOMER` roles require a matching `registrationCode`.

### KYC Operations

| Method | Endpoint | Role | Body | Response |
|---|---|---|---|---|
| `POST` | `/api/kyc/verify` | `VERIFIER` | `{ customerId, pii: { fullName, govId? } }` | `{ success, txHash, piiHash }` |
| `GET` | `/api/kyc/access/:customerId` | `PARTNER` | — | `{ success, pii, verifiedAt, verifiedAtUnix }` |
| `GET` | `/api/kyc/me` | `CUSTOMER` | — | `{ success, verified, integrityOk, pii, piiHash, verifiedAt, verifierBank, expiresAt, consents }` |
| `DELETE` | `/api/kyc/forget` | `CUSTOMER` | — | `{ success, message, deletedRecords }` |
| `POST` | `/api/kyc/set-expiry` | `CUSTOMER` | `{ minutes }` (0–10080) | `{ success, expiresAt }` |

- `POST /api/kyc/verify` encrypts PII with AES-256-GCM, stores the ciphertext in the database, computes a SHA-256 hash, and calls `verifyKYC(customerId, hash)` on-chain. Fails if the customer already has a valid proof on-chain.
- `GET /api/kyc/access/:customerId` checks on-chain consent and verification, decrypts PII, verifies the hash against the on-chain record, and returns data only if all checks pass. Every attempt (granted or denied) is logged to `AccessLog`.
- `DELETE /api/kyc/forget` permanently deletes the customer's off-chain PII, consents, and OTP challenges. The on-chain hash becomes an orphan.

### Consent Management

| Method | Endpoint | Role | Body | Response |
|---|---|---|---|---|
| `POST` | `/api/consent/grant` | `CUSTOMER` | `{ partnerId }` | `{ success, txHash, partnerId }` |
| `POST` | `/api/consent/revoke` | `CUSTOMER` | `{ partnerId }` | `{ success, txHash, partnerId }` |

- `partnerId` is resolved against registered `PARTNER` accounts by username or bankId (case-insensitive).
- Both endpoints update the database consent record and call the corresponding on-chain function.

### OTP-Based Sharing

| Method | Endpoint | Role | Body | Response |
|---|---|---|---|---|
| `POST` | `/api/otp/generate` | `CUSTOMER` | `{ partnerId, disclosureType? }` | `{ success, otp, expiresInSeconds, partnerId }` |
| `POST` | `/api/otp/verify` | `PARTNER` (rate-limited) | `{ customerId, otp }` | `{ success, customerId, pii, verifiedVia, verifiedAt, issuedAt }` |

- `disclosureType` controls what fields are returned: `FULL` (default), `NAME_ONLY` (govId hidden), or `PROOF_OF_EXISTENCE` (all fields hidden, only confirmation of identity).
- OTPs are 6 digits, valid for 5 minutes, with a maximum of 5 verification attempts per challenge.
- OTP does **not** require on-chain consent; it is an independent access channel. The partner still needs a valid on-chain KYC proof to exist.

### OCR

| Method | Endpoint | Role | Body | Response |
|---|---|---|---|---|
| `POST` | `/api/ocr/extract` | `VERIFIER` | `multipart/form-data` with field `document` (PDF, JPEG, PNG, WebP; max 10 MB) | `{ success, extracted: { fullName, govId, dob }, rawText }` |

- Requires `GCP_API_KEY` to be set; returns 503 otherwise.
- Uses Google Cloud Vision `TEXT_DETECTION` and applies heuristics to extract name, government ID (Aadhaar/PAN patterns), and date of birth.

### Other

| Method | Endpoint | Role | Body | Response |
|---|---|---|---|---|
| `GET` | `/api/partners` | Any authenticated | — | `{ success, partners: [{ username, bankId }] }` |
| `GET` | `/api/audit/:customerId` | `CUSTOMER` (own ID only) | — | `{ success, customerId, auditTrail, expiresAt }` |
| `GET` | `/health` | None | — | `{ ok: true }` |

- The audit trail merges KYC verification events, consent changes, and access log entries into a single chronological list.

---

## Smart Contract Reference

**Contract:** `KYCVault.sol`
**Solidity:** `^0.8.19`
**Network:** Ethereum Sepolia Testnet

### State

- `operator` — `address`, immutable, set in the constructor. Every write function is gated by `onlyOperator`.
- `kycProofs` — `mapping(string => KYCProof)`. Each `KYCProof` contains `payloadHash` (bytes32), `verifiedAt` (uint256), `isValid` (bool), `verifierBank` (address).
- `consentList` — `mapping(string => mapping(bytes32 => bool))`. Maps `customerId` to `keccak256(partnerId)` to a boolean.

### Functions

| Function | Access | Description |
|---|---|---|
| `verifyKYC(string customerId, bytes32 payloadHash)` | `onlyOperator` | Creates a KYC proof. Reverts if a valid proof already exists for that customer. |
| `grantConsent(string customerId, bytes32 partnerIdHash)` | `onlyOperator` | Sets consent to `true`. Requires a valid KYC proof to exist. |
| `revokeConsent(string customerId, bytes32 partnerIdHash)` | `onlyOperator` | Sets consent to `false`. Requires a valid KYC proof to exist. |
| `hasConsent(string customerId, bytes32 partnerIdHash)` | Anyone (`view`) | Returns the consent boolean. |
| `checkStatus(string customerId, bytes32 partnerIdHash)` | Anyone (`view`) | Returns `(consentGranted, isVerified, payloadHash, verifiedAt, verifierBank)`. |

**Important:** The `partnerIdHash` stored on-chain is `keccak256(lowercase(partnerId))`, computed by the backend in `blockchain.ts` via `ethers.id(partnerId.trim().toLowerCase())`. The contract itself receives and stores the hash, not the raw partner ID string.

### Events

| Event | Parameters | Emitted When |
|---|---|---|
| `KYCVerified` | `customerId` (indexed), `verifierBank` (indexed), `payloadHash` | `verifyKYC` succeeds |
| `ConsentGranted` | `customerId` (indexed), `partnerIdHash` (indexed) | `grantConsent` succeeds |
| `ConsentRevoked` | `customerId` (indexed), `partnerIdHash` (indexed) | `revokeConsent` succeeds |

### Transaction serialization

The backend serializes all contract writes through a promise queue with local nonce tracking (`blockchain.ts`). This prevents `NONCE_EXPIRED` errors from concurrent requests hitting the same operator wallet. By default, the backend waits for on-chain confirmation before returning; set `WAIT_FOR_CONFIRMATION=false` to skip the wait.

---

## Security Model

| Concern | Mitigation |
|---|---|
| **PII at rest** | Envelope encryption. A unique 256-bit data key per record encrypts the PII with AES-256-GCM; that data key is wrapped by an HSM-backed Cloud KMS key (`pii-kek`) using the customer's `publicId` as Additional Authenticated Data. KMS never sees plaintext PII, no long-lived key sits in process memory, the KEK auto-rotates every 90 days, and every decryption is recorded in Cloud Audit Logs. |
| **PII in transit** | HTTPS (TLS terminated by the hosting layer). Helmet sets security headers. |
| **Password storage** | scrypt with 16-byte random salt, 64-byte derived key, timing-safe comparison. Legacy plain-text passwords are auto-rehashed on successful login. |
| **Unauthorized data access** | Backend checks on-chain consent via `checkStatus` before returning PII. OTP path verifies a HMAC'd challenge with attempt limits (5) and expiry (5 min). |
| **Data tampering** | SHA-256 hash of the plaintext PII is stored on-chain at verification time. The backend recomputes the hash at access time and rejects the request if they do not match. |
| **Session security** | JWT with 2-hour expiry stored in `sessionStorage` (cleared on tab close). The Axios interceptor clears stale tokens on 401/403. |
| **Brute force** | `express-rate-limit` on auth routes (20/15 min) and OTP verification (30/15 min). Per-challenge attempt cap (5). |
| **Right to be Forgotten** | `DELETE /api/kyc/forget` erases all off-chain data (PII, consents, OTP challenges). The on-chain hash becomes an orphan with no corresponding plaintext. |
| **Self-destruct timer** | Customers can set an expiry (0–10080 minutes) on their record. A 60-second background sweep deletes expired records. |
| **Credential exposure** | `.gitignore` excludes `.env` files, `node_modules`, and build artifacts. |

| **Operator signing key** | An `EC_SIGN_SECP256K1_SHA256` key generated inside a Cloud KMS HSM. It is non-exportable: there is no plaintext copy anywhere. A compromised runtime can request signatures (rate-alerted) but cannot steal the key, so the blast radius ends when the breach is closed. |
| **Database** | Cloud SQL for PostgreSQL with no public IP, reached over private VPC peering. Authentication is Cloud SQL IAM auth via the Auth Proxy - no database password exists. Data, backups and WAL are encrypted with a customer-managed KMS key. |
| **Application secrets** | Secret Manager under CMEK, generated by Terraform and mounted by reference into Cloud Run, so values never appear in service config or deployment history. |

### Honest limitations of the security model

- The single operator key signs every on-chain transaction; there is no multi-sig or per-user signing. It is now unstealable, but it is still a single point of authorization.
- Rate limiting is per-IP. Cloud Run behind a load balancer requires `trust proxy` (set to `1`).
- The `AccessLog` table deliberately survives customer erasure (it stores only the pseudonymous `publicId`, not PII) to satisfy audit requirements, but this is a design trade-off.
- The OCR extraction uses heuristics and may misidentify names or IDs on non-standard documents.

---

## Known Limitations / Roadmap

- **Zero-Knowledge Proofs** — Replace full PII disclosure with zk-SNARKs (e.g., prove age >= 18 without revealing DOB). The `PROOF_OF_EXISTENCE` disclosure type is a manual approximation, not a cryptographic proof.
- **Re-verification** — `verifyKYC` reverts if a proof already exists (`"KYC already verified"`). There is no update or re-verification path on-chain.
- **Production chain** — Migrate from Sepolia testnet to a production EVM chain.
- **Per-user signing** — Let customers and verifiers sign their own transactions via browser wallets instead of relaying through the operator.
- **File storage** — Uploaded documents are processed in-memory and discarded; the backend does not persist original documents.

---

## License

MIT
