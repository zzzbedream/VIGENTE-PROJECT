# AI Assistance Disclosure

> Required by SCF Open Track: *"Full-disclosure on the use of AI-generated and AI-assisted artifacts (docs, code, etc.)."*

This document provides a complete and honest accounting of AI tool usage in the development of Vigente Protocol. Transparency on this topic is non-negotiable for our submission.

> **Scope note (updated 2026-08-16).** Sections 1–6 below were written on 2026-05-24 and describe
> the project as it stood then. Between May and August 2026 the project pivoted and the volume of
> AI-assisted work **increased substantially**. Rather than silently restate the old percentages,
> §8 records what changed. Read §8 alongside §5 — §5 alone understates current AI involvement.

---

## 1. AI Tools Used

| Tool | Vendor | Use cases |
|------|--------|-----------|
| Claude (Sonnet, Opus) | Anthropic | Code review, doc drafting, refactoring assistance, test scaffolding, debugging |
| GitHub Copilot | GitHub/OpenAI | Inline code completion during pair-programming sessions |

No other AI services were used in code generation or documentation drafting.

---

## 2. What AI Assisted With

### 2.1 Documentation (high AI involvement)

The following documentation was drafted with significant Claude assistance:

- `README.md` — initial outlines and section drafting
- `RESUBMISSION_FEEDBACK.md` — structure and prose *(since superseded and moved out of the public tree)*
- `TRANCHE_1_DELIVERABLES.md`, `TRANCHE_2_DELIVERABLES.md`, `TRANCHE_3_DELIVERABLES.md` *(superseded by the current submission; moved out of the public tree)*
- `docs/ARCHITECTURE.md` — diagrams and prose
- `BUSINESS_PLAN.md` *(pre-pivot; moved out of the public tree)*
- This document (`AI_DISCLOSURE.md`)

**Author review for documentation:** every claim, number, timeline, and verification step in these documents was reviewed by the Founder against the codebase. AI-drafted claims that could not be verified were either corrected or removed before commit.

### 2.2 Code (moderate AI involvement)

Specific code areas where Claude or Copilot contributed substantially:

| Area | Files | AI contribution |
|------|-------|----------------|
| Payku adapter pattern | `web/src/services/payku-client.ts`, `payku-oracle.ts`, `payku-payout.ts` | Adapter structure, HMAC signing logic, retry/timeout patterns. Tests written manually. |
| Scoring engine | `web/src/services/scoring-engine.ts` | Algorithm structure proposed by AI, weight tuning done manually based on test data. |
| API routes | `web/src/app/api/*/route.ts` | Boilerplate and error handling patterns. Business logic reviewed. |
| Frontend page logic | `web/src/app/page.tsx` | UI scaffolding and state management. UX decisions made manually. |
| Test scaffolding | `contracts/vigente-badge/src/test.rs` | Test structure and edge case identification. Each test assertion verified manually. |

### 2.3 Code (low/no AI involvement)

Areas where AI was NOT a significant contributor:

- Core Soroban contract logic (`contracts/vigente-badge/src/lib.rs`, `contracts/src/lib.rs`) — written by Founder with reference to Soroban docs and examples. AI used only for refactoring suggestions.
- Cryptographic primitives (HMAC, SHA-256 hash calculations) — copied from well-known patterns, AI usage limited to syntax assistance.
- Architectural decisions — made by Founder. AI provided alternatives and tradeoff analysis when asked.
- Business plan reasoning — Founder + Commercial Lead. AI helped with phrasing and market data formatting only.
- Partnership negotiations and LOI drafts — Founder and Commercial Lead directly. AI not involved in commercial conversations.
- Git commits, deployments, and live transactions — all human-executed.

---

## 3. Author Review Process

All AI-assisted artifacts went through one of three review levels:

| Review level | Description | Applied to |
|--------------|-------------|------------|
| Line-by-line | Every line read and validated against the codebase or external sources | Critical contracts, security-relevant code, claims that affect SCF reviewers |
| Functional | Code runs as intended; behavior verified via tests or manual execution | Adapter code, UI components, build configuration |
| Editorial | Prose reviewed for accuracy and tone; specific facts cross-checked | Documentation, marketing copy |

