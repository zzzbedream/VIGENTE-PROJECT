# Phase A Acceptance — Synthetic Scoring Engine

**Date:** 2026-05-28 (Day 1)
**Test:** `npm run evaluate -- <pubkey>` against live Stellar testnet
**Module:** `web/src/services/horizon-scoring.ts`

## Verdict: PASS — Phase A sealed

All three acceptance criteria from the plan are met. Phase B is unblocked.

## Test 1 — Single-op account (mother account, freshly funded)

Pubkey: `GBV676BNXDPVZDLUAB6O7DHWUIS42OTIWI5MIKCFJOWMJWTVKQNXFWCM`

| Field | Value |
|---|---:|
| ops_evaluated | 1 |
| capped | `false` |
| account_age_days | 0 |
| total_volume_usd_equiv | 1000 |
| latency_ms | **718** |
| tier | None |

Expected: no cap, low score, sub-second latency. ✅

## Test 2 — Whale account (Circle USDC testnet issuer)

Pubkey: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`

| Field | Value |
|---|---:|
| ops_evaluated | 199 (post-filter from 200-record page) |
| capped | **`true`** ← 200-op cap fired before 180d window |
| account_age_days | 162 |
| density_cv | 2.80 (bursty) |
| asset_diversity | 2 |
| total_volume_usd_equiv | 634.01 |
| latency_ms | **882** |
| tier | Bronze (volume too low despite activity) |

Expected: cap activates, sub-3s latency, honest tier (not inflated). ✅

## What this confirms

1. **Paginación inversa is O(1) relative to total history.** The whale has presumably tens of thousands of operations; we still finished in 882 ms — only 23% slower than the 1-op mother account. Horizon's `order=desc&limit=200` does the heavy lifting; we never paginate forward.

2. **Honesty over inflation.** The Circle USDC issuer is a "whale" in account-creation/admin activity, but the engine doesn't see this as creditworthiness — its actual XLM/USDC payment volume in the window is only $634. The engine returns Bronze, not Gold. This is the correct behavior for a credit oracle: identity-style "VIP" status does not equal repayment capacity.

3. **No crashes on truncation.** The 200-record array was processed without OOM, without panic, without unhandled rejections.

4. **Cap is auditable.** The `capped: true` flag is in the JSON response, not buried. SCF reviewers can verify the design decision is deliberate, not hidden.

## SLA budget assessment

Plan target: `<3s for accounts within the cap, <6s for whales`.
Reality: **<1s for both**. We have 3× headroom even before any caching kicks in.

The 5-minute in-memory cache (`/api/oracle/score-onchain`) provides a second layer of protection against Horizon rate limits — once a pubkey is fetched, subsequent reads in the next 5 min return `cache_hit: true` instantly.

## Phase B unblocked

With on-chain scoring sealed and the Day-1 Soroban smoke verdict (PASS, see `soroban-budget-day1.md`) also green, all preconditions for Phase B are met:

- ed25519 threshold verification fits comfortably in Soroban budget (1.3% of CPU ceiling for k=3).
- Synthetic scoring engine produces honest, low-latency, source-agnostic credit scores.
- No fintech dependency anywhere in the score-mint path.

Proceeding to B.1 (refactor `DataKey::AuthOracles` → `OracleKeys` + `OracleThreshold`).
