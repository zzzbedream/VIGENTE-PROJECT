# Vigente Protocol — Threat Model & Risk Mitigation

> *Every claim in this document is verifiable. Each mitigation links to the
> code that implements it and the test (or live testnet transaction) that
> validates it.*

This document responds directly to the SCF reviewer feedback that
"key components are underspecified" and "the centralized oracle model
introduces a single point of trust". It is structured as a STRIDE-style
analysis of six concrete attack vectors against Vigente Protocol, the
mitigation we ship, the file that implements it, and the artefact that
proves it works.

## Summary table

| # | Vector | Mitigation | Status |
|---|---|---|---|
| 1 | Carousel / wash trading between user-owned wallets | Ecosystem-counterparty whitelist + 70% penalty on P2P volume and frequency | ✅ Shipped (B'.1) |
| 2 | Sybil farms minting bot-wallet badges en masse | Hard wallet-age floor (30 days, configurable) bundled into the signed mint message | ✅ Shipped (B'.2) |
| 3 | "Long con" — high score reputation followed by a single large default | Score-anchored credit ladder: first loan throttled to 10% of tier ceiling, full ceiling only after first successful repay | ✅ Shipped (B'.3) |
| 4 | Vault drainage via reentrancy / bug + uncapped exposure | Circuit-breaker pause (Phase 1) + TVL cap + 85% utilization rail | ✅ Shipped (already + B'.4) |
| 5 | Centralized oracle compromise (single signer) | k-of-n threshold ed25519 oracle ACL with on-chain verification + per-mint anti-replay nonce | ✅ Shipped (Phase B) |
| 6 | LP bank run | 14-day withdrawal timelock + utilization cap floor of 15% available liquidity | ✅ Shipped (B'.5) |

## 1. Carousel / wash trading (Vector V1.E1)

**Attack.** A single human creates wallets A, B, C and routes $X back and forth daily. Naive scoring sees high volume and high frequency, awards Gold, lends, defaulter disappears.

**Mitigation.** `horizon-scoring.ts` classifies every payment by its counterparty against an explicit allowlist of ecosystem service addresses. Volume from outside that list is multiplied by `ECOSYSTEM_P2P_FACTOR = 0.3` (a 70% penalty). The penalty is applied to all three dimensions the scoring engine reads — raw volume, monthly volume bins, and effective transaction count — so an attacker who maintains perfect uniformity to keep consistency/frequency points still cannot reclaim the volume lost to the penalty.

**Code:**
- [web/src/services/ecosystem-whitelist.ts](../web/src/services/ecosystem-whitelist.ts) — the seed list and the `isEcosystemCounterparty` lookup.
- [web/src/services/horizon-scoring.ts](../web/src/services/horizon-scoring.ts) — `computeFeatures` does the split into `contract_volume_usd_equiv`, `p2p_volume_usd_equiv`, `adjusted_volume_usd_equiv`, plus the parallel split on transaction counts (`contract_tx_count`, `p2p_tx_count`, `effective_tx_count`).
- `featuresToMetrics` feeds the adjusted basis into the scoring engine.

**Proof:**
- [web/tests/horizon-scoring.test.ts](../web/tests/horizon-scoring.test.ts) — test *"pure P2P volume is discounted by ECOSYSTEM_P2P_FACTOR (Carousel mitigation)"* builds a $18k-equivalent attacker scenario and asserts the resulting tier is not Gold.
- Test *"same volume via ecosystem counterparty gets full weight"* confirms a real merchant earning $18k via a whitelisted hub keeps Gold.

**Out-of-scope nuance.** The whitelist is currently a hardcoded seed of ~3 well-known testnet addresses, plus an `VIGENTE_ECOSYSTEM_EXTRA_ADDRESSES` env override for experiments. Post-grant the curator list moves to LP-DAO governance — documented as the explicit next step, not promised as part of this submission.

## 2. Sybil farms (Vector V1.E2)

**Attack.** A bot script creates 1,000 fresh Stellar accounts and immediately requests badges hoping to game any volume floor.

**Mitigation.** Two complementary controls:
1. The off-chain oracle node refuses to sign a mint for any account whose `account_age_days` is below the floor (default 30).
2. The on-chain contract independently rejects mint calls where the signed `account_age_days` argument is below `MinWalletAgeDays`. The age value is part of the canonical message every oracle signs, so a compromised oracle cannot pass an inflated age to the contract on its own — the other k-1 oracles refuse to co-sign.

**Code:**
- [contracts/vigente-badge/src/lib.rs](../contracts/vigente-badge/src/lib.rs) — `DataKey::MinWalletAgeDays` (default 30), `set_min_wallet_age` admin-only setter, `mint()` rejects when `account_age_days < min_age`.
- `build_mint_message()` includes `account_age_days_be` between `expiration_be` and `nonce` in the canonical signed bytes.

**Proof:**
- 4 unit tests in [contracts/vigente-badge/src/test.rs](../contracts/vigente-badge/src/test.rs): below-floor rejection, exact-floor pass, admin lowering the floor, and the tamper test where the relayer submits `age=15` against signatures produced over `age=60` — ed25519_verify fails because the bytes don't match.
- Live testnet evidence: `npm run mint:onchain -- … --age 10` was trapped at simulation with `HostError(WasmVm, InvalidAction)` against v3 contract `CDLLO7QE…` — recorded in [docs/notes/phase-b-prime-acceptance.md](../docs/notes/phase-b-prime-acceptance.md).

**Cost calculus for an attacker.** Creating 1,000 fresh wallets, waiting 30 days, then attempting a Sybil-bulk mint costs the wait time plus the threshold signature requirement on every single mint. Each badge issuance must clear the score floor — i.e. the wallet must show 180 days of activity history with whitelisted counterparties — so the 30-day age floor by itself is not the entire defense; it's the cheapest filter that eliminates the obviously synthetic.

## 3. Long con (Vector V1.E3)

**Attack.** A patient borrower builds a 6-month spotless reputation, takes the maximum loan once the ladder allows, defaults intentionally, abandons the wallet.

**Mitigation.** The credit ladder in `reference-vault` throttles every borrower's first loan to 10% of their tier-ceiling-derived score-anchored cap. The full cap unlocks only after `RepayCount(borrower) > 0`, and `RepayCount` is incremented exclusively inside `repay()` — never inside `liquidate()`, so a defaulter who paid prior loans does not retain the lifted cap.

**Math:**

```
TIER_GOLD_CEILING   = $2,000   (score ≥ 800)
TIER_SILVER_CEILING = $500     (score ≥ 550)
TIER_BRONZE_CEILING = $100     (score ≥ 300)

score_anchored = (tier_ceiling × score) / 1000
first_loan_cap = score_anchored × 0.10
post_repay_cap = score_anchored
allowed = min(cap, per_pool_cap)   // per_pool_cap = available_liquidity / 10
```

**Worked example.** A Gold borrower with score 900 has `score_anchored = $1,800`. Their first loan is bounded at `$180`. To reach $1,800 they must close their first loan honestly — which costs them at least the interest payment and surrenders the option of defaulting on a higher amount.

**Code:**
- [archive/reference-vault/src/lib.rs](../archive/reference-vault/src/lib.rs) — `tier_ceiling_for_score`, the ladder in `borrow()`, and `RepayCount(borrower)` incremented in `repay()`.

**Proof:**
- 5 tests in [archive/reference-vault/src/test.rs](../archive/reference-vault/src/test.rs): `test_first_loan_throttled_to_10pct_of_ceiling`, `test_ladder_lifts_to_full_ceiling_after_first_repay`, `test_max_loan_for_borrower_applies_first_loan_throttle`, `test_below_bronze_floor_rejected`, plus the integration tests that prove existing happy-path / default-path tests still work under the ladder.

## 4. Vault drainage and uncapped exposure (Vector V2.E4)

**Attack.** A bug in the lending logic (or a future amendment) leaks more USDC than the borrower's collateral / credit limit allows. Without bounds, the loss is unbounded.

**Mitigation.** Three independent rails:

1. `pause()` / `unpause()` admin-only circuit breaker. Already present from Phase 1.
2. `MaxTvlUsdc` — hard ceiling on `TotalDeposits`. Deposits past the cap are rejected (`"deposit exceeds TVL cap"`).
3. `MaxUtilizationBps` — default 85%. `borrow()` rejects when `(total_borrowed + amount) × 10_000 > total_deposits × max_utilization_bps`. The remaining 15% of pool liquidity stays available for `claim_withdraw`.

**Code:**
- [archive/reference-vault/src/lib.rs](../archive/reference-vault/src/lib.rs) — see `deposit()`, `borrow()`, the `MaxTvlUsdc` and `MaxUtilizationBps` storage keys, and the `pause`/`unpause` admin-only functions.

**Proof:**
- `test_tvl_cap_rejects_overflow` and `test_tvl_cap_allows_at_exactly_limit` validate the boundary.
- `test_utilization_cap_rejects_over_limit` configures a tight 1% cap and confirms borrows past it are rejected with the expected panic string.
- Pre-existing `test_mint_while_paused_fails`, `test_slash_while_paused_fails`, `test_unpause_resumes_operations` cover the breaker.

## 5. Centralized oracle compromise (Vector V2.E5)

**Original SCF reviewer concern.** *"The centralized oracle model introduces a single point of trust for reputation issuance."*

**Mitigation.** The `vigente-badge` contract no longer accepts mints from a single oracle Address. Instead it stores `OracleKeys: Vec<BytesN<32>>` (n raw ed25519 pubkeys) and `OracleThreshold: u32` (k). Every mint must include a `Vec<(u32, BytesN<64>)>` with at least k entries, each one a signature over the canonical mint message verifiable against `OracleKeys[index]`. Indices must be unique within a single call (so one oracle cannot vote twice). The nonce is stored as a `UsedNonce(BytesN<32>)` marker after a successful mint and rejected on replay.

**Canonical message format (92 bytes for a G-address borrower):**

```
borrower.to_xdr()    // 44 bytes
|| score.to_be(4)    // 4 bytes
|| expiration.to_be(8)
|| account_age_days.to_be(4)
|| nonce             // 32 bytes
```

**Cross-language parity is the load-bearing assumption.** The off-chain signer in TypeScript (`web/src/services/threshold-oracle.ts`) builds these bytes via `Address.fromString(...).toScVal().toXDR()` and `Buffer.concat`. We validate the parity byte-for-byte both in unit tests and against a live Soroban host.

**Code:**
- [contracts/vigente-badge/src/lib.rs](../contracts/vigente-badge/src/lib.rs) — storage keys, `set_oracle_keys` (atomic replacement, rejects duplicates, requires `threshold <= keys.len()`), `mint()` verification loop calling `env.crypto().ed25519_verify` k times.
- [web/src/services/threshold-oracle.ts](../web/src/services/threshold-oracle.ts) — `buildMintMessage`, `signMint`, `buildSignedMintRequest`. Seeds persist in `web/.env.local` under `VIGENTE_ORACLE_SEEDS_HEX` so the pubkeys registered on-chain match the simulator across restarts.

**Proof:**
- Day-1 budget probe: `tests/threshold_smoke.rs::smoke_three_of_five_signatures_under_budget` measured 3× `ed25519_verify` at 1.3% of testnet CPU budget, recorded in [docs/notes/soroban-budget-day1.md](../docs/notes/soroban-budget-day1.md).
- 7 threshold-specific unit tests in [contracts/vigente-badge/src/test.rs](../contracts/vigente-badge/src/test.rs): 3-of-5 happy path with non-contiguous indices, insufficient sigs rejection, duplicate index rejection, replayed nonce rejection, invalid signature rejection, out-of-range index rejection, `set_oracle_keys` admin-only.
- XDR parity unit tests: [web/tests/xdr-parity.test.ts](../web/tests/xdr-parity.test.ts) asserts the TS output equals the printed Rust fixture byte-for-byte (92 bytes).
- Live testnet evidence: tx `8b9fccfc…` minted a Gold badge on `CDLLO7QE…` with 3 simulator-produced signatures and `get_score(borrower)` returned the exact score signed. [stellar.expert](https://stellar.expert/explorer/testnet/tx/8b9fccfc9daaf594e457e19808ef9c0746e8e45f37aab8417b5fe8d59641bc85).
- Negative live evidence: a tampered `age=10` submission against the same contract was trapped at simulation with `Error(WasmVm, InvalidAction)`. No tx hit the ledger, no gas was spent.

## 6. LP bank run (Vector V3.E6)

**Attack.** A rumor of compromise spreads, every LP simultaneously requests a withdrawal, available liquidity is insufficient because most of it is lent out, the vault collapses.

**Mitigation.**
- `request_withdraw(lp, amount)` records a `WithdrawalRequestRecord { amount, requested_at: now }`. One active request per LP.
- `claim_withdraw(lp)` succeeds only if `now >= requested_at + WithdrawalTimelock` (default 14 days) AND available liquidity covers the payout. The payout caps at the LP's current balance in case losses (cross-contract slashes from liquidations) have shrunk it since the request.
- `cancel_withdraw(lp)` lets an honest LP back out without penalty.
- The 14-day window combined with the 85% utilization cap means even a coordinated rush leaves enough float for honest withdrawals as outstanding loans repay.

**Code:**
- [archive/reference-vault/src/lib.rs](../archive/reference-vault/src/lib.rs) — `request_withdraw`, `claim_withdraw`, `cancel_withdraw`, and the `WithdrawalRequest(Address)` storage key.

**Proof:**
- 6 tests in [archive/reference-vault/src/test.rs](../archive/reference-vault/src/test.rs): `test_request_then_claim_withdraw_after_timelock`, `test_claim_before_timelock_fails`, `test_double_withdrawal_request_rejected`, `test_cancel_then_new_request_succeeds`, `test_request_above_balance_rejected`, `test_cancel_without_request_fails`.

## Threats explicitly out of scope

These are real risks that we have deliberately not mitigated and we want SCF reviewers to know we made that choice consciously:

- **A Stellar validator quorum collapse or network split.** We trust the Stellar Core consensus to be live and safe. If it isn't, every protocol on the network is in trouble, not just ours. This is not a problem we can solve at the application layer.
- **A compromised user wallet (Freighter, hardware wallet, key leak).** If the user's private key is stolen, the attacker can sign any transaction the user could. Vigente cannot meaningfully defend against this — it's a layer below us.
- **Front-end exploits (XSS, malicious browser extension).** The front-end is informational. Every consequential action requires either an on-chain signed transaction or an off-chain threshold signature. A compromised UI can mislead the user but cannot bypass the contract's authorization rails.
- **A future SDK / Soroban host bug.** We pin the SDK version in `Cargo.toml` and the contract version on-chain; a host bug is something we monitor and patch like the rest of the ecosystem.

Listing these explicitly is itself a security control — it stops the next reviewer from spending time debating a vector we have already considered and ruled out for sound reasons.

## How to verify this document end-to-end

A reviewer with `cargo`, `npm`, and a Soroban-compatible Stellar account can reproduce every claim:

```bash
# Unit tests across all contracts
cd contracts/vigente-badge && cargo test
cd ../reference-vault   && cargo test
cd ../mock-usdc         && cargo test

# Off-chain scoring + simulator + XDR parity
cd ../../web
npm run test:web

# Live end-to-end mint against v3 on testnet
npm run mint:onchain -- <YOUR_G_ADDRESS> 750 --age 60
# Returns a tx hash; paste into stellar.expert for confirmation.

# Negative end-to-end (age floor enforcement)
npm run mint:onchain -- <YOUR_G_ADDRESS> 700 --age 10
# Should fail at simulation with Error(WasmVm, InvalidAction).
```

Test counts at submission time: **41 badge + 5 smoke + 23 vault + 5 mock-usdc + 30 web = 104 green tests**.
