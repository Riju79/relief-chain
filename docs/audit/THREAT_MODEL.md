# ReliefChain Comprehensive System Threat Model & Vulnerability Analysis

**Version:** 1.0.0-audit  
**Target:** ReliefChain Protocol (Sui Move Contracts, Backend Service, Frontend dApp, Decentralized Storage)  
**Methodology:** STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)  
**Status:** Prepared for Third-Party Smart Contract & Infrastructure Security Auditors  

---

## 1. Architecture Overview & Trust Boundaries

ReliefChain custody and operations span four distinct trust zones:
```
┌─────────────────────────────────────────────────────────────┐
│ Zone 1: Client Layer (Web Browser / Sui Wallet Extension)  │
│ - Donor & Verifier Browser DOM, Local Storage, Injected Keys│
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / WSS
┌──────────────────────────────▼──────────────────────────────┐
│ Zone 2: Backend Relayer & API Service (Express / PostgreSQL) │
│ - AI Triage Engine, Audit Logger, Nonce Verification        │
└──────────────────────────────┬──────────────────────────────┘
                               │ JSON-RPC / HTTP
┌──────────────────────────────▼──────────────────────────────┐
│ Zone 3: Sui Blockchain Layer (Move VM / Validator Quorum)   │
│ - Treasury Balances, Milestone Logic, Capabilities         │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / Blob Verification
┌──────────────────────────────▼──────────────────────────────┐
│ Zone 4: Decentralized Storage Layer (Walrus Protocol)       │
│ - Disaster Photos, Invoices, Delivery Receipts, Metadata   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Threat Vector 1: Compromised Protocol Admin Capability (`AdminCap`)

### Threat Description
An attacker gains possession of the private key controlling the `AdminCap` object (`0x...::relief_chain::AdminCap`).

### STRIDE Classification
- **Elevation of Privilege:** Attacker assumes root administrative status.
- **Denial of Service:** Attacker can prematurely cancel or halt legitimate relief campaigns.

### Technical Analysis & Blast Radius
1. **Can the attacker drain locked campaign treasuries?**
   - **NO.** In Move, `AdminCap` does **not** give access to `relief_chain::release_funds` or `Campaign.treasury`. Funds can only be released to a designated milestone beneficiary via `VerifierCap` with an approved milestone.
2. **What CAN the attacker do?**
   - Execute `grant_verifier_cap(admin_cap, recipient_address)` to mint arbitrary `VerifierCap`s to attacker-controlled wallets.
   - Execute `emergency_close(admin_cap, campaign)` on active campaigns, halting incoming donations and milestone progression.
   - Execute `revoke_verifier_cap(admin_cap, cap_id)` to de-authorize honest verifiers.

### Mitigations Implemented & Planned
- **Move Invariant:** `AdminCap` possesses zero custody transfer functions.
- **Multisig Custody (`CAPABILITY_MAP_AND_CUSTODY.md`):** For production, `AdminCap` MUST NOT reside on an externally owned single-key account (EOA). It must be locked into a 3-of-5 threshold multisig composed of diverse organizational keyholders on hardware wallets.
- **Audit Trails:** Every execution of `grant_verifier_cap` and `emergency_close` emits an on-chain event (`CampaignCancelled`, etc.) captured in immutable Sui validator logs.

---

## 3. Threat Vector 2: Rogue or Compromised Verifier (`VerifierCap`)

### Threat Description
A field verifier's key is stolen, or a corrupt verifier colludes with a fraudulent campaign creator or beneficiary to siphon relief funds.

### STRIDE Classification
- **Tampering:** Falsification of milestone completion state (`approve_milestone`).
- **Elevation of Privilege:** Unauthorized triggering of `release_funds`.

### Technical Analysis & Blast Radius
1. **Can the verifier steal ALL funds from a campaign at once?**
   - **NO.** By contract invariant `INV-FIN-01` and `INV-FIN-02`:
     - Funds can only be released up to the milestone's predefined `allocation`.
     - Releases are constrained by the actual balance in the treasury.
     - Each milestone requires prior creation by the `CampaignAdminCap` holder before approval.
2. **Residual Risk:**
   - A rogue verifier can approve a bogus milestone and call `release_funds` to pay out that specific milestone's allocation to the registered `beneficiary`.

### Mitigations Implemented & Planned
- **Cryptographic Evidence Verification (`INV-EVID-01`, `INV-EVID-02`):** Verifiers must sign off on attached evidence blobs with immutable SHA-256 digests.
- **Backend SIWE Verification Middleware:** Mutating backend review actions require wallet signatures over single-use nonces stored in PostgreSQL.
- **Multi-Verifier Threshold for High-Value Payouts:** Milestones exceeding \$5,000 USD equivalent will require 2-of-3 verifier multi-signature approval in the v1.1 contract.
- **Instant Revocation Capability:** `relief_chain::revoke_verifier_cap` allows `AdminCap` signers to instantly revoke compromised verifier credentials.

---

## 4. Threat Vector 3: Walrus Decentralized Storage Availability & Tampering

### Threat Description
Disaster relief evidence (satellite imagery, supplier receipts, delivery photos) stored on the decentralized Walrus network is unavailable due to epoch expiry, node censorship, or a malicious party attempts to serve altered files.

### STRIDE Classification
- **Tampering:** Attempting to alter invoice or delivery photo contents.
- **Denial of Service:** Walrus aggregator downtime preventing evidence retrieval during verifier audits.

### Technical Analysis & Blast Radius
- If evidence cannot be viewed, verifiers cannot verify milestones, temporarily stalling fund disbursements.
- If an adversary tampers with the image file returned from an aggregator, donors and verifiers might be misled.

### Mitigations Implemented & Planned
- **Dual-Side SHA-256 Re-Verification (`INV-EVID-01`):**
  - The exact cryptographic hash (`content_hash: vector<u8>`) is permanently stored on the Sui blockchain inside `EvidenceRecord`.
  - Both client-side JavaScript and backend API (`/api/evidence/verify-integrity`) fetch the raw bytes from Walrus, compute the SHA-256 digest, and reject any file whose hash does not match the on-chain value byte-for-byte.
- **Local Fallback Cache:** High-priority evidence is temporarily mirrored in encrypted local object storage (`uploads/`) to guarantee access during disaster network degradations.
- **Aggregator Failover:** Frontend and backend support configurable multi-aggregator endpoints (`WALRUS_AGGREGATOR_LIST`).

---

## 5. Threat Vector 4: RPC Man-in-the-Middle (MITM) & Fullnode Censorship

### Threat Description
An adversary compromises or intercepts traffic to the Sui fullnode JSON-RPC endpoint (`fullnode.testnet.sui.io:443`), returning spoofed campaign balances, omitting donation events, or delaying transaction submission.

### STRIDE Classification
- **Spoofing / Tampering:** Returning falsified object states or fabricated transaction receipts.
- **Denial of Service:** Dropping submitted transactions during peak panic hours.

### Technical Analysis & Blast Radius
- Because web3 clients sign transactions locally with their private keys, an RPC node **cannot forge signatures or steal private keys**.
- An RPC node could lie about the campaign's raised amount or conceal newly added milestones.

### Mitigations Implemented & Planned
- **Cryptographic Transaction Receipts:** All user balance-altering transactions are validated through Sui dual-certificate receipts with validator quorum signatures (`sui:signAndExecuteTransactionBlock`).
- **RPC Failover Engine (`src/utils/rpcFailover.js`):** Client and indexer maintain connections to multiple independent fullnode RPC providers with automatic round-robin and health checks.
- **Idempotent Reconciliation:** The event indexer reconciles its state with direct on-chain object inspections (`reconcileWithSui`) at regular intervals.

---

## 6. Threat Vector 5: Supply-Chain Vulnerability & CDN Dependency Pinning (`esm.sh`)

### Threat Description
In `suiConnection.js` (lines 38-39), external ES modules are dynamically loaded directly from a third-party CDN:
```javascript
import { getWallets } from 'https://esm.sh/@mysten/wallet-standard@0.20.3';
import { Transaction } from 'https://esm.sh/@mysten/sui@2.17.0/transactions';
```
If `esm.sh` is compromised, hijacked via DNS poisoning, or subject to a malicious upstream package release, arbitrary JavaScript could be injected into the user's browser, potentially altering transaction recipient addresses or hijacking wallet interactions.

### STRIDE Classification
- **Tampering / Spoofing / Elevation of Privilege:** Critical client-side supply chain vulnerability.

### Immediate Hardening Plan & Production Action Items
1. **Eliminate Unpinned CDN Imports:**
   - Migrate `suiConnection.js` from `https://esm.sh/...` to local npm bundling via Vite/Rollup. Both `@mysten/wallet-standard` and `@mysten/sui` are already present in `package.json` (`@mysten/wallet-standard@0.20.3`, `@mysten/sui@2.17.0`).
   - Re-route imports to local node modules:
     ```javascript
     import { getWallets } from '@mysten/wallet-standard';
     import { Transaction } from '@mysten/sui/transactions';
     ```
