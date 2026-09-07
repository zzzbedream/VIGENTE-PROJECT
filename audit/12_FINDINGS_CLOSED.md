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

## Still open

| Finding | Why it is not closed |
|---|---|
| **H-03** — deviation guard limits the rate of manipulation, does not stop it, and fails closed on legitimate large moves | **Cannot be closed on this deployment.** The aggregator sits in the pool's immutable oracle slot; replacing it means a new pool and losing the evidence base. The redesign (time-scaled band, upstream TWAP or multi-source median as the reference, defined degraded mode) belongs to the mainnet aggregator. Stated, not promised. |
| **N-01** — untracked Blend interest | Needs `sweep_interest` and a further redeploy. Described above. |
| **M-07** — single-key admin | Not a code problem. The admin key exists in one keystore; generating three keys on the same machine would be multisig theatre, not security. Needs a decision on who custodies the other signers. Current state, verified: 1 signer, weight 1, thresholds 0. |
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
