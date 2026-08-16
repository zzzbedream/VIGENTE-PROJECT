# Tranche 3 — Mainnet Launch: Production Deployment, SDK & First Pilot

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
**Payment:** 40% of total grant = **$24,000 USD**
**Timeline:** 10 weeks (follows Tranche 2)
**Lead:** Founder + Full-stack Engineer + Commercial Lead

---

## 1. Phase Objective

Tranche 3 is **mainnet launch**: deploying `vigente-badge` and `reference-vault` to Stellar Mainnet with production-grade hardening, publishing a public TypeScript SDK so any protocol can integrate Vigente in minutes, and onboarding the first cohort of real Chilean PyMEs through the Payku partnership.

Per SCF Build guidelines, Tranche 3 is the mainnet milestone. Vigente becomes a live, callable protocol on Stellar Mainnet by the end of this tranche.

---

## 2. Deliverables

### 2.1 Mainnet Deployment of Vigente Contracts

**Deployment order:**

1. `mock-usdc` is **not deployed** to mainnet (replaced by real Stellar USDC Stellar Asset Contract).
2. `vigente-badge` deployed to mainnet with production parameters:
   - Multi-signature admin (3-of-5 keys, see 2.2)
   - Hardened oracle ACL with at least 2 authorized oracles
   - Circuit breaker (pause/unpause) tested in pre-launch dry run
3. `reference-vault` deployed to mainnet:
   - Initialized with real USDC SAC address
   - Interest rate confirmed via governance (initially 5% / 500 bps)
   - Vault address added to badge contract's `AuthVaults` list

**Verification:**
- Both mainnet contract IDs published in `README.md`.
- `stellar contract invoke --network mainnet --id <BADGE_ID> -- get_admin` returns the multi-sig admin address.
- First test mint executed by an internal test borrower; visible on mainnet stellar.expert.

### 2.2 Multi-Signature Admin Security

**Implementation:** the admin role transitions from a single keypair to a 3-of-5 Soroban multi-sig:

- Keys held by: Founder, Full-stack Engineer, Commercial Lead, and 2 external advisors (post-hire via grant).
- All admin operations (`add_oracle`, `add_vault`, `pause`, `unpause`) require 3 signatures.
- Key rotation procedure documented in `docs/MAINNET_OPERATIONS.md`.

**Verification:** an admin operation attempt with 2 signatures must fail. With 3 signatures must succeed. Documented in mainnet runbook.

### 2.3 Public TypeScript SDK

**Location:** `packages/vigente-sdk/` published to npm as `@vigente/sdk`.

**Surface:**

```typescript
import { VigenteClient } from '@vigente/sdk';

const client = new VigenteClient({ network: 'mainnet', rpc: '...' });

// Read-only (no auth)
const isDefaulted = await client.isDefaulted(borrowerAddress);
const score = await client.getScore(borrowerAddress);
const badge = await client.getBadge(borrowerAddress);

// Authorized writes (require vault to be in AuthVaults)
const slashTx = await client.slash({ vault, borrower, reason: 'non_payment' });
```

Includes:
- TypeScript type definitions for all contract structs
- Auto-retry with exponential backoff
- Network-aware (testnet / mainnet switching)
- Vitest test suite with mocked Soroban RPC responses
- Examples directory with end-to-end snippets

**Verification:** `npm install @vigente/sdk && npx tsc --noEmit examples/check-borrower.ts` compiles and runs against mainnet without errors.

### 2.4 Documentation Site

**Location:** `docs-site/` (mkdocs or Docusaurus) published to `docs.vigenteprotocol.com`.

Contents:
- Quickstart for protocols (5-minute integration guide)
- Full contract reference (auto-generated from Soroban contract definitions)
- SDK API reference
- Architectural overview (mirrors `docs/ARCHITECTURE.md`)
- Mainnet operations runbook (incident response, key rotation, pause procedure)

### 2.5 First Commercial Pilot — 100 Chilean PyMEs

**Lead:** Commercial Lead (Mauricio Urra), supported by Payku partnership.

**Targets:**
- 100 active PyMEs onboarded to Vigente mainnet
- ≥30 of them complete a borrow → repay cycle in the reference vault
- ≥1 LP partner (DeFi protocol, DAO treasury, or impact investor) provides $50K+ USDC liquidity
- Aggregate origination volume documented and published as a public metrics dashboard

**Letter of Intent collection:**
- Payku formal LOI signed (initiated Tranche 1, finalized by Tranche 2)
- Pilot user LOIs from at least 3 microcommerces willing to be referenced publicly
- LP partner LOI

Letters stored in `docs/letters/` as PDF attachments to the submission.

### 2.6 Monitoring & Observability

**Stack:**
- Mercury indexer subscribed to all `vigente-badge` and `reference-vault` events
- Public Grafana dashboard at `metrics.vigenteprotocol.com` showing: total badges, defaults, originations, repayments, pool utilization
- Alerts: pause-trigger conditions, abnormal slash velocity, oracle unavailability

### 2.7 Validation Script

**Location:** `web/package.json` script `validate-t3`

```bash
cd web && npm run validate-t3
```

**Output:**

```json
{
  "tranche": 3,
  "status": "complete",
  "mainnet": {
    "vigente_badge": "C...",
    "reference_vault": "C...",
    "admin_is_multisig": true,
    "first_mint_tx": "..."
  },
  "sdk": {
    "npm_version": "1.0.0",
    "npm_package": "@vigente/sdk",
    "weekly_downloads": 123
  },
  "pilot": {
    "active_users": 102,
    "originations_total_usdc": 285000,
    "default_rate_percent": 2.1,
    "lp_partners_count": 1
  },
  "docs_site": "https://docs.vigenteprotocol.com",
  "monitoring": "https://metrics.vigenteprotocol.com"
}
```

