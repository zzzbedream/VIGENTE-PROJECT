# Architecture Audit — Blend-oracle dependency removal

> ## 🗄️ HISTORICAL — this audit was acted on; its conclusions are now built
>
> A dated snapshot of the analysis that **produced** the current architecture. It correctly
> concluded that Blend consumes only SEP-40 *price* oracles and can never read a reputation
> score — the finding that led to the margin-controller design.
>
> What changed since: the audit treats the `reference-vault` as the on-chain consumer. That
> contract is **archived**. The consumer today is the `margin-controller`, running over our
> own Blend pool with our own SEP-40 aggregator in the pool's immutable oracle slot.
>
> **Read instead:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
> [`audit/08_POOL_ACTIVATION.md`](audit/08_POOL_ACTIVATION.md)

**Branch:** `arch/remove-blend-oracle-dependency`
**Date:** 2026-06-27

## Why this audit exists

The SCF panel rejected Vigente partly because the pitch implied **Blend reads
our score on-chain** to gate/originate loans. Blend is immutable and consumes
**only SEP-40 *price* oracles** — it cannot read a third-party reputation
oracle. Any copy implying Blend (or any immutable price-oracle market) reads
`get_score` / `is_defaulted` to gate lending is unviable and must be removed
or reframed.

## Viable model (target)

- **Off-chain consumption** via a SEP-12-style attestation API by originators
  that already do KYC + originate credit (remittance wallets / PayFi; **Vita
  Wallet = target partner, LOI in progress, not signed**).
- **On-chain consumption** only by (i) our own `reference-vault` (the
  credit-gating demonstration) and (ii) any protocol that explicitly opts in
  to read `get_score` / `is_defaulted` — **not Blend**.
- Keep the **3-of-5 ed25519 threshold oracle** (answer to the
  "centralized oracle" critique).
- **Repayment interception** is the roadmap moat — labeled roadmap, not shipped.
- Vigente is a **data/attestation layer, not a lender** — carries no default
  on its balance sheet; the originating partner bears credit risk.

## Verified state of the CODE (clean before this branch)

- [x] **No Blend SDK** in any `Cargo.toml` (`vigente-badge`, `reference-vault`,
      `mock-usdc`).
- [x] **No Blend imports** in any Rust source.
- [x] `contracts/vigente-badge/src/lib.rs` — 3-of-5 ed25519 threshold verified
      on-chain (`mint` runs `ed25519_verify` per signature, unique-index
      enforcement, anti-replay nonce). SBT + immutable `DefaultBadge` via
      `slash`. Public reads `get_score` / `is_defaulted`.
- [x] `contracts/reference-vault/src/lib.rs` — credit-gating (`borrow` calls
      `is_defaulted` / `get_score`), TVL cap, utilization rail, withdrawal
      timelock, slash-on-default cascade. This is THE on-chain credit-gating
      reference.
- [x] `docs/SCF_REBUTTAL.md` + `docs/RESUBMISSION_FEEDBACK.md` already state the
      Blend dependency was removed and explain the SEP-40 constraint.

**Conclusion:** the problem was stale **public copy**, not the contracts.

## Conflicts found in copy — and the reframe applied

