# Tranche 1 — MVP: Threshold-Signed Badge Contract & Synthetic Scoring

> ## Presupuesto superseded — ver `docs/private/scf-45/SUBMISSION_FORM.md` §8
>
> Las cifras de este archivo corresponden al plan de **$60.000** y a un alcance de 6 meses.
> La postulación vigente pide **$80.000 sobre ~4 meses**, con una estructura distinta: la línea
> de Commercial Lead desaparece (operaciones se financian fuera del award) y entra la
> contratación de un ingeniero Soroban senior.
>
> **Los entregables y sus criterios de verificación vigentes están en el formulario.** Este
> archivo se conserva como traza del plan anterior.


**Project:** Vigente Protocol
**Track:** Stellar Community Fund — Open Track / Build Award
**Payment:** 20% of total grant = **$12,000 USD**
**Timeline:** 6 weeks from award acceptance
**Lead:** Founder + Full-stack Engineer

> **Pre-submission update.** Between the original rejection and this
> resubmission we shipped the bulk of what was scheduled for Tranche 1
> (and several Tranche 3 items) ahead of time. Sections below are
> marked **✅ shipped** where the work is already in the repo and on
> testnet, and **scheduled** where the grant payment funds the remaining
> production hardening. The scope of the grant is not reduced — it is
> tightened to the production work that genuinely needs paid effort
> rather than a 6-week pre-build of code that already exists.

---

## 1. Phase Objective

Tranche 1 ships the **Minimum Viable Product**: a production-grade Soulbound credit badge contract on Stellar testnet, paired with a working Payku oracle adapter and an end-to-end user flow that mints a badge from real Chilean merchant data.

Per SCF Build guidelines, Tranche 1 is **shippable product**, not architecture, research, or planning. The architectural design is complete pre-submission (`docs/ARCHITECTURE.md`) and not a deliverable here.

---

## 2. Deliverables

### 2.1 `vigente-badge` Soroban Contract — Production Hardening

**Location:** `contracts/vigente-badge/`

**Status at submission time:** ✅ **Shipped pre-submission.** k-of-n threshold ed25519 verification on-chain, anti-replay nonce, configurable wallet-age floor (default 30 days), 41 unit tests + 5 smoke tests. Deployed to testnet as v3 at `CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD`. End-to-end mint validated with tx `8b9fccfc…`.

**Tranche 1 work (post-funding) — remaining production hardening:**

1. ✅ ~~**Multi-oracle authorization**~~ — *Shipped.* `set_oracle_keys` atomically replaces the entire pubkey set with `0 < threshold <= keys.len()` invariants enforced in a single transaction. Atomic replacement was chosen over add/remove to prevent the bricked-contract failure mode.
2. **Slash reason taxonomy expansion** — currently 4 reason codes. Expand to 8 categories aligned with credit reporting standards: payment_delinquency, technical_default, fraud_confirmed, identity_dispute, regulatory_freeze, collateral_shortfall, voluntary_termination, unspecified.
3. **Storage TTL refresh helper** — admin-callable function to extend TTL on badges and default records nearing expiry.
4. **Event indexing schema** — document event topics + payloads for Mercury/SubQuery indexers. Publish JSON schema for downstream consumers.
5. **Mint fee escrow with refund on first repay** — anti-Sybil economic disincentive paired with the existing 30-day age floor. Documented in `docs/THREAT_MODEL.md` § 2 as deliberately deferred pending the grant.

**Deliverable acceptance:**
- `cargo test --package vigente-badge` → ≥41 tests pass *(currently 41 + 5 smoke = 46)*.
- `cargo tarpaulin --package vigente-badge` → line coverage > 90%.
- Testnet contract responds to `get_admin()`, `is_defaulted()`, `get_score()`, `get_oracle_keys()`, `get_oracle_threshold()`, `get_min_wallet_age()`.
- Contract ID published in `README.md` and `web/.env.local`.
- `npm run validate-t1` returns `status: "complete"` with the threshold demo block all-green.

### 2.2 Off-Chain Threshold Oracle Simulator (Phase B.6)

**Location:** `web/src/services/threshold-oracle.ts`, `web/src/app/api/oracle/sign-threshold/route.ts`

