# 10 — Security review report: isolated Blend pool and SEP-40 oracle aggregator

**Report date:** 2026-09-02 · **Network:** Stellar testnet · **On-chain reads in this report:** ledger 4457563–4457670, 2026-09-02 01:10 UTC
**Requested by:** SCF #45 panel — *"Provide the full audit report (not just references) for the isolated Blend pool and the SEP-40 aggregator, and confirm that the audit was independent and not an internal review."*

---

## 0. Independence statement — read this first

**The security review described in this document was internal. It was not an independent audit.**

- The review was performed by the founder, who is also the author of the code, between 2026-07-11 and 2026-07-26, with AI assistance (Claude Code), as disclosed in [`../docs/AI_DISCLOSURE.md`](../docs/AI_DISCLOSURE.md) §8. The findings register in §3 is what that review produced, reconstructed from the commit history because the working notes were never in the public tree.
- No external audit firm, no external individual reviewer, and no Soroban Audit Bank engagement has reviewed `oracle-aggregator`, `margin-controller` or `vigente-badge`. Nobody outside the team has signed off on this code.
- The SCF #45 submission says *"Full security audit conducted with findings remediated; the audit process and its corrections are documented publicly."* The first clause overstated what happened. The accurate description is **"internal security review, with findings remediated and documented"**. We are correcting that wording in the submission and in this repository (§8).
- The parts of the stack that **have** been reviewed by third parties are the ones we did not write: Blend V2 core contracts (Certora security assessment, April 2025; Certora formal verification, June 2025; Code4rena audit, February–March 2025 — reports in [blend-contracts-v2/audits](https://github.com/blend-capital/blend-contracts-v2/tree/main/audits)) and Reflector (Code4rena, October 2025). Blend's audits cover the pool factory, pool, backstop and emitter. They do **not** cover Comet, the AMM whose LP token is the Blend backstop asset, and we found no published audit of Comet.
- **Path to an independent audit.** The Soroban Audit Bank funds audits for SCF-funded projects that are close to mainnet-ready, with a 5% co-payment refunded if all critical, high and medium findings are remediated within 20 business days, and the final report published by the firm ([official rules](https://stellar.gitbook.io/scf-handbook/supporting-programs/audit-bank/official-rules)). Our position, unchanged from the README, is now a formal release gate: **no mainnet deployment and no real user funds before an independent audit report is published** ([`../docs/qms/RELEASE_QUALITY_GATES.md`](../docs/qms/RELEASE_QUALITY_GATES.md), Gate 7). The threat model, this report and the post-mortem in [`11_POSTMORTEM.md`](11_POSTMORTEM.md) are the intake material for that audit.

Everything below should be read with that framing: it is the complete record of what the authors found in their own code, plus what a second internal pass on 2026-09-02 found while writing this report. Several of the open findings in §3 were discovered during that second pass and are being disclosed here for the first time.

---

## 1. Scope

| Artefact | Contract ID (testnet) | Wasm hash (from ledger via stellar.expert) | Source | In scope for |
|---|---|---|---|---|
| **`oracle-aggregator`** | `CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4` | `73ec959e…d6a5` | [`../contracts/oracle-aggregator/src/lib.rs`](../contracts/oracle-aggregator/src/lib.rs), commit `64d8fb6` (doc-comment-only edits since, `252c6e3`) | code review, configuration, operations |
| **Vigente pool** (isolated Blend V2 pool) | `CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI` | `a41fc53d…350e` — **identical** to Blend's canonical testnet pool `CCEBVDYM…` | Blend's code, deployed through Blend's testnet pool factory `CDV6RX4C…` (wasm `31328050…`, verified against `blend-contracts-v2` commit `c19abee5`, identical to the mainnet factory) | **configuration** only — code is Blend's and audited by third parties |
| `margin-controller` | `CCZNOV65BYYMJP35CJDBRSUE5S6HRAW4R2MCB7LY4SVOXOHJKWK7OCLJ` | `6e7d3a3d…fe95` | [`../contracts/margin-controller/src/lib.rs`](../contracts/margin-controller/src/lib.rs), commit `511c2f0` | code review — it is the pool's only user; all pool risk flows through it |
| `vigente-badge` v3 | `CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD` | `60fe64dc…6c80` | [`../contracts/vigente-badge/src/lib.rs`](../contracts/vigente-badge/src/lib.rs) | coupling with the controller |
| Blend backstop V2 | `CBDVWXT433PRVTUNM56C3JREF3HIZHRBA64NB2C3B2UNCKIS65ZYCLZA` | `c1f4502a…fbc2` (verified, `blend-contracts-v2` `c19abee5`) | Blend | dependency review |
| Comet BLND:USDC LP (backstop token) | `CA5UTUUPHYL5K22UBRUVC37EARZUGYOSGK3IKIXG2JLCC5ZZLI4BDWDM` | `8abc2891…1a36` (verified, `CometDEX/comet-contracts-v1` `ef4cbfad`) — **identical to the mainnet Comet contract exploited on 2026-08-25** | CometDEX | dependency review |
| Reflector, testnet *External CEXs & DEXs* feed | `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63` | `8ecd1857…d11c` (verified, `reflector-contract` `42f3116b`) | Reflector | dependency review |

**Out of scope:** the Next.js app, the off-chain scoring engine and signer set (covered as a trust boundary in [`../docs/THREAT_MODEL.md`](../docs/THREAT_MODEL.md) and [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §1.2), and everything under `archive/`.

Feed identity matters and was verified: the aggregator routes XLM and USDC to Reflector's **External CEXs & DEXs** testnet contract, per the [Stellar oracle providers page](https://developers.stellar.org/docs/data/oracles/oracle-providers). It does **not** route to Reflector's Stellar-DEX feed (`CAVLP5DH…` on testnet), which is the feed class that was manipulated in the YieldBlox incident (see `11_POSTMORTEM.md` §1).

---

## 2. Method

| Activity | What was done | Limits |
|---|---|---|
| Manual review | Line-by-line read of the three crates (2,165 lines of contract code) by the author, with AI assistance, in July 2026; a second full pass on 2026-09-02 for this report | Author reviewing own code; no independent reviewer |
| Tests | 102 `cargo test` across three crates: 37 controller (incl. 4 property tests I1/I2/I5/I8 and one fuzz), 19 aggregator, 41 + 5 badge. Named in §5 and §6 | Property tests run 10–25 random states, not exhaustive |
| Coverage | `cargo-llvm-cov`, 2026-07-26: 95.59 % lines aggregator, 88.65 % controller (commit `64d8fb6`) | Not re-measured since; Rust toolchain not pinned (M-05) |
| On-chain verification | Every remediation has a testnet transaction hash ([`08_POOL_ACTIVATION.md`](08_POOL_ACTIVATION.md)); every configuration claim in §4 is a direct RPC read made for this report | Testnet only, testnet scale |
| Bug-class checks | Same-record aliasing (the Comet bug class), zero/degenerate inputs, pause semantics, TTL maintenance — see §3 and `11_POSTMORTEM.md` §3 | Checklist, not formal |
| Not done | Formal verification; economic/adversarial modelling of the aggregate-position design; independent review | — |

---

## 3. Findings register — complete

Identifiers from the July working notes are kept where they appear in commit messages (`C-01`, `M-06`). All other identifiers were assigned when writing this report. Severity is rated for **mainnet use**; testnet impact is noted where different.

### 3.1 Remediated (July 2026 review)

| ID | Severity | Component | Finding | Remediation | Evidence |
|---|---|---|---|---|---|
| **C-01** | Critical | Ops / secrets | The `margin-controller` admin secret key was committed in 7 tracked files and, earlier, in a pasted session transcript (`a4f9874` → removed `2aa6b68`). | Key rotated on-chain via `propose_admin`/`accept_admin` (v1 answers to the new admin); files scrubbed; `.githooks/pre-commit` and CI `secret-scan.yml` block 6 secret patterns on added lines; `.gitignore` hardened. **Git history was not rewritten** — the decision and residual risk are in `11_POSTMORTEM.md` §4. | `50901a5` (2026-07-26); `git grep -IlE 'S[A-Z2-7]{55}'` → 0 |
| **C-02** | Critical | `margin-controller` v0 / `reference-vault` | `pause()` also blocked `repay`, `withdraw` and `liquidate`, so the admin could trap user funds. | v1: `pause` gates only `deposit_collateral` and `borrow`; `withdraw_collateral`, `repay`, `liquidate` never read the flag. `reference-vault` archived with the defect documented rather than forked. | `511c2f0`; tests `test_pause_does_not_block_withdraw_or_repay`, `test_pause_does_not_block_liquidate`, `prop_i1_pause_nunca_bloquea_las_salidas`; on-chain: admin pauses [`e8803f60`](https://stellar.expert/explorer/testnet/tx/e8803f60719d78e29dfcc4b593b8e687e4c93d2c49092701d132ef3dc9d12a82) → user withdraws everything [`d370b84a`](https://stellar.expert/explorer/testnet/tx/d370b84aab83cce899a3d944e7f9916520a202bdc4a4258e4a465d6006b6ba32) |
| **H-01** | High | `margin-controller` | The admin could make a healthy position liquidatable instantly: `set_tier_ltv` took effect immediately, and a badge slash dropped the position to the lowest tier at once. | Immutable `min_ltv_floor` (5000 bps, set at `init`, no setter); ladder changes go through `queue_set_tier_ltv` → 48 h grace → permissionless `apply_tier_ltv`; a slashed borrower's position is valued at its `LtvAtBorrow` snapshot during the grace window; `liquidate` no longer double-slashes. | `511c2f0`; tests `test_queued_ltv_downgrade_respects_grace_period`, `test_slash_grace_protects_healthy_position`, `test_queue_rejects_ltv_below_floor`, `test_apply_without_pending_fails`, `prop_i2_ningun_poder_admin_mueve_fondos_del_usuario` |
| **H-02** | High | legacy `pyme_token_v1` + web | The legacy badge contract authenticated the **beneficiary** in `mint_badge`, so anyone could self-issue an arbitrary score; four live web routes still wrote to it. | Routes `api/mint`, `api/evaluate-and-fund`, `/legacy`, `mint-service.ts` deleted; contract archived and its defect documented; only `api/mint-v3` (3-of-5 threshold) remains. | `f2f66d9`; [`../archive/README.md`](../archive/README.md); `grep -rn NEXT_PUBLIC_CONTRACT_ID web/src` → 0 |
| **M-06** | Medium | Tests | No measured coverage number existed. | `cargo-llvm-cov`: 95.59 % aggregator, 88.65 % controller. | `64d8fb6` |
| M-08 | Medium | `margin-controller` | `liquidate` re-slashed an already-defaulted borrower, so the badge's "already slashed" guard reverted the whole liquidation. | `liquidate` checks `is_defaulted` and skips `slash` when true. | `511c2f0`; `test_slash_grace_protects_healthy_position` (second half) |
| P-01 | Process | Documentation | The backstop threshold was taken from documentation (200,000) while the code says 100,000; we sent Blend an asset request 2.3× too large. | Caught by Blend's team (2026-08-04), verified by us against `blend-utils/.../get-backstop-threshold.ts:22`. Rule adopted: numbers come from code or official tooling, with the line cited. | [`08_POOL_ACTIVATION.md`](08_POOL_ACTIVATION.md) §2 |

### 3.2 Open — found while writing this report (2026-09-02)

| ID | Severity | Component | Finding | Planned remediation |
|---|---|---|---|---|
| **H-03** | **High** on mainnet · Low on testnet | `oracle-aggregator` | **The deviation guard limits the rate of change, it does not stop manipulation, and it fails closed on legitimate large moves.** `check_deviation` compares the new upstream price with `LastGood(asset)`, the last price *this contract served*, and `lastprice` (permissionless) overwrites `LastGood` on every successful read (`lib.rs:180-186`). Consequences: (a) an attacker who can move the upstream price in steps of ≤ `max_deviation_bps` and trigger a read after each step walks the reference wherever they want — with XLM at 2000 bps and Reflector's 5-minute rounds, 100× takes about 26 rounds ≈ 2.2 hours, every step visible on-chain. That raises the cost of a YieldBlox-style attack; it does not prevent it. (b) A genuine move larger than the band between two consecutive successful reads makes `lastprice` panic until the price returns inside the band or a 48 h route change clears the reference (`apply_route` removes `LastGood`). While it panics the pool cannot price: no borrows, no liquidations, no withdrawals with debt. That is exactly the window in which bad debt forms. | Redesign before the **mainnet** aggregator is deployed (Tranche 2.1 already scopes this as an explicit decision): time-scaled band (allowed deviation grows with seconds since `LastGood`), reference taken from the upstream's own TWAP or a multi-source median rather than our last served value, and a defined degraded mode instead of a panic. The testnet contract cannot be changed: it sits in the pool's immutable oracle slot. Its guard stays as documented evidence of the current behaviour. Test `salto_anomalo_revierte` pins behaviour (b). |
| **H-04** | **High** (operations) | `vigente-badge` | **The badge contract's instance TTL has expired.** `getLedgerEntries` at ledger 4457670 returns `liveUntilLedgerSeq: 0` for the instance on two independent RPCs (SDF, Ankr); the pool, aggregator and controller instances return live values. Cause: the badge extends its instance TTL only in `initialize` (`lib.rs:147`); `mint`, `add_vault` and `set_oracle_keys` extend their own persistent keys, not the instance. Initialised 2026-05-31 with a ~90-day bump → expiry ≈ 2026-08-29. Every controller path that reads the badge (`max_borrow`, `ltv_bps_for`, `borrow`, `health`, `liquidate`) fails in a real transaction until a `RestoreFootprint` is submitted. Manual runs did not notice because the Stellar CLI auto-restores archived entries before invoking. | **Immediate:** restore the instance (anyone can pay for it) and extend it. Next badge build: `extend_ttl` on the instance in every state-changing entry point. Keeper in P-08 of `11_POSTMORTEM.md`. |
| **M-01** | Medium (operations) | pool · aggregator · controller | **TTL maintenance is manual and nobody owns it.** At ledger 4457650: Vigente pool instance `liveUntil` 4,606,234 (≈ 8.6 days — Blend bumps ~31 days on writes and the last write was the activation on 2026-08-08); aggregator ≈ 52.8 days; controller ≈ 65 days; controller v1 ≈ 44 days. The aggregator's `LastGood(XLM)` and `LastGood(USDC)` entries already report `liveUntil` 0: `lastprice` sets them without extending TTL, so the first read in a real transaction needs a restore, and after a restore the deviation check runs against a reference from before the gap (H-03 b). | Weekly TTL keeper (an `ExtendFootprintTTL` operation per instance and hot key; no contract change needed); runbook; next builds extend TTL on write. Reviewers: if a verification command fails with an archival error, that is this finding, not a change in the contracts. |
| **M-02** | Medium | `margin-controller` ↔ `vigente-badge` | **The badge admin can block controller liquidations.** `badge.slash` starts with `require_not_paused` (`vigente-badge/src/lib.rs:488`); `liquidate` calls `slash` unconditionally for any non-defaulted borrower (`margin-controller/src/lib.rs`, liquidation section). If the badge is paused, every liquidation of a non-defaulted borrower reverts. The badge admin (`GBV676BN…`) is a different key from the pool/controller admin (`GDGMMHYO…`). Blend can still liquidate the controller's *aggregate* position, so this is a risk to the controller's own accounting, not to Blend suppliers. | Next controller build: call `try_slash` and complete the seizure regardless of the badge's answer, emitting an event when the slash was skipped; or exempt `slash` from the badge pause. Interim: the badge pause is an admin action under the same operational runbook as the controller pause. |
| M-03 | Medium | `margin-controller` | `liquidate` seizes **all** of the borrower's collateral, and seized collateral has no extraction path (`Seized`, `PendingSettlement` only have getters). Funds are immobilised, not stealable. | Tranche 1.1 (proportional liquidation + settlement path with a contract-restricted destination). Known and published in the README. |
| M-04 | Medium | `margin-controller` | Only per-asset caps exist; a single user can absorb an asset's entire cap. | Tranche 1.2 (per-user exposure cap derived from issuer redemption capacity). |
| M-05 | Medium | Build | Build is not reproducible: no `rust-toolchain.toml`; local builds give `7215e1d6…` (`wasm32v1-none`) and `f7076f83…` (`wasm32-unknown-unknown`) against `6e7d3a3d…` on the ledger (found 2026-08-22). Blend V2 pins `channel = "1.81"`. | Pin the toolchain and CLI version before the next deploy; CI job that builds and compares the hash with the ledger. The two deployed controller instances are byte-identical to each other (verified by fetching both). |
| M-07 | Medium | Governance | Single-key admin everywhere: pool, aggregator and controller admin `GDGMMHYO…`; badge admin `GBV676BN…`. The badge admin can replace the signer set with `set_oracle_keys` and then mint any score. Damage is bounded — every tier LTV ≤ 8500 bps < XLM `c_factor` 9000, per-asset caps, 48 h ladder timelock, immutable floor — but the score is a trusted input, as [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §1.2 states. | 2-of-3 multisig on all admin accounts before mainnet (Tranche 3.1); signer hosts separated (Tranche 2). |
| L-01 | Low | `oracle-aggregator` | Guard parameters were set by judgement: XLM `max_deviation_bps` 2000, USDC 500, `max_age` 900 s for both. The RWA calibration in [`09_RAMP_CONNECTIVITY.md`](09_RAMP_CONNECTIVITY.md) §3 (inter-provider dispersion ≤ 47 bps) suggests 2000 bps is far too loose for a bond token. | Calibrate per asset for the mainnet aggregator (Tranche 2.1); the deviation redesign in H-03 supersedes the raw number. |
| L-02 | Low | `oracle-aggregator` | `lastprice` writes persistent storage on the read path, so every pool read pays for a write. Not a safety issue; it does make the `LastGood` TTL problem in M-01 recur on every idle period. | Folded into the H-03 redesign. |
| I-01 | Info | Pool configuration | `bstop_rate` 10 %, `max_positions` 4, `min_collateral` 1 × 10¹⁴ (= 1.00 in the oracle's 14-decimal units). Reviewed in §4; no change needed for the testnet pilot. | — |

### 3.3 Checked and not found

- **Same-record aliasing (the Comet bug class).** No function in the controller or the aggregator takes two asset parameters that can alias the same storage record; `add_collateral_asset` rejects duplicates; `init` registers a single collateral asset; every read-modify-write in `deposit_collateral`, `withdraw_collateral`, `repay`, `borrow` and `liquidate` touches one key at a time and re-reads before writing. Detail in `11_POSTMORTEM.md` §3.
- **Zero and negative amounts.** All entry points reject `amount <= 0`; `rescale` panics rather than round a positive price to zero (`un_precio_que_se_redondearia_a_cero_revierte`).
- **Re-initialisation.** Both contracts guard `init` (`no_se_puede_re_inicializar`, `test_initialize_twice_fails`).
- **Admin fund movement.** No admin function transfers tokens; the only outbound transfers go to the calling user (`prop_i2`).
- **Upgradeability.** None of the three contracts implements `update_current_contract_wasm`; fixes require redeploy and voluntary migration.

---

## 4. Configuration review of the isolated pool

All values are direct RPC reads at ledger 4457563 (2026-09-02 01:10 UTC). Commands in §9.

### 4.1 Pool

| Parameter | Value | Assessment |
|---|---|---|
| `status` | **0 (Active)** | Set by `set_status(0)` on 2026-08-08 ([`00130c83`](https://stellar.expert/explorer/testnet/tx/00130c8361571de6c0d7fdd57633bd4e3698c0a1b7103d5f6425518d813c3bab)); that call validates the backstop threshold inside the contract |
| `oracle` | `CCG6EAGO…FQH4` — our aggregator | Immutable after deployment; verified against every reserve before `pool_factory.deploy` |
| `bstop_rate` | 1,000,000 (10 %) | Share of interest routed to the backstop; Blend default range |
| `max_positions` | 4 | Fine for a 2-reserve pool |
| `min_collateral` | 100,000,000,000,000 (1.00 in 14-decimal oracle units) | Prevents dust positions |
| `get_admin` | `GDGMMHYO…` (single key) | See M-07 |

### 4.2 Reserves

| Reserve | `c_factor` | `l_factor` | `util` target | `max_util` | `r_base` / `r_one` / `r_two` / `r_three` | `reactivity` | `supply_cap` | `enabled` |
|---|---|---|---|---|---|---|---|---|
| USDC `CAQCFVLO…` (debt asset, index 0) | 85 % | 95 % | 80 % | 95 % | 0.5 % / 3 % / 20 % / 100 % | 50 | 100,000 USDC | yes |
| XLM `CDLZFC3S…` (collateral, index 1) | **90 %** | 75 % | 50 % | 95 % | 0.5 % / 3 % / 20 % / 100 % | 50 | 1,000,000 XLM | yes |

Live reserve data at read time: USDC `b_supply` 1,400 USDC (the seeded liquidity), `d_supply` 15 (dust dTokens left by the 2026-08-08 repay); XLM `b_supply` 3,050 XLM, no debt.

Assessment:
- The controller's hard ceiling `MAX_LTV_BPS = 9000` and the active ladder (8500 / 7500 / 6000) stay strictly below the XLM `c_factor` of 90 %, so the controller's aggregate position cannot be liquidated by Blend at a user's own limit. This is the invariant `test_tier_ltv_above_c_factor_margin_rejected` enforces.
- USDC has a `c_factor` of 85 % but the controller does not list it as collateral, so USDC-as-collateral is not reachable through the product path.
- Supply caps bound the pilot at 100,000 USDC of deposits and 1,000,000 XLM of collateral. They were chosen for testnet; mainnet caps will be set from issuer redemption capacity (Tranche 1.2 / 3.1).
- Interest-rate parameters are Blend's reference values; no custom curve.
- **Reserves cannot be added without a 7-day queue** now that the pool has left `Setup`; adding an RWA reserve (Tranche 2.1) goes through `queue_set_reserve`.

### 4.3 Backstop

| Item | Value |
|---|---|
| Backstop token | `CA5UTUUP…` — Comet BLND:USDC 80/20 LP |
| Pool deposit | 22,980 LP shares (= tokens) |
| Underlying | 185,377.24 BLND + 13,642.63 USDC |
| Threshold product `k = A^0.8 · B^0.2` | ≈ 110,010 → **110 % of the 100,000 threshold** |
| Queued for withdrawal (`q4w_pct`) | 0 % |
| Withdrawal queue | 17 days |

The backstop asset is the same Comet contract code (wasm `8abc2891…`) that was exploited on mainnet on 2026-08-25. On testnet the tokens have no value; the consequence for the mainnet plan is the subject of `11_POSTMORTEM.md` §2.

### 4.4 Price path

```
Vigente pool ──lastprice(Asset::Stellar(…))──▶ oracle-aggregator (ours, decimals 14, route grace 172,800 s)
                                                     ├─ XLM  → Reflector External CEXs & DEXs, upstream key Other("XLM"),  max_age 900 s, max_deviation 2000 bps
                                                     └─ USDC → Reflector External CEXs & DEXs, upstream key Other("USDC"), max_age 900 s, max_deviation 500 bps
```

Read at report time: XLM 0.17457 USD (timestamp 1788311100), USDC 1.00034 USD (same timestamp); no pending route change; both routes' upstream is the verified Reflector contract. The controller applies its own `max_price_age` of 900 s on top, so a price older than 15 minutes is rejected twice.

---

## 5. `oracle-aggregator` — review notes

**What it is.** About 400 lines. Storage: `Admin`, immutable `Decimals` and `RouteGraceSecs`, `RouteOf(asset)`, `Assets`, `Pending(asset)`, `LastGood(asset)`, `PendingAdmin`. Public surface: `init`, `set_initial_route`, SEP-40 `lastprice`/`decimals`, `assets`, `queue_set_route`/`apply_route`/getters, two-step admin rotation.

**Properties that hold (with the test that pins each):**

| Property | Test |
|---|---|
| A route, once set, cannot be replaced instantly — not even by the admin | `invariante_ruta_existente_no_se_re_rutea_instantaneamente_ni_por_el_admin` |
| Adding a new asset after init also goes through the queue | `invariante_asset_nuevo_tambien_pasa_por_la_cola` |
| Legitimate migration works after the grace period; `apply_route` is permissionless | `invariante_la_migracion_legitima_funciona_pasado_el_grace`, `apply_sin_pendiente_falla` |
| Stale, missing, zero and non-positive upstream prices panic instead of returning a value | `precio_viejo_revierte`, `upstream_sin_precio_revierte`, `precio_cero_revierte` |
| Decimal normalisation up and down; a price that would round to zero panics | `escala_hacia_arriba…`, `escala_hacia_abajo…`, `un_precio_que_se_redondearia_a_cero_revierte` |
| Jumps above the band revert; inside the band pass; migration clears the reference | `salto_anomalo_revierte`, `movimiento_dentro_de_la_banda_se_acepta`, `tras_migrar_de_fuente_no_se_arrastra_la_referencia_de_desviacion` |
| Route validation: `max_age` > 0, `max_deviation_bps` ≤ 5000 | `max_age_cero_se_rechaza`, `desviacion_por_encima_del_techo_se_rechaza` |
| Unknown asset → `None` (never a panic); SEP-40 surface and enumeration; two-step admin; no re-init | `asset_sin_ruta_devuelve_none…`, `superficie_sep40_y_enumeracion`, `rotacion_de_admin_en_dos_pasos`, `no_se_puede_re_inicializar` |

**What it does not do, stated plainly:** no TWAP, no multi-source median, no fallback source, no circuit breaker other than the panic in H-03 (b), no per-asset liquidity or volume check on the upstream. Blend's own oracle guidance recommends TWAPs for volatile or illiquid assets and aggregation across sources ([selecting an oracle](https://docs.blend.capital/pool-creators/selecting-an-oracle)). The current contract routes and guards; it does not aggregate in that sense. The mainnet version must (H-03, `11_POSTMORTEM.md` P-04).

---

## 6. Coupling review

| Interface | What was checked | Result |
|---|---|---|
| controller → pool (`submit`) | Request type numbers (2/3/4/5) and struct field names verified against the deployed pool wasm; nested token pull pre-authorised with `authorize_as_current_contract` scoped to exactly (`this`, `pool`, `amount`) | Correct. One aggregate Blend position for all users is an accepted MVP ceiling (README §"Pins / notes") |
| controller → aggregator (`lastprice`) | Both legs priced by the same contract so decimals cancel; `fresh_price` rejects `None`, non-positive and stale; `max_price_age` 900 s equals the aggregator's `max_age` | Correct; `prop_i8_ninguna_ruta_opera_con_precio_invalido` |
| controller → badge (`get_score`, `is_defaulted`, `get_default`, `slash`) | Defaulted borrowers cannot borrow; grace-window valuation; slash skipped when already defaulted | Correct, except **M-02** (badge pause blocks liquidations) and **H-04** (badge instance expired) |
| pool → aggregator | Pool asks with `Asset::Stellar(contract)`; aggregator maps to Reflector's ticker keys | Correct; both reserves return prices |
| backstop ↔ pool | Threshold met with 10 % margin; `q4w` 0 % | Correct; dependency risk in `11_POSTMORTEM.md` §2 |

---

## 7. Hand-off for an independent auditor

In order of where we would want a fresh pair of eyes first:

1. **H-03** — the deviation guard's threat model, including the interaction between `LastGood` expiry (M-01) and the restore path.
2. **Aggregate-position model** — one Blend position for all users; how a single user's shortfall propagates, and whether the `c_factor` margin plus caps is sufficient at mainnet caps.
3. **Liquidation economics** — full-collateral seizure today (M-03) and the proportional design of Tranche 1.1; keeper incentives.
4. **M-02** and every other cross-contract failure mode between controller, badge and pool, including pauses and archival.
5. **Signer set and badge admin powers** (M-07) — what a threshold-compromised issuer can do within the LTV bounds.
6. **Arithmetic** — `capacity_of` ordering and truncation; `rescale`; `check_deviation` cross-multiplication with `saturating_mul`.

---

## 8. Corrections to public claims

| Where | Claim | Correction |
|---|---|---|
| SCF #45 submission, *Traction — Engineering evidence* | "Full security audit conducted with findings remediated" | "Internal security review with findings remediated; no independent audit yet; full report at `audit/10_SECURITY_REVIEW_REPORT.md`" |
| SCF #45 submission, *Team* | "a full security audit with findings remediated and published" | same correction |
| `README.md`, *What does not exist yet* | (absent) | Added: "An independent audit." with a link to this report |
| Landing page, *"pool: composes on blend (audited)"* | refers to Blend's third-party audits | accurate as written; it does not claim our contracts were audited. Left unchanged. |

---

## 9. Reproduction

All reads below are permissionless and need only a funded testnet account for simulation. If a command fails with an archival or `restore` error, see H-04 and M-01 — the entry has expired and needs a `RestoreFootprint`; the Stellar CLI does this automatically when invoking.

```bash
POOL=CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI
AGG=CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4
CTRL=CCZNOV65BYYMJP35CJDBRSUE5S6HRAW4R2MCB7LY4SVOXOHJKWK7OCLJ
BACKSTOP=CBDVWXT433PRVTUNM56C3JREF3HIZHRBA64NB2C3B2UNCKIS65ZYCLZA
XLM=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
USDC=CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU
R="--network testnet --source-account <ANY_FUNDED_ACCOUNT> --send=no"

stellar contract invoke --id $POOL $R -- get_config                       # §4.1
stellar contract invoke --id $POOL $R -- get_reserve --asset $USDC        # §4.2
stellar contract invoke --id $POOL $R -- get_reserve --asset $XLM
stellar contract invoke --id $BACKSTOP $R -- pool_data --pool $POOL       # §4.3
stellar contract invoke --id $AGG $R -- get_route --asset "{\"Stellar\":\"$XLM\"}"   # §4.4
stellar contract invoke --id $AGG $R -- get_route_grace
stellar contract invoke --id $AGG $R -- lastprice --asset "{\"Stellar\":\"$XLM\"}"
stellar contract invoke --id $CTRL $R -- get_tier_ltv

# Wasm hashes (§1): fetch from the ledger and hash
stellar contract fetch --id $AGG --network testnet --out-file agg.wasm && sha256sum agg.wasm

# TTL (H-04, M-01): liveUntilLedgerSeq of a contract instance
curl -s -H 'Content-Type: application/json' https://soroban-testnet.stellar.org \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLedgerEntries","params":{"keys":["<base64 LedgerKey::ContractData{contract, LedgerKeyContractInstance, persistent}>"]}}'
```

Tests, from a fresh clone (no cargo workspace; use `-j 1` on small machines):

```bash
for c in vigente-badge margin-controller oracle-aggregator; do
  printf "%-20s " "$c"; (cd contracts/$c && cargo test -j 1 2>&1 | grep "^test result" | head -1)
done
```

---

*Related: [`11_POSTMORTEM.md`](11_POSTMORTEM.md) — incidents, root causes and process changes · [`08_POOL_ACTIVATION.md`](08_POOL_ACTIVATION.md) — activation evidence · [`../docs/THREAT_MODEL.md`](../docs/THREAT_MODEL.md) · [`../docs/qms/INCIDENT_LOG.md`](../docs/qms/INCIDENT_LOG.md)*
