# Vigente Protocol — Business Plan

> Pre-submission business plan per SCF criteria. Addresses Feedback Item 4 from prior submission: *"Business use case and go-to-market plan are not clearly defined."*
>
> **Update for this resubmission.** The protocol no longer requires any fintech partnership to operate. The synthetic scoring engine reads only Stellar Horizon and produces verifiable credit profiles independently of Payku, Fintoc, or any third-party API. Payku is preserved in the codebase as an *optional enrichment adapter* — it can add detail to a borrower's profile when commercial agreements exist, but the protocol does not depend on its presence to function. This decoupling resolves the "no confirmed partnerships" criticism by making partnerships an upgrade path rather than a critical dependency.

## Post-Grant North Star — Subcollateralized Debt & On-Chain Credit Bonds

Tranches 1 and 2 focus strictly on establishing the threshold-signed credit badge as a robust, sybil-resistant scoring primitive. Once the scoring engine is validated at scale, the protocol bootstraps a **decentralized fixed-income market** on top of the primitive. Verifiable credit profiles enable the issuance of **on-chain credit bonds**: high-tier (Gold / Silver) users access subcollateralized lending pools, liquidity providers underwrite debt based on transparent on-chain behavioral data, and traditional bond mechanics arrive in the Stellar ecosystem. Solving identity and creditworthiness first is the only honest way to bring institutional liquidity to undercollateralized lending — and it's the work that Tranches 1–3 fund.


---

## 1. Problem Statement

### 1.1 The Credit Invisibility Gap

Latin America's microcommerce sector — Chilean PyMEs, Argentine pymes, Mexican changarros, Colombian tenderos — generates trillions of pesos in monthly cash flow yet remains structurally excluded from credit:

- **Banks won't lend** without collateral the borrower can't post. Average Chilean microcommerce has no real estate, no liquid investments, no warranty acceptable to a bank.
- **DeFi won't lend** because credit doesn't exist on-chain. Stellar, Ethereum, and every L1 require 150–200% overcollateralization. A microcommerce with $50,000 USD annual TPV cannot lock up $30,000 of crypto to borrow $20,000.
- **Predatory lenders fill the void.** Loans charging 80–120% annual rates extract value from the segment most able to repay.

### 1.2 Why the Problem Exists

The data exists. Every Chilean microcommerce that processes payments through Payku, Transbank, MercadoPago, or similar generates a verifiable transaction history. But that history lives in payment processor databases — invisible to Web3, illegible to banks without expensive credit bureau intermediation.

There is no protocol that:
1. Reads merchant transaction history (legally, with consent).
2. Maps it deterministically to a credit reputation.
3. Publishes that reputation on-chain in a privacy-preserving way.
4. Lets any DeFi protocol query it without intermediary fees.

Vigente is that protocol.

---

## 2. Solution

Vigente Protocol bridges fintech rails (Payku in Chile, expanding via Fintoc/Prometeo) and on-chain liquidity (Stellar Soroban) through a non-transferable credit badge (SBT) that encodes a merchant's credit tier.

The user journey:
1. Merchant connects their Payku account (existing relationship; no new KYC).
2. Vigente oracle reads 6 months of transaction history.
3. Scoring engine computes a tier (Gold / Silver / Bronze).
4. User mints a Soulbound badge on Stellar Soroban.
5. Any DeFi protocol can query `is_defaulted()` and `get_score()` for that user to extend uncollateralized credit.

Default events trigger an immutable on-chain `slash()`, creating ecosystem-wide credit consequences that ordinary credit bureaus take months to record.

---

## 3. Market Sizing

### 3.1 Total Addressable Market (TAM)

| Metric | Value | Source |
|--------|-------|--------|
| Latin American small business segment | ~50M businesses | World Bank SME data |
| Annual SME credit gap (LAC) | $1.2 trillion USD | IFC SME Finance Forum |
| Microcommerce digital payment volume (LatAm 2024) | ~$400B USD | Statista, Kantar |

### 3.2 Serviceable Addressable Market (SAM)

Chile + Mexico + Colombia + Argentina + Peru, microcommerce segment with active digital payment processing:

| Country | Active microcommerces (digital) | Estimated annual TPV |
|---------|--------------------------------|---------------------|
| Chile | ~1.0M | ~$15B USD |
| Mexico | ~3.5M | ~$45B USD |
| Colombia | ~1.8M | ~$22B USD |
| Argentina | ~1.2M | ~$18B USD |
| Peru | ~0.8M | ~$10B USD |
| **Total SAM** | **~8.3M** | **~$110B USD** |

Source: Aggregation of national statistics offices (INE Chile, INEGI Mexico, DANE Colombia, INDEC Argentina, INEI Peru) cross-referenced with payment processor public data (Payku, Clip, ePayco, MercadoPago, Niubiz).

### 3.3 Serviceable Obtainable Market (SOM) — 24-Month Window

Realistic capture by Vigente in the first 2 years post-mainnet launch:

