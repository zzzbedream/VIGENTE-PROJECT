# Vigente Protocol

![Build Status](https://img.shields.io/badge/build-passing-brightgreen) ![Network](https://img.shields.io/badge/stellar-testnet-blue) ![License](https://img.shields.io/badge/license-MIT-purple) ![Tests](https://img.shields.io/badge/tests-45%2F45-green)

> **Privacy-preserving on-chain credit reputation for the LatAm SME and microcommerce market.**
>
> Vigente turns merchant transaction history (initially via Payku in Chile, extending to open banking via Fintoc/Prometeo) into verifiable Soroban-native credit badges that unlock undercollateralized lending.

---

## The Problem

Chile alone has **>1M microcommerces** processing payments through fintech rails like Payku, yet zero of them have credit history visible to DeFi protocols. Despite consistent monthly cash flow, they are excluded from on-chain liquidity because Stellar has no native credit primitive that maps fiat transactional behavior to verifiable reputation.

Banks won't lend without collateral they can't post. DeFi won't lend without 150%+ overcollateralization. The result: a $2B+ annual transaction volume that generates zero borrowing capacity.

## The Solution

Vigente Protocol is a **three-component infrastructure** on Stellar:

### 1. CreditBadge SBT (`vigente-badge`)
Non-transferable Soulbound Token on Soroban encoding a borrower's credit tier, score, and a SHA-256 commitment to their attested transactional data. Includes a permanent `slash()` mechanism that records defaults immutably for ~2 years.

### 2. Oracle Adapter Layer
Service-side adapter that ingests merchant data from Payku (Chile) and produces deterministic credit scores. Designed with a clean adapter interface (`PaykuClient`) so Fintoc/Prometeo open banking sources can be added without changing the scoring engine. Privacy-preserving: only SHA-256 commitments touch the chain.

### 3. Reference Lending Vault (`reference-vault`)
A minimal but complete Soroban lending contract that demonstrates credit-gated undercollateralized lending end-to-end. Calls `is_defaulted()` and `get_score()` on the badge contract to determine eligibility; calls `slash()` cross-contract on default. **Not** a production protocol — a reference implementation that any Stellar lending protocol can adopt.

---

## Live Deployment (Testnet)

| Resource | Value |
|----------|-------|
| **Live App** | https://vigente-hackathon-final.vercel.app |
| **Badge Contract** | `CATE7NUICQNBSUKF3RMA2HQAJK2RWCHCYH4NCPTQDLFNWNUNSFTTUH4W` |
| **Network** | Stellar Testnet |
| **Explorer** | [stellar.expert](https://stellar.expert/explorer/testnet/contract/CATE7NUICQNBSUKF3RMA2HQAJK2RWCHCYH4NCPTQDLFNWNUNSFTTUH4W) |
| **Repository** | https://github.com/zzzbedream/VIGENTE-PROJECT |

---

## Testing Guide

### Test RUTs (Chilean ID Numbers)

| RUT | Tier | Score | Badge | Description |
|-----|------|-------|-------|-------------|
| `20.244.452-1` | A | 1000 | Gold | High volume, consistent history |
| `7.452.862-K` | A | 1000 | Gold | K as verification digit |
| `12.345.678-2` | B | ~650 | Silver | Medium volume, stable history |
| `6.531.561-5` | B | ~640 | Silver | Good credit profile |
| `99.999.999-9` | D | 0 | None | Insufficient history (fail case) |

> RUTs ending in `1`/`K` → Tier A; `2` → Tier B; `9` → fail; other digits → Tier B/C.

### End-to-End Flow

1. Install [Freighter Wallet](https://www.freighter.app/) (Testnet mode).
2. Fund your testnet account at https://laboratory.stellar.org/#account-creator?network=test.
3. Open https://vigente-hackathon-final.vercel.app.
4. Click **Connect Wallet** → approve in Freighter.
5. Enter a test RUT (e.g., `20.244.452-1`).
6. Click **Connect & Analyze** → review credit score and transaction chart.
7. Click **Mint Credit Badge** → approve transaction in Freighter.
8. Inspect the transaction hash on Stellar Expert.

---

## Architecture (Summary — Full Spec in `docs/ARCHITECTURE.md`)

```
┌─────────────┐    ┌───────────────────┐    ┌─────────────────┐
│  Merchant    │───►│  Payku Oracle      │───►│ Scoring Engine  │
│  (RUT)       │    │  (adapter pattern)│    │ (V, F, C → S)   │
└─────────────┘    └───────────────────┘    └────────┬────────┘
                                                      │
                          ┌───────────────────────────┴──┐
                          ▼                              ▼
                  ┌──────────────────┐         ┌─────────────────┐
                  │ vigente-badge    │◄────────│  Freighter      │
                  │ Soroban SBT      │ mint()  │  Wallet (user)  │
                  └─────────┬────────┘         └─────────────────┘
                            │
              get_score()   │   slash()
                            ▼
                  ┌──────────────────┐         ┌─────────────────┐
                  │ reference-vault  │────────►│  Borrower /     │
                  │ Soroban Lending  │ borrow()│  LP             │
                  └──────────────────┘         └─────────────────┘
```

**Technical flow**:
1. **Data ingestion**: Oracle pulls merchant transaction data from Payku (or Fintoc in T2).
2. **Scoring**: Deterministic algorithm weights volume, frequency, and consistency.
3. **Privacy layer**: SHA-256 commitment of RUT + merchant data — raw PII never on-chain.
4. **Minting**: Soroban contract verifies signed claim and mints non-transferable `CreditBadge`.
5. **DeFi integration**: Badge gates borrowing in `reference-vault`; default triggers cross-contract `slash()`.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Smart Contracts | Rust + Soroban SDK | CreditBadge SBT, reference lending vault, mock USDC |
| Oracle | Node.js + TypeScript | Payku API adapter with HMAC signing + retry/timeout |
| Frontend | Next.js 16 + Tailwind | User dashboard, Freighter integration, vault UI |
| Network | Stellar Testnet → Mainnet | Sub-cent fees, 5-second finality |

---

## Installation

### Prerequisites
- Node.js v18+
- Rust 1.75+ & Cargo
- Stellar CLI v22+
- Freighter wallet (browser extension)

### Frontend

```bash
git clone https://github.com/zzzbedream/VIGENTE-PROJECT.git
cd VIGENTE-PROJECT/web
npm install
cp .env.local.example .env.local  # Configure CONTRACT_ID, ADMIN_SECRET
npm run dev
# Open http://localhost:3000
```

### Smart Contracts

```bash
# vigente-badge (30 tests)
cd contracts/vigente-badge && cargo test
# Expected: 30 passed; 0 failed

# reference-vault (10 integration tests with badge + mock-usdc)
cd ../reference-vault && cargo test
# Expected: 10 passed; 0 failed

# mock-usdc (5 tests)
cd ../mock-usdc && cargo test
# Expected: 5 passed; 0 failed
```

### Deploy to Testnet

```bash
cd contracts/vigente-badge
cargo build --target wasm32v1-none --release
stellar contract deploy \
  --wasm target/wasm32v1-none/release/vigente_badge.wasm \
  --source <ADMIN_SECRET> \
  --network testnet
```

---

## Roadmap (SCF Build — 3 Tranches, $60K USD)

### Tranche 1 — MVP ($12K) · Weeks 1-6
- `vigente-badge` contract deployed to testnet with 30+ tests passing.
- Payku adapter integrating sandbox API with hybrid fallback.
- Frontend end-to-end flow: RUT → score → mint → on-chain confirmation.
- **Validation**: `npm run validate-t1` returns JSON with contract ID, test count, and a fresh mint tx hash.

### Tranche 2 — Testnet Expansion ($18K) · Weeks 7-14
- `reference-vault` contract on testnet with cross-contract calls to `vigente-badge`.
- Mock USDC token (SEP-41) for testnet liquidity.
- Full lending lifecycle: mint → deposit → borrow → repay (happy path) and → liquidate → slash (default path).
- Frontend vault UI: deposit, borrow, repay flows.
- Open banking adapter: real Fintoc HTTP integration (replaces sandbox fixtures).
- **Validation**: `npm run validate-t2` executes full lifecycle, returns 4 tx hashes.

### Tranche 3 — Mainnet Launch ($24K) · Weeks 15-24
- Mainnet deployment of `vigente-badge` and `reference-vault`.
- Hardening: multi-sig admin, monitoring (Mercury indexer), audit preparation.
- Public TypeScript SDK + docs site.
- 1+ pilot user (Chilean PyME via commercial partnership with Payku).
- **Validation**: mainnet contract IDs verifiable on stellar.expert + go-live metrics dashboard.

---

## Market Opportunity

| Metric | Value | Source |
|--------|-------|--------|
| LatAm SME credit gap | $1.2T USD | IFC SME Finance Forum |
| Chile Microcommerce Population | ~1M PyMEs | SII |
| Payku Annual TPV (Chile) | $500M+ | Industry estimates |
| Unbanked/Underbanked Rate | 68% (LatAm) | CGAP |

**Thesis**: Vigente addresses the "cold start" problem for DeFi lending in emerging markets by creating a privacy-preserving bridge between regulated fintech rails (Payku, Fintoc) and permissionless on-chain liquidity.

---

## Security & Privacy

- **Data hashing**: SHA-256 commitment of RUT + merchant data. Raw PII never on-chain.
- **Soulbound (non-transferable)**: badges bound to a Stellar address permanently.
- **Time-bound badges**: 90-day expiry forces fresh attestation.
- **Immutable defaults**: `slash()` creates a permanent `DefaultBadge` with ~2-year TTL. No delete function exists.
- **Three-tier ACL**: Admin (governance), Oracle (mint), Vault (slash) — separation of concerns prevents single-key compromise.
- **Circuit breaker**: admin can pause `mint`/`slash` without affecting existing data.

See `docs/ARCHITECTURE.md` for the full threat model.

---

## Contributing

We welcome contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

Development priorities:
1. **Reference vault** — cross-contract lending PoC (Tranche 2 deliverable).
2. **Fintoc real integration** — replace sandbox fixtures with live HTTP.
3. **TypeScript SDK** — public package for protocols integrating Vigente badges.

---

## Team

- **zzzbedream** — Founder / Tech Lead
- **Cristian Pérez Arce** — Full-stack Engineer
- **Mauricio Urra** — Commercial Lead (BD, partnerships)

See [docs/TEAM.md](./docs/TEAM.md) for profiles.

---

## AI Disclosure

Per SCF Open Track requirements, full disclosure of AI assistance in development is available in [docs/AI_DISCLOSURE.md](./docs/AI_DISCLOSURE.md). Summary: Anthropic Claude was used as a collaborative coding and documentation assistant. All design decisions, security-relevant code, and final implementations were author-reviewed and validated.

---

## License

MIT — see [LICENSE](./LICENSE).

---

<p align="center">
  <strong>Vigente Protocol</strong><br/>
  Privacy-preserving credit reputation infrastructure on Stellar<br/>
  <a href="https://vigente-hackathon-final.vercel.app">Live Demo</a> ·
  <a href="https://github.com/zzzbedream/VIGENTE-PROJECT">GitHub</a> ·
  <a href="https://stellar.expert/explorer/testnet/contract/CATE7NUICQNBSUKF3RMA2HQAJK2RWCHCYH4NCPTQDLFNWNUNSFTTUH4W">Testnet Contract</a>
</p>
