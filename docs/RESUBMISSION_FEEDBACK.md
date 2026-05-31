# Resubmission Feedback — Vigente Protocol

> *This section addresses the feedback received on the prior SCF Build submission and documents the concrete changes made in response.*

---

## Why We Are Resubmitting

Vigente Protocol was submitted to the Stellar Community Fund in early 2026 and was not selected. We received six specific feedback items from Delegate Panelists. This document maps each item to the concrete changes we made in the repository — every claim below is verifiable by inspecting the code, running the tests, or querying the testnet contracts.

We did not rewrite the proposal cosmetically. We restructured the architecture, the team, the budget, and the deliverables so that this resubmission addresses the substance of each concern.

---

## Feedback Item 1 — Team Composition & Execution Risk

**Reviewer concern:** *"The team is a solo student developer with hackathon experience. While the technical concept is interesting, this is a significant ask ($123K) for a single early-career builder, and the execution risk is high for the proposed scope."*

**What changed:**

The original submission was effectively solo. We have since formed a three-person team with complementary roles:

| Role | Name | Responsibility | Verification |
|------|------|----------------|--------------|
| Founder / Tech Lead | zzzbedream | Architecture, Soroban contracts, integration | Primary Git author (verifiable via `git log`) |
| Full-stack Engineer | Cristian Pérez Arce | Frontend, oracle adapters, testing | Profile in `docs/TEAM.md`; commits to be visible in `git log` before submission |
| Commercial Lead | Mauricio Urra | Business development, partnerships, LOIs | Profile in `docs/TEAM.md`; LOIs in `docs/letters/` |

We did not inflate team size for appearances. The three roles are functional, with the Founder remaining accountable for technical delivery. The codebase is the proof of execution — it is auditable in this repository.

**Budget reduction:** Original ask was $123,000 USD. Current ask is **$60,000 USD** — a 51% reduction. This reflects the realistic cost of three engineers shipping a scoped MVP → Testnet → Mainnet trajectory in six months, not an aspirational team of ten.

---

## Feedback Item 2 — Budget Alignment with SCF Handbook

**Reviewer concern:** *"The budget does not align with the SCF Build Award milestone structure (10/20/30/40). The tranche breakdown should be restructured to follow SCF handbook guidelines."*

**What changed:**

The budget now follows the SCF handbook exactly: **three tranches** (MVP / Testnet / Mainnet) backed by **four payments** at 10% / 20% / 30% / 40%.

| Payment | Trigger | Amount | % |
|---------|---------|--------|---|
| #0 | Award acceptance | $6,000 | 10% |
| #1 | Tranche 1 — MVP complete | $12,000 | 20% |
| #2 | Tranche 2 — Testnet expansion complete | $18,000 | 30% |
| #3 | Tranche 3 — Mainnet launch complete | $24,000 | 40% |
| **Total** | | **$60,000** | **100%** |

Each tranche has explicit deliverables, validation criteria, and a verifiable success signal documented in `docs/TRANCHE_1_DELIVERABLES.md`, `docs/TRANCHE_2_DELIVERABLES.md`, and `docs/TRANCHE_3_DELIVERABLES.md`.

The previous 4-tranche structure was non-compliant with the handbook. We removed the fourth tranche entirely and folded its content (reference lending vault) into Tranche 2, where it sits next to the cross-contract integration work it depends on.

---

## Feedback Item 3 — Underspecified Components: Blend, Default Logic, Centralized Oracle

**Reviewer concern:** *"Key components are underspecified. The Blend integration is referenced but Blend does not currently support third-party oracles. The loan default handling logic is not well-elaborated, and the centralized oracle model introduces a single point of trust for reputation issuance."*

**What changed:**

### Blend dependency: removed entirely

The previous submission described Vigente as a credit oracle for Blend Protocol. Blend does not currently support third-party oracles, which made the integration claim aspirational at best. We removed the dependency in three concrete ways:

1. **No Blend SDK in any `Cargo.toml`** — verifiable via `git grep -i blend contracts/`.
2. **No Blend imports in Rust code** — same grep returns zero hits.
3. **Tranche 2 delivers a `reference-vault` contract** that demonstrates credit-gated lending end-to-end on Soroban with no third-party protocol dependency. This is the integration reference that production protocols (Blend, Lulo, others) can adopt when they choose to support external credit oracles. The reference vault is a complete working example, not a placeholder.

### Default logic: implemented as immutable on-chain enforcement

