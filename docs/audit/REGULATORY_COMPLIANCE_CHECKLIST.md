# ReliefChain Regulatory & Compliance Issue-Spotting Checklist

> [!CAUTION]
> **LEGAL DISCLAIMER: NOT LEGAL ADVICE**  
> This document is prepared strictly by the engineering and security team as an issue-spotting checklist and technical architectural brief for qualified legal counsel, compliance attorneys, and tax advisors. It does NOT constitute legal, financial, or regulatory advice. Prior to facilitating or custodying real donor cryptocurrency, competent legal counsel in each relevant jurisdiction must review and sign off on platform operations.

---

## 1. Overview of Platform Fund Flows

To assist legal counsel in characterizing the protocol, the technical fund flow is defined as follows:

```
[Donor Wallet] 
      │
      ▼  (Direct on-chain Sui transfer to smart contract treasury)
[Sui Move Shared Object: Campaign Treasury]
      │
      │  (Milestone Evidence attached by NGO / Creator)
      │  (Human Verifier inspects Walrus blob + SHA-256 hash)
      │
      ▼  (Verifier signs release_funds transaction)
[Beneficiary / Vendor Sui Wallet Address]
```

**Key Architectural Facts:**
1. **Non-Custodial Move Contracts:** Donor funds are locked inside a decentralized Sui Move object (`Campaign.treasury: Balance<SUI>`). ReliefChain operators do not possess private keys to siphon or divert funds to company accounts.
2. **Backend Intermediary Status:** The Express backend (`server.js`) and database store metadata, verification hashes, and audit logs. The backend does **not** take custody of SUI tokens at any point in the lifecycle.
3. **Multi-Party Authorization:** Funds are only disbursed when both the NGO presents a milestone and a licensed/vetted Verifier approves evidence.

---

## 2. United States Regulatory Framework

### 2.1. FinCEN Money Services Business (MSB) & Money Transmission
- [ ] **MSB Exemption Analysis:** Evaluate whether ReliefChain operates as an "unregistered money transmitter" under FinCEN guidance (FIN-2019-G001). Under FinCEN rules, a provider of software or non-custodial smart contracts is generally not a money transmitter unless they accept and transmit currency or value that substitutes for currency on behalf of another person.
- [ ] **State Money Transmitter Licenses (MTLs):** Review individual state banking department thresholds (e.g., NYDFS BitLicense, California DFPI). Because Move shared objects hold donor tokens until disbursement, counsel must evaluate whether holding tokens in a smart contract escrows funds under state definitions.
- [ ] **Relayer / Paymaster Liability:** If sponsored transactions or gas relayers are implemented in the future, determine if gas sponsorship triggers intermediary classification.

### 2.2. State Charitable Solicitation Laws (The Charleston Principles)
- [ ] **State Charitable Registration:** In the United States, soliciting charitable donations across state lines via a website triggers registration requirements in approximately 39 states. Counsel must determine whether ReliefChain is acting as:
  - A *Charitable Platform* (e.g., California AB 488 rules governing charitable fundraising platforms).
  - A *Commercial Co-Venturer* (CCV).
  - A *Professional Fundraiser / Solicitor*.
  - A pure *Technology Service Provider*.
- [ ] **California Assembly Bill 488 (AB 488) Compliance:** If California donors or charities participate, verify adherence to platform transparency requirements, prompt disbursement rules (typically within 30 days of receipt), and conspicuous disclosure of platform fees.
- [ ] **Donor Tax Substantiation & IRS Disclosures:** Determine whether ReliefChain must issue written acknowledgments for donor contributions under IRC Section 170(f)(8) (required for gifts of $250 or more). Provide clear warnings to donors if contributions made to non-501(c)(3) foreign entities are **not** tax-deductible in the US.

---

## 3. European Union & United Kingdom Frameworks

### 3.1. EU Markets in Crypto-Assets (MiCA) Regulation
- [ ] **Asset Classification:** Confirm the status of SUI under MiCA (classified as a crypto-asset other than an asset-referenced token or e-money token).
- [ ] **Crypto-Asset Service Provider (CASP) Scoping:** Evaluate whether verifying disaster milestones or coordinating donor wallets triggers licensing requirements under MiCA Article 59 (such as "reception and transmission of orders for crypto-assets" or "providing custody and administration of crypto-assets").
- [ ] **DeFi Exemption Assessment:** Assess whether the decentralization of the Move smart contract meets MiCA's exemption for "fully decentralized crypto-asset services provided without any intermediary."

