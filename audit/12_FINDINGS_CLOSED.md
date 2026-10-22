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
| **M-05** — build not reproducible | rustc embeds the crate path and `$CARGO_HOME` in the binary, so two machines produced different hashes from identical source. Confirmed: the wasm contained `C:\Users\<user>\.cargo\registry\...`. | `e587d78` | CI job `wasm reproducibility` | **PARTIALLY CLOSED — see the 2026-10-21 correction under *Still open*.** Same machine only. Rebuild with `bash contracts/scripts/build-reproducible.sh margin-controller`, then `stellar contract fetch --id CAH2BHAE… \| sha256sum`. Both give `64cb01f427a4e72c…` **on the machine that built it**. CI has produced a different hash for all three contracts on every run since 2026-09-08. |
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
| **M-05** — reproducible on one machine, not between machines (**correction of 2026-10-21**) | The row in *Closed* above is right about what it measured and wrong about what it implied. Measured again today: the deployed controller binary is `64cb01f427a4e72c61c651e327576dea79777e345355bb0c7b7333cb765a0507` and the local reproducible build matches it exactly — **on the machine that produced it**. But the CI job `wasm reproducibility` has failed on **every run since 2026-09-08** (`34285692880`, `34286312201`, `39188099409`), with a different hash for all three contracts. Pinning rustc in `rust-toolchain.toml` was not sufficient. The criterion that matters to an external auditor is *"anyone can rebuild and compare"*, and under that criterion **M-05 is not closed**. `contracts/deployed-wasm-hashes.json` carried that exact phrase; it has been withdrawn there too. Recorded as half closed, like M-01, rather than quietly left in the closed column. |

### M-05 — root cause found, 2026-10-21

Six weeks of a red CI job had no diagnosis. It has one now, and it is not a version pin.

**The two builds use the same compiler.** CI logs `rustc 1.92.0 (ded5c06cf 2025-12-08)`;
so does this machine. Same `Cargo.lock`, same source, same remapping scheme
(`--remap-path-prefix=$CARGO_HOME=/cargo`, `=$REPO_ROOT=/src`). The local build still
reproduces the manifest byte-for-byte — measured today on `vigente-badge`, the one crate
untouched this sprint:

```
$ bash contracts/scripts/build-reproducible.sh vigente-badge
vigente-badge   raw=d7299b17594cb81d496fdd3f17f114d49bcd8c9876f112117c7643abf7fa97bb   ← manifest match
                opt=08e39d75c0a0c9e5c3c1c2a128235be0a730af28c3eafbe15d1aad848182caa9   ← manifest match
```

CI builds the same crate as `b3076c7682879870…`.

**The cause is the path separator.** Dumping the printable strings of the Windows-built
wasm:

```
/cargo\registry\src\index.crates.io-1949cf8c6b5b557f\soroban-sdk-21.7.7\src\ledger.rs
src\lib.rs
/rustc/ded5c06cf21d2b93bffd5d884aa6e96934ee4234/library/core/src/ops/function.rs
```

`rustc` records source locations for panic metadata **using the host OS separator**, and
`--remap-path-prefix` only rewrites the *prefix* — everything after it keeps `\` on
Windows and `/` on Linux. Different bytes, different hash. The third line shows the std
library is **not** the problem: Rust already remaps it to `/rustc/<commit>/…` with forward
slashes on both hosts, which is why that one is identical.

**This cannot be fixed with more remap flags.** The remainder of the path is not a prefix.

**Consequences, stated plainly:**

1. The honest claim is *"reproducible on one host OS"*, not *"reproducible"*. Already
   corrected here and in `deployed-wasm-hashes.json`.
2. The manifest's hashes were produced on **Windows**, so they are the wrong canonical
   reference: a third party rebuilding on Linux — which is what an auditor will do — gets
   CI's numbers, not the manifest's.
3. **The deployed v3 binaries were built on Windows, so no third party on Linux can ever
   reproduce them.** M-05 cannot be fully closed on this generation. It can only be closed
   by the v4 redeployment, and only if v4 is built in a canonical Linux environment.

**Recommendation:** build the v4 wasm in a pinned container (Linux, toolchain 1.92.0), make
that the only sanctioned build path, re-baseline the manifest from it, and deploy the
binary the container produced. Then `reproducible` and `deployed` agree *and* a stranger
can reproduce both.

**Second, independent defect in the same job, found in the same log:** the manifest
contains a fourth entry, `margin-controller-v-previous`, that the build script never
builds — its default list is three crates. CI reports `margin-controller-v-previous: not
built` and fails on that line alone, so the job would stay red even if every hash matched.

| **D-01** — the backstop's Comet contract is still the exploited one (opened 2026-10-21) | Not our code, and it is testnet, so no funds are at risk here. But the verification §1 left pending now has an answer, and it is **no**: `stellar contract read --id CA5UTUUP… --network testnet` returns wasm `8abc28913035c07411ed5d134e6bfeab4723d97ddd4d1a22a0605d35c94d1a36`, byte-identical to the hash this report already flags as the mainnet Comet exploited on 2026-08-25. Two months on, the backstop token has not moved to Comet V1.1. Our backstop holds **22 980 LP** behind a **17-day** withdrawal queue. The exploit mechanism was reported as **self-swaps** — one token swapped for itself through a missing check — which is precisely the aliasing class §1 argues does not reach our contracts. **That argument was re-checked and holds:** the only three public functions taking two `Address` parameters are `deposit_collateral`, `withdraw_collateral` and `get_collateral`, and all three take `(user, asset)`, never a pair of assets over one reserve; `user == asset` is covered by `aliasing_user_igual_a_asset_no_corrompe_contabilidad`. What this *does* change is the mainnet decision: Blend v2.1 runs Comet **V1.1**, and the Blend v3 proposal drops the shared Comet LP backstop entirely. Incident sources are secondary — **no official Blend or Comet post-mortem was found**, so the root cause is recorded as provisional. |

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