The `vigente-badge` contract (`contracts/vigente-badge/src/lib.rs`) implements a permanent slashing mechanism with the following guarantees, all enforced in code:

- `slash()` marks the active `CreditBadge` as `slashed = true` and creates an immutable `DefaultBadge` record in persistent storage.
- The `DefaultBadge` TTL is approximately 2 years (12,614,400 ledgers at ~5s/ledger) — the maximum practical retention under Soroban's storage model.
- **No `delete_default()` function exists** — not even for the admin. This is enforced by the absence of code, not by access control.
- `mint()` calls `is_defaulted()` before issuing a new badge. A defaulted address can never receive a new badge from this contract.
- A `slash` event is emitted to the Stellar ledger, providing a permanent audit trail even after the storage entry eventually expires.

The test suite (`contracts/vigente-badge/src/test.rs`) contains 30 tests covering the slash lifecycle, including the cases where a defaulted borrower cannot re-mint and where double-slashing is prevented.

### Centralized oracle: SHIPPED as k-of-n threshold ed25519 on-chain (Phase B, pre-submission)

Between the rejection and this resubmission we did not just document a roadmap — we built the multi-signature oracle in code, audited it against a Soroban resource budget probe, deployed it to testnet, and proved cross-language signature parity end-to-end. The trust assumption changed from "trust the Vigente oracle" to "trust no single oracle of the n configured; a k-quorum is required for every mint".

| Phase | Model | Trust Assumption | Status |
|-------|-------|------------------|--------|
| Pre-rejection baseline | Server-side oracle with HMAC-signed claims | Trust Vigente oracle is honest | Replaced |
| **Phase B (pre-submission)** | **k-of-n threshold ed25519 verification on-chain** in `vigente-badge.mint()`. Default `k=3, n=5`. Indices into `OracleKeys: Vec<BytesN<32>>` are unique per call; anti-replay nonce stored as `UsedNonce(BytesN<32>)`. | **Trust quorum (k) of independently-keyed oracles** | **Live on testnet at `CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD`.** |
| Tranche 2 deliverable | Open banking adapter (Fintoc) feeding distinct oracle nodes | Same threshold guarantees, more diverse data inputs | Planned |
| Post-grant roadmap | TLSNotary client-side attestation (architectural spec in `docs/ARCHITECTURE.md`) | Trustless: cryptographic proof from user's own device | Out of scope of the grant ask |

Evidence that this is real, not a promise:

