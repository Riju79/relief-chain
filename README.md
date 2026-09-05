# ReliefChain — Decentralized Web3 Disaster Relief Protocol on Sui & Walrus

**ReliefChain** is a production-grade Web3 disaster-relief protocol built on the **Sui Blockchain** and **Walrus Decentralized Storage Network**. It eliminates traditional humanitarian aid fraud, opaque intermediary fees, and fake disaster claims by anchoring every relief milestone, donation, and evidence item to immutable, cryptographically verifiable on-chain Move contracts.

---

## 🚀 Key Innovation & Highlights

- **Sui Blockchain as Financial Source of Truth:** On-chain Move shared objects (`Campaign`) hold treasury balances (`Balance<SUI>`), financial goals, donation ledgers, and milestone allocations.
- **Real Walrus Decentralized Storage:** Bulk disaster evidence (photos, video footage, vendor receipts, satellite imagery) is published directly to Walrus. Walrus Blob IDs and **SHA-256 content digests** are anchored on Sui.
- **Capability-Based Governance:** Role-based permissions are enforced via Move capabilities (`AdminCap`, `VerifierCap`, `CampaignAdminCap`). Campaign creators cannot arbitrarily withdraw or drain funds.
- **Milestone-Based Fund Release:** Direct payout releases to verified beneficiaries only after human auditor verification.
- **Off-Chain Automated Triage Engine:** Heuristic diagnostic tool that calculates a 0–100% triage priority score (entropy, filename, and format heuristics) to flag suspicious files for human auditors. *Automated triage has zero financial capability or Move transaction signing access; all approvals require human verifiers.*
- **Fault-Tolerant Sui Event Indexer:** Idempotent event processing layer with on-chain Sui RPC reconciliation.

---

## 💡 The Problem

Traditional disaster relief suffers from systemic inefficiencies:
1. **Opaque Fund Allocations:** Donors cannot verify if their contributions reach actual victims.
2. **Fraudulent Crisis Claims:** Unverified crisis reports often misappropriate public goodwill.
3. **Intermediary Drains:** High banking and administrative fees eat into emergency funds.
4. **Single-Point Storage Failure:** Centralized databases can alter or hide audit documentation.

---

## ⚡ The Solution

ReliefChain introduces a transparent, multi-tiered verification pipeline:

```
[ Disaster Reporter / NGO ]
           │
           ▼ Uploads Evidence
 [ Real Walrus Storage ] ──▶ Returns Blob ID & SHA-256 Digest
           │
           ▼ Runs Off-Chain Diagnostics
[ Automated Triage Engine ] ──▶ Computes Heuristic Triage Score (0-100%, Pending Review)
           │
           ▼ Reviews Evidence & SHA-256 Digest
 [ Human Verifier Board ] ──▶ Signs Sui Transaction (VerifierCap)
           │
           ▼ Emits CampaignVerified / MilestoneApproved
 [ Sui Move Smart Contract ] ──▶ Unlocks SUI Treasury Payout
           │
           ▼ Direct Transfer
 [ Verified Beneficiary ]
```

---

## 🌐 Why Sui & Walrus?

### Why Sui?
- **Move Object Model:** Campaigns, treasuries, and capabilities exist as native Move objects with explicit type safety and ownership semantics.
- **Sub-Second Finality & Low Fees:** Critical for real-time emergency aid distribution and micro-donations.
- **Programmable Transaction Blocks (PTBs):** Enables atomic batch operations (e.g. minting coins, splitting gas, and updating milestone ledgers in one transaction).

### Why Walrus?
- **Cost-Effective Decentralized Storage:** Efficiently stores large media files (videos, high-res photos, PDF budget ledgers) off-chain.
- **Cryptographic Anchoring:** Walrus storage IDs paired with SHA-256 content hashes are stored on Sui, guaranteeing zero off-chain file tampering.

---

## 📜 Move Smart Contracts & Capability Architecture

Located in [`move/sources/relief_chain.move`](move/sources/relief_chain.move):

### Move Structs
- `Campaign`: Shared key object containing treasury balance (`Balance<SUI>`), goal, raised funds, total released funds, status, milestones, and evidence records.
- `Milestone`: Milestone index, description, allocation amount, released amount, status, and beneficiary address.
- `Evidence`: `evidence_id`, `walrus_blob_id`, `content_hash` (SHA-256), `uploader`, `timestamp`, `mime_type`, `title`, `metadata`, `milestone_index`.

### Role Capabilities
- `AdminCap`: Granted on contract deployment. Can grant `VerifierCap` to human auditors (`grant_verifier_role`).
- `VerifierCap`: Granted to vetted human auditors. Required to call `verify_campaign`, `approve_milestone`, `release_funds`, `complete_campaign`, `cancel_campaign`.
- `CampaignAdminCap`: Issued to the campaign creator upon `create_campaign`. Required to call `add_milestone` and `attach_evidence`.

