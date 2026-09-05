# ReliefChain Capability Architecture & Custody Plan

**Target Network:** Sui Mainnet (Prepared for Audit)  
**Package:** \`relief_chain\`  
**Module:** \`relief_chain::relief_chain\`  
**Version:** 1.0.0-audit  

---

## 1. Executive Summary

ReliefChain uses Sui's object-centric capability model to enforce access control over sensitive operations (campaign verification, verifier onboarding, fund release, emergency closure). Rather than relying on contract-level roles or off-chain database permissions, administrative and verification authority is physically held as typed Move objects (\`AdminCap\`, \`VerifierCap\`, \`CampaignAdminCap\`).

This document details:
1. The exact capabilities defined in Move bytecode and their privilege matrices.
2. The current development key-holding topology.
3. The production $k$-of-$n$ multisig threshold custody transition plan required prior to accepting real donor funds.
4. Key rotation, timelock, and incident response procedures.

---

## 2. On-Chain Capability Taxonomy & Privilege Matrix

| Capability Struct | Abilities | Target Scope | Functions Guarded | Blast Radius if Compromised |
|---|---|---|---|---|
| **\`AdminCap\`** | \`key, store\` | Global Package-wide | \`grant_verifier_cap\`<br>\`revoke_verifier_cap\`<br>\`emergency_close\` | High: Rogue actor can authorize arbitrary verifiers or halt active relief campaigns. Cannot steal locked treasury funds directly. |
| **\`VerifierCap\`** | \`key, store\` | Network-wide Verification | \`verify_campaign\`<br>\`approve_milestone\`<br>\`release_funds\` | Critical: Malicious verifier can approve fraudulent milestones and execute fund release up to milestone allocation to specified beneficiaries. |
| **\`CampaignAdminCap\`** | \`key, store\` | Single Campaign Instance | \`create_milestone\`<br>\`attach_evidence\`<br>\`complete_campaign\`<br>\`cancel_campaign\` | Moderate: Confined strictly to the specific \`campaign_id\` bound to that capability. Cannot affect other campaigns or release funds without Verifier approval. |

### Capability Invariant Enforcement

1. **Campaign Admin Cap Isolation (\`INV-AUTH-03\`):**
   \`\`\`move
   public fun create_milestone(
       cap: &CampaignAdminCap,
       campaign: &mut Campaign,
       ...
   ) {
       assert!(cap.campaign_id == object::uid_to_inner(&campaign.id), ENotAuthorized);
       ...
   }
   \`\`\`
   A holder of \`CampaignAdminCap\` for Campaign $A$ will immediately abort with \`ENotAuthorized (0)\` if presented to Campaign $B$.

2. **Dual-Key Custody for Fund Release:**
   Funds can **never** be released by the campaign creator alone. Releasing funds requires:
   - A valid \`&VerifierCap\` presented by an authorized verifier.
   - Milestone status marked as \`STATUS_APPROVED (2)\`.
   - Release amount $\le$ Milestone allocation.
   - Release amount $\le$ Campaign treasury balance.

---

## 3. Current Testnet Keyholders

| Role | Environment | Current Holder Address | Custody Mechanism |
|---|---|---|---|
| **Deployer / Initial AdminCap** | Sui Testnet | \`0xbc...7849\` (Dev Admin Key) | Local CLI Ed25519 Keystore (\`~/.sui/sui_config/sui.keystore\`) |
| **VerifierCap Holder** | Sui Testnet | \`0xbc...7849\` | Shared single-key testnet address |
| **CampaignAdminCap Holder** | Sui Testnet | \`0xbc...7849\` | Campaign Creator address |

> [!WARNING]
> **Single-Key Custody is Strictly Prohibited on Mainnet.**
> The testnet deployment utilizes a single Ed25519 development key for integration and load testing. Prior to mainnet contract publishing, ownership of \`AdminCap\` and all initial \`VerifierCap\`s must be transferred to the multisig topologies outlined below.

---

## 4. Production Mainnet Custody Architecture: $k$-of-$n$ Multisig

For mainnet operations, ReliefChain requires a multi-signature threshold model using Sui native multisig accounts (\`sui keytool multi-sig-combine\`) or a formal institutional custody provider (e.g., Safe / MSafe on Sui).

### 4.1. AdminCap: 3-of-5 Protocol Governance Multisig

The \`AdminCap\` controls root authorization (granting/revoking verifier capabilities and emergency stop).

- **Threshold:** 3 of 5 signatures required for any transaction.
- **Keyholders:**
  - **Keyholder 1 (Foundation):** ReliefChain Foundation Board Member (Ledger Nano S+ / cold).
  - **Keyholder 2 (Security Lead):** Independent Smart Contract Auditor / Security Lead (Cold hardware wallet).
  - **Keyholder 3 (NGO Partner):** Global Disaster Response NGO Representative (Cold hardware wallet).
  - **Keyholder 4 (Legal/Compliance):** Compliance Officer (Cold hardware wallet).
  - **Keyholder 5 (Backup/Escrow):** Multi-party Institutional Custodian Escrow.
- **Rules:**
  - No two keys may be held by the same physical person or organization.
  - All signing actions must be preceded by a minimum 24-hour public on-chain or forum advisory notice (except emergency response).

### 4.2. VerifierCap: 2-of-3 Regional Verifier Multisig

Individual field workers and triage agents do not hold autonomous single-key \`VerifierCap\`s for high-value milestone payouts ($>5,000$ USD equivalent).

- **Low-Value Milestones ($\le 5,000$ USD):** Held by vetted institutional partner verifiers with hardware security module (HSM) or Ledger-backed keys.
- **High-Value Milestones ($> 5,000$ USD):** Held by a 2-of-3 multisig consisting of:
  1. On-the-ground Humanitarian Logistics Lead (Identity verified).
  2. ReliefChain Compliance Verifier.
  3. Independent Satellite / Drone Verification Partner.

### 4.3. CampaignAdminCap: Disaster Relief Organization Custody

When an NGO or local community group launches a campaign:
- The \`CampaignAdminCap\` is transferred directly to the verified NGO's Sui wallet address upon creation.
- ReliefChain backend or contracts never retain custody of \`CampaignAdminCap\`.
- If an NGO loses their key, the campaign can still receive donations and milestones can still be fulfilled, but new milestones cannot be created. The \`AdminCap\` can safely trigger \`emergency_close\` if the NGO key is compromised.

---

## 5. Security Protocols & Operational Runbooks

### 5.1. Key Rotation Runbook
1. **Multisig Member Change:**
   - Create a new $k$-of-$n$ Sui multisig address with the updated signer public keys and weights.
   - Execute an on-chain transfer of the \`AdminCap\` or \`VerifierCap\` object from the old multisig address to the new multisig address.
   - Verify ownership via Sui RPC:
     \`\`\`bash
     sui client objects <NEW_MULTISIG_ADDRESS>
     \`\`\`
   - Update backend \`requireRole\` verifier registry.

2. **Revocation of Rogue Verifier:**
   - The 3-of-5 Admin multisig calls \`relief_chain::revoke_verifier_cap(admin_cap, verifier_cap_id)\`.
   - The backend \`requireRole\` middleware automatically denies API operations for that address on the next request, as live owned-object queries will fail.

### 5.2. Emergency Stop / Incident Response Runbook
In the event of an active exploit, abnormal outflow, or compromised NGO key:
1. **Trigger Emergency Close:**
   - 3-of-5 Admin multisig executes \`relief_chain::emergency_close(admin_cap, &mut campaign)\`.
   - Contract emits \`CampaignCancelled\` and transitions status to \`STATUS_CANCELLED (4)\`.
2. **Immediate Effect:**
   - \`donate\` calls abort with \`EInvalidCampaignStatus (1)\`.
   - \`release_funds\` calls abort with \`EInvalidCampaignStatus (1)\`.
   - Remaining funds in the campaign \`treasury: Balance<SUI>\` remain locked and preserved for audit reconciliation and donor restitution.

---

## 6. Cold Storage & Hardware Requirements

All signers on the 3-of-5 Admin multisig must comply with the following standards:
1. **Hardware Wallets:** Ledger Nano X, Ledger Stax, or Keystone 3 Pro running verified Sui firmware.
2. **Key Generation:** Seed phrases generated in air-gapped environments using true hardware random number generators (TRNG).
3. **Backup Physical Storage:** Seed phrases etched onto stainless steel backup plates (e.g. Cryptosteel / Billfodl) and placed in bank-grade safe deposit boxes.
4. **Phishing Protection:** Signers must verify raw transaction digests against contract function signatures before signing any transaction payload.