**Status:** ✅ **Shipped pre-submission.** Five ed25519 keypairs persisted via `VIGENTE_ORACLE_SEEDS_HEX`, deterministic across process restarts. `signMint(borrower, score, expiration, accountAgeDays, nonce)` produces k=3 signatures over the canonical 92-byte message. Cross-language XDR parity with the Rust contract validated by 2 dedicated tests + the live mint on testnet.

**Tranche 1 work (post-funding):**

1. **Operational deployment of multiple independent oracle nodes** — separate the simulator pubkeys into N distinct processes / hosts so a single host compromise does not threaten the k threshold. Document the rotation procedure.
2. **Monitoring** — oracle latency, sign-rate, refusal rate (badge requests below the age floor), and disagreement rate between nodes.

### 2.3 Synthetic Scoring Engine (no fintech dependency)

**Location:** `web/src/services/horizon-scoring.ts`, `web/src/services/ecosystem-whitelist.ts`, `web/src/services/scoring-engine.ts`

**Status:** ✅ **Shipped pre-submission.** Reverse-paginated Horizon read with 180-day / 200-op cap, ecosystem-counterparty whitelist with 70% P2P penalty, classified V/F/C tier output. 17 unit tests cover tier bands, P2P penalty, ecosystem ratio, density CV, reciprocity, and the age cap.

**Tranche 1 work (post-funding):**

1. Persist the score JSON in Redis (currently in-memory Map) so the 5-minute TTL survives across Vercel function invocations.
2. Extend the whitelist seed to ~25 verified ecosystem addresses (anchors, AMM routers, lending pools on mainnet).

### 2.4 Payku Oracle Adapter (preserved as optional enrichment)

**Location:** `web/src/services/payku-client.ts`, `payku-oracle.ts`, `payku-payout.ts`

**Status at submission time:** HTTP client with HMAC signing, retry, timeout, fallback. Adapter pattern that transforms Payku conciliation data into scoring inputs.

**Tranche 1 work (post-funding):**

1. **Live Payku Sandbox credentials provisioned** — formal LOI with Payku finalized; sandbox keys configured in deployment environment.
2. **Conciliation 6-month chunked retrieval hardened** — currently iterates 30-day windows. Add resume-from-last-chunk for partial failures.
3. **Score signature library** — extract the HMAC scoring signature into a reusable module that the badge contract's `mint()` will eventually verify (post-Tranche 1, when multi-sig oracle ACL lands).
4. **Monitoring** — instrument Payku call latency, error rate, and fallback frequency. Output to console + structured log file.

**Deliverable acceptance:**
- `GET /api/oracle/score?rut=<test_rut>` returns JSON with `dataSource: "payku_sandbox_real"` (not fallback) for ≥1 test RUT.
- `GET /api/evaluate-and-fund?rut=<test_rut>` completes all 4 steps (oracle → score → mint → payout) without errors.
- Log file shows successful Payku API calls with latency metrics.

### 2.3 Frontend End-to-End Flow

**Location:** `web/`

**Status at submission time:** Next.js 16 app live at https://vigente-hackathon-final.vercel.app with RUT input, score visualization, mint button via Freighter.

**Tranche 1 work (post-funding):**

1. **Error path UX** — clear messages for: account not funded, Freighter not installed, network mismatch, Payku unreachable.
2. **Transaction confirmation flow** — polling status with progress indicator; link to stellar.expert on success.
3. **Mobile responsive pass** — current UI is desktop-first; ensure mint flow works on iOS Safari and Android Chrome.
4. **Telemetry** — track funnel metrics (visits → connect wallet → enter RUT → score generated → mint completed) for product validation.

**Deliverable acceptance:**
- Reviewer following `README.md` testing guide completes mint on testnet in under 5 minutes.
- Three different test RUTs (Gold, Silver, fail) produce expected score tiers.
- Mint tx hash links to stellar.expert and the badge is visible via `get_score()` invocation.

### 2.4 Validation Script

**Location:** `web/package.json` script `validate-t1`

A single command for SCF reviewers to verify Tranche 1 completion:

```bash
cd web && npm run validate-t1
```

**Output (structured JSON):**