| Year | Target users | Aggregate TPV unlocked | Vigente origination volume (est) |
|------|-------------|----------------------|-------------------------------|
| Year 1 (Tranche 3 + post-grant) | 1,000 PyMEs (Chile only) | ~$15M USD | ~$3M USD |
| Year 2 | 5,000 PyMEs (Chile + Mexico) | ~$75M USD | ~$15M USD |

These are conservative numbers. The constraint is not market demand (credit gap is structural) but Vigente's ability to onboard LPs to provide lending capital and integrate with multiple lending protocols.

---

## 4. Target Customer

### 4.1 Primary Customer Segment

**Chilean microcommerce (PyME) processing payments through Payku.**

Profile:
- Annual revenue: $20K–$200K USD equivalent
- Monthly transaction count: 50–500 transactions
- Existing relationship with Payku (already KYC'd, already in the fintech rail)
- Has tried to access bank credit and been denied
- Needs working capital for inventory, equipment, seasonal demand

### 4.2 Secondary Customer Segment (Tranche 3+)

**DeFi lending protocols on Stellar** that want to expand into LatAm credit markets:
- Opt-in lending protocols that choose to read an external reputation oracle on-chain (note: immutable price-oracle markets consume only SEP-40 *price* oracles and cannot)
- Lulo Finance
- Any future Stellar lending product seeking emerging market expansion

These are not paying customers — they are integration partners. Vigente's revenue comes from origination fees on the loans they extend. **Vigente carries no default on its balance sheet** — the originating partner bears the credit risk; Vigente lowers their expected default through better borrower selection and (roadmap) repayment interception. We are a data/attestation layer, not a lender.

### 4.3 LP Segment (Tranche 3+)

**Liquidity providers** for the reference vault and downstream lending pools:
- DAO treasuries seeking yield with social impact
- Impact investors and family offices
- Stellar ecosystem participants seeking diversified yield

---

## 5. Competitive Landscape

### 5.1 Direct Competitors

| Competitor | Approach | How Vigente differs |
|------------|----------|---------------------|
| Goldfinch | Off-chain credit assessment, on-chain pools | Goldfinch is Ethereum-native, focuses on enterprise borrowers ($1M+ loans). Vigente targets micro-loans on Stellar with lower per-loan economics. |
| Spark Protocol | Direct DAI minting against collateral | Spark requires crypto collateral. Vigente uses reputation, not collateral. |
| Centrifuge | Real-world asset (RWA) collateralization | Centrifuge tokenizes invoices. Vigente tokenizes credit reputation — orthogonal use case. |
| Traditional credit bureaus (Equifax, Sinacofi) | Centralized credit scoring | Vigente is open, on-chain, queryable by anyone. No B2B contracts required. |

### 5.2 Indirect Competitors (Local Lending)

In Chile, microcommerces currently access credit through:
- **Bancoestado microempresarios** — government-backed, low rates, requires extensive paperwork. Vigente complements by serving rejections.
- **BancoFalabella, Banco Ripley** — consumer credit at high rates. Vigente offers better rates with on-chain transparency.
- **Khipu, Mach** — payment-rail fintechs without credit products. Vigente extends their value proposition.

### 5.3 Strategic Differentiation

Vigente is the only protocol that:
1. Operates on Stellar (sub-cent fees critical for micro-loans).
2. Uses non-transferable badges (cannot be sold, traded, or hidden).
3. Stores defaults immutably with no admin delete function.
4. Provides a free public credit oracle (no B2B integration fees).
5. Designed for permissioned data sources (Payku, Fintoc) that already have legal user consent.

---

## 6. Pricing Model

### 6.1 Origination Fee

When a Vigente badge holder borrows from any protocol that uses Vigente as the credit oracle, Vigente collects a **1% origination fee** in the loan currency (USDC).

Example:
- User borrows 10,000 USDC against their Gold badge.
- Lending protocol disburses 9,900 USDC to the user, 100 USDC to Vigente treasury.
- Vigente shares 50% of fees with LPs as additional yield, retaining 50% for protocol sustainability.

### 6.2 LP Yield Share

LPs in the `reference-vault` (Tranche 2 deliverable) earn:
- Interest spread on loans (5% APR on principal)
- Plus Vigente's 50% origination fee share

### 6.3 SDK Access

The TypeScript SDK is free and MIT-licensed. No B2B contract required. No fee for protocols integrating Vigente queries — only the per-loan origination fee when their lending pool funds a Vigente badge holder.

### 6.4 Why No Subscription Model

We considered B2B subscriptions for protocol integrations but rejected the model because:
- It would slow adoption (every protocol negotiating contracts)
- It would centralize Vigente as a paid intermediary, contradicting our public-good positioning
- Origination fees scale with usage, aligning incentives

---

## 7. Go-To-Market — 12 Month Plan

### 7.1 Phase 1: Tranche 1 MVP (Weeks 1-6)
- Public testnet badge contract live
- Payku LOI signed (commercial validation)
- Working demo: any reviewer can mint a badge in 5 minutes
- Public README walkthrough generates ecosystem awareness

### 7.2 Phase 2: Tranche 2 Testnet Expansion (Weeks 7-14)
- Reference vault deployed to testnet
- 5-10 design partners (PyMEs) onboarded for product feedback
- Fintoc adapter live (proves multi-source architecture)
- Documentation site published

### 7.3 Phase 3: Tranche 3 Mainnet Launch (Weeks 15-24)
- Mainnet deployment of both contracts
- Multi-sig admin security in place
- Pilot user acquisition: 100 active PyMEs onboarded via Payku
- LP partner secured ($50K+ USDC initial liquidity)
- TypeScript SDK published to npm
- Spanish-language pilot user training material

### 7.4 Phase 4: Post-Grant Growth (Months 7-12)
- Prometeo integration for Latam expansion (Argentina, Colombia, Mexico, Peru)
- Second LP partner ($250K+ USDC liquidity)
- 1,000 active users target
- First B2B integration with a Stellar lending protocol
- Revenue self-sustainability target: protocol fees cover ongoing operations

---

## 8. Success Metrics

### 8.1 Per-Tranche Quantitative Metrics

| Metric | Tranche 1 | Tranche 2 | Tranche 3 |
|--------|-----------|-----------|-----------|
| Testnet contracts deployed | 1 | 3 | 3 |
| Active users (testnet) | 10 (manual demos) | 50 (design partners) | — |
| Active users (mainnet) | 0 | 0 | 100 |
| Aggregate origination volume | $0 | $0 (testnet only) | $50K+ USDC |
| Default rate | n/a | n/a (testnet) | <5% (target) |
| LP partners | 0 | 0 | 1+ |
| LOI documents | 1 (Payku) | 3+ (pilot users) | 5+ (pilots + LP) |

### 8.2 Qualitative Success Signals

- Stellar ecosystem awareness: at least 1 mention in Stellar community channels per tranche
- Developer adoption: at least 1 external repo forking or importing the SDK by end of Tranche 3
- Reviewer satisfaction: SCF validation scripts return all green on first reviewer attempt

### 8.3 Failure Conditions (Honest)

This is a credit protocol. Some failure modes:
- **Default rate > 15%** in the pilot cohort would indicate the scoring algorithm needs recalibration. Mitigation: tighten scoring thresholds, reduce loan limits.
- **Pilot user count < 50** by end of Tranche 3 would indicate go-to-market difficulty. Mitigation: Commercial Lead pivots from PyME direct outreach to channel partnerships with industry associations.
- **No LP partner secured** by Tranche 3 deadline would block mainnet origination. Mitigation: founders commit personal funds as bootstrap liquidity ($5K+).

---

## 9. Revenue Projection (Conservative)

| Period | Origination volume | Vigente revenue (1% fee) | Protocol expenses | Net |
|--------|-------------------|-------------------------|-------------------|-----|
| End Tranche 3 | $50K | $500 | (grant-funded) | n/a |
| Month 9 | $200K | $2,000 | $5,000 (infra + Commercial) | -$3,000 |
| Month 12 | $500K | $5,000 | $5,000 | $0 (break-even) |
| Month 18 | $2M | $20,000 | $7,500 | +$12,500 |
| Month 24 | $15M | $150,000 | $15,000 | +$135,000 |

These are conservative projections assuming Chile-only operations through Month 18 and modest LatAm expansion in Month 19-24. Aggressive scenarios with multi-country launch could be 2-3x higher.

---

## 10. Risk & Mitigation

| Risk | Mitigation |
|------|------------|
| Payku partnership fails | Fintoc adapter (Tranche 2) provides alternative data source. Open banking is regulatory-protected; Fintoc cannot revoke API access arbitrarily. |
| Default rates higher than expected | Scoring engine has explicit tuning levers (V, F, C weights). Conservative initial loan limits with measured loosening. |
| Stellar ecosystem doesn't adopt the SDK | Vigente queries are free and permissionless. Adoption is organic. Even without protocol adoption, the reference vault provides a working lending product. |
| Regulatory pushback in Chile | Chile has fintech regulation (Ley Fintec 21.521) explicitly allowing this kind of model. Vigente operates on public open banking standards. |
| Audit reveals critical vulnerability | Circuit breaker (`pause()`) tested. Migration plan in `docs/MAINNET_OPERATIONS.md`. Audit funded separately via SCF Audit Bank. |
| Founder unavailability | Full-stack Engineer (Cristian) has deep knowledge of code; Commercial Lead (Mauricio) maintains commercial continuity. Bus factor > 1. |

---

## 11. Why This Plan Aligns with Stellar's Ecosystem Goals

Stellar's mission is financial inclusion. Vigente directly addresses one of the most acute exclusion problems in Latin America: credit invisibility for the small business segment. By building this on Stellar specifically (rather than Ethereum or L2s), we leverage:
- The cost structure that makes micro-loans economically viable (sub-cent fees)
- The throughput needed for real-time credit decisions (5-second finality)
- The composability that lets any protocol use Vigente as a public good

If Vigente succeeds, Stellar gets a credit primitive that none of its competitors have natively. If it fails, the lessons are public, the code is MIT-licensed, and the next builder can fork.

---

*Document Version: 1.0.0*
*Last updated: 2026-05-24*
*Authors: Founder + Commercial Lead*