### 3.2. EU AMLD5 / AMLD6 & Transfer of Funds Regulation (TFR)
- [ ] **TFR (Travel Rule) Compliance:** Under the EU Transfer of Funds Regulation, transactions between CASPs and self-hosted wallets exceeding €1,000 may require beneficiary information collection.
- [ ] **GDPR & On-Chain Privacy:** Because donor wallet addresses and public audit logs are immutable on the Sui blockchain, review GDPR Article 17 ("Right to Erasure") implications. Ensure off-chain databases do not leak personal identifiers tied to wallet addresses without consent.

### 3.3. United Kingdom (FCA & Charities Commission)
- [ ] **Charities Commission Guidance:** Review Charity Commission guidance on accepting cryptocurrency donations, specifically regarding volatility risk, conversion into fiat, and trustee fiduciary duties.
- [ ] **FCA Financial Promotions Regime:** Ensure website promotional copy cannot be construed as an unauthorized financial promotion or an inducement to invest under Section 21 of FSMA.

---

## 4. India & Cross-Border Restrictions

### 4.1. Foreign Contribution Regulation Act (FCRA) 2010
- [ ] **Foreign Donation Restrictions:** In India, associations or NGOs receiving foreign contributions must have an active FCRA registration from the Ministry of Home Affairs (MHA) and must receive funds in a designated State Bank of India (SBI) New Delhi main branch account.
- [ ] **Cryptocurrency Incompatibility with FCRA:** Under existing Indian guidelines, crypto-assets received from overseas wallets cannot be deposited directly into FCRA-designated bank accounts. Counsel must structure a mechanism where international SUI donations are liquidated into approved fiat foreign currency through an authorized dealer before crediting Indian relief entities, or limit Indian participation to locally sourced funds.

### 4.2. Virtual Digital Assets (VDA) Tax Regime
- [ ] **Section 194S TDS:** Evaluate applicability of 1% Tax Deducted at Source (TDS) on crypto-to-crypto and crypto-to-fiat transactions in India.
- [ ] **Section 115BBH 30% Flat Tax:** Clarify tax implications for Indian recipients of crypto grants (whether gifts received by registered charitable trusts are exempt under Section 12AA/12AB).

---

## 5. Global Sanctions, AML & KYC Threshold Policy

| Donor Contribution Tier | KYC / Identity Requirement | Screening Requirement | Action on Sanction Match |
|---|---|---|---|
| **Tier 1: Micro-Donations**<br>($\le \$250$ USD equiv.) | Anonymous / Pseudonymous Sui wallet allowed. | Automated wallet screening against OFAC/UN lists via oracle or RPC hook. | Immediate reject / abort transaction on-chain. |
| **Tier 2: Standard Donations**<br>($\$250 - \$2,500$ USD) | Basic verification (Email + Verified Wallet Address). | Sanctions + Darknet/Mixer taint check (Chainalysis / TRM Labs API). | Flag for compliance review; reject if taint score $> 75\%$. |
| **Tier 3: High-Value / Institutional**<br>($> \$2,500$ USD) | Full KYC / AML (Government ID, Proof of Address, PEP check). | Deep chain forensics + Ultimate Beneficial Ownership (UBO) check. | Mandatory manual compliance signoff before milestone release. |

### Beneficiary & Vendor Screening (Mandatory for ALL amounts)
- [ ] **100% Identity Verification:** Every beneficiary or relief vendor wallet must undergo rigorous off-chain identity verification, sanctions screening, and geographic location confirmation prior to receiving fund disallowances from `release_funds`.
- [ ] **Specially Designated Nationals (SDN) Screening:** Pre-screen all beneficiary addresses against the US Treasury OFAC SDN List, EU Consolidated Financial Sanctions List, and UK HMT Sanctions List.
- [ ] **Adverse Media & Terrorist Financing Checks:** Cross-reference relief coordinators against international databases (Interpol, UN 1267 Committee) before issuing a `CampaignAdminCap` or listing a campaign.

---

## 6. Action Items Before Real-Fund Pilot

1. Retain legal counsel specializing in fintech, blockchain law, and nonprofit governance.
2. Formalize Terms of Service (ToS) and Donor Disclosures explicitly stating that donations are final and subject to smart contract execution.
3. Integrate third-party wallet screening API (e.g. TRM Labs, Chainalysis, or Range Security) into the backend donation flow.
4. Establish clear fiat on/off-ramp partnerships with licensed local exchanges in disaster-affected regions.
