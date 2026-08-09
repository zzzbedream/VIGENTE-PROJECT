# Vigente Protocol — Product Requirements Document

> ## 🗄️ HISTORICAL — superseded, kept for traceability
>
> This PRD describes the **pre-pivot** product: Vigente as a credit-signal oracle sold to
> third parties, which "does not lend". That is no longer what is built. The product today is
> **non-custodial collateralized credit**: a margin controller that prices each user's LTV
> from an on-chain reputation badge, in front of our own isolated Blend pool.
>
> **Read instead:**
> - [`../README.md`](../README.md) — what the product is, and how to verify it
> - [`ARCHITECTURE.md`](ARCHITECTURE.md) — the current technical architecture
> - [`../audit/08_POOL_ACTIVATION.md`](../audit/08_POOL_ACTIVATION.md) — on-chain evidence
>
> Contract IDs and feature claims below are **out of date**. This file is retained because the
> decision trail is part of the evidence, not because it describes the system.

> **The credit reputation oracle for Stellar.** Vigente sells the credit
> signal; it does not lend. Asset-light, no fund, no credit risk on our
> balance sheet. This PRD defines the product, the MVP, and a phase-by-phase
> roadmap aligned to the SCF Build Award structure (10/20/30/40).
>
> Target: SCF #45. Realistic by design — every "shipped" claim is verifiable
> on-chain; every future claim is scoped to what a small team can deliver.

---

## 1. Problem

Stellar DeFi is entirely over-collateralized (every major lending market demands
≥100% collateral) because **there is no shared credit/reputation primitive**.
Separately, Stellar projects running airdrops or reputation-weighted
governance have **no native Sybil-resistance tool**. Both problems are the
same missing piece: a trustworthy, decentralized, readable **reputation
signal** for any Stellar address. See [MARKET_ANALYSIS.md](MARKET_ANALYSIS.md).

## 2. Product

Vigente is a **credit reputation oracle** with three consumption surfaces:

1. **On-chain (Soroban):** contracts call `get_score(addr)` /
   `is_defaulted(addr)` cross-contract. Spec:
   [INTERFACE.md](../contracts/vigente-badge/INTERFACE.md).
2. **Off-chain (REST API):** `GET /score/{address}` returns a reputation
   signal for Web2 systems, fintechs, and other chains.
3. **Embeddable widget:** a credit-passport / 180-day activity heat map that
   wallets and apps drop in.

The score is produced by a **synthetic scoring engine** reading public
Stellar Horizon data, and attested by a **3-of-5 ed25519 threshold oracle** —
no single party, not even the contract admin, can fabricate a score.
Defaults are recorded immutably on-chain.

**What Vigente is NOT:** a lender, a fund, a custodian of capital. The
`reference-vault` in this repo is a *reference implementation* showing
integrators how to consume the oracle — Vigente does not operate it with
real money. **We sell the score; the protocols that read it bear the credit
risk and the yield.**

## 3. Target customers (ordered by time-to-revenue)

| # | Segment | Use case | Lending needed? | Time-to-revenue |
|---|---|---|---|---|
| 1 | Airdrop / governance projects | Sybil filter: genuine addresses vs farms | **No** | **Immediate** |
| 2 | Opt-in lending protocols / RWA pools | Gate / price under-collateralized credit | By them, not us | Short |
| 3 | Wallets (Lobstr, xBull) | Embedded credit passport | No | Medium |
| 4 | Fintechs / anchors | KYC-light risk / fraud signal | No | Medium |

The **airdrop/Sybil wedge (segment 1) is the entry point** because it
delivers value with zero lenders in the loop — it bootstraps oracle usage
before the lending flywheel exists.

## 4. What is already built (verifiable today)

