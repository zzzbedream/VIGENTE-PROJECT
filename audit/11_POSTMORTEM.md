# 11 — Post-mortem: the 2026 Blend pool incidents, the critical findings of our own review, and what changes

**Date:** 2026-09-02 · **Written by:** the Vigente team · **Status:** open items tracked in §7 and in [`../docs/qms/INCIDENT_LOG.md`](../docs/qms/INCIDENT_LOG.md)
**Requested by:** SCF #45 panel — *"Publish a written post-mortem of the previous Blend pool incident and of the critical issues in your own audit, and describe the specific process changes that prevent a recurrence in the isolated pool."*

Two Blend-related incidents happened on mainnet in 2026. Neither touched our pool, our contracts or any user funds — we have no users and no mainnet deployment. Both bear directly on what we are building: one broke a pool through its **oracle**, the other broke Blend's **backstop token**. Our isolated pool has exactly those two dependencies. This document treats both incidents as if they had been ours, then does the same for the critical findings of our own review.

---

## 0. Summary

- **Incident A (2026-02-22, YieldBlox pool on Blend V2, ≈ $10.9M):** a thin SDEX market for USTRY was pushed ~100× and Reflector's SDEX-sourced feed relayed it; the pool lent against the inflated collateral. Root cause: collateral valuation depended on a manipulable price source. Blend's core contracts were not at fault.
- **Incident B (2026-08-25, Comet BLND:USDC LP, 717,518.92 USDC):** a same-token swap corrupted Comet's reserve accounting; the attacker used Blend flash loans to repeat it. The LP token is the Blend V2 backstop asset, so every V2 backstop — including the one that keeps our testnet pool active — is denominated in a token whose contract has a known critical bug.
- **For our pool:** (A) our aggregator routes to Reflector's *External CEXs & DEXs* feed, not the SDEX feed, and it has a deviation guard — but that guard slows a manipulation rather than stopping it, and it fails closed on legitimate large moves (finding H-03 in [`10_SECURITY_REVIEW_REPORT.md`](10_SECURITY_REVIEW_REPORT.md)). The RWA assets on our roadmap are the same class as USTRY. (B) Our testnet backstop is 22,980 LP shares of the identical Comet code; on testnet nothing of value is at risk, but **the mainnet plan in Tranche 3.1 cannot be executed as written** while Blend V2's backstop token is compromised.
- **Our own review** found one critical secret leak, one critical custody flaw and one high-severity admin power in July, all remediated on-chain with hashes; writing this document found two more high-severity items (the deviation-guard design and an expired badge instance TTL) and two medium ones. They are disclosed in the review report.
- **Process changes** are in §6: eleven items, each with its status and the artefact that proves it. Four are already in place; the rest are scheduled against specific deliverables.

---

## 1. Incident A — YieldBlox pool: oracle manipulation (2026-02-22)

### 1.1 What happened

| Time (UTC) | Event |
|---|---|
| 2026-02-21 23:38 | Attacker's burner places a sell offer on SDEX for 1.2185 USTRY at ≈ 107 USDC, ~100× the ≈ 1.06 USDC market value. USTRY/USDC on SDEX had under $1 of hourly volume and fewer than five USTRY on the ask side after the only market maker had withdrawn. |
| 2026-02-22 00:10 | Price-setting trade: 0.05 USTRY bought at the inflated price. No other trades follow for over 10 minutes. |
| 00:15 – 00:20 | Reflector's SDEX-sourced VWAP feed ingests the poisoned price. With no other volume in the window, one trade defines the VWAP. |
| 00:24:27 | Two borrows against ≈ 153,000 USTRY (real value ≈ $158,500, valued by the pool at ≈ $16M): 1,000,196 USDC and 61,249,278 XLM — the pool's entire reserves. Health factor at the second borrow: 1.47. |
| 2026-02-22 (statement) | Script3: *"At 00:25:00 UTC the Reflector USTRY oracle was manipulated, misreporting a significantly higher price. This resulted in a loss of ~10 million USD … from the Blend YieldBlox pool. NO OTHER BLEND POOLS WERE AFFECTED. NO OTHER POOLS ARE VULNERABLE."* |
| following days | Stellar Tier-1 validators freeze ≈ 48M XLM (~80 % of the stolen XLM). Script3 commits to fully compensate USDC, XLM and EURC depositors for the bad debt. |

