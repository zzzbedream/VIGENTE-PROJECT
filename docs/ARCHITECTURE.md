# Vigente Protocol — Architecture

> Complete pre-submission architecture per SCF Build criteria: *"Your technical architecture must already be complete at the time of application."*

---

## 1. System Overview

Vigente Protocol is a privacy-preserving credit reputation layer on Stellar Soroban. It transforms off-chain merchant transaction data (initially via Payku in Chile, extending to open banking via Fintoc and Prometeo) into verifiable, non-transferable on-chain credit badges. These badges gate undercollateralized lending in DeFi protocols.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          VIGENTE PROTOCOL                                │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │  Merchant     │  │  Open Banking │  │  Future:      │                  │
│  │  (Payku)      │  │  (Fintoc)     │  │  Prometeo     │                  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │
│         │                  │                  │                          │
│         └──────────────────┴──────────────────┘                          │
│                            │                                             │
│                            ▼                                             │
│             ┌────────────────────────────────┐                          │
│             │  Oracle Adapter Layer           │                          │
│             │  (TypeScript, server-side)      │                          │
│             │  - HMAC-signed score claims     │                          │
│             │  - SHA-256 commitment of data   │                          │
│             │  - No PII storage               │                          │
│             └────────────┬───────────────────┘                          │
│                          │                                              │
│                          ▼                                              │
│             ┌────────────────────────────────┐                          │
│             │  Scoring Engine                 │                          │
│             │  - Volume (V), Frequency (F),  │                          │
│             │    Consistency (C) → Score S    │                          │
│             │  - Tier mapping (Gold/Silver/   │                          │
│             │    Bronze/None)                 │                          │
│             └────────────┬───────────────────┘                          │
│                          │                                              │
│         ┌────────────────┴────────────────┐                             │
│         │  Soroban Contract Layer          │                             │
│         │                                  │                             │
│  ┌──────▼───────────┐    ┌────────────────▼─────────┐                  │
│  │  vigente-badge   │◄──►│   reference-vault         │                  │
│  │  (SBT contract)  │    │   (lending contract)      │                  │
│  │                  │    │                           │                  │
│  │  - mint()        │    │  - deposit() / withdraw() │                  │
│  │  - slash()       │    │  - borrow() / repay()     │                  │
│  │  - get_score()   │    │  - liquidate() → slash()  │                  │
│  │  - is_defaulted()│    │                           │                  │
│  └──────────────────┘    └───────────────────────────┘                  │
│         ▲                            │                                  │
│         │                            │                                  │
│         │              ┌─────────────▼──────────────┐                   │
│         │              │  USDC SAC (Stellar Asset    │                   │
│         │              │  Contract — real USDC on    │                   │
│         │              │  mainnet, mock on testnet)  │                   │
│         │              └─────────────────────────────┘                   │
│         │                                                                │
│  ┌──────┴──────────────────┐                                            │
│  │  Frontend (Next.js)      │                                            │
│  │  Freighter wallet        │                                            │
│  │  User → RUT → Score →   │                                            │
│  │  Mint badge → Borrow     │                                            │
│  └─────────────────────────┘                                            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Why Stellar (Non-Superficial Use)

Per SCF criteria, Stellar must be used to meaningfully improve core features, not as a superficial integration or data storage layer. Vigente uses Stellar Soroban specifically for properties no off-chain stack provides:

| Stellar property | Vigente use case | Why this is non-superficial |
|------------------|------------------|----------------------------|
| **Permissionless contract calls** | Any protocol can query `is_defaulted()` and `get_score()` without permission from Vigente | Off-chain credit bureaus require contracts; Soroban makes reputation a public good |
| **Immutable storage with TTL** | `DefaultBadge` records persist for ~2 years with no delete function | Off-chain DBs can erase records; Soroban storage is enforced at protocol level |
| **Cross-contract atomic calls** | `reference-vault.liquidate()` atomically slashes the badge | Without atomicity, defaults could be evaded by reordering tx |
| **Sub-cent transaction fees** | Mint cost is fractional cents | Critical for microcommerce target where margins are thin |
| **5-second finality** | Borrow approval happens in real-time | Web2 credit checks take days; Soroban finality enables real-time UX |
| **Native cryptographic primitives** | `env.crypto().sha256()`, `ed25519_verify()` | Future TLSNotary attestation requires these as gas-efficient operations |