```json
{
  "tranche": 1,
  "status": "complete",
  "vigente_badge": {
    "contract_id": "C...",
    "tests_passed": 40,
    "coverage_percent": 92.5,
    "testnet_admin": "G..."
  },
  "payku_oracle": {
    "data_source": "payku_sandbox_real",
    "sample_score": 875,
    "api_latency_ms": 432
  },
  "frontend": {
    "live_url": "https://...",
    "test_rut_mint_tx": "abc123..."
  },
  "timestamp": "2026-..."
}
```

---

## 3. Budget Breakdown

| Item | Hours | Rate | Cost |
|------|-------|------|------|
| `vigente-badge` production hardening (40h × Founder) | 40h | $80 | $3,200 |
| Payku adapter operability + Live integration (30h × Full-stack) | 30h | $70 | $2,100 |
| Frontend UX hardening + telemetry (40h × Full-stack) | 40h | $70 | $2,800 |
| Validation scripts + CI (15h × Founder) | 15h | $80 | $1,200 |
| Testnet deployment + smoke testing (10h × Founder) | 10h | $80 | $800 |
| QA + reviewer-walkthrough recording (20h × Full-stack) | 20h | $70 | $1,400 |
| Buffer (10%) | — | — | $500 |
| **Total** | 155h | — | **$12,000** |

Rates are local Chilean market for senior Soroban / full-stack engineers (≈$70-80/hr USD). All costs are development labor — no marketing, no audit, no operational overhead per SCF budget guidelines.

---

## 4. Verification Method for SCF Reviewer

Each item below should complete in under 15 minutes:

```bash
# 1. Clone and verify repository structure
git clone https://github.com/zzzbedream/VIGENTE-PROJECT.git
cd VIGENTE-PROJECT
ls contracts/vigente-badge/src/lib.rs    # must exist
ls web/src/services/payku-client.ts      # must exist

# 2. Run contract tests
cd contracts/vigente-badge
cargo test
# Expected: test result: ok. 40+ passed

# 3. Run validation script
cd ../../web
npm install
npm run validate-t1
# Expected: JSON output above with all fields populated

# 4. Manual mint flow on live testnet
# Open https://vigente-hackathon-final.vercel.app
# Connect Freighter (testnet), enter RUT 20.244.452-1, mint badge
# Confirm tx hash on stellar.expert
```

---

## 5. Dependencies & Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Payku does not deliver live sandbox credentials | Medium | Medium | Hybrid fallback to mock data already in code; demo works without credentials. LOI process documented in `docs/letters/`. |
| Soroban SDK breaking change | Low | High | Pin SDK version; CI runs against latest preview to catch issues early. |
| Freighter API changes | Low | Medium | Wallet integration isolated in `web/src/services/mint-service.ts`; swap library if needed. |
| Testnet reset or congestion | Low | Low | Deployment scripts in `contracts/scripts/` enable rapid re-deploy. |

---

## 6. Acceptance Criteria Summary

| # | Deliverable | Verification |
|---|-------------|--------------|
| D1 | `vigente-badge` 40+ tests, >90% coverage, testnet deployed | `cargo test` + `cargo tarpaulin` + contract ID in `README.md` |
| D2 | Payku adapter with live sandbox credentials | `GET /api/oracle/score` returns `dataSource: "payku_sandbox_real"` |
| D3 | Frontend mint flow with error handling and telemetry | Reviewer completes mint in <5 min on testnet |
| D4 | `npm run validate-t1` returns structured JSON | Single command, exit 0, all fields populated |

---

## 7. Why This Is Tranche 1, Not Tranche 0

SCF explicitly requires Tranche 1 to be product development, not planning. This tranche is exclusively engineering work that ships verifiable code:

- No architectural research (architecture is pre-submission in `docs/ARCHITECTURE.md`)
- No proof-of-concept exploration (vigente-badge is already built and tested)
- No business validation (LOI process is separate, not a deliverable here)

What this tranche does ship: production hardening of code that already exists, with explicit acceptance criteria that a reviewer can verify.

---

*Document Version: 2.0.0 (SCF-aligned)*
*Previous version: 1.0.0 (4-tranche structure, deprecated)*
*Predecessor: pre-submission baseline*
*Successor: [Tranche 2 — Testnet Expansion](./TRANCHE_2_DELIVERABLES.md)*