| Capability | Evidence |
|---|---|
| 3-of-5 threshold mint, verified on-chain | tx [`5bf78e25…`](https://stellar.expert/explorer/testnet/tx/5bf78e2590cdd83553183aaee17e09c23b032eda224dc6b8b69514ccc3859657) + 4 more |
| Badge contract + immutable defaults | `CDLLO7QE…` on testnet |
| Synthetic on-chain scoring engine | `web/src/services/horizon-scoring.ts` |
| Credit Oracle Interface v1 + ABI + example consumer | [INTERFACE.md](../contracts/vigente-badge/INTERFACE.md), [abi-v3.json](integration/abi-v3.json), [example](../examples/integration-snippet/) |
| REST score endpoint | `/api/oracle/score-onchain` |
| Credit heat map | `web/src/components/CreditHistoryHeatmap.tsx` |
| SEP draft (credit attestation standard) | [sep-draft](integration/sep-draft-credit-attestation.md) |
| Reference lending consumer + 104+ tests | `contracts/reference-vault/` |
| Live app | https://vigente-project.vercel.app |

The hard cryptography and the read interface exist. **The pivot is about
productizing and distributing what's built — not rebuilding it.**

## 5. MVP — the thinnest valuable slice (no fund, $0 at risk)

**Definition of done:** the reputation oracle live on mainnet, plus **one
real third party consuming the signal** — an airdrop using the Sybil filter,
a protocol reading the score cross-contract, or an API consumer with a key.

| MVP requirement | Status | Gap to close |
|---|---|---|
| Badge contract on **mainnet** | testnet only | deploy |
| Scoring engine | ✅ | — |
| Threshold oracle | ✅ | harden seed custody |
| Interface v1 + ABI + example | ✅ | — |
| REST API productized (keys, rate-limit, tiers) | endpoint exists | `docs/API.md` + key auth |
| Embeddable passport widget | heat map exists | `<embed>` build |
| **1 real consumer** | ❌ | **the actual deliverable** |

**Capital at risk: $0.** MVP revenue = integration fee / API subscription /
Sybil-filter fee. No lending, no credit risk, no lending-license exposure.

## 6. Phase-by-phase roadmap (SCF tranches, MVP-first)

### Phase 0 — Pre-grant (shipped, $0)
Threshold oracle · badge + defaults · Interface v1 + ABI + example · scoring
engine · heat map · REST endpoint · SEP draft · 104+ tests · live app.
**Validation:** tx hashes on stellar.expert · `cargo test` · live app.

### Tranche 1 — Oracle MVP on mainnet · $12K (10/20/**20**/...) → 20% of $60K
*Deliverables*
- Deploy `vigente-badge` (the oracle only) to **mainnet**.
- Productize the REST API: API keys, rate-limit, free/paid tiers, `docs/API.md`.
- Embeddable credit-passport widget.
- Harden oracle seed custody + key-rotation runbook.
- **First Sybil-wedge consumer**: integrate with ≥1 airdrop/governance
  project using the score as a filter. *(This is the MVP value proof.)*
- Submit the SEP draft as a PR to `stellar/stellar-protocol`.

*Validation:* `npm run validate-t1` → JSON (mainnet contract ID, threshold
demo) + one real consumer with verifiable evidence (call log / tx) + API
responding to a keyed request.

### Tranche 2 — Lending integrations as reference · $18K (30%)
*Deliverables*
- **`reference-vault` as the on-chain credit-gating reference**: the
  contract reads Interface v1 (`is_defaulted == false`, `get_score`) and
  gates lending end-to-end (TVL cap, utilization rail, timelock,
  slash-on-default) — proving credit-gated, under-collateralized lending
  **without Vigente operating a fund**. It is the SDK any opt-in lending
  protocol copies to gate by reputation. Immutable price-oracle markets
  consume only SEP-40 *price* oracles and cannot read it on-chain — they
  are out of scope by design; their consumption path is off-chain.
- Credit passport embedded in ≥1 wallet (Lobstr/xBull).
- Generic attestation pipeline v1 (placeholder ZK) — the "waiting room" where
  a source attests data → enriched score, on the Protocol-25 ZK rails.

*Validation:* `npm run validate-t2` → reference-vault `deposit→borrow→yield→claim`
tx + a score read from a third-party contract + ≥2 integrated consumers.

### Tranche 3 — Standard + scale · $24K (40%)
*Deliverables*
- **TypeScript SDK** on npm (`@vigente/oracle`) — trivial consumption.
- SEP advanced in the Stellar standardization process.
- Real ZK attestation pipeline (real-world data) on Protocol 25 / Risc Zero.
- B2B risk-analytics dashboard for protocols sizing exposure.
- **3+ mainnet integrators** consuming the signal.

*Validation:* SDK on npm + 3 verifiable on-chain integrators + ZK proof demo.

### Tranche 4 — Beyond the grant (revenue / pre-seed, NOT in the $60K ask)
Multi-source attestation · independent third-party oracle node operators ·
the same standard ported to other chains · a real credit pilot where a
*partner* protocol provides the fund.

## 7. Why this qualifies as "significant improvement" (SCF resubmission)

SCF blocks a project after 3 rejections; Vigente has **1** (SCF #41). The
pivot is the meaningful improvement the policy requires:

| SCF "significant improvement" example | How the pivot delivers it |
|---|---|
| Stronger, more realistic roadmap | From "lending app with a fund and credit risk" to "asset-light oracle, $0 at risk" |
| Better-structured tranche plan | §6: each tranche has a deliverable + validation + a *real consumer* |
| Demonstrated traction / technical progress | Interface v1 shipped, 5 mint txs, live app, 104+ tests since #41 |
| More compelling use of Stellar/Soroban | First native reputation oracle + uses Protocol-25 ZK + an open SEP |
| Fixing critical reviewer issues | Removes "another lending app" and the execution risk of operating a fund |

Full point-by-point answer to the #41 feedback: [SCF_REBUTTAL.md](SCF_REBUTTAL.md).

## 8. Risks

| Risk | Mitigation |
|---|---|
| "No lending → no demand" | The Sybil/airdrop wedge has demand *today* without any lender |
| Slow oracle adoption | Start with the lowest-friction case (an airdrop filter, one API call) |
| Thin on-chain data for some users | Honest: real-world data is T2+ via ZK; MVP serves crypto-native actors |
| SEP not adopted | Zero sunk cost (it's markdown); the value is public authorship |
| "Are they a lender or not?" confusion | One message: *we sell the score, we don't lend*; the vault is a demo |

## 9. Success metrics

- **MVP (T1):** ≥1 real external consumer; mainnet oracle live; API serving keyed requests.
- **T2:** ≥2 integrated consumers; reference-vault credit-gated loan tx on-chain.
- **T3:** ≥3 mainnet integrators; SDK on npm; ZK proof demo.
- **North star:** number of independent protocols reading Vigente — the
  network effect that makes the reputation signal valuable and the credit
  flywheel self-reinforcing.

---

*Companion documents: [MARKET_ANALYSIS.md](MARKET_ANALYSIS.md) ·
[SCF_REBUTTAL.md](SCF_REBUTTAL.md) ·
[INTERFACE.md](../contracts/vigente-badge/INTERFACE.md) ·
[THREAT_MODEL.md](THREAT_MODEL.md). Contact: zzzbedream@gmail.com*
