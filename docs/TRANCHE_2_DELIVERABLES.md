# Tranche 2 — Testnet Expansion: Reference Lending Vault & Cross-Contract Integration

**Project:** Vigente Protocol
**Track:** Stellar Community Fund — Open Track / Build Award
**Payment:** 30% of total grant = **$18,000 USD**
**Timeline:** 8 weeks (follows Tranche 1)
**Lead:** Founder + Full-stack Engineer

---

## 1. Phase Objective

Tranche 2 demonstrates the core thesis of Vigente: that on-chain credit reputation can gate undercollateralized lending end-to-end on Stellar. This phase ships a **reference lending vault** (Soroban contract) that performs cross-contract calls into `vigente-badge` to query credit eligibility and to enforce defaults via `slash()`.

The reference vault is intentionally minimal — not a production lending protocol. Its purpose is to prove the integration pattern works and to provide a working code example that production protocols (Blend, Lulo, others) can adopt when they choose to support external credit oracles.

---

## 2. Deliverables

### 2.1 `reference-vault` Soroban Contract

**Location:** `contracts/reference-vault/`

**Functions:**

| Function | Purpose | Cross-contract calls |
|----------|---------|---------------------|
| `initialize(admin, badge_contract, token_contract, rate_bps, duration)` | One-time setup | None |
| `deposit(depositor, amount)` | LP supplies USDC, receives proportional LP shares | `token.transfer(depositor → vault)` |
| `borrow(borrower, amount)` | Credit-gated loan origination | `badge.is_defaulted(borrower)`, `badge.get_score(borrower)`, `token.transfer(vault → borrower)` |
| `repay(borrower, amount)` | Full repayment of principal + interest | `token.transfer(borrower → vault)` |
| `liquidate(liquidator, borrower)` | Default enforcement after due date | `badge.slash(vault, borrower, 1)`, marks loan defaulted |

**Loan limit formula:**

```
available = total_deposits - total_borrowed
per_borrower_cap = available / 10           # max 10% pool concentration
max_loan = (per_borrower_cap * score) / 1000
```

Example: 100,000 USDC pool, borrower score 850 → max loan 8,500 USDC.

**Interest model:** fixed 5% (500 bps) for the reference implementation. Production protocols would implement utilization-based curves.

### 2.2 `mock-usdc` Token Contract

**Location:** `contracts/mock-usdc/`

SEP-41 compatible token for testnet liquidity. Pre-minted to test accounts. Identical interface to real USDC — swapping to Stellar USDC SAC in mainnet (Tranche 3) requires only an address change in initialization.

### 2.3 Cross-Contract Integration Tests

**Location:** `contracts/reference-vault/src/test.rs` (integration tests in `integration_test.rs`)

Test coverage target:
- 20+ unit tests for vault in isolation (deposit, borrow, repay, liquidate happy paths and rejections)
- 8+ integration tests deploying all three contracts (badge + vault + mock-usdc) in the same Soroban test environment

Critical integration scenarios:
1. Full lifecycle: oracle mints badge → LP deposits → borrower borrows → borrower repays. Badge intact.
2. Default lifecycle: oracle mints badge → borrower borrows → time advances past due → keeper liquidates → badge slashed → re-mint attempt fails.
3. Multi-user isolation: two borrowers, one defaults, the other completes loan. Default doesn't affect non-defaulting borrower.
4. Badge expiry mid-loan: borrower's badge expires before loan due date. Existing loan continues; new borrow attempts fail.

### 2.4 Frontend Vault UI

**Location:** `web/src/app/vault/` (new pages)

| Route | Purpose |
|-------|---------|
| `/vault` | Overview: pool size, utilization, user's LP position, active loan (if any) |
| `/vault/deposit` | Deposit USDC, view LP shares received |
| `/vault/borrow` | Calculate max loan from current badge score, execute borrow |
| `/vault/repay` | Show principal + interest, execute repay |

UI reuses existing Freighter integration from `web/src/contexts/WalletContext.tsx`. Implementation in `web/src/services/vault-service.ts`.

### 2.5 Fintoc Open Banking Adapter — Real HTTP Integration

**Location:** `integrations/fintoc-sandbox/`

**Status at submission time:** quickstart reads embedded JSON fixtures (`simulateFintocConnection`).

**Tranche 2 work:** replace fixture reads with real HTTP calls to `api.fintoc.com` using self-service sandbox credentials. The adapter produces the same `MovementData[]` interface, so the scoring engine doesn't change. This is the second data source that proves Vigente's adapter pattern is not Payku-locked.

### 2.6 Validation Script

**Location:** `web/package.json` script `validate-t2`

```bash
cd web && npm run validate-t2
```

**Output:**

