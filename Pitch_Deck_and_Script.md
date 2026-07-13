# IDBI Bank: Decentralized KYC Vault
## Pitch Deck & Speaker Notes Guide

---

### Slide 1: Title Slide
**Visuals:** Team Name, Project Title ("Decentralized KYC Vault"), IDBI Bank Logo.
**Speaker Notes:**
> "Namaste, judges. We are presenting the Decentralized KYC Vault—a Web3, privacy-first identity solution designed to solve IDBI Bank's most expensive and dangerous data problems."

---

### Slide 2: The Problem (Status Quo)
**Visuals:**
* Current IDBI Customer Base: 2.4 Crore (24 Million).
* E-KYC Cost: ₹30 - ₹50 per user (Total cost: ₹7.2+ Crores).
* Data Liability: Storing 2.4 Crore raw Aadhaar/PAN cards creates a 120 Terabyte "Honeypot" for hackers.
**Speaker Notes:**
> "Today, IDBI Bank spends over 7.2 Crores just to verify its 2.4 Crore customers. Worse, storing all those raw Aadhaar and PAN cards creates a massive 120-Terabyte centralized honeypot of sensitive data, just waiting for a catastrophic security breach."

---

### Slide 3: The Solution (Web3 Vault)
**Visuals:**
* Zero-Trust Architecture: No raw documents stored after verification.
* Automated AI: Google Cloud Vision AI extracts data in 1.5s.
* Immutable Ledger: Cryptographic hashes anchored to the Ethereum Sepolia Blockchain.
**Speaker Notes:**
> "We built a serverless, Web3 identity vault. A user connects their MetaMask wallet and uploads their ID. Our backend leverages Google Vision AI to extract the data in 1.5 seconds. Once validated, the raw image is discarded. We generate a tiny cryptographic hash of that data and anchor it to the blockchain."

---

### Slide 4: Prototype Performance & Benchmarks
**Visuals:** (Include the 100/100 PageSpeed Insights Screenshot here)
* Frontend Performance: 100/100 (Google PageSpeed Insights)
* First Contentful Paint: 0.3 Seconds
* Blockchain Finality: ~15 seconds on Sepolia
**Speaker Notes:**
> "We didn't just build a proof of concept; we built an enterprise-grade platform. Our Firebase frontend scored a perfect 100 out of 100 on Google PageSpeed Insights with zero blocking time. From upload to a cryptographically verified blockchain identity, the entire process takes less than 20 seconds."

---

### Slide 5: The Macro Impact (The 2.4 Crore Math)
**Visuals:** (Include the impact_comparison.png flowchart here)
* Cost Reduction: From ₹30/user to ₹0.50/user. (Saves ₹6 Crores).
* Storage Reduction: From 120 Terabytes to just 12 Gigabytes.
* Security: 100% elimination of centralized mass data breaches.
**Speaker Notes:**
> "When applied to IDBI's portfolio, the numbers are staggering. We drop the verification cost from 30 Rupees to just 50 Paise per user—saving the bank 6 Crore Rupees. Furthermore, because we only store a 64-byte hash instead of a 5-megabyte image, IDBI’s storage requirement plummets from 120 Terabytes down to just 12 Gigabytes."

---

### Slide 6: Future Roadmap & The "Profit Center"
**Visuals:**
* Zero-Knowledge Proofs (ZK-SNARKs).
* Cross-Chain Interoperability.
* Monetization: Turning KYC into an Identity Oracle.
**Speaker Notes:**
> "Where do we go from here? Today, KYC is a dead expense for the bank. But with our Web3 Vault, we turn KYC into a profit center. If an IDBI customer wants to open a Zerodha trading account, Zerodha can pay IDBI a ₹10 micro-fee to instantly access the verification proof on the blockchain. IDBI creates a massive new revenue stream by acting as a trusted Identity Oracle for the rest of the financial sector."

---

### Slide 7: Live Demo & Code Verification
**Visuals:**
* GitHub Public Repository: https://github.com/Suyash2527/Decentralized_KYC_VAULT
* Demo Video Link: (Your Video Link)
* Final Product Link: https://idbi-kyc-vault.web.app
**Speaker Notes:**
> "Our platform is live, deployed, and 100% open-source. You can scan our code on GitHub, watch our full technical walkthrough video, and you can pull out your phones right now and test the live product for yourselves. Thank you, and we are ready for your questions."