Sources: Script3's statements on X (2026-02-22/23), [rekt.news](https://rekt.news/yieldblox-rekt), [BlockSec](https://blocksec.com/blog/yieldblox-dao-incident-on-stellar-oracle-misconfiguration-enabled-a-10m-drain), [Halborn](https://www.halborn.com/blog/post/explained-the-yieldblox-hack-february-2026). Figures differ slightly between sources ($10.2M–$10.97M); the mechanism does not.

### 1.2 Root cause chain

Four layers, any one of which would have stopped it:

1. **Illiquid collateral accepted** with a collateral factor high enough to matter.
2. **Single-source, DEX-derived price** (Reflector's SDEX VWAP) for that asset — the pool operator's oracle choice, not a Blend core-contract flaw.
3. **No filtering at the oracle adapter** — the latest price was passed through with no deviation flag, no TWAP, no median across sources.
4. **No anomaly detection or cap** that would have limited how much could be borrowed against one asset in one block.

Blend's own guidance already said most of this: *"Oracles CANNOT be changed after a pool is created"*, prefer TWAPs for volatile or illiquid assets, aggregate across sources, use an adapter contract when a single oracle is not enough ([docs](https://docs.blend.capital/pool-creators/selecting-an-oracle)). The Code4rena formal verification had proved the health-factor arithmetic correct; it never asked whether the collateral markets had depth.

### 1.3 What it means for the isolated Vigente pool

| Layer in §1.2 | Our pool today (testnet) | Gap | Change (§6) |
|---|---|---|---|
| 1 — collateral liquidity | XLM only. Reserve `supply_cap` 1,000,000 XLM; controller per-asset cap 100,000 XLM. | The RWA collateral on our roadmap — Etherfuse Stablebonds: CETES, **USTRY**, TESOURO — is the exact asset class that was manipulated. | P-04: RWA listing policy — no thin-DEX assets; caps derived from issuer redemption capacity; per-user cap (T1.2) |
| 2 — price source | Aggregator routes XLM and USDC to Reflector's **External CEXs & DEXs** feed (`CCYOZJCO…`, verified), not the Stellar-DEX feed (`CAVLP5DH…`) that YieldBlox used. | For a bond token the right source is the issuer's NAV/redemption price or a provider that does not derive it from a DEX order book. No such route exists yet. | P-04: source-methodology requirement written into the listing checklist; Tranche 2.1 |
| 3 — adapter filtering | Staleness bound (900 s) and a deviation band (2000 bps XLM / 500 bps USDC). | **H-03:** the band is a per-read rate limit on our own served series — an attacker who moves the upstream ≤ 20 % per Reflector round walks it to 100× in ≈ 2.2 hours; and a legitimate move beyond the band freezes pricing until it comes back or a 48 h route change. Slows, does not stop; fails closed. | P-04: mainnet aggregator redesign (time-scaled band, TWAP/median reference, degraded mode) — a decision already scoped in Tranche 2.1 |
| 4 — anomaly detection and caps | Caps as above. No alerting stack yet. | Nothing would page anyone. Blockaid alerted Script3 in Incident B about an hour in; we would learn from Stellar Expert. | P-09: monitoring plan and alerting (Tranche 2.4), incident runbook now |

The single most useful fact from this incident for us: **our own measured data says the honest disagreement between FX sources for the MXN bonds is under 9 bps** ([`09_RAMP_CONNECTIVITY.md`](09_RAMP_CONNECTIVITY.md) §3). A guard that admits a 20 % step for such an asset is not a guard. The deviation redesign has to be per asset and time-aware, and it has to come from a source whose methodology is not a DEX order book.

---

## 2. Incident B — Comet BLND:USDC LP: same-token swap (2026-08-25)

### 2.1 What happened

| Time (UTC) | Event |
|---|---|
| 2026-08-25 03:25 | Attacker funds a fresh account (`GCE…YHC`) with 535.57 XLM from HitBTC; 03:48 adds 30,282 USDC from Binance; deploys two helper contracts. |
| 03:49 | Exploit sequence starts. Each transaction: flash-loan 530,000 USDC from a Blend pool → `swap_exact_amount_in` on Comet with `token_in == token_out == USDC` → join the LP → `gulp` → exit the LP → swap BLND back → repay the flash loan. First transaction [`41c898a1…`](https://stellar.expert/explorer/public/tx/41c898a15b13658d45cb8fbef2e5d93f69a501c5093cb4c0296205d69e2fc622) (verified on Horizon: ledger 64112340, 2026-08-25 03:51:02 UTC, successful) nets 46,372.24 USDC. |
| 04:32 | Blockaid alerts Script3. |
| 04:49 / 04:54 | 500k and 247k USDC bridged to Ethereum via NEAR intents. |
| 04:52 | Script3 responds; 04:53 the attacker locks the helper contracts. |
| 05:41 | Root cause confirmed; public announcements begin. |
| 11:14 and 15:03 | Two white-hat operations use the same technique to rescue ≈ 190,022 USDC and 23,169,807 BLND — the remaining pool balance — for return to the response effort. |
| 2026-08-26 | Comet PR #12 *"fix: reject same-token swaps"* opened; 2026-08-29 issue #31 *"Release Comet v2 with Protocol 27 support and security hardening"* bundles 18 hardening PRs. |

Total extracted by the attacker: **717,518.92 USDC**. Source: Script3's incident report as received by the team (a copy is in our records; we could not locate a canonical public URL to cite, and as of 2026-09-02 [docs.blend.capital](https://docs.blend.capital/) carries no notice), corroborated by the exploit transaction on-chain, the Comet repository, and press coverage of the TVL impact (Stellar DeFi TVL $270M on 2026-08-22 → ≈ $98M on 2026-08-27; Blend TVL from > $150M to near zero — [Bitget/CoinTurk](https://www.bitget.com/news/detail/12560605751219)).

### 2.2 Root cause

Comet is a port of Balancer V1. Its swap functions load `in_record` and `out_record` for the two tokens, mutate each, and write them back in order. In Solidity, with the same token, both are references to one storage slot and the sequential edits compose. In Soroban, values loaded from a `Map` are **copies**: with `token_in == token_out`, the second write overwrites the first and the pool's recorded reserve ends up `amount_in` below its real balance. `gulp()` then "corrects" the accounting upward, which revalues every LP share, and an attacker who minted shares just before `gulp` and burns them just after captures the difference. The fix is one line of validation before any state is read (PR #12: *"Reject swaps where `token_in == token_out`"*).

The wider lesson is about **porting across execution models**: an invariant that a source platform enforces implicitly (storage aliasing) becomes a bug when the target platform does not. Comet had no published audit that we could find; its original team no longer exists; its admin account for this pool had been locked, so the pool could not be frozen.

### 2.3 Effect on Blend and on our pool

Per Script3's report: Blend's core contracts have no known vulnerability; lending pools keep working and users can always withdraw and repay; but the backstop of every V1 and V2 pool holds Comet BLND:USDC LP tokens, so **backstops can no longer hold their value**, new backstop deposits are not recommended, interest auctions that buy LP tokens should not be expected to yield, and — because the LP token is not upgradeable and its role in V2 cannot be changed — **Blend V2 will eventually be wound down**, with a possible V3 under community discussion.

For us, concretely:

| Item | Fact | Consequence |
|---|---|---|
| Testnet backstop | 22,980 LP shares of Comet `CA5UTUUP…`, wasm `8abc2891…` — **byte-identical to the exploited mainnet contract** (both verified against `CometDEX/comet-contracts-v1` commit `ef4cbfad`). 17-day withdrawal queue. | No value at risk (testnet tokens donated by Blend's team). Not worth withdrawing; it keeps the evidence pool active. If the testnet Comet pool is exploited by someone practising, our pool's status can drop to on-ice and borrowing stops — deposits, repayments and withdrawals continue by Blend's design. |
| Mainnet plan, Tranche 3.1 | Written as "contracts deployed to Stellar mainnet … through Blend's pool factory", which on V2 requires a backstop funded in Comet LP. | **Blocked as written.** Funding a V2 backstop on mainnet today means buying a token whose contract has a known critical bug and whose issuer protocol says not to. We will not do it. |
| Our contracts | The aggregator is pool-agnostic (SEP-40). The controller depends on Blend's `submit` interface (`Request{address, amount, request_type}`, `Positions`). | Everything in Tranches 1 and 2 stays valid on testnet. The mainnet target (V2 with a remediated backstop path, V3, or another pool primitive) is a decision, recorded as P-03 below, to be taken when Script3 publishes the remediation plan. We will state it to the panel rather than quietly assume V2. |

### 2.4 Timeline of our own response

| Date | Action |
|---|---|
| 2026-08-26/27 | Team reads Script3's report; confirms no Vigente mainnet exposure. |
| 2026-09-01 | SCF panel asks for the audit report and this post-mortem. |
| 2026-09-02 | Hash comparison confirms the testnet backstop token is the exploited code; Comet bug-class check on our contracts (§3); this document and the review report written; incidents registered in the QMS log. |

---

## 3. The Comet bug class in our own code — checked, not found

The Comet defect is *two handles to the same record, mutated separately, written back in order*. We went through every function in `margin-controller` and `oracle-aggregator` that reads more than one record or takes more than one asset:

| Function | Records touched | Can they alias? | Verdict |
|---|---|---|---|
| `deposit_collateral(user, asset, amount)` | `Collateral(user, asset)`, `TotalCollateral(asset)`, `Cap(asset)` | Different keys by construction | Safe; each key read → written once |
| `withdraw_collateral` | same set + health pre-check via `borrow_capacity`, which substitutes the hypothetical amount for `asset` and reads the others | The substitution is by equality on `asset` inside one loop; no write | Safe |
| `borrow` / `repay` | `Debt(user)`, `TotalDebt`, `LtvAtBorrow(user)` | Distinct | Safe |
| `liquidate` | For each listed asset: `Collateral(user, asset)` → 0, `Seized(asset)` += held; then `Debt`, `TotalDebt`, `PendingSettlement` | `CollateralAssets` cannot contain duplicates (`add_collateral_asset` rejects; `init` lists one) | Safe; the loop re-reads `Seized` per asset before writing |
| `init` | `FeedKey(borrow_asset)` then `FeedKey(collateral_asset)` | If both were the same address the second write would overwrite the first with an identical feed — benign; the LTV math then uses p/p = 1 | Harmless; a `collateral_asset == borrow_asset` guard will be added in the next build for clarity |
| `oracle-aggregator::store_route` / `apply_route` | `RouteOf(asset)`, `Assets`, `Pending(asset)`, `LastGood(asset)` | Single asset per call | Safe |

No function takes two asset parameters that can refer to the same reserve. Zero-output and zero-amount paths all revert. We also confirmed the *other* Comet-class issue Comet's own hardening PR #29 addresses — non-standard token behaviour (fee-on-transfer, rebasing) — does not apply: the only tokens the controller moves are Stellar Asset Contracts (XLM SAC and Blend's testnet USDC SAC), and `add_collateral_asset` is admin-gated. A rule to only list SAC-backed assets is part of P-04.

---

## 4. The critical issues in our own review

Complete register, with severities and evidence, is §3 of [`10_SECURITY_REVIEW_REPORT.md`](10_SECURITY_REVIEW_REPORT.md). This section is the post-mortem of each: how it got in, who found it, what changed.

### 4.1 C-01 — the admin secret was in the repository

**What.** The `margin-controller` admin secret key was hardcoded in three markdown guides and four scripts, and had earlier been pasted into a debugging transcript that was committed on 2026-02-07 and deleted on 2026-05-24 — deleted from the tree, not from history. Detected 2026-07-18 during the internal review.

**How it got in.** Convenience during the hackathon phase; no hook, no scan, no rule. The transcript is the more instructive half: an assistant session log was committed as documentation, with the key inside it ten times.

**What changed.** The key was rotated on-chain first (`propose_admin`/`accept_admin`), then the files were cleaned (`50901a5`), then two controls were added: a pre-commit hook and a CI job that block six secret patterns on added lines and report file and line, never the value. `.gitignore` now covers every `.env` variant and assistant transcripts.

**What did not change, and why.** The git history still contains the burned key. Rewriting history requires a force-push that invalidates every clone, including a collaborator's and the Vercel integration; a procedure was prepared and deliberately not executed. The decision was to treat the old key as permanently burned — it controls nothing — and to publish the repository with its history rather than present a sanitised one. The residual risk is reputational, not financial, and we prefer to state it.

### 4.2 C-02 — `pause` could trap user funds

**What.** In `reference-vault` and controller v0, `pause()` gated repay, withdraw and liquidate as well as deposits and borrows. An admin could stop users from leaving.

**How it got in.** The circuit breaker was copied from a generic pattern where "pause everything" is the default. Nobody had asked which operations must survive a pause for the "non-custodial" claim to be true.

**What changed.** v1 defines pause as *entry of new risk only*. Three tests and one property test pin it; the on-chain demonstration is the pair [`e8803f60`](https://stellar.expert/explorer/testnet/tx/e8803f60719d78e29dfcc4b593b8e687e4c93d2c49092701d132ef3dc9d12a82) (admin pauses) → [`d370b84a`](https://stellar.expert/explorer/testnet/tx/d370b84aab83cce899a3d944e7f9916520a202bdc4a4258e4a465d6006b6ba32) (user withdraws everything anyway). `reference-vault` was archived with the defect documented, not fixed, so nobody forks it.

### 4.3 H-01 — the admin could induce liquidations

**What.** Tier LTVs could be changed instantly, and a badge slash instantly revalued a position at the lowest tier, so a healthy borrower could be made liquidatable by an admin action.

**What changed.** An immutable LTV floor set at `init`, a 48-hour timelock with permissionless `apply`, and a borrow-time LTV snapshot that protects a slashed position during the grace window. Property test I2 asserts that no sequence of admin powers moves user collateral or credits the admin.

### 4.4 H-02 — a legacy contract anyone could mint on, still reachable from the app

**What.** The first badge contract authenticated the beneficiary rather than the oracle in `mint_badge`; anyone could give themselves a score. Four live routes in the web app still wrote to it in July.

**What changed.** Routes deleted, contract archived, the only mint path is the 3-of-5 threshold one. The lesson recorded: retiring a contract means retiring every caller, and the callers were found by grepping for the environment variable, not by remembering.

### 4.5 P-01 — a documentation number cost a partner's time

**What.** We believed the backstop threshold was 200,000 because a document said so; the code says 100,000. We asked Blend for 2.3× the assets we needed. Blend's `mootz12` corrected us.

**What changed.** The rule *code over documentation, cite the line* is now applied to every number we publish, and it is the reason the reserve and backstop figures in the review report are RPC reads with a ledger number rather than quotes.

### 4.6 Found while writing this document (2026-09-02)

- **H-03 — deviation guard.** Designed as a manipulation defence; on analysis it is a rate limiter that also fails closed. It got in because the guard was reasoned about against a single-step attack (the YieldBlox shape) and not against a patient one, and because "panic on anomaly" felt safe without asking what the pool does while the panic lasts. The testnet contract cannot change; the mainnet one will (P-04).
- **H-04 — expired badge instance.** The badge extends its instance TTL only in `initialize`; ninety days after 2026-05-31 the instance archived, and every controller call that reads the badge now needs a restore. It went unnoticed because the CLI restores archived entries automatically and every manual run went through the CLI. **This one is embarrassing and we are stating it plainly:** the reviewer commands in the README would have failed with an archival error the day the panel tried them.
- **M-01 — TTL ownership.** Nobody owns TTLs. The pool instance had ≈ 8.6 days left at read time.
- **M-02 — badge pause blocks liquidations.** A cross-contract coupling nobody had drawn: pausing the badge makes `slash` panic, and `liquidate` calls `slash`.

---

## 5. Consolidated timeline

| Date | Event |
|---|---|
| 2026-02-22 | Incident A — YieldBlox oracle manipulation |
| 2026-05-31 | `vigente-badge` v3 initialised (instance TTL bump: 90 days) |
| 2026-07-11 → 07-26 | Internal security review; C-01, C-02, H-01, H-02, M-06 remediated; aggregator and own pool deployed |
| 2026-07-18 | C-01 detected; key rotated; hook and CI added (committed 07-26) |
| 2026-08-03/04 | P-01: threshold error, corrected by Blend |
| 2026-08-08 | Own pool activated; full credit cycle and custody test on-chain |
| 2026-08-16 | SCF #45 submission |
| 2026-08-22 | Build reproducibility gap (M-05) found and documented |
| 2026-08-25 | Incident B — Comet BLND:USDC LP |
| ≈ 2026-08-29 | H-04: badge instance TTL expires (unnoticed) |
| 2026-09-01 | SCF panel requests audit report and post-mortem |
| 2026-09-02 | This document; H-03, H-04, M-01, M-02 disclosed; incidents registered |

---

## 6. Process changes

Each change names what it prevents, its status, and the artefact a reviewer can check. "Scheduled" items are tied to a funded deliverable or a dated action, not left open.

| # | Change | Prevents recurrence of | Status | Artefact |
|---|---|---|---|---|
| **P-01** | **Numbers come from code or official tooling, with the line cited.** Documentation is a hint, not a source. | Threshold error (4.5) | **In place** since 2026-08-04 | [`08_POOL_ACTIVATION.md`](08_POOL_ACTIVATION.md) §2; review report §4 (every value is an RPC read with a ledger) |
| **P-02** | **No secret enters git.** Pre-commit hook on added lines, CI scan on every push, `.gitignore` for env files and assistant transcripts; admin keys never in Vercel env or on developer machines once multisig exists. | C-01 | **In place** since 2026-07-26 | [`../.githooks/pre-commit`](../.githooks/pre-commit), [`../.github/workflows/secret-scan.yml`](../.github/workflows/secret-scan.yml) |
| **P-03** | **Dependency inventory with blast radius, and a written impact assessment within 72 h of any upstream incident.** Every third-party contract the pool depends on is listed with its wasm hash, upgradeability, admin, audit status and what breaks if it fails. The Blend V2 backstop decision (do not fund a mainnet V2 backstop while the Comet LP is compromised; choose the mainnet target when Script3 publishes the remediation path) is recorded as a decision, not an assumption. | Incident B surprising us; silently planning mainnet on a compromised backstop | **In place** (this document is the first assessment; inventory in review report §1) · decision record scheduled for Tranche 3.1 kick-off | Review report §1; this §2.3; Gate 2 in [`../docs/qms/RELEASE_QUALITY_GATES.md`](../docs/qms/RELEASE_QUALITY_GATES.md) |
| **P-04** | **Oracle and collateral listing policy.** (a) No collateral whose price derives from a thin DEX order book; RWA feeds must be NAV/redemption-based or multi-source, and the provider's methodology must be documented before listing. (b) Per-asset deviation band calibrated from measured dispersion and time-scaled; reference from upstream TWAP/median, not our last served price; a defined degraded mode instead of an indefinite panic. (c) Caps: reserve `supply_cap`, controller per-asset cap and per-user cap (T1.2) derived from issuer redemption capacity, never chosen abstractly. (d) Only SAC-backed assets. (e) For every function that takes two assets or two records: a test with equal inputs. | Incident A class; H-03; Comet class | (a)(c)(d)(e) **adopted now** as checklist items · (b) **scheduled**: mainnet aggregator, Tranche 2.1, before any RWA reserve is queued | Gates 2 and 6 in `RELEASE_QUALITY_GATES.md`; review report H-03/L-01; [`09_RAMP_CONNECTIVITY.md`](09_RAMP_CONNECTIVITY.md) §3 (measured dispersion) |
| **P-05** | **Independent audit is a hard release gate.** "Independent" means a firm or reviewer who did not write the code, engaged in writing, with a published report; AI-assisted self-review does not qualify. Audit Bank request is filed when Tranche 2 closes (the "nearly mainnet-ready" criterion); critical/high/medium findings remediated within the 20-business-day window; no mainnet contract holds user funds before the report is public. | Overstating review status; shipping unreviewed code to mainnet | **In place** as a gate; request **scheduled** at the end of Tranche 2 | Gate 7 in `RELEASE_QUALITY_GATES.md`; review report §0 |
| **P-06** | **Claims discipline.** No public claim ships without an on-chain read with its command cited, code with file:line, or command output; the word "audit" is reserved for P-05's definition. The SCF #45 submission wording is corrected. | The "full security audit" wording | **In place** (rule since 2026-08-16); correction **this week** | [`../docs/AI_DISCLOSURE.md`](../docs/AI_DISCLOSURE.md) §8; review report §8; README "What does not exist yet" |
| **P-07** | **Incident log is used.** Every security-relevant event — ours or an upstream's that touches a dependency — gets an entry with severity, root cause, fix link and closure. | A log that said "no incidents" while four had happened | **In place**: INC-2026-01…04 registered today | [`../docs/qms/INCIDENT_LOG.md`](../docs/qms/INCIDENT_LOG.md) |
| **P-08** | **TTL keeper and runbook.** Weekly `ExtendFootprintTTL` on every contract instance and hot key; alert when any instance has < 21 days left; next builds extend instance TTL on every write. | H-04, M-01 | Restore + extend **this week** · keeper **scheduled** with the alerting stack, Tranche 2.4 | Review report H-04/M-01; runbook below |
| **P-09** | **Incident runbook and monitoring.** Who can do what, in order: (1) controller `pause` — stops new deposits and borrows, never exits; (2) pool `set_status` to admin-on-ice or frozen — stops borrowing/supplying on the Blend side, withdrawals and repayments continue; (3) aggregator `queue_set_route` if the price source is the problem — 48 h, announced; (4) badge `pause` only with M-02 in mind. Alerting on the contracts' events (12 in the controller, 8 in the badge) plus price-deviation and TTL alerts. | An hour of unnoticed exploitation (Incident B); nobody knowing which lever to pull | Runbook **in place** (below) · alerting **scheduled**, Tranche 2.4 | This section; Tranche 2.4 deliverable |
| **P-10** | **Reproducible builds.** Pin `rust-toolchain.toml` and the CLI version; CI builds the wasm and compares its hash with the ledger; the hash of every deployed contract is recorded with its commit. | M-05 | **Scheduled** before the next deploy (Tranche 1.1 redeploy) | Review report M-05 |
| **P-11** | **Cross-contract failure review** on every change: for each pair of contracts, what happens if the other is paused, archived, re-initialised or returns an error. | M-02, H-04 | **Adopted now** as a Gate 2 item; `try_slash` fix in the next controller build | Gate 2 checklist; review report M-02 |

### Runbook (P-09) — the levers, in order

```
Suspected price problem (aggregator, upstream, or an asset)
  1. margin-controller.pause()            admin GDGMMHYO…  — blocks deposit_collateral/borrow; withdraw, repay, liquidate keep working
  2. pool.set_status(2)  (admin on-ice)   admin GDGMMHYO…  — Blend side: no new borrows; withdrawals and repayments continue
  3. aggregator.queue_set_route(asset, …) admin GDGMMHYO…  — announced on-chain, effective after 172,800 s; apply_route is permissionless
  4. Post the incident entry in docs/qms/INCIDENT_LOG.md within 24 h; impact assessment within 72 h (P-03)

Suspected controller/badge problem
  1. margin-controller.pause()            — as above
  2. Do NOT pause the badge unless liquidations must also stop (M-02)
  3. If the flaw is in code: contracts are immutable — announce, keep exits open, redeploy, migrate voluntarily

Archival error on any call ("entry archived" / restore required)
  1. Submit RestoreFootprint for the entry (anyone can pay), then ExtendFootprintTTL
  2. Record in INCIDENT_LOG; check the keeper (P-08)
```

---

## 7. Immediate actions (owner: founder unless stated)

| # | Action | By |
|---|---|---|
| 1 | Restore and extend the `vigente-badge` instance; extend the pool, aggregator and both controller instances (H-04, M-01). Re-run the README verification commands afterwards. | 2026-09-05 |
| 2 | Correct the submission wording ("internal security review", not "full security audit") and send the panel this document and the review report. | 2026-09-03 |
| 3 | Register INC-2026-01…04 (done in this commit); keep them open until closed with a date. | done |
| 4 | Record the Blend V2 mainnet decision as a dated decision note when Script3 publishes its remediation plan; until then Tranche 3.1 is explicitly conditional. | when published |
| 5 | Pin the toolchain (P-10) and add the `collateral_asset != borrow_asset` guard and `try_slash` (M-02) to the Tranche 1.1 redeploy scope. | Tranche 1.1 |

---

## 8. Sources

- Script3, statements on the YieldBlox incident, X, 2026-02-22/23 — quoted in §1.1.
- rekt.news, *YieldBlox — Rekt* (timeline, transactions, oracle detail). BlockSec, *YieldBlox DAO incident on Stellar* (SDEX depth, borrow sequence). Halborn, *Explained: the YieldBlox hack* (validator freeze, root cause framing).
- Script3, incident report on the Comet BLND:USDC exploit, 2026-08-25 (team copy). Exploit transaction `41c898a1…` on Stellar mainnet, ledger 64112340.
- CometDEX, `comet-contracts-v1`: PR #12 *fix: reject same-token swaps* (2026-08-26); issue #31 *Release Comet v2 … security hardening* (2026-08-29); PR #29 *Restrict Comet pool assets to Stellar Asset Contracts*.
- Blend documentation: *Selecting an oracle*, *Backstopping*, *Audits & bug bounties*, whitepaper (pool status rules, backstop threshold, 17-day queue). `blend-contracts-v2/audits` (Certora April and June 2025; Code4rena 2025).
- Stellar developers, *Oracle providers* (Reflector feed contract identities).
- Soroban Audit Bank, official rules (SCF handbook).
- Bitget/CoinTurk, *Stellar DeFi TVL plunges 60% after $717K Blend exploit* (TVL figures).
- Contract hashes and creation data: stellar.expert API, testnet and public network, 2026-09-02.
