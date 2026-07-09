<p align="center">
  <img src="https://img.shields.io/badge/Solidity-^0.8.19-363636?logo=solidity" alt="Solidity" />
  <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/Google_Cloud_SQL-PostgreSQL-4285F4?logo=googlecloud&logoColor=white" alt="Cloud SQL" />
  <img src="https://img.shields.io/badge/Ethereum-Sepolia_Testnet-3C3C3D?logo=ethereum" alt="Ethereum" />
</p>

# 🔐 Decentralized KYC Vault

> **A blockchain-backed, privacy-first identity verification platform that separates sensitive PII from immutable consent proofs — built for India's DPDP Act and RBI KYC Master Directions.**

---

## 📖 Table of Contents

- [Problem Statement](#-problem-statement)
- [Solution Architecture](#-solution-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Installation & Setup](#-installation--setup)
- [Environment Variables](#-environment-variables)
- [Running the Application](#-running-the-application)
- [Demo Walkthrough (Step-by-Step)](#-demo-walkthrough-step-by-step)
- [Smart Contract Details](#-smart-contract-details)
- [API Reference](#-api-reference)
- [Security Model](#-security-model)
- [Future Roadmap](#-future-roadmap)
- [License](#license)

---

## 🎯 Problem Statement

Every time a customer opens a new bank account, trading account, or insurance policy, they must re-submit their KYC documents (Aadhaar, PAN, passport). This leads to:

- **Data duplication** across dozens of financial institutions
- **Privacy risk** — each copy is a potential breach surface
- **Regulatory friction** — DPDP Act mandates explicit consent for every data share
- **Customer fatigue** — repeated form-filling with no control over who holds their data

## 💡 Solution Architecture

```
┌─────────────────┐       ┌──────────────────────┐       ┌────────────────────┐
│   React SPA     │──────▶│  Node.js / Express   │──────▶│  Google Cloud SQL  │
│  (Neumorphic)   │ JWT   │    Backend API        │ PII   │   (PostgreSQL)     │
│                 │◀──────│                      │◀──────│   AES-256-GCM      │
└─────────────────┘       └──────────┬───────────┘       └────────────────────┘
                                     │
                                     │ ethers.js
                                     ▼
                          ┌──────────────────────┐
                          │  Ethereum Sepolia     │
                          │  KYCVault.sol         │
                          │  (SHA-256 Hash +      │
                          │   Consent ACL)        │
                          └──────────────────────┘
```

**Core Principle — Zero PII on Chain:**

| Layer | What it stores | Technology |
|-------|---------------|------------|
| **Blockchain** | SHA-256 hash of PII, consent ACL, timestamps | Ethereum Sepolia (EVM) |
| **Cloud Database** | AES-256-GCM encrypted PII | Google Cloud SQL (PostgreSQL) |
| **Frontend** | Nothing persisted — JWT in localStorage | React + Vite |

---

## 🛠 Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Smart Contracts | Solidity ^0.8.19, Hardhat | On-chain KYC proofs & consent |
| Backend API | Node.js, Express, TypeScript | REST API, encryption, JWT auth |
| ORM | Prisma | Database access & migrations |
| Database | Google Cloud SQL (PostgreSQL) | Encrypted PII storage |
| Frontend | React 18, Vite, TailwindCSS | Neumorphic UI |
| Blockchain RPC | PublicNode Sepolia / GCP Web3 | Testnet connectivity |
| Encryption | AES-256-GCM (Node.js crypto) | PII encryption at rest |
| Auth | JSON Web Tokens (JWT) | Role-based access control |

---

## 📁 Project Structure

```
idbi/
├── .gitignore
├── README.md
│
├── blockchain/                # Smart Contract Layer
│   ├── contracts/
│   │   └── KYCVault.sol       # Core smart contract
│   ├── scripts/
│   │   └── deploy.js          # Deployment script
│   ├── test/
│   │   └── KYCVault.test.js   # Unit tests
│   └── hardhat.config.js      # Network config (Sepolia)
│
├── backend/                   # API Layer
│   ├── src/
│   │   ├── index.ts           # Express server, JWT auth, routes
│   │   ├── utils/
│   │   │   └── crypto.ts      # AES-256-GCM encrypt/decrypt
│   │   └── services/
│   │       └── blockchain.ts  # ethers.js contract interactions
│   ├── prisma/
│   │   └── schema.prisma      # Database schema (PostgreSQL)
│   └── tsconfig.json
│
└── frontend/                  # UI Layer
    ├── src/
    │   ├── App.jsx            # React components & routing
    │   ├── index.css          # Neumorphic design system
    │   └── main.jsx           # Entry point
    ├── index.html
    ├── vite.config.js
    └── tailwind.config.js
```

---

## 📋 Prerequisites

- **Node.js** v18 or higher — [Download](https://nodejs.org/)
- **npm** (bundled with Node.js)
- **MetaMask** wallet with Sepolia ETH — [Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)
- **Google Cloud SQL** instance (PostgreSQL) — [Console](https://console.cloud.google.com/sql)

---

## ⚡ Installation & Setup

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/decentralized-kyc-vault.git
cd decentralized-kyc-vault
```

### 2. Install Dependencies (all three workspaces)

```bash
# Smart Contracts
cd blockchain && npm install && cd ..

# Backend
cd backend && npm install && cd ..

# Frontend
cd frontend && npm install && cd ..
```

### 3. Configure Environment Variables

Create a `.env` file inside the `backend/` directory:

```bash
# backend/.env

PORT=3001
CONTRACT_ADDRESS=0x7870Ff19FD81Ac191C677b917ce4eD4cC2ff68A7
RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
ENCRYPTION_KEY=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@YOUR_CLOUD_SQL_IP:5432/postgres?schema=public"
DEPLOYER_PRIVATE_KEY="YOUR_METAMASK_PRIVATE_KEY"
```

> ⚠️ **Never commit the `.env` file.** The `.gitignore` already excludes it.

### 4. Deploy the Smart Contract (optional — already deployed)

The contract is already live at `0x7870Ff19FD81Ac191C677b917ce4eD4cC2ff68A7` on Sepolia.

To redeploy:
```bash
cd blockchain
npx hardhat run scripts/deploy.js --network sepolia
```

### 5. Push Database Schema to Cloud SQL

```bash
cd backend
npx prisma db push
npx prisma generate
```

---

## 🚀 Running the Application

Open **three terminals** and run:

```bash
# Terminal 1 — Backend API (port 3001)
cd backend
npm run dev

# Terminal 2 — Frontend (port 3000)
cd frontend
npm run dev
```

Open your browser at **http://localhost:3000**

---

## 🎬 Demo Walkthrough (Step-by-Step)

This walkthrough demonstrates the **complete end-to-end flow** with three users.

### Pre-seeded Test Accounts

| Username | Password | Role | Dashboard |
|----------|----------|------|-----------|
| `bankA` | `password` | VERIFIER | Bank Verifier Node |
| `john` | `password` | CUSTOMER | Identity Vault |
| `bankB` | `password` | PARTNER | Partner Console |

You can also **register new accounts** via the Sign Up page.

---

### Step 1: Bank Verifies a Customer (Verifier)

1. Open `http://localhost:3000`
2. **Log in** as `bankA` / `password`
3. You land on the **Bank Verifier Node** dashboard
4. Fill out the form:
   - Customer Public ID: `demo_user_1`
   - Full Name: `Alice Wonderland`
   - Government ID: `1234-5678-9012`
5. Click **"Encrypt & Mint On-Chain Proof"**

**What happens behind the scenes:**
```
Frontend  →  POST /api/kyc/verify (JWT protected)
                │
Backend   →  1. Encrypts PII with AES-256-GCM
             2. Stores encrypted blob in Google Cloud SQL
             3. Computes SHA-256 hash of the PII
             4. Calls KYCVault.verifyKYC(customerId, hash) on Ethereum Sepolia
             5. Returns the live Ethereum TxHash
```

The TxHash appears in the status panel. You can verify it on [Sepolia Etherscan](https://sepolia.etherscan.io).

---

### Step 2: Customer Grants Consent (Customer)

1. **Log out** → Click the logout icon in the top-right
2. **Register** (or log in) as the customer:
   - Username: `demo_user_1`
   - Password: `password`
   - Role: `Individual Customer`
3. You land on the **Identity Vault** dashboard
4. Enter Partner ID: `bankB`
5. Click **"Grant Access"**

**What happens behind the scenes:**
```
Frontend  →  POST /api/consent/grant (JWT protected)
                │
Backend   →  1. Records consent in Cloud SQL
             2. Calls KYCVault.grantConsent(customerId, partnerAddress) on Sepolia
             3. Returns the live Ethereum TxHash
```

The blockchain now permanently records that `demo_user_1` authorized `bankB` to access their data.

---

### Step 3: Partner Fetches Verified Data (Partner)

1. **Log out**
2. **Log in** as `bankB` / `password`
3. You land on the **Partner Console**
4. Enter Customer ID: `demo_user_1`
5. Click **"Verify & Fetch"**

**What happens behind the scenes:**
```
Frontend  →  GET /api/kyc/access/demo_user_1 (JWT protected)
                │
Backend   →  1. Queries KYCVault.checkStatus() on Sepolia
             2. IF hasConsent == true:
                  a. Fetches encrypted PII from Google Cloud SQL
                  b. Decrypts with AES-256-GCM
                  c. Verifies SHA-256 hash matches blockchain record
                  d. Returns decrypted PII to the partner
             3. IF hasConsent == false:
                  → 403 "Access Denied: No active consent found"
```

**Result:** The partner sees Alice's verified name and Government ID, along with the on-chain verification timestamp. If consent was never granted (or revoked), the smart contract physically blocks the data retrieval.

---

### Step 4: Verify on Etherscan (The Proof)

1. Open [Sepolia Etherscan](https://sepolia.etherscan.io/address/0x7870Ff19FD81Ac191C677b917ce4eD4cC2ff68A7)
2. Click the **"Internal Txns"** or **"Transactions"** tab
3. You will see the actual live transactions generated by Steps 1–3

This proves the system is not a mockup — it is executing real, verifiable transactions on the Ethereum public testnet.

---

## 📜 Smart Contract Details

**Contract:** `KYCVault.sol`  
**Network:** Ethereum Sepolia Testnet  
**Address:** [`0x7870Ff19FD81Ac191C677b917ce4eD4cC2ff68A7`](https://sepolia.etherscan.io/address/0x7870Ff19FD81Ac191C677b917ce4eD4cC2ff68A7)

| Function | Access | Description |
|----------|--------|-------------|
| `verifyKYC(customerId, payloadHash)` | Originator Bank | Mints a KYC proof on-chain |
| `grantConsent(customerId, partnerBank)` | Customer | Authorizes a partner to access data |
| `revokeConsent(customerId, partnerBank)` | Customer | Revokes partner access |
| `checkStatus(customerId, partnerBank)` | Anyone | Reads consent status & proof hash |

| Event | Emitted When |
|-------|-------------|
| `KYCVerified` | A new KYC proof is minted |
| `ConsentGranted` | Customer grants a partner access |
| `ConsentRevoked` | Customer revokes partner access |

---

## 📡 API Reference

All protected endpoints require `Authorization: Bearer <JWT>` header.

### Authentication

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | `{ username, password, role }` | Register a new user |
| POST | `/api/auth/login` | `{ username, password }` | Login, returns JWT |

### KYC Operations

| Method | Endpoint | Role | Body | Description |
|--------|----------|------|------|-------------|
| POST | `/api/kyc/verify` | VERIFIER | `{ customerId, pii: { fullName, govId } }` | Encrypt PII + mint proof |
| GET | `/api/kyc/access/:customerId` | PARTNER | — | Fetch verified PII (consent required) |

### Consent Management

| Method | Endpoint | Role | Body | Description |
|--------|----------|------|------|-------------|
| POST | `/api/consent/grant` | CUSTOMER | `{ partnerId }` | Grant partner access |
| POST | `/api/consent/revoke` | CUSTOMER | `{ partnerId }` | Revoke partner access |

---

## 🔒 Security Model

| Threat | Mitigation |
|--------|-----------|
| PII leakage from database | AES-256-GCM encryption at the application layer |
| Unauthorized data access | Smart contract enforces consent before API returns data |
| Tampered data | SHA-256 hash on blockchain — backend verifies before serving |
| Credential exposure | `.gitignore` excludes `.env`, private keys, GCP service accounts |
| Session hijacking | JWT with 2-hour expiry, role-based route protection |
| Right to be Forgotten (DPDP) | Delete off-chain record; on-chain hash becomes orphaned |

---

## 🗺 Future Roadmap

- **Google Cloud KMS** — Move from `.env` encryption keys to managed KMS
- **Zero-Knowledge Proofs** — Upgrade to zk-SNARKs (prove age ≥ 18 without revealing DOB)
- **IPFS Storage** — Private IPFS network restricted to banking consortium members
- **Multi-sig Consent** — Require both customer + regulator approval for high-risk data shares
- **Production EVM** — Migrate from Sepolia to Polygon PoS or a permissioned Hyperledger Besu chain

---

## License

MIT © 2025 Decentralized KYC Vault Team