```json
{
  "tranche": 2,
  "status": "complete",
  "contracts": {
    "vigente_badge": "C...",
    "reference_vault": "C...",
    "mock_usdc": "C..."
  },
  "lifecycle_test": {
    "mint_tx": "...",
    "deposit_tx": "...",
    "borrow_tx": "...",
    "repay_tx": "..."
  },
  "default_test": {
    "borrow_tx": "...",
    "liquidate_tx": "...",
    "slash_verified": true,
    "remint_blocked": true
  },
  "fintoc_real_call": {
    "endpoint": "api.fintoc.com",
    "status": 200,
    "movements_count": 47
  }
}
```

---

## 3. Budget Breakdown

| Item | Hours | Rate | Cost |
|------|-------|------|------|
| `reference-vault` contract (60h × Founder) | 60h | $80 | $4,800 |
| `mock-usdc` contract + tests (20h × Founder) | 20h | $80 | $1,600 |
| Integration tests + coverage (30h × Founder) | 30h | $80 | $2,400 |
| Vault testnet deployment + ACL setup (10h × Founder) | 10h | $80 | $800 |
| Frontend vault UI: 4 pages (60h × Full-stack) | 60h | $70 | $4,200 |
| `vault-service.ts` + Freighter integration (20h × Full-stack) | 20h | $70 | $1,400 |
| Fintoc real HTTP integration (15h × Full-stack) | 15h | $70 | $1,050 |
| Validation script + JSON schema (10h × Full-stack) | 10h | $70 | $700 |
| QA, video walkthrough, docs (15h × Full-stack) | 15h | $70 | $1,050 |
| **Total** | 240h | — | **$18,000** |

All costs are development labor per SCF guidelines.

---

## 4. Verification Method for SCF Reviewer

```bash
# 1. Run all tests
cd contracts
cargo test --workspace
# Expected: all tests pass across vigente-badge, reference-vault, mock-usdc

# 2. Run integration validation
cd ../web
npm run validate-t2
# Expected: JSON output with all 4 lifecycle tx hashes + slash verification

# 3. Manual end-to-end on testnet
# Open https://vigente-hackathon-final.vercel.app/vault
# Connect Freighter (testnet), funded account
# Flow: deposit 10,000 USDC → borrow 5,000 → repay 5,250
# Verify: pool utilization updated, badge still active

# 4. Default scenario verification
# Use admin account to advance ledger past due date
# Click "Liquidate" on overdue loan
# Verify: badge.is_defaulted(borrower) returns true
# Verify: subsequent borrow attempt panics with "borrower is in default"
```

---

## 5. Critical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Cross-contract call gas limits exceeded | High | Vault calls are simple CRUD; profile in tests. Keep critical path under 50K instructions. |
| Mock USDC behavior diverges from Stellar USDC | Medium | Use Soroban SDK token interface; test against `soroban-cli` SAC wrapper before Tranche 3 mainnet swap. |
| Liquidation triggers don't fire on Testnet (no keeper bots) | Low | UI exposes a "Liquidate" button for manual triggering; production would use Mercury indexer + keeper bot. |
| Frontend complexity for non-crypto users | Medium | Hide LP/borrowing complexity behind simple buttons. Show estimates in CLP equivalent. |

---

## 6. Acceptance Criteria Summary

| # | Deliverable | Verification |
|---|-------------|--------------|
| D1 | `reference-vault` contract deployed testnet with 4 functions | Contract ID published; `cargo test` passes |
| D2 | `mock-usdc` token contract deployed testnet | Contract ID published; transfers work |
| D3 | Cross-contract slash propagation verified | `is_defaulted()` returns `true` after `liquidate()` |
| D4 | 28+ tests (20 unit + 8 integration) passing | `cargo test --workspace` exit 0 |
| D5 | Frontend vault UI with 4 working pages | Manual reviewer walkthrough on testnet |
| D6 | Fintoc real HTTP integration | Validation JSON shows live `api.fintoc.com` response |
| D7 | `npm run validate-t2` returns structured JSON | Single command, exit 0 |

---

## 7. Composability Statement

The `reference-vault` is **not** a production lending protocol and is **not** intended to compete with Blend, Lulo, or other Stellar lending platforms. It exists to:

1. Prove the integration pattern works on Stellar today.
2. Provide a working, auditable code example.
3. Establish the cross-contract call interface (`is_defaulted`, `get_score`, `slash`) as a de facto standard for any protocol that wants to integrate Vigente.

Any production protocol that chooses to support external credit oracles can fork this reference, add their production logic (dynamic rates, liquidation auctions, multi-asset, governance), and integrate Vigente badges with minimal code changes.

---

*Document Version: 2.0.0 (SCF-aligned)*
*Predecessor: [Tranche 1 — MVP](./TRANCHE_1_DELIVERABLES.md)*
*Successor: [Tranche 3 — Mainnet Launch](./TRANCHE_3_DELIVERABLES.md)*