Vigente could **not** be built as a Web2 service. The composability, atomicity, and verifiability are the protocol's reason to exist.

---

## 3. Smart Contract Layer

### 3.1 `vigente-badge` — Credit Reputation SBT

**Contract type:** Non-transferable Soulbound Token (SBT). One badge per address. No `transfer()` function exists.

**Storage architecture:**

| Storage tier | Contents | TTL |
|--------------|----------|-----|
| Instance | Admin, AuthOracles, AuthVaults, Paused flag | ~90 days (auto-extended on use) |
| Persistent | `Badge(Address) → CreditBadge` | ~90 days |
| Persistent | `Default(Address) → DefaultBadge` | **~2 years** (intentional max retention) |
| Temporary | Not used | — |

**Data structures:**

```rust
pub struct CreditBadge {
    score: u32,               // 0–1000
    issued_at: u64,           // ledger timestamp
    expires_at: u64,
    data_hash: BytesN<32>,    // SHA-256 commitment to attested data
    slashed: bool,
}

pub struct DefaultBadge {
    score_at_default: u32,
    defaulted_at: u64,
    slashed_by: Address,      // which vault triggered the slash
    reason: u32,              // 0=unspecified, 1=non_payment, 2=fraud, 3=collateral_shortfall
}
```

**Access control (three-tier ACL):**

| Role | Can call | Cannot |
|------|----------|--------|
| Admin (single → multi-sig in T3) | `add_oracle`, `add_vault`, `remove_*`, `pause`, `unpause` | `mint`, `slash`, delete defaults |
| Authorized Oracles (vec) | `mint` | `slash`, ACL management |
| Authorized Vaults (vec) | `slash` | `mint`, ACL management |
| Public | `is_defaulted`, `get_score`, `get_badge`, `get_default` | Any write |

**Immutability of negative history (defense in depth):**
1. No `delete_default()` function exists in the code.
2. `DefaultBadge` TTL is the maximum Soroban allows (~2 years).
3. `mint()` calls `is_defaulted()` before issuing — a defaulted address cannot ever re-mint from this contract.
4. `is_defaulted()` uses dual check (DefaultBadge record OR badge.slashed).
5. The `slash` event is emitted to the ledger; even after TTL expiry, the event log is permanent.

### 3.2 `reference-vault` — Credit-Gated Lending

**Contract type:** Single-asset lending pool with credit-score-based borrow limits and cross-contract default enforcement.

**Functions:**

```rust
fn deposit(depositor: Address, amount: i128)
fn borrow(borrower: Address, amount: i128)
fn repay(borrower: Address, amount: i128)
fn liquidate(liquidator: Address, borrower: Address)
fn withdraw(depositor: Address, shares: i128)
```

**Cross-contract integration:**

```rust
// Inside reference-vault.borrow():
let badge = VigenteBadgeClient::new(&env, &badge_contract_id);

if badge.is_defaulted(&borrower) {
    panic!("borrower is in default");
}

let score = badge.get_score(&borrower)
    .expect("no active credit badge");

let max_loan = (available * score as i128) / (1000 * 10);  // 10% per-borrower cap
```

**Loan limit formula:**

```
available_liquidity = total_deposits - total_borrowed
per_borrower_cap = available_liquidity / 10
max_loan = per_borrower_cap × (score / 1000)
```

### 3.3 Open Source Plan

All Soroban contracts are MIT-licensed (`LICENSE` at repository root). The TypeScript SDK delivered in Tranche 3 is also MIT. There is no plan to introduce closed-source components or proprietary licensing. Forks, integrations, and modifications are encouraged.