The Founder is accountable for every commit signed under `zzzbedream`. AI-assisted does not mean AI-validated — every PR or commit reflects human review and decision-making.

---

## 4. AI Was Not Used For

To prevent any ambiguity, AI was explicitly **not** used for:

- Forging or fabricating any partnership, integration, or metric
- Generating fake commit history or fake activity
- Producing audit reports (no audit has occurred yet; audit funded separately via SCF Audit Bank pathway)
- Synthesizing identity verification or KYC data
- Authoring legal documents (LICENSE is a standard MIT text, not AI-generated)

---

## 5. Approximate Breakdown by Volume

Rough estimate for the SCF reviewer's situational awareness:

| Artifact type | AI-assisted % | Human-only % |
|---------------|--------------|--------------|
| Documentation (markdown in `docs/`, `README.md`) | ~70% drafted by AI, 100% reviewed/edited by author | ~30% original author writing |
| TypeScript code (`web/`) | ~50% scaffolding and patterns from AI | ~50% business logic and integration written by hand |
| Rust contracts (`contracts/`) | ~20% syntax assistance | ~80% original implementation by author |
| Test code | ~40% scaffolding, ~60% manual assertion writing | — |
| Configuration (env, package.json, Cargo.toml) | ~30% AI suggestions | ~70% manual |
| Commercial work (LOIs, partnership messaging) | 0% AI | 100% human |

These percentages are estimates based on the team's recollection. The codebase commit history is the authoritative source.

---

## 6. Why We Disclose This

The SCF Open Track explicitly requires AI disclosure because:

1. Reviewers need to know what kind of work is being evaluated (original engineering vs. AI orchestration).
2. Future grant rounds may have different policies on AI-assisted work.
3. The crypto / fintech industry is grappling with AI's role in protocol development, and transparency helps the community establish norms.

We believe that AI-assisted development is legitimate and increasingly normal. We also believe that hiding it would be dishonest. This document is our attempt to give SCF reviewers full information to evaluate Vigente on the merits of the actual work.

---

## 7. Questions

If the SCF reviewer wants more detail on AI involvement in any specific file or commit, the Founder is available for a live walkthrough of the development process. Pairing sessions can be recorded and shared if useful.

---

## 8. Amendment — May to August 2026

The original disclosure predates the pivot from "credit-signal oracle" to non-custodial
collateralized credit. In that period AI assistance (Claude, via Claude Code) went from
*drafting help* to a substantially larger share of the work. Stating it plainly:

**Documentation — higher than the ~70% in §5.** Drafted with heavy AI assistance:
`audit/07_OWN_POOL_EVIDENCE.md`, `audit/08_POOL_ACTIVATION.md`, `audit/09_RAMP_CONNECTIVITY.md`,
the current `README.md`, `docs/ARQUITECTURA_INTERNA.md`, the tranche deliverables in their present
form, and the landing copy in `web/src/app/landing/copy.ts`.

**Code — comparable to or above the ~50% in §5.** AI-assisted work includes the non-custodial
hardening of `contracts/margin-controller` (pause semantics, LTV floor, grace window, two-step
admin), the `oracle-aggregator`, and the operational scripts used to activate the pool.

**Operations.** Deployments, contract initialisation and every on-chain transaction were executed
against live testnet with AI assistance in composing the commands. The transactions themselves are
real and their hashes are published; a human authorised each one.

**What did not change.** The review discipline in §3 still applies, and the working rule tightened:
*no claim ships without an on-chain read with its command cited, code with file:line, or command
output.* That rule exists because AI-drafted claims in this repository were found to be wrong more
than once — an inflated backstop threshold, a miscounted contributor distribution, an
unsigned LOI described as signed, and a false account of a partner exchange. Each was corrected in
git history. **The rule is the mitigation; §4 still holds — nothing was fabricated to look better.**

**Estimating honestly.** We are not restating §5's percentages with invented precision. The
directional statement is what we can defend: **AI involvement in this repository is high and has
grown**, the author remains accountable for every commit, and the commit history is the
authoritative record.

---

*Document Version: 1.1.0*
*Originally written: 2026-05-24 · Amended: 2026-08-16 (§8, scope note)*
*Author accountable: Founder (zzzbedream)*