---

## 3. Budget Breakdown

| Item | Hours | Rate | Cost |
|------|-------|------|------|
| Mainnet deployment + dry-run (15h × Founder) | 15h | $80 | $1,200 |
| Multi-sig admin implementation + key ceremony (25h × Founder) | 25h | $80 | $2,000 |
| Hardening: monitoring, alerting (30h × Founder) | 30h | $80 | $2,400 |
| TypeScript SDK design + implementation (50h × Full-stack) | 50h | $70 | $3,500 |
| SDK tests + examples + npm publish pipeline (25h × Full-stack) | 25h | $70 | $1,750 |
| Documentation site build + content (40h × Full-stack) | 40h | $70 | $2,800 |
| Mercury indexer integration + Grafana dashboards (30h × Founder) | 30h | $80 | $2,400 |
| Commercial pilot onboarding support (40h × Commercial Lead) | 40h | $60 | $2,400 |
| Pilot user training material + Spanish docs (30h × Full-stack) | 30h | $70 | $2,100 |
| Incident response runbook + on-call setup (15h × Founder) | 15h | $80 | $1,200 |
| Reviewer demo + final walkthrough video (15h × Full-stack) | 15h | $70 | $1,050 |
| Buffer (5%) | — | — | $1,200 |
| **Total** | 315h | — | **$24,000** |

All costs are development and commercial-launch labor. No marketing spend, no audit fees (separate SCF Audit Bank pathway), no legal/entity formation per SCF budget guidelines.

---

## 4. Verification Method for SCF Reviewer

```bash
# 1. Verify mainnet contracts
stellar contract invoke --network mainnet --id <BADGE_CONTRACT_ID> -- get_admin
# Expected: returns the multi-sig admin address

stellar contract invoke --network mainnet --id <VAULT_CONTRACT_ID> -- get_total_deposits
# Expected: returns a non-zero number (LPs have supplied liquidity)

# 2. Install and use the SDK
npm install @vigente/sdk
npx tsc --noEmit examples/check-borrower.ts
# Expected: compiles + runs against mainnet

# 3. Visit documentation site
# Open https://docs.vigenteprotocol.com
# Verify quickstart guide is 5 minutes or less

# 4. Run final validation
cd web && npm run validate-t3
# Expected: JSON output with all fields populated

# 5. Review LOIs
ls docs/letters/
# Expected: payku-loi.pdf + at least 3 pilot-user-loi-*.pdf
```

---

## 5. Critical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Mainnet bug discovered post-launch | Critical | Circuit breaker (`pause()`) tested in dry-run; incident response runbook ready; reserved 24h for pause + investigate + unpause cycle. |
| Pilot user count below 100 | Medium | Commercial Lead engages Payku for warm intros to 200+ candidates; conversion rate target 50%. |
| LP partner doesn't materialize | Medium | Vigente team commits $5K from grant buffer + founder personal funds as bootstrap liquidity to demonstrate model viability. |
| SDK adopted by zero external protocols | Medium | SDK is open source; success criterion is publication and example documentation, not adoption (out of grant scope). |
| Audit cost not in grant | Acknowledged | Per SCF guidelines, audit is funded separately via Audit Bank pathway. Application submitted at start of Tranche 3. |

---

## 6. Acceptance Criteria Summary

| # | Deliverable | Verification |
|---|-------------|--------------|
| D1 | `vigente-badge` mainnet deployment with multi-sig admin | `get_admin()` returns multi-sig address |
| D2 | `reference-vault` mainnet deployment with real USDC | `get_total_deposits()` non-zero |
| D3 | `@vigente/sdk` published to npm | `npm view @vigente/sdk` shows v1.0.0+ |
| D4 | `docs.vigenteprotocol.com` live | 5-minute quickstart verified |
| D5 | 100 pilot users onboarded | Mercury indexer shows ≥100 distinct mint events |
| D6 | ≥1 LP partner with $50K+ deposit | Visible in vault `TotalDeposits` |
| D7 | LOIs collected and published | `docs/letters/` contains signed PDFs |
| D8 | Public monitoring dashboard | `metrics.vigenteprotocol.com` accessible |
| D9 | `npm run validate-t3` returns JSON | Single command, exit 0 |

---

## 7. Post-Grant Path

Tranche 3 closes the SCF Build Award commitment. Post-grant, Vigente continues with:

- Audit funded via SCF Audit Bank or alternative provider
- Prometeo integration for Latam expansion (Argentina, Colombia, Mexico, Peru)
- Multi-notary TLSNotary architecture (the "ultimate decentralization" path documented in `docs/ARCHITECTURE.md`)
- Opt-in lending-protocol integrations when they choose to read an external credit oracle on-chain (immutable price-oracle markets consume the score off-chain via the attestation API)
- Revenue model: 1% origination fee + LP yield share, retained for protocol sustainability

These are explicitly **not** Tranche 3 deliverables. They are the bridge from "grant-funded MVP" to "self-sustaining protocol".

---

*Document Version: 2.0.0 (SCF-aligned)*
*Predecessor: [Tranche 2 — Testnet Expansion](./TRANCHE_2_DELIVERABLES.md)*
*Successor: Post-grant operations*