---

## 4. Oracle Adapter Layer

### 4.1 Current State (Pre-Submission Baseline)

**Server-side oracle.** A Next.js API route receives the user's RUT, calls Payku Sandbox or falls back to mock data, computes the score deterministically, and returns a signed claim:

```
sig = HMAC-SHA256(rut_clean, ADMIN_SECRET)
```

The signature is currently advisory (the `vigente-badge` contract's `mint()` checks only that the caller is in `AuthOracles`, not that the data is signed). This is a known limitation documented as Tranche 1 work — adding signature verification to `mint()` so the oracle's role is reduced to "I attest to this score" without any other trust.

### 4.2 Tranche 2 State

Fintoc adapter implements real HTTP calls to `api.fintoc.com` with the same `MovementData[]` interface as Payku. The scoring engine is data-source-agnostic. Either source produces the same score format.

### 4.3 Post-Grant Decentralization Path

The architecture explicitly supports future decentralization without contract redeployment:

| Phase | Notary model | Trust assumption |
|-------|-------------|------------------|
| Pre-submission | Single server-side oracle with HMAC | Trust Vigente operator |
| Tranche 3 | Multi-signature oracle (k-of-n) via `add_oracle()` | Trust quorum of operators |
| Post-grant | TLSNotary client-side attestation | Trustless: user's own device generates proof |

The TLSNotary endgame is **not** a Tranche deliverable. Documenting it in this architecture demonstrates that the contracts (which verify `ed25519_signature` natively via `env.crypto().ed25519_verify()`) are ready for that future without breaking changes.

---

## 5. Scoring Engine

Deterministic three-dimensional algorithm operating on 6-month transaction history:

```
Volume score (0–40):     based on total transactional USD equivalent
Consistency score (0–30): inverse coefficient of variation across monthly volumes
Frequency score (0–30):  transactions per month over the 6-month window

Total: 0–100 → mapped to Tier (Gold ≥80, Silver ≥55, Bronze ≥30, None < 30)
Max loan amount: tier-dependent (Gold: 10M CLP, Silver: 5M CLP, Bronze: 2M CLP, None: 0)
```

Implementation: `web/src/services/scoring-engine.ts`. Pure function, no side effects, deterministic for fixed inputs. Same algorithm runs server-side today and will move client-side post-TLSNotary integration.

---

## 6. Threat Model (Summary)

**Full STRIDE analysis with code references and live testnet evidence lives in [docs/THREAT_MODEL.md](THREAT_MODEL.md).** That document is the authoritative source; the table below is a quick reviewer pointer.

| Vector | Mitigation | Status | Code |
|---|---|---|---|
| Oracle key compromise (single signer) | k-of-n threshold ed25519 verification on-chain, anti-replay nonce | ✅ Shipped, live on testnet `CDLLO7QE…` | `contracts/vigente-badge/src/lib.rs` |
| Sybil farms / throw-away wallets | 30-day wallet-age floor folded into the signed mint message | ✅ Shipped | `vigente-badge.mint()` |
| Carousel / wash trading | Ecosystem-counterparty whitelist + 70% P2P penalty on volume and effective tx count | ✅ Shipped | `web/src/services/horizon-scoring.ts` |
| Long-con default | Score-anchored credit ladder: first loan = 10% of tier ceiling; full ceiling unlocked only after first successful repay | ✅ Shipped | `contracts/reference-vault/src/lib.rs` |
| Vault drainage / uncapped exposure | Circuit breaker + TVL cap + 85% utilization rail | ✅ Shipped | `contracts/reference-vault/src/lib.rs` |
| LP bank run | 14-day withdrawal timelock + utilization floor leaving 15% pool liquid | ✅ Shipped | `contracts/reference-vault/src/lib.rs` |
| Reentrancy in vault | Soroban execution model inherently reentrancy-safe | ✅ Inherent | n/a |
| Tampered off-chain attestation (TLSNotary) | Documented as post-grant work | ⏳ Out of scope of the grant | n/a |

---

## 7. Privacy Design

**What goes on-chain:**
- SHA-256 commitment of (RUT + merchant data)
- Aggregate score (number 0-1000)
- Tier (1-4)
- Timestamps and expiry
- Slashing events with reason codes

**What never goes on-chain:**
- Raw RUT (only its hash)
- Individual transaction amounts
- Counterparty information
- Bank account numbers
- Names, emails, phone numbers

The privacy guarantee is enforced by the data layer (oracle never writes raw fields to the contract) and the schema (contract structs only contain hashes and aggregates).

---

## 8. Data Flow — End-to-End

```
1. User opens app, connects Freighter wallet
2. User enters RUT (Chilean national ID)
3. Frontend POSTs to /api/evaluate-and-fund
4. Server-side:
   a. Payku adapter pulls 6 months of conciliation data for this RUT
   b. Scoring engine computes (V, F, C) → S → tier
   c. Server creates data_hash = SHA-256(rut + ADMIN_SECRET)
   d. Server creates signature for the score claim (future: signed via Ed25519)
5. Frontend receives { score, tier, data_hash, signature }
6. Frontend builds mint tx: vigente_badge.mint(user, tier, score, data_hash)
7. User signs tx with Freighter
8. Tx broadcast to Soroban RPC
9. Contract verifies caller is in AuthOracles
10. Contract emits "mint" event, stores Badge(user) entry
11. UI polls tx status, displays confirmation with stellar.expert link

Later, if user defaults on a reference-vault loan:
12. Loan due date passes, keeper or anyone calls vault.liquidate(user)
13. Vault calls badge.slash(vault_address, user, reason=1)
14. Badge marks Badge(user).slashed = true
15. Badge creates Default(user) record (TTL: 2 years, no delete possible)
16. Future borrow attempts on ANY vault calling is_defaulted(user) → true → loan denied
```

---

## 9. Failure Modes & Recovery

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Payku API down | Adapter retry exhausted | Hybrid fallback to mock — UI shows `dataSource: payku_fallback_mock` |
| Oracle key compromise | Anomalous mint volume in Mercury indexer | Admin calls `pause()`, rotates oracle via `remove_oracle()`/`add_oracle()` |
| Reference vault stuck (e.g., bad math) | Tests, audit, or post-mortem | Admin calls `pause()`; new vault deployed; users migrate. Badges survive. |
| Stellar testnet/mainnet outage | Soroban RPC unreachable | UI shows error; retries; mint deferred. No state corruption. |

---

## 10. Standards & Interoperability

- **SEP-41 token interface** — used for the USDC token integration in `reference-vault`. Real USDC SAC on mainnet, mock USDC on testnet.
- **Soroban events** — all state-changing operations emit indexed events for Mercury / SubQuery indexers.
- **`is_defaulted()` and `get_score()`** as a de facto standard interface for any Stellar lending protocol that wants to query Vigente badges.

There is no Vigente-specific token standard. We use Soroban's native primitives.

---

## 11. Non-Goals (What This Architecture Does NOT Do)

To prevent scope creep and clarify the boundary:

- **Vigente does not issue stablecoins or fiat-backed tokens.** No Stellar Info File needed.
- **Vigente does not operate a fiat on/off ramp.** Payku and Fintoc are the data sources, not the rails.
- **Vigente does not implement KYC.** We rely on Payku's existing KYC for merchant verification.
- **Vigente is not a wallet.** Freighter is the user's chosen wallet.
- **Vigente is not a chain or L2.** It's a set of Soroban contracts on Stellar Mainnet.

---

*Document Version: 1.0.0*
*This document is pre-submission per SCF criteria. The contracts and data flows described here are implementation-complete in the repository at submission time, with deployment and final hardening delivered through Tranches 1–3.*