2. **Subresource Integrity (SRI) & Content Security Policy (CSP):**
   - Enforce strict CSP headers in `server.js`:
     ```
     Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self' https://*.sui.io https://*.walrus.space;
     ```
   - Disallow execution of scripts from arbitrary external domains or unpinned CDNs.
3. **Lockfile & Vulnerability Auditing:**
   - Maintain strict `package-lock.json` lockfiles and run automated CI dependency scans via `npm audit` and Dependabot.

---

## 7. Threat Matrix Summary

| Threat ID | Threat Vector | Likelihood | Impact | Severity | Primary Defense |
|---|---|---|---|---|---|
| **TV-01** | Compromised `AdminCap` | Low | High | **HIGH** | 3-of-5 hardware multisig; no custody transfer ability in Move bytecode. |
| **TV-02** | Malicious Verifier Collusion | Medium | High | **CRITICAL** | Milestone allocation ceiling; multi-signature verifier threshold for >$5k; on-chain SHA-256 evidence anchoring. |
| **TV-03** | Walrus Storage Tampering / Loss | Medium | Medium | **MEDIUM** | On-chain SHA-256 byte-level re-verification; multi-aggregator failover; local fallback cache. |
| **TV-04** | Sui Fullnode RPC Censorship / MITM | Low | Medium | **MEDIUM** | Validator quorum signatures; multi-provider RPC failover pool. |
| **TV-05** | Frontend `esm.sh` Supply-Chain Risk | Medium | Critical | **HIGH** | Replace CDN imports with locally bundled npm dependencies; enforce strict Content Security Policy. |
