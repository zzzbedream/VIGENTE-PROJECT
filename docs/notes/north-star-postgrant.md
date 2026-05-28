# Post-Grant North Star — Subcollateralized Debt & On-Chain Credit Bonds

**For:** Cristian (integration into `docs/BUSINESS_PLAN.md` during D.3, Day 11)
**Authored by:** Founder (zzzbedream), Day 1 of the SCF resubmit sprint
**Status:** Vision, not Tranche deliverable. Goes in the "long-term" section of the business plan.

---

Tranche 1 and Tranche 2 focus strictly on establishing the Vigente Badge as a robust, sybil-resistant scoring primitive. The ultimate vision for the protocol is to bootstrap a **decentralized fixed-income market** on top of that primitive.

Once the threshold scoring engine is validated at scale, the protocol will leverage these verifiable credit profiles to enable the issuance of **on-chain credit bonds**. High-tier users (Gold / Silver) will be able to access **subcollateralized lending pools**, allowing liquidity providers to underwrite debt based on transparent, on-chain behavioral data.

By solving the identity and creditworthiness puzzle first, Vigente sets the technical foundation to bring traditional bond mechanics and institutional liquidity into the Stellar ecosystem.

## Why this matters for the SCF narrative

The current submission risks being read as "another credit-score oracle". This north-star clarifies that the badge is the **infrastructure layer** beneath a much larger market design:

- **T1–T2 (grant scope):** the primitive — badge SBT, threshold oracle, reference vault.
- **Post-grant (this vision):** the market — credit bonds, undercollateralized pools, institutional LP partnerships.

Frame the SCF ask as funding the foundation, not the end product.

## How to integrate into BUSINESS_PLAN.md

Add a new section toward the end (after current GTM, before competitive analysis):

> ### Post-Grant North Star: Subcollateralized Debt & On-Chain Credit Bonds
> [paste text above]

Avoid promising bond mechanics inside any Tranche deliverable. Stay disciplined: the grant funds the primitive. The bonds story is the "what comes next" arc, not a milestone.

## Open questions to refine before D.3

1. Who is the target LP archetype — DeFi protocols (Blend, Aave-style), DAO treasuries (Stellar Aid, MakerDAO-style), or fintech-licensed funds?
2. What's the conservative LTV / undercollateralization band for Gold-tier? (Initial guess: 80-90% collateralization for Gold, 95-100% for Silver, full collateral for Bronze.)
3. Is there a bond-maturity model that matches Chilean SME cash-flow cycles (typically 30 / 60 / 90 days)?

These belong in the business plan, not the technical deliverables.
