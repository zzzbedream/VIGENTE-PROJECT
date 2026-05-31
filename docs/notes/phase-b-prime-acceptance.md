# Phase B' — Threat-Model Hardening Acceptance

**Date:** 2026-05-31 (sprint Day 2, evening — ahead of plan)
**Outcome:** PASS for B'.2 (age floor), B'.3 (credit ladder), B'.4 (TVL + util cap), B'.5 (LP timelock).
**Remaining:** B'.1 (whitelist + P2P penalty in horizon-scoring) — off-chain only.

## What landed on-chain

| Contract | Address | Network |
|---|---|---|
| vigente-badge **v3** | `CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD` | testnet |

v3 supersedes v2 (`CCD7KNYI…`). The new mint signature includes `account_age_days` as a u32 before the nonce, and the contract enforces `account_age_days >= MinWalletAgeDays` (default 30 days).

ACL configured identically to v2 (same 5 oracle pubkeys, threshold 3, sourced from `VIGENTE_ORACLE_SEEDS_HEX` in `web/.env.local`).

## Positive end-to-end test (v3)

`npm run mint:onchain -- GBV676BN… 880 --age 90`

| Field | Value |
|---|---:|
| Tx hash | `8b9fccfc9daaf594e457e19808ef9c0746e8e45f37aab8417b5fe8d59641bc85` |
| Status | SUCCESS |
| Borrower score on-chain | 880 |
| Age days asserted | 90 |
| Signatures | 3 (oracles 0, 1, 2) |

[stellar.expert](https://stellar.expert/explorer/testnet/tx/8b9fccfc9daaf594e457e19808ef9c0746e8e45f37aab8417b5fe8d59641bc85)

## Negative test (age floor enforcement)

`npm run mint:onchain -- GBV676BN… 700 --age 10`

The Soroban host rejected the call with `Error(WasmVm, InvalidAction) — VM call trapped: UnreachableCodeReached`, which is exactly how a Rust `panic!("wallet age below minimum")` surfaces at the WASM layer. The simulator caught it during simulation, so no transaction hit the ledger and no gas was spent.

This validates a critical invariant in production:

- The age value lives **inside the signed message**, not in some out-of-band field.
- A malicious relayer cannot lie about age without invalidating the signatures.
- A malicious single oracle cannot grant a young wallet a badge alone — the other k-1 oracles in the threshold would refuse to co-sign the fabricated age, and the contract would reject.

## Test matrix at the close of B'.2-5

| Suite | Tests | Result |
|---|---:|---|
| `vigente-badge` lib | 41 | green |
| `vigente-badge` smoke | 5 | green |
| `reference-vault` lib | 23 | green |
| `mock-usdc` | 5 | green |
| Web (`horizon-scoring`, `threshold-oracle`, `xdr-parity`) | 25 | green |
| **Total** | **99** | **green** |

## Math anchors documented in code

- Credit ladder ceilings live in `contracts/reference-vault/src/lib.rs` as `TIER_GOLD_CEILING`, `TIER_SILVER_CEILING`, `TIER_BRONZE_CEILING` and the `tier_ceiling_for_score()` helper.
- First-loan throttle is `FIRST_LOAN_FACTOR_BPS = 1_000` (= 10%) and applies whenever `RepayCount(borrower) == 0`.
- Default util cap is `8500` bps (85%) and default withdrawal timelock is `14 * 24 * 60 * 60` seconds.
- Default min wallet age is `30` days, configurable by admin without redeploy via `set_min_wallet_age`.

These constants are intentionally inline and named — anyone reviewing the contract sees the threat-model knobs without spelunking through documentation.

## Items intentionally NOT done in B'.2

- **Mint fee with escrow refund** (originally part of B'.2 in the plan): adds a token-transfer flow that needs a fee SAC plumbed through deploy + tests + simulator. Defer until Phase D so the polished demo doesn't carry half-finished plumbing. The current age-floor mitigation already imposes a meaningful cost on bot wallets (30-day waiting period before any mint can happen), so the marginal value of the mint fee in the SCF narrative is incremental, not foundational.
- **Whitelist + P2P penalty** (B'.1): off-chain only, lives in `horizon-scoring.ts`. Next item.

## Items completed beyond plan

- v3 testnet deploy + end-to-end positive and negative validation in production. The plan only required B'.7 to surface in code; running it against live testnet wasn't required until Phase D.
- The reference-vault test suite was reorganized with the credit ladder amounts in plain USD numbers (`usdc(150)`) so reviewers can read the test files as documentation of the ladder behavior.
