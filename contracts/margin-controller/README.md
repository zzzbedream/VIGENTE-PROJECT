# Margin Controller — Vigente Protocol

Collateralized credit where the **LTV is per-user, set by on-chain reputation**.
The controller composes three REAL testnet integrations — it does not reinvent
the pool or the oracle:

| Piece | Contract (Stellar testnet) | Role |
|---|---|---|
| **Margin Controller (active)** | `CCZNOV65BYYMJP35CJDBRSUE5S6HRAW4R2MCB7LY4SVOXOHJKWK7OCLJ` | Reputation → LTV gate + per-user accounting, over **our own** pool |
| **Price oracle — `oracle-aggregator` (ours)** | `CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4` | SEP-40 feed in the pool's immutable oracle slot; routes upstream to Reflector |
| **Blend pool "Vigente" (ours)** | `CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI` | Isolated pool, `status: 0`. Liquidity: `submit` SupplyCollateral / Borrow / Repay / WithdrawCollateral |
| Reputation Registry (`vigente-badge`) | `CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD` | `get_score` / `is_defaulted` / `slash` (3-of-5 threshold ed25519) |
| Reflector (third party, upstream) | `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63` | Price source behind our aggregator, 14 decimals |
| Margin Controller v1 (history) | `CA4SFW7354P7AR6JQWLPNP4LUAH74KILBWMM2KFOJUJAOUM74XCMCHDV` | Same binary, still live on Blend's canonical pool `CCEBVDYM…`. Kept so published evidence stays verifiable |
| Margin Controller v0 (deprecated) | `CAZ2JITV36BJ5FO3UYM5XS32CISZ3JUCLW4GWYLGDUXHOGNJHELTS3FC` | Superseded by v1 after the 11-jul security audit; demo position exited cleanly |
| Borrow asset (Blend testnet USDC) | `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU` | `USDC:GATALTGT…` — borrowers need a classic trustline |
| Collateral (native XLM SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | Pilot collateral (cap: 100,000 XLM) |

**Blend never sees the score.** The gate (`amount <= collateral_value ×
tier_ltv(score) / 10000 − debt`) runs in this contract before any `submit`.
Blend only ever sees the controller's aggregate position.

## Live proof

The full credit cycle runs on **our own** pool: supply → borrow → repay →
withdraw, plus a custody test where the admin pauses the contract and the
user still withdraws everything. Every transaction hash is in
[`../../audit/08_POOL_ACTIVATION.md`](../../audit/08_POOL_ACTIVATION.md).

The sharpest single result: two accounts, identical collateral, same block —
only the reputation differs.

| Account | Score | `ltv_bps_for` | `max_borrow` |
|---|---|---|---|
| `GC6IPCM3…` | 650 (Silver) | 7500 | 1223133480 |
| `GDESGH52…` | 850 (Gold) | 8500 | 1386217944 |

The ratio is exactly `8500 / 7500`. Absolute figures drift between reads
because the price is live; the ratio does not.

Reproduce the reads (no keys needed):

```bash
stellar contract invoke --network testnet --send=no \
  --source-account <ANY_FUNDED_ACCOUNT> \
  --id CCZNOV65BYYMJP35CJDBRSUE5S6HRAW4R2MCB7LY4SVOXOHJKWK7OCLJ \
  -- ltv_bps_for --user GC6IPCM3OO44PW4Y62XD54HLT5Q23E5OFNFMYPMNUDSDRUK37ZFB6ECZ
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
- **Pause:** admin circuit breaker — **only freezes `deposit_collateral` and
  `borrow`** (entry of new risk). It can NEVER freeze `withdraw_collateral`,
  `repay`, or `liquidate`.
- **Nested auth:** the pool pulls tokens from the controller inside `submit`;
  the controller pre-authorizes exactly that transfer via
  `authorize_as_current_contract` (see `authorize_pool_pull`).

## Non-custodial guarantees — admin powers inventory (v1)

Set at init and **immutable** (no setter exists): `min_ltv_floor` = 5000 bps,
`param_grace_secs` = 172800 (48 h). The contract has **no upgrade function**
(`update_current_contract_wasm` is absent) — the code cannot be changed after
deploy; fixes require a new contract and voluntary user migration.

| The admin CAN | The admin CANNOT |
|---|---|
| `pause`/`unpause` — freezes only `deposit_collateral` + `borrow` | Move, seize, or receive user funds — the only direct token transfers are user-authorized (`deposit_collateral`, `repay`); every outbound transfer goes to the user's own wallet |
| `queue_set_tier_ltv` — announce a ladder change (event) that only takes effect after the 48 h grace via permissionless `apply_tier_ltv` | Freeze `withdraw_collateral`, `repay`, or `liquidate` — these ignore pause by construction |
| `set_cap` — cap NEW deposits per asset (never affects held collateral) | Make a healthy position liquidatable instantly — LTV changes are timelocked; a badge slash keeps the position valued at its borrow-time LTV during the grace window |
| `add_collateral_asset` — allowlist a new asset (adds an option) | Set any tier LTV below `min_ltv_floor` or above `MAX_LTV_BPS` (9000) |
| `propose_admin` → `accept_admin` — two-step rotation (multisig migration path) | Extract `Seized` collateral or `PendingSettlement` — no extraction function exists |
| — | Upgrade the contract — immutable wasm |

**Multisig status:** after these fixes no remaining admin power is custodial,
so a single admin key is acceptable for the capped testnet pilot. Converting
the admin account to a 2-of-3 multisig (Stellar account signers/thresholds)
is a **pre-mainnet checklist item**; `propose_admin`/`accept_admin` exists so
that rotation requires no redeploy.

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
cargo test -j 1                                       # unit + property tests
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
  pattern Blend uses). RedStone is a **candidate** mainnet feed — no agreement
  exists — while Reflector is the live testnet source behind our aggregator.
  BENJI would enter as a second collateral via `add_collateral_asset` once a
  pool with a BENJI reserve exists; that depends on a price feed we do not
  have yet. Both are roadmap, not commitments.
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