| File | Snippet (before) | Why it conflicts | Reframe (after) |
|---|---|---|---|
| `README.md` status table | "Blend integration in code — … router contract not yet built" | implies a real Blend integration path | "First off-chain originator integration — score API consumed by a remittance/PayFi partner (Vita = target, LOI in progress)" |
| `README.md` Tranche 1 | "Blend Credit Router — design + PoC … executes `submit` against a Blend pool via the Blend SDK" | implies Blend-side credit gating | T1 = first **off-chain originator integration** (score attestation API + originator guide; Vita = target) |
| `README.md` Tranche 2 | "Score → collateral-factor at the router level … Blend's health factor … Own pool via Blend `pool_factory`" | implies Blend reads reputation | T2 = **open-finance enrichment (consented) + yield** on the `reference-vault` |
| `README.md` Tranche 4 | "risk analytics for Blend backstop depositors" | Blend-coupled deliverable | removed; added **repayment interception** moat (roadmap) |
| `README.md` line 166 | dangling link `docs/integration/BLEND.md` (file never existed) | broken reference | removed with the router bullet |
| `README.md` out-of-scope | (none) | missing | added: "any dependency on an immutable price-oracle lending market reading our score on-chain — those markets consume only SEP-40 *price* oracles" |
| `README.md` SCF section | "… Blend feasibility, default handling …" | naming Blend in public README | "third-party-oracle feasibility" |
| `docs/PRD.md:15` | "(Blend, Laina, FxDAO all demand ≥100% collateral)" | names Blend in PRD | "(every major lending market demands ≥100% collateral)" |
| `docs/PRD.md:50` | "Lending protocols (Blend pools, Laina, RWA)" | Blend as a gating consumer | "Opt-in lending protocols / RWA pools" |
| `docs/PRD.md:117` | "Blend Credit Router … `submit` against a Blend pool" | implies Blend gating | "`reference-vault` as the on-chain credit-gating reference" |
| `docs/PRD.md:127,173` | "Blend-router tx" | validation tied to Blend | "reference-vault `deposit→borrow→yield→claim` tx" |
| `docs/ARCHITECTURE.md:9` | "These badges gate undercollateralized lending in DeFi protocols." | implies gating inside third-party pools | "enable credit-gated lending via the `reference-vault` and any contract that opts in" |
| `docs/ARCHITECTURE.md §11` | (no Blend non-goal) | missing | added explicit non-goal on immutable price-oracle markets |
| `docs/BUSINESS_PLAN.md:107` | "Blend Protocol (if/when they support external oracles)" | Blend as future customer | "Opt-in lending protocols … (immutable price-oracle markets cannot)"; added data-layer / no-default-on-balance-sheet note |
| `docs/ROADMAP.md` (ES) | (no Blend non-goal) | missing parity | added ES out-of-scope line + repayment-interception moat note |

## Gap-check vs. target model

- [x] **Off-chain API / SEP-12-style path** exists (`web/src/app/api/oracle/*`
      HMAC-signed) — now framed as **the** originator consumption story in T1.
- [x] **`reference-vault` = THE on-chain credit-gating reference** — now the
      sole on-chain gating story (Blend router removed).
- [x] **Default handling = data layer, not lender** — reinforced in
      `BUSINESS_PLAN.md`.
- [x] **Validation method per tranche** — added to README T1–T3 and PRD T2.
- [x] **Repayment interception** — added as labeled roadmap moat +
      `docs/design/REPAYMENT_INTERCEPTION.md` (design only, not shipped).

## Left intentionally untouched (already correct)

- `MARKET_ANALYSIS.md` — factual competitor framing ("Blend reads a *price*
  oracle, it has no credit oracle to read"). This *is* the constraint argument.
- `docs/SCF_REBUTTAL.md`, `docs/RESUBMISSION_FEEDBACK.md` — the "why we don't
  depend on Blend" explanation.
- `docs/private/**` — historical strategy notes.
- Landing (`/landing`), app (`/v3`), one-pager (`/onepager`) — verified free of
  Blend claims.
- The 3-of-5 threshold, anti-replay nonce, vault TVL/utilization caps, and
  withdrawal timelock — unchanged (no security weakening).

## Verification

- `git grep -in blend` over README / PRD / ARCHITECTURE / BUSINESS_PLAN /
  ROADMAP returns **zero** hits (Blend remains only in SCF_REBUTTAL,
  RESUBMISSION_FEEDBACK, MARKET_ANALYSIS, private/).
- `cd contracts && cargo test` — 104+ tests green (docs-only change; confirms no
  code impact).