### 🌐 Verified Sui Testnet Deployment
- **Package ID:** [`0x9c0e1fe411f3f1bc9b877710d000ef4ca3113e3461cdffed469be1f1bd7b5bfe`](https://suiscan.xyz/testnet/object/0x9c0e1fe411f3f1bc9b877710d000ef4ca3113e3461cdffed469be1f1bd7b5bfe) ([SuiVision Mirror](https://testnet.suivision.xyz/package/0x9c0e1fe411f3f1bc9b877710d000ef4ca3113e3461cdffed469be1f1bd7b5bfe))
- **AdminCap Object ID:** `0x21e2ca751c1157689c086dd223487841fe4ef53b5e95ac0c935f009261c5191f`
- **VerifierCap Object ID:** `0xf5d8fbb6bb38c2b5be734f2fd8e4ac5797e033b9f073448267f5adb953e1921c`
- **UpgradeCap Object ID:** `0xc462508fd6ea77cb21724d35b32a05d56160aac1dc6960d6424db96ace2dd006`
- **Publish Transaction Digest:** [`83gRrNKmZ4WjVsRXnmEVstVEgUbeVEDuKLauLvfiUSnC`](https://suiscan.xyz/testnet/tx/83gRrNKmZ4WjVsRXnmEVstVEgUbeVEDuKLauLvfiUSnC)

---

## ⚡ Role of the Automated Triage Engine (Heuristic Screening)

The automated triage engine (`runAutomatedTriage` / `runAiAuthentication` in backend / client) acts strictly as an **off-chain heuristic screening advisor**:
- **Media Classification:** Categorizes evidence based on filename heuristics and metadata (Flash Flooding, Cyclone, Wildfire, Landslide, Earthquake).
- **Entropy & Integrity Check:** Analyzes byte entropy and checks for placeholder files, suspicious filenames, or tiny dummy payloads.
- **Triage Priority Score:** Generates a 0–100% automated triage score to prioritize queues for human verifiers. It is an automated screening heuristic, not a trained autonomous decision-maker.
- **Pending Human Verification:** Every report remains unapproved until an authorized human verifier holding an on-chain `VerifierCap` inspects the evidence, re-verifies the cryptographic SHA-256 hash, and signs a transaction on Sui.

> ⚠️ **Strict Security Rule:** The triage engine holds **zero Move capabilities**, cannot sign transactions, and **cannot release treasury funds**. Final verification is exclusively performed on-chain by human auditors holding `VerifierCap`.

---

## 🔒 Security Model

- **No Arbitrary Withdrawals:** `release_funds` checks `released_amount + amount <= allocation` (`EOverRelease` = 10) and `treasury_balance >= amount` (`EInsufficientFunds` = 3).
- **Duplicate Prevention:** Rejects duplicate `evidence_id` submissions (`EDuplicateEvidence` = 14).
- **Input Validation:** Rejects empty Walrus Blob IDs or empty hashes (`EEmptyString` = 13).
- **Unverified Campaign Protection:** Donations to unverified campaigns (`STATUS_SUBMITTED`) are rejected (`ECampaignClosed` = 11).

---

## 🛠 Setup & Local Development Guide

### Prerequisites
- **Node.js**: v20+ or v22+
- **Sui CLI**: 1.20+ (`sui`)
- **NPM**: 10+

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/Riju79/relief-chain.git
cd relief-chain
npm install
```

### 2. Environment Configuration (`.env`)
Create a `.env` file in the root directory:
```env
SUI_RPC_URL=https://fullnode.testnet.sui.io:443
NETWORK=testnet
PORT=3000
RELIEFCHAIN_PACKAGE_ID=0x9c0e1fe411f3f1bc9b877710d000ef4ca3113e3461cdffed469be1f1bd7b5bfe
ADMIN_CAP_OBJECT_ID=0x21e2ca751c1157689c086dd223487841fe4ef53b5e95ac0c935f009261c5191f
VERIFIER_CAP_OBJECT_ID=0xf5d8fbb6bb38c2b5be734f2fd8e4ac5797e033b9f073448267f5adb953e1921c
```

### 3. Run Development Servers
Start Express backend (Port 3000) and Vite frontend (Port 5173):
```bash
# Start backend API server
npm run server

# In another terminal, start Vite frontend dev server
npm run dev
```

Visit the application at `http://localhost:5173`.

---

## 🧪 Testing Suite

### 1. Run Move Smart Contract Unit Tests
```bash
cd move
sui move test
```
*Executes 5/5 Move unit tests covering lifecycle, duplicate checks, empty inputs, and authorization aborts.*

### 2. Run Sui Event Indexer & Deduplication Test
```bash
npx tsx src/indexer/testIndexer.ts
```

### 3. Run Real Sui Testnet & Walrus End-to-End Test
```bash
npx tsx src/testRealTestnetE2E.ts
```

### 4. Build Production Frontend Bundle
```bash
npx vite build
```

---

## 📄 License
MIT License. Built for the Sui Web3 Ecosystem.
