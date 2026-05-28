# Day 1 — Soroban Budget Probe for k-of-n ed25519 Threshold Verification

**Date:** 2026-05-28
**Phase:** Sprint Day 1, Track T1 (foundational risk reduction)
**Test:** `contracts/vigente-badge/tests/threshold_smoke.rs`
**Soroban SDK:** 21.2.0 (host 21.2.1)

## Verdict: PASS

Three `env.crypto().ed25519_verify` invocations inside a single Soroban contract call consume **1.3% of CPU budget and 0.003% of memory budget** on testnet. We have abundant headroom for the rest of `mint()` (storage writes, SHA-256 hashing, ACL lookups, event emission). Proceed with Phase B (Threshold Oracle Contract) as planned — k = 3, n = 5.

## Measurements

| Metric | Used | Testnet ceiling | % of budget |
|---|---:|---:|---:|
| CPU instructions | 1,272,389 | 100,000,000 | **1.27%** |
| Memory bytes | 1,272 | 41,943,040 | **0.003%** |
| Signatures vector payload | ~220 bytes | ~131,072 (envelope) | **0.17%** |

## Cost breakdown (3× ed25519_verify)

| CostType | CPU insns | Mem bytes |
|---|---:|---:|
| `VerifyEd25519Sig` | 1,135,623 | 0 |
| `ComputeEd25519PubKey` | 120,759 | 0 |
| `MemAlloc` | 5,343 | 1,272 |
| `ComputeSha256Hash` | 3,738 | 0 |
| `VisitObject` | 4,331 | 0 |
| `MemCpy` | 2,043 | 0 |
| `MemCmp` | 552 | 0 |
| **Total** | **~1.27M** | **~1.3K** |

The dominant cost is `VerifyEd25519Sig` itself (~378K CPU per verification × 3). Linear scaling is observed — we could verify up to ~78 signatures in a single tx before hitting the CPU ceiling, far beyond any sensible threshold scheme.

## Implications for Phase B

1. **Threshold k = 3** is comfortably feasible. Even k = 5 (all 5 oracles) would consume ~2.1M CPU instructions, still under 2.2% of budget.
2. **No need to split mint() across multiple transactions.** Single-tx verification is the simplest and most auditable design.
3. **Anti-replay nonce storage** can be added in `persistent` without budget concerns — storage costs are paid via separate resource fees, not CPU/memory budget.
4. **No commit-reveal fallback required.** The Day-1 contingency plan for `❌ FAIL` verdict is shelved.

## What we still need to validate (deferred but not blocking)

- **Real testnet deployment cost** in XLM (lumens). The test harness measures budget consumption, not the resulting transaction fee. Day 7 (B.7 deploy) will surface this.
- **Storage rent for nonces.** Day 7 deploy + 50 sintéticos in Day 5 will produce empirical data.

## Tests run

```
cargo test --test threshold_smoke -- --nocapture
```

| Test | Result |
|---|---|
| `smoke_single_verification_succeeds` | ✅ PASS |
| `smoke_three_of_five_signatures_under_budget` | ✅ PASS |
| `smoke_invalid_signature_fails` | ✅ PASS (panic captured as expected) |
| `smoke_payload_size_within_envelope` | ✅ PASS |

Snapshots written to `contracts/vigente-badge/test_snapshots/`.

## Next steps (unblocked)

- **T2 (Phase A):** start `web/src/services/horizon-scoring.ts` with cap 180d/200 ops.
- **T3 (Day 1):** create `web/scripts/setup-mother-account.ts` — fund the mother account via Friendbot once.
- **Phase B planning:** safe to assume on-chain k-of-n ed25519 verification as the production design. No degradation needed.