- **Code:** `contracts/vigente-badge/src/lib.rs` — `DataKey::OracleKeys`, `DataKey::OracleThreshold`, `set_oracle_keys` (atomic replacement with duplicate-pubkey and `threshold <= keys.len()` invariants), `mint()` verifying k signatures via `env.crypto().ed25519_verify`.
- **Budget probe:** 3× `ed25519_verify` consumes 1.27M CPU instructions, 1.3% of the testnet ceiling. Documented in `docs/notes/soroban-budget-day1.md`.
- **Live positive mint (3-of-5 sigs, age=90):** [tx `8b9fccfc…`](https://stellar.expert/explorer/testnet/tx/8b9fccfc9daaf594e457e19808ef9c0746e8e45f37aab8417b5fe8d59641bc85). `get_score(borrower)` returns the exact score the simulator signed.
- **Live negative mint (age=10 tampered):** trapped at Soroban simulation with `Error(WasmVm, InvalidAction)`, recorded in `docs/notes/phase-b-prime-acceptance.md`.
- **Tests:** 7 threshold-specific unit tests + 2 XDR-parity tests + 9 simulator tests. See `docs/THREAT_MODEL.md` § 5 for the full proof trail.

This is the change we owed the previous review: the centralized oracle critique is no longer applicable to the contract on testnet today.

---

## Feedback Item 4 — Business Use Case, Traction, and Partnerships

**Reviewer concern:** *"Business use case and go-to-market plan are not clearly defined. The submission lacks verifiable traction, defined access to MoneyGram, or confirmed partnerships. It is unclear who the target customers are and how adoption will scale."*

**What changed:**

### Data source: pivoted from MoneyGram to Payku (with Fintoc as Tranche 2 expansion)

We had no partnership with MoneyGram. Claiming otherwise was the prior submission's weakest point. The current data strategy is grounded in commercial reality:

| Source | Coverage | Access Status | Verification |
|--------|----------|---------------|--------------|
| **Payku (Chile)** | Microcommerce payment data — primary launch market | Sandbox integration in code (`web/src/services/payku-client.ts`); Letter of Intent in progress | `docs/letters/payku-loi.pdf` (post-meeting) |
| **Fintoc (Chile)** | Open banking — Tranche 2 expansion | Self-service sandbox; integration adapter in `integrations/fintoc-sandbox/` | Verifiable via Fintoc developer portal |
| **Prometeo (LatAm)** | Open banking — post-grant expansion | Documented in `docs/BUSINESS_PLAN.md` | Not a Tranche deliverable |

Payku is the right launch partner because (a) they already serve our target customer, (b) their sandbox is self-serve and we have working integration code, and (c) they operate under Chilean fintech regulation.

### Target customer

`docs/BUSINESS_PLAN.md` documents:
- **Primary segment**: Chilean microcommerces (≈1M businesses) processing payments through fintech rails like Payku.
- **Pain point**: consistent monthly cash flow with zero access to DeFi credit because no on-chain reputation exists.
- **Initial wedge**: 100 PyME pilot via Payku partnership (Tranche 3).
- **Expansion**: Latam-wide via Prometeo integration post-grant.

### Go-to-market plan

Phased commercial milestones tied to tranches:
- **Tranche 1**: Working sandbox demo, public testnet contract, LOI from Payku.
- **Tranche 2**: First 5-10 design partners onboarded to testnet vault.
- **Tranche 3**: 100 pilot PyMEs on mainnet with measurable origination volume and at least one LP partner (DeFi protocol or DAO treasury).

Full business plan in `docs/BUSINESS_PLAN.md`.

---

## Feedback Item 5 — Missing Validation Section

**Reviewer concern:** *"The deliverables are missing a validation section. Reviewers need a clear method to test, view, or verify the completion of each milestone."*

**What changed:**

Every tranche document now includes an explicit, executable validation section. A reviewer with `cargo`, `npm`, and a Freighter wallet can verify each tranche in under 15 minutes by running a single command:

```bash
# Tranche 1 validation (MVP)
npm run validate-t1
# Output: { contract_id: "CATE7NU...", tests_passed: 30, sandbox_data: {...}, mint_tx_hash: "..." }

# Tranche 2 validation (Testnet)
npm run validate-t2
# Output: { deposit_tx, borrow_tx, repay_tx, liquidate_tx, slash_verified: true }

# Tranche 3 validation (Mainnet)
npm run validate-t3
# Output: { mainnet_contract_id, sdk_npm_version, pilot_user_count, first_origination_tx }
```

The validation scripts are part of the deliverables themselves — they ship in `web/package.json` and produce structured JSON that the reviewer can paste as evidence of tranche completion. This is the same pattern SCF reviewers use when verifying milestone payments.

Detailed acceptance criteria for each deliverable are in the respective `TRANCHE_*_DELIVERABLES.md` documents.

---

## Feedback Item 6 — Future Submission Recommendations

**Reviewer recommendation:** *"A future submission should include a clearer business plan, restructured budget per SCF guidelines, evidence of protocol integration feasibility (especially with Blend), and a more detailed team profile."*

**What we did:**

- **Business plan**: `docs/BUSINESS_PLAN.md` with target segment, market sizing, competitive analysis, pricing, and 12-month go-to-market.
- **Budget**: restructured to 10/20/30/40 across 3 tranches per SCF handbook (Feedback Item 2 above).
- **Protocol integration feasibility**: removed Blend dependency entirely; the `reference-vault` contract in Tranche 2 demonstrates credit-gated lending on Soroban without requiring third-party protocol cooperation (Feedback Item 3 above).
- **Team profile**: `docs/TEAM.md` documents all three team members with role, experience, and verification path.

---

## Additional Required Disclosures

### AI Assistance Disclosure (Open Track Requirement)

Per SCF Open Track requirements, full disclosure of AI tool use is documented in `docs/AI_DISCLOSURE.md`. Summary:

- Anthropic Claude was used as a collaborative coding and documentation assistant during development.
- All design decisions, security-relevant code, and final implementations were author-reviewed and validated.
- AI-assisted artifacts include: doc drafting, code refactoring, test scaffolding, and prototype iteration.
- Hand-written work includes: architectural decisions, business plan reasoning, partnership negotiations, all final commit signatures.

### Open Source Plan

The entire repository is published under the MIT License (`LICENSE`). The Soroban contracts (`contracts/vigente-badge/`, `contracts/reference-vault/`, `contracts/mock-usdc/`) and the TypeScript SDK delivered in Tranche 3 will remain open source under MIT in perpetuity. Any third-party protocol can integrate Vigente's `is_defaulted()` and `get_score()` queries without permission.

### Previous SDF Funding

Vigente Protocol has not received prior SCF, Enterprise Fund, Matching Fund, or other SDF awards. There are no outstanding obligations from prior grants.

---

## State of the Repository at Submission Time

To prevent any ambiguity between "what is built" and "what is the deliverable being funded":

### Currently shipped and verifiable (pre-submission)

| Artifact | Location | Verification |
|----------|----------|--------------|
| Vigente v1 contract (legacy `VigenteProtocol`) | `contracts/src/lib.rs` | Deployed at `CATE7NUICQNBSUKF3RMA2HQAJK2RWCHCYH4NCPTQDLFNWNUNSFTTUH4W` on testnet; historical reference, no longer the active path. |
| **`vigente-badge` v3** (current, threshold + age floor) | `contracts/vigente-badge/src/lib.rs` | **41 unit tests + 5 smoke tests pass**. Deployed at `CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD`. Live positive mint: tx `8b9fccfc…`. |
| `reference-vault` contract (Phase B' hardened) | `contracts/reference-vault/src/lib.rs` | 23 integration tests pass — full lifecycle, default cascade, credit ladder, TVL cap, utilization cap, LP withdrawal timelock. |
| `mock-usdc` SEP-41 token | `contracts/mock-usdc/src/lib.rs` | 5 tests pass; replaced by Stellar USDC SAC on mainnet (Tranche 3). |
| **Off-chain threshold oracle simulator** | `web/src/services/threshold-oracle.ts` | 9 unit tests + 2 XDR parity tests. Cross-language byte-for-byte parity with Rust contract validated empirically. |
| **Synthetic scoring engine** (no fintech dependency) | `web/src/services/horizon-scoring.ts` | 17 tests covering tier bands, P2P penalty, ecosystem whitelist, density CV, reciprocity, account-age cap. |
| **/v3 threshold demo UI** | `web/src/app/v3/page.tsx`, `web/src/app/api/mint-v3/route.ts` | End-to-end mint via the browser; relay endpoint validated with tx `3f498e54…`. |
| Payku oracle adapter (optional) | `web/src/services/payku-client.ts`, `payku-oracle.ts` | Preserved as an enrichment adapter; not on the critical path. |
| Threat model | `docs/THREAT_MODEL.md` | STRIDE-style analysis with code + test references for 6 vectors. |
| Architecture documentation | `docs/ARCHITECTURE.md` | Complete pre-submission per SCF criteria |
| Business plan | `docs/BUSINESS_PLAN.md` | Market analysis, GTM, competitive positioning |

**Test count at submission:** 104 green tests across the matrix (41 badge + 5 smoke + 23 vault + 5 mock-usdc + 30 web).

### To be delivered through the grant

Everything in `docs/TRANCHE_1_DELIVERABLES.md` (production-grade MVP), `docs/TRANCHE_2_DELIVERABLES.md` (reference vault + testnet expansion), and `docs/TRANCHE_3_DELIVERABLES.md` (mainnet launch + SDK + pilot).

We are not asking the grant to fund work that is already done. We are asking the grant to fund the production hardening, the reference vault integration, the mainnet deployment, and the commercial pilot.

---

## Threat Model & Risk Mitigation

In direct response to the *"underspecified components"* feedback, we have written `docs/THREAT_MODEL.md` — a STRIDE-style analysis of six attack vectors (carousel/wash trading, Sybil farms, long-con default, vault drainage, centralized-oracle compromise, LP bank run). For each vector the document gives:

- the attack story,
- the exact mitigation in code (file + function name),
- the tests or live testnet transactions that prove it works,
- the boundary of what we deliberately do not try to mitigate (validator collapse, compromised wallets, etc.).

Five of the six vectors have shipped mitigations in code as of this submission. The sixth (mint-fee escrow) is documented as deferred to a post-grant deliverable rather than promised as part of Tranche 1.

## Closing

The reviewers' feedback on the prior submission was correct in every detail. We did not pivot to avoid the criticism — we pivoted because the criticism exposed real weaknesses that would have surfaced in production. This resubmission is shorter, more concrete, and more verifiable than the previous one.

The repository at `https://github.com/zzzbedream/VIGENTE-PROJECT` is public. The code, tests, and contracts can be inspected directly. The team can be reached for clarification or live demo at any point in the review process.
