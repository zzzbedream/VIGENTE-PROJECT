# 12 — Findings closed (2026-09-02)

Follow-up to [`10_SECURITY_REVIEW_REPORT.md`](10_SECURITY_REVIEW_REPORT.md). One of the six
SCF #45 rejection points was that our own review left open findings on the pool. This
records which of them are now closed, with the commit, the tests and the transaction that
prove it — and which are still open, with the reason.

**This is still an internal review.** No independent audit of these contracts has been
performed. See §0 of the review report.

Baseline at the start of this work: **102 tests** green (controller 37, aggregator 19,
badge 41 + 5 smoke). After: **118** (controller 53). Every number below is a command output
or an on-chain read, not an estimate.

---

## Closed

| Finding | What it was | Commit | Tests | How a third party verifies it |
|---|---|---|---|---|
| **H-04** — badge instance TTL expired | `getLedgerEntries` returned `liveUntilLedgerSeq: 0` for the badge instance. Every controller path that reads the badge failed in a real transaction. | — (operational) | — | Query the badge instance: `liveUntil` is now **7 667 156** (~180 days). Restore tx [`1730fbf2`](https://stellar.expert/explorer/testnet/tx/1730fbf2fb11e9c463b2efba029cb56ffa0ee8b889dd73b753ad839403f23db0) |
| **M-05** — build not reproducible | rustc embeds the crate path and `$CARGO_HOME` in the binary, so two machines produced different hashes from identical source. Confirmed: the wasm contained `C:\Users\<user>\.cargo\registry\...`. | `e587d78` | CI job `wasm reproducibility` | **Proved on-chain.** Rebuild with `bash contracts/scripts/build-reproducible.sh margin-controller`, then `stellar contract fetch --id CAH2BHAE… \| sha256sum`. Both give `64cb01f427a4e72c…` |
| **M-04** — no per-user exposure cap | Only per-asset caps existed; one account could absorb an entire asset cap. | `0adf6e8` | 5 tests, incl. `user_cap_nunca_atrapa_una_posicion_preexistente` | `get_user_cap(asset)`; `cargo test -j 1 user_cap` |
| **M-03** — liquidation seized 100 %, seized funds had no exit | `liquidate` swept every asset into `Seized`/`PendingSettlement`, which only had getters. | `dbc870d` | 8 tests, incl. `m03_el_excedente_es_retirable_por_el_deudor` and `m03_settle_seized_repaga_contra_el_pool` | `cargo test -j 1 m03_`; read the new `liquidate` and `settle_seized` signatures in `src/lib.rs` |
| **M-02** — badge admin could block liquidations | `liquidate` called `slash` unconditionally, and `slash` starts with `require_not_paused`. A paused badge blocked every liquidation. | `dbc870d` | covered by the M-03 insolvency tests | `liquidate_insolvent` now uses `try_slash` and emits `noslash` when skipped |
| **Comet bug class** (aliasing) | Not a defect — the sweep in §3.3 of the review report found none. It had no regression test. | `4d67600` | 3 tests, incl. `aliasing_liquidate_con_liquidador_igual_al_deudor_revierte` | `cargo test -j 1 aliasing_` |

### What M-03 actually changed

`liquidate(liquidator, user)` became
`liquidate(liquidator, user, collateral_asset, repay_amount)` — Model A: the liquidator
repays part of the debt in the borrow asset and receives collateral at a discount. No swap,
so no slippage and no DEX dependency.

```
penalty_value    = repay_amount x 800 bps
protocol_cut     = penalty_value x 2000 bps
liquidator_bonus = penalty_value - protocol_cut     (split, not charged twice)
seize_value      = repay_amount + penalty_value
surplus          = collateral_held - seize_amount   -> stays with the borrower
```

Close factor 50 % per call, successive calls allowed until `health >= 100`. Rounding is
ceiling on both conversion legs, then summed, so the two cannot disagree. The three
parameters are **constants, not admin-settable**: a lever the admin can move is a lever the
admin can abuse, and they do not need to change during a capped pilot.

Insolvency (`collateral_value < debt`) is the only path that still seizes a whole position:
no penalty is charged, the shortfall is recorded in `BadDebt` instead of being dropped, and
the badge is slashed.

`settle_seized(asset)` has **no destination parameter**. The only place the funds can go is a
`Repay` against the pool. An address argument would turn the settlement path into an admin
extraction route, which is the property the finding was about. Only the debt asset settles
directly; any other asset needs a swap, this contract has none, and it reverts saying so
rather than pretending.

### Redeployment

Contracts have no upgrade function, so closing M-02/M-03/M-04 required a new instance.

| | Address |
|---|---|
| **Controller (active)** | `CAH2BHAEBYUCVQ4UQGNZKCLDD2KLP7GY3F2PWMNMXOZ7S54WLHG3C75W` |
| Controller (previous) | `CCZNOV65BYYMJP35CJDBRSUE5S6HRAW4R2MCB7LY4SVOXOHJKWK7OCLJ` |
| Pool (unchanged) | `CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI` |
| Aggregator (unchanged) | `CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4` |

The pool's immutable slot is the **oracle**, not the controller, so the pool and the
aggregator carry over untouched: only the controller address changed. Init tx
[`254ca7ec`](https://stellar.expert/explorer/testnet/tx/254ca7ec70937623c69322450dd4e635f5fcec5a521cb21226ca67cf55e9e656),
vault authorisation
[`013052da`](https://stellar.expert/explorer/testnet/tx/013052daee4cfe0e351b149cb96277b3a3e17cf5dd896f6cf51565e1d10647e8).

The reputation result still holds on the new instance — same collateral, same block, only the
score differs:

| Account | Score | `ltv_bps_for` | `max_borrow` |
|---|---|---|---|
| `GC6IPCM3…` | 650 (Silver) | 7500 | 1 447 596 174 |
| `GDESGH52…` | 850 (Gold) | 8500 | 1 640 608 998 |

1 640 608 998 / 1 447 596 174 = 1.13333… = 8500 / 7500 exactly.

**Why Gold's collateral was equalised after the migration — stated plainly, because the
alternative reading is worse than the truth.**

Migration is per-user and voluntary: each account withdrew from the old instance and
re-deposited into the new one. Gold came back with a different collateral balance than
Silver, and with unequal collateral the comparison above proves nothing — two numbers
differing for two reasons at once is not evidence. So Gold's collateral was topped back up
to match Silver's.

The purpose was to **restore the documented experimental conditions**, which have been the
same since the first publication of this result: *same collateral, same block, only the
score differs*. It was **not** to adjust data until it fitted a claim. The distinction
matters and is easy to lose, so here is the test that separates them: the ratio was never
tuned. `max_borrow` is computed on-chain from the live price and the tier ladder; nobody
can move it to 1.13333 by choosing a collateral amount. Equalising the collateral is what
makes the *comparison* valid; it has no influence on the *ratio*, which comes out of the
contract either way.

Verified again on 2026-10-19 on a third pair of readings — Gold and Silver at 1 000 XLM
each, plus a Bronze account at 100 XLM added for this run:

| Account | Score | `ltv_bps` | Collateral | `max_borrow` |
|---|---|---|---|---|
| `GDESGH52…` | 850 | 8500 | 1 000 XLM | 1 509 013 131 |
| `GC6IPCM3…` | 650 | 7500 | 1 000 XLM | 1 331 482 175 |
| `GC5PQMUM…` | 400 | 6000 | 100 XLM | 106 518 573 |

Gold / Silver = 1.133333 against 8500 / 7500 = 1.133333. Bronze, normalised to the same
collateral, lands within 10 units of a thousand million — integer rounding. Different
prices, different day, different third account: same ratio. See
`docs/private/pilot/03_E2E_RESULTS.md` T03.

---

## New finding, opened by this work

### N-01 — Blend interest is not tracked, and it can block a full exit

**Severity: Medium** (exit-blocking, no loss of funds) · `margin-controller`

While migrating positions we found the previous controller holding, in Blend:

```
collateral: {1: 10000000000}    liabilities: {0: 6}    supply: {}
```

Six stroops of USDC liability — while the controller's own books reported
`get_total_debt() = 0`. The controller tracks **principal**; Blend accrues **interest** on
the aggregate position. When users repay their principal the accrued interest stays behind as
a residual liability, and it grows over time.

Consequences, measured rather than assumed:

- Withdrawing the last collateral failed with Blend error `#1205` (health factor).
- Leaving 1 XLM failed with `#1224`: the pool's `min_collateral` is $1.00, and 1 XLM ≈ $0.19.
- Leaving 10 XLM worked — tx [`1f2f2f20`](https://stellar.expert/explorer/testnet/tx/1f2f2f2069ede1d6711479d44ab9d3f993e31548ed6d8690cb2f8b047ecd33a4).
- **10 XLM (~$1.92) is therefore locked in `CCZNOV65…` and cannot be recovered through the
  contract**, because `repay(user, amount)` requires `amount <= debt` and the tracked debt is
  zero. There is no function that pays down residual interest.

Nobody can steal it; it is immobilised, which is the same shape as the original M-03 and it
matters for the same reason: it is a condition, not caused by the user, under which the user
cannot fully exit.

**The active controller has the same gap.** It was not introduced by this work and it is not
fixed by it. The fix is a permissionless `sweep_interest(amount)` whose destination is
hard-coded to a `Repay` against the pool — the same restricted-destination shape as
`settle_seized`. It requires another redeploy and is not claimed as done.

Because of it, the non-custodial wording stays as it is: *smart-contract controlled,
user-authorized, with limited administrative controls* — not "fully non-custodial".

---

### N-02 — the protocol's share of a liquidation penalty cannot be collected

**Severity: Low** (protocol revenue, no user funds at risk) · `margin-controller`
**Opened 2026-10-19 by the testnet end-to-end run**, not by reading the code.

`liquidate` records the seizure under the **collateral** asset
(`DataKey::Seized(collateral_asset)`, `lib.rs:752,755`). `settle_seized` refuses anything
that is not the **debt** asset (`lib.rs:858-860`, `Error::SettleAssetNotDebtAsset`).

With the deployed configuration — XLM collateral, USDC debt — those two can never meet.
`Seized(XLM)` is write-only in production: nothing reads it except `get_seized`.

Measured after the liquidation in tx
[`2f4eae27`](https://stellar.expert/explorer/testnet/tx/2f4eae27e7ba653c9bb12e82c6d9f079d2e667304c6f6904c80b36a2d5f3f7c4):

```
get_seized(XLM)        → 4930857          (the protocol's cut, stranded)
settle_seized(XLM)     → Error(Contract, #3)
```

Per liquidation the protocol loses 20 % of the 8 % penalty = **1.6 % of the repaid
amount**. Here, 0.49 XLM. No user loses funds and the liquidation itself completes
correctly: debt fell by exactly the repaid amount, collateral by exactly the seized
amount, and health went 99 → 120.

**Why the unit tests did not catch it**, which is the part worth keeping. The fixture says
so itself, at `margin-controller/src/test.rs:1410`:

```rust
// permite ejercitar el unico caso implementado (asset == borrow_asset).
h.ctrl.add_collateral_asset(&h.usdc_id, &Asset::Stellar(h.usdc_id.clone()), &0_i128);
```

The test adds USDC as a collateral asset so the seizure lands where `settle_seized` can
read it. The test passes, and passes honestly — it exercises the implemented case. What it
does not exercise is the deployed configuration. **A green test over a fixture that does
not exist in production is not coverage.** Before mainnet, the other fixtures deserve the
same question.

Closing it needs a redeploy, exactly like N-01.

---

### M-04's mitigation was deployed but dormant

Not a new defect — a new fact about the live instance, found in the same run.

```
get_user_cap(XLM) → "0"      (0 means NO CAP)
```

`UserCap` is the only risk parameter with no path through `init`: it is written solely by
`set_user_cap` (`lib.rs:993`). Every deployment therefore starts uncapped, and the
per-user cap that closed M-04 does nothing until somebody runs that call. Set to 150 XLM
for the test account during the run.

**This belongs in the deployment runbook as a mandatory step**, because it will recur with
every new controller generation.

---

## Still open

| Finding | Why it is not closed |
|---|---|
| **H-03** — deviation guard limits the rate of manipulation, does not stop it, and fails closed on legitimate large moves | **Cannot be closed on this deployment.** The aggregator sits in the pool's immutable oracle slot; replacing it means a new pool and losing the evidence base. The redesign (time-scaled band, upstream TWAP or multi-source median as the reference, defined degraded mode) belongs to the mainnet aggregator. Stated, not promised. |
| **N-01** — untracked Blend interest | Needs `sweep_interest` and a further redeploy. Described above. **Upgraded 2026-10-19 from historical artefact to systematic property:** reproduced deliberately — every *full* repayment leaves ~1 dToken behind in Blend, always in the pool's favour, and unreachable because `repay()` rejects amounts above the tracked debt. |
| **N-02** — the protocol's liquidation cut cannot be collected | Needs a redeploy. Described above. |
| **M-07** — single-key admin | Not a code problem. The admin key exists in one keystore; generating three keys on the same machine would be multisig theatre, not security. Needs a decision on who custodies the other signers. Current state, re-measured 2026-10-19 and **worse than previously recorded**: there are **two** single-key accounts, not one — controller+pool (`GDGMMHYO…`) and badge (`GBV676BN…`), each 1 signer, weight 1, thresholds 0/0/0, held in two different stores (CLI keystore and `web/.env.local`). |
| **M-01** — TTL maintenance has no owner | The *state* is fixed: badge, pool, aggregator and both controllers now sit ~180 days out, and the aggregator's `LastGood` entries were refreshed with live prices rather than merely restored, so the first read after the gap is not rejected by the deviation guard. The *cause* — that nobody owns the weekly keeper — is unchanged. Half closed, and recorded as half. |
| **L-01, L-02** | Folded into the H-03 redesign, as the review report already states. |

## Reproduce

```bash
for c in vigente-badge margin-controller oracle-aggregator; do
  printf "%-20s " "$c"; (cd contracts/$c && cargo test -j 1 2>&1 | grep "^test result" | head -1)
done
# expected: 41+5 / 53 / 19

bash contracts/scripts/build-reproducible.sh margin-controller
stellar contract fetch --id CAH2BHAEBYUCVQ4UQGNZKCLDD2KLP7GY3F2PWMNMXOZ7S54WLHG3C75W \
  --network testnet --out-file /tmp/c.wasm && sha256sum /tmp/c.wasm
# both: 64cb01f427a4e72c61c651e327576dea79777e345355bb0c7b7333cb765a0507
```

If a read fails with an archival error, see M-01 — the Stellar CLI restores automatically
when invoking.

---

*Related: [`10_SECURITY_REVIEW_REPORT.md`](10_SECURITY_REVIEW_REPORT.md) ·
[`11_POSTMORTEM.md`](11_POSTMORTEM.md) · [`08_POOL_ACTIVATION.md`](08_POOL_ACTIVATION.md) ·
[`../contracts/deployed-wasm-hashes.json`](../contracts/deployed-wasm-hashes.json)*
