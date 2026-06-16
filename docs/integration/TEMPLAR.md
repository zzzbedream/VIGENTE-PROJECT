# Vigente × Templar — Integration (Capa 1 MVP)

> Status: **draft / pre-outreach**. Architecture verified from public sources
> (June 2026); the on-chain specifics must be confirmed directly with the
> Templar team before any production integration. See "Open questions" below.

## 1. Why Templar is the first Capa-1 target

Templar is the newest lending protocol on Stellar/Soroban (launched late 2025),
growing fast (+89.5% QoQ TVL in Q1 2026, ~$5.6M) with an explicit **RWA** focus
(Centrifuge deJAA/deJTRSY, Etherfuse CETES/USTRY). Being new and in expansion, it
is more likely to **co-design a credit primitive** than an already-consolidated
protocol. It is the natural first integrator for a reputation/credit layer.

## 2. Verified architecture (A.0 finding)

| Aspect | Finding | Source |
|---|---|---|
| Collateral model | **Collateralized** — borrow USDC against XLM and (soon) RWA collateral | templarfi.org |
| Oracle slot | **Pyth price feed**, 60s staleness cap, EMA smoothing, per-market price ID + decimals | Templar docs / Stellar oracle providers |
| Chain abstraction | NEAR MPC + Chain Signatures (deposit Stellar assets, borrow cross-chain) | templarfi.org/blog/stellar |

**Conclusion.** Templar's on-chain oracle is **price-only** (like Blend's SEP-40
slot). There is **no on-chain hook to gate a borrower by reputation**. Vigente
therefore cannot inject a credit score into Templar's contract path. This is the
same constraint we already documented for Blend in the J.3.2 correction — and we
treat it with the same honesty.

## 3. Chosen integration pattern — (b) off-chain eligibility gate

Two patterns were considered:

- **(a) On-chain gate** — only viable if Templar exposes a per-borrower risk hook
  it invokes during `borrow`. It does **not** today (price-only oracle). Rejected.
- **(b) Off-chain eligibility gate** — **chosen.** The Vigente backend reads the
  borrower's badge (`get_score`, `is_defaulted`) permissionlessly via simulation,
  decides who enters a reputation-tier pool and with what subcollateralized
  ceiling, and Templar keeps using its normal Pyth price oracle.

```
Open Finance (optional, consented)          on-chain, trustless
   Floid / Fintoc enrichment  ─┐                 │
                               ▼                 ▼
 borrower ──▶ Vigente scoring engine ──▶ threshold oracle (k-of-n) ──▶ vigente-badge (mint)
                                                                            │ get_score / is_defaulted
                                                                            ▼
                              Vigente backend  ──evaluateTemplarEligibility──▶  decision
                                                                            │ (eligible? subcollateralized ceiling)
                                                                            ▼
                                               Templar pool entry / terms (Pyth price oracle unchanged)
```

The **value frontier is never delegated**: threshold oracle + scoring engine +
badge SBT stay ours. Templar is a distribution/consumer layer. The on-chain
score (`get_score`) and the immutable default (`is_defaulted`) remain the
trustless source of truth; "zero fintech in the trust path" still holds because
Open Finance enrichment is optional and sits *before* scoring, never inside the
attestation.

## 4. Credit policy (off-chain twin of reference-vault)

The decision logic lives in
[`web/src/lib/integrations/templar-adapter.ts`](../../web/src/lib/integrations/templar-adapter.ts)
and is the off-chain mirror of the **on-chain** policy proven in
[`contracts/reference-vault/src/lib.rs`](../../contracts/reference-vault/src/lib.rs):

| Rule | Value | reference-vault proof |
|---|---|---|
| Default = hard reject (checked first) | `is_defaulted` | `test_borrow_when_defaulted_fails` |
| Bronze floor | score ≥ 300 | `test_below_bronze_floor_rejected` |
| Tier ceilings (USD) | Gold $2000 / Silver $500 / Bronze $100 | `test_max_loan_for_score_uses_tier_ceiling` |
| First-loan throttle | 10% of ceiling until first repayment | `test_first_loan_throttled_to_10pct_of_ceiling` |
| Repayment ladder | lifts to 100% after first on-time repay | `test_ladder_lifts_to_full_ceiling_after_first_repay` |

These ceilings are deliberately small. **CP2 (prevention of over-indebtedness,
Cerise+SPTF)** governs them — see [docs/qms/CLIENT_PROTECTION.md](../qms/CLIENT_PROTECTION.md).
Subcollateralized credit to thin-file borrowers must start conservative.

## 5. Snippet

```ts
import {
  readBadgeState,
  evaluateTemplarEligibility,
} from "@/lib/integrations/templar-adapter";

// reader wraps the project's Stellar RPC client (Interface v1 §3 simulation reads)
const state = await readBadgeState(reader, borrowerG);
const decision = evaluateTemplarEligibility(state, {
  hasPriorRepayment,
  requestedUsd,
});

if (decision.eligible) {
  // route borrower into the Vigente-gated Templar pool at decision.approvedUsd
}
```

Tests: `cd web && npm run test:templar` (7/7). The two headline cases mirror the
on-chain proofs: eligible→approved-throttled, defaulted→hard-reject.

## 6. Open questions for the Templar team

1. Does Templar expose **any** per-market admin hook (allowlist, max-LTV override,
   pool-entry guard) that a reputation layer could drive on-chain? If yes, pattern
   (a) becomes possible and we revisit.
2. Appetite to co-design a **reputation-tier RWA pool** where Vigente gates entry?
3. Pyth market-config details (price ID, decimals) for the assets in scope.

## 7. Out of scope (by design, until confirmed)

Subcollateralized lending at scale, interest-rate curves, liquidation auctions —
these are Templar's domain, not Vigente's. Vigente supplies the credit signal and
the eligibility decision; it does not become a lending market.
