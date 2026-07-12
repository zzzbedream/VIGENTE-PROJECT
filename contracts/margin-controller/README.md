# Margin Controller — Vigente Protocol

Collateralized credit where the **LTV is per-user, set by on-chain reputation**.
The controller composes three REAL testnet integrations — it does not reinvent
the pool or the oracle:

| Piece | Contract (Stellar testnet) | Role |
|---|---|---|
| **Margin Controller** (this crate) | `CAZ2JITV36BJ5FO3UYM5XS32CISZ3JUCLW4GWYLGDUXHOGNJHELTS3FC` | Reputation → LTV gate + per-user accounting |
| Reputation Registry (`vigente-badge`) | `CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD` | `get_score` / `is_defaulted` / `slash` (3-of-5 threshold ed25519) |
| Price oracle (SEP-40, Reflector) | `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63` | `lastprice(Other("XLM"))` / `lastprice(Other("USDC"))`, 14 decimals |
| Blend pool (canonical TestnetV2) | `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF` | Liquidity: `submit` SupplyCollateral / Borrow / Repay / WithdrawCollateral |
| Borrow asset (Blend testnet USDC) | `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU` | `USDC:GATALTGT…` — borrowers need a classic trustline |
| Collateral (native XLM SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | Pilot collateral (cap: 100,000 XLM) |

**Blend never sees the score.** The gate (`amount <= collateral_value ×
tier_ltv(score) / 10000 − debt`) runs in this contract before any `submit`.
Blend only ever sees the controller's aggregate position.

## Live proof (executed 2026-07-11)

Real E2E on testnet, no mocks in the path:

1. `deposit_collateral(GBV676BN…, XLM, 100 XLM)` → collateral flowed
   controller → canonical Blend pool.
2. `max_borrow` → `143916153` ($14.39): 100 XLM × Reflector live price ×
   **7500 bps** (the user's REAL badge, score 650 → Silver tier).
3. `borrow($5)` → the Blend pool disbursed 5.00 real testnet USDC to the
   user's wallet (tier event: `(650, 7500)`).
4. `health` → 287%, `get_debt` → 5 USDC. Position remains live on-chain.

Reproduce the reads (no keys needed):

```bash
stellar contract invoke --network testnet --send=no \
  --source-account <ANY_FUNDED_SECRET> \
  --id CAZ2JITV36BJ5FO3UYM5XS32CISZ3JUCLW4GWYLGDUXHOGNJHELTS3FC \
  -- ltv_bps_for --user GBV676BNXDPVZDLUAB6O7DHWUIS42OTIWI5MIKCFJOWMJWTVKQNXFWCM
# → 7500
```

## Tier ladder (admin-tunable via `set_tier_ltv`)

| Score | Tier | LTV |
|---|---|---|
| ≥ 800 | Gold | 85% |
| ≥ 550 | Silver | 75% |
| ≥ 300 | Bronze | 60% |
| < 300 | — | cannot borrow |

Invariant enforced on-chain (`MAX_LTV_BPS = 9000`): every tier stays strictly
below the Blend reserve `c_factor` (90% for XLM on the canonical pool), so the
aggregate position can never be liquidated by Blend at a user's limit.

## Safety rules

- **Prices:** every operation calls SEP-40 `lastprice`; missing, non-positive,
  or older than `max_price_age` (900 s configured) → **revert**.
- **Caps:** per-asset total-collateral caps (pilot guardrail).
- **Pause:** admin circuit breaker.
- **Nested auth:** the pool pulls tokens from the controller inside `submit`;
  the controller pre-authorizes exactly that transfer via
  `authorize_as_current_contract` (see `authorize_pool_pull`).

## Liquidation (sprint scope) + keeper runbook

`liquidate(keeper, user)` when `health < 100`: seizes the user's collateral
claim into `Seized(asset)`, writes the debt off into `PendingSettlement`, and
**slashes the badge cross-contract** (reason 3 = collateral_shortfall). The
`seize` events carry (asset, amount, price, timestamp) — everything a keeper
or a future OEV solver needs.

Manual settlement runbook (T2 automates this):
1. Admin withdraws seized collateral from the Blend position
   (`WithdrawCollateral` as the controller admin op — T2 adds a helper).
2. Swap collateral → USDC (DEX / off-chain).
3. `submit(Repay)` the USDC against the controller's Blend liabilities.
4. Decrement `PendingSettlement` (T2 helper).

## Build / test / deploy

```bash
cargo test                                            # 26 tests + fuzz
cargo build --target wasm32-unknown-unknown --release
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/margin_controller.wasm
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/margin_controller.optimized.wasm \
  --source-account <ADMIN_SECRET> --network testnet
# init: see InitConfig in src/lib.rs (single JSON struct arg)
# then authorize slashing: vigente-badge add_vault --vault <CONTROLLER_ID>
```

Validation: `cd web && npm run validate-t1` — includes a `margin_controller`
block (crate tests + live on-chain reads of ltv/max_borrow/debt/health).

## Pins / notes

- `soroban-sdk 21.2.0` (repo-wide). The RedStone Rust SDK requires sdk 23.x —
  deliberately NOT embedded; we consume SEP-40 cross-contract instead (same
  pattern Blend uses). RedStone's adapter is the mainnet path (LOI); Reflector
  is the live testnet feed. BENJI enters as a second collateral via
  `add_collateral_asset` once a pool with a BENJI reserve exists (own pool —
  stretch; requires the RedStone BENJI feed).
- Blend interface verified against the deployed TestnetV2 wasm
  (`stellar contract info interface`): `submit(from, spender, to, requests)`,
  `Request{address, amount, request_type}` (2/3/4/5), `Positions{collateral,
  liabilities, supply}`.
- Accepted MVP ceiling: one aggregate Blend position for all users (a user
  shortfall affects shared health). Mitigated by caps + LTV < c_factor margin;
  T2+ moves to isolated positions.
- Known follow-ups (T2): automated liquidation settlement, endogenous
  reputation update on repay, borrow-asset interest accrual pass-through
  (Blend accrues interest on the aggregate position; the pilot absorbs the
  spread — size caps accordingly).
