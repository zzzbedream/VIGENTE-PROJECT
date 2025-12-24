<p align="center">
  <img src="web/public/logo-vigente.svg" alt="VIGENTE Logo" width="200" />
</p>

<h1 align="center">VIGENTE</h1>

<p align="center">
  <strong>Privacy-First GovTech Validation Infrastructure on Stellar</strong>
</p>

<p align="center">
  <a href="https://stellar.expert/explorer/testnet/contract/CDFA64ESMY2MWBBDVLKJJPQ3TMIBSBDGJGVUSGHCVHZDHCTJOUNOANG2">
    <img src="https://img.shields.io/badge/Build-Verified-brightgreen?logo=stellar" alt="Build Verified" />
  </a>
  <a href="https://github.com/zzzbedream/VIGENTE-PROJECT/releases">
    <img src="https://img.shields.io/github/v/release/zzzbedream/VIGENTE-PROJECT?label=version" alt="Version" />
  </a>
  <a href="https://stellar.org/protocol/sep-0055">
    <img src="https://img.shields.io/badge/SEP--0055-Compliant-blue" alt="SEP-0055" />
  </a>
</p>

---

## 🎯 What is VIGENTE?

**VIGENTE** enables financial institutions to verify identity documents (Chilean RUT) and record compliance attestations on Stellar's blockchain—**without ever exposing personal data on-chain**.

> **The Problem**: Traditional KYC processes store sensitive data in centralized databases vulnerable to breaches. Blockchain offers immutability but creates permanent privacy risks.
>
> **Our Solution**: Cryptographic proof of validation stored on-chain, with zero personal data exposure.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  "We verify the person, not store them."                                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🏗️ Architecture: Privacy-First Design

VIGENTE implements a **zero-knowledge attestation** pattern where sensitive data never leaves the secure backend zone.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA FLOW ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────┐      ┌─────────────────────────────────────────────────┐    │
│   │          │      │            🔒 SECURE ZONE (Backend)              │    │
│   │   USER   │      │  ┌─────────────┐    ┌──────────────────────┐   │    │
│   │          │ RUT  │  │             │    │                      │   │    │
│   │ 12345678-5 ────────▶│  Validation │───▶│  HMAC-SHA256 Hash   │   │    │
│   │          │      │  │  (Format +  │    │                      │   │    │
│   │          │      │  │  Whitelist) │    │  RUT + Secret ──▶ 0x7f3a│   │    │
│   └──────────┘      │  └─────────────┘    └──────────┬───────────┘   │    │
│                     │                                 │               │    │
│                     └─────────────────────────────────┼───────────────┘    │
│                                                       │                     │
│   ┌───────────────────────────────────────────────────┼───────────────────┐│
│   │                    🌐 PUBLIC ZONE (Blockchain)    │                   ││
│   │                                                   ▼                   ││
│   │  ┌─────────────────────────────────────────────────────────────────┐ ││
│   │  │                    SOROBAN SMART CONTRACT                       │ ││
│   │  │                                                                 │ ││
│   │  │   mint_deal(                                                    │ ││
│   │  │     data_hash: 0x7f3a8b2c...  ◀── Only hash, never RUT         │ ││
│   │  │     partner: GAJT5NOK...                                        │ ││
│   │  │     amount: 5000000                                             │ ││
│   │  │   )                                                             │ ││
│   │  │                                                                 │ ││
│   │  │   ✓ Verify admin signature                                      │ ││
│   │  │   ✓ Emit immutable event                                        │ ││
│   │  │   ✓ Store attestation proof                                     │ ││
│   │  │                                                                 │ ││
│   │  └─────────────────────────────────────────────────────────────────┘ ││
│   │                                   │                                   ││
│   │                                   ▼                                   ││
│   │  ┌─────────────────────────────────────────────────────────────────┐ ││
│   │  │                      STELLAR LEDGER                             │ ││
│   │  │   TX: fcbb0347... │ Hash: 0x7f3a... │ Timestamp: 2025-12-24    │ ││
│   │  └─────────────────────────────────────────────────────────────────┘ ││
│   └───────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│   🔐 SECURITY GUARANTEES:                                                   │
│   • RUT "12345678-5" NEVER appears on-chain                                │
│   • Only cryptographic hash is stored                                       │
│   • Hash is irreversible (cannot derive RUT from hash)                     │
│   • Admin signature required for all operations                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Security Model

| Layer | Protection | Implementation |
|-------|------------|----------------|
| **Transport** | TLS 1.3 | HTTPS only |
| **Validation** | Input sanitization | Regex + Modulo 11 algorithm |
| **Hashing** | Irreversible transformation | HMAC-SHA256 with server secret |
| **Authorization** | Whitelist + Admin signature | ENV-based ACL + Stellar keypair |
| **Auditability** | Immutable proof | Stellar ledger events |

---

## 🛡️ SEP-0055 Compliance

VIGENTE implements [SEP-0055](https://stellar.org/protocol/sep-0055) for **verifiable builds**:

```bash
# Verify our deployed contract matches the source code
$ gh attestation verify releases/pyme_token_v1.wasm --repo zzzbedream/VIGENTE-PROJECT

✓ Verification succeeded!
  Build repo:     zzzbedream/VIGENTE-PROJECT
  Build workflow: .github/workflows/release.yml@refs/tags/v1.0.11
```

| Verification | Value |
|--------------|-------|
| Contract ID | `CDFA64ESMY2MWBBDVLKJJPQ3TMIBSBDGJGVUSGHCVHZDHCTJOUNOANG2` |
| WASM Hash | `ef8fa7ea202e61a8f11924716d469db675cfcb934a92a35a76952f36639cb41b` |
| Source Repo | `github:zzzbedream/VIGENTE-PROJECT` |
| Network | Stellar Testnet |

---

## 🔧 Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Frontend** | Next.js 16 + TypeScript | User interface |
| **API** | Next.js API Routes | Secure validation layer |
| **Smart Contract** | Soroban (Rust) | On-chain attestation |
| **Blockchain** | Stellar Testnet | Immutable ledger |
| **CI/CD** | GitHub Actions | Automated verified builds |
| **Validation** | Custom RUT Validator | Chilean tax ID verification |

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli) v22.8+
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/zzzbedream/VIGENTE-PROJECT.git
cd VIGENTE-PROJECT

# Install dependencies
cd web && npm install

# Configure environment
cp .env.example .env.local
```

### Environment Variables

```env
# .env.local
ADMIN_SECRET=YOUR_STELLAR_SECRET_KEY
NEXT_PUBLIC_CONTRACT_ID=CDFA64ESMY2MWBBDVLKJJPQ3TMIBSBDGJGVUSGHCVHZDHCTJOUNOANG2
RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
AUTHORIZED_RUTS=12345678-5,78043412-0
```

### Run Development Server

```bash
npm run dev
# → http://localhost:3000
```

---

## 📡 API Reference

### POST `/api/mint`

Creates a new attestation on the blockchain.

**Request:**
```json
{
  "rut": "12345678-5",
  "amount": 5000000
}
```

**Response (Success):**
```json
{
  "success": true,
  "hash": "fcbb03475e1e0df986fe85f8397c854a593c457b1d54533493daa1feaa3f2baf",
  "status": "PENDING"
}
```

**Error Codes:**
| Status | Code | Description |
|--------|------|-------------|
| 400 | `INVALID_FORMAT` | RUT format invalid |
| 400 | `INVALID_DV` | Check digit incorrect |
| 403 | `NOT_AUTHORIZED` | RUT not in whitelist |
| 500 | `TX_FAILED` | Blockchain transaction failed |

---

## 🧪 Testing

### Run Validation Tests

```bash
# Valid RUT (authorized)
curl -X POST http://localhost:3000/api/mint \
  -H "Content-Type: application/json" \
  -d '{"rut":"12345678-5","amount":5000000}'
# → 200 OK

# Invalid format
curl -X POST http://localhost:3000/api/mint \
  -H "Content-Type: application/json" \
  -d '{"rut":"1234","amount":5000000}'
# → 400 Bad Request

# Not authorized
curl -X POST http://localhost:3000/api/mint \
  -H "Content-Type: application/json" \
  -d '{"rut":"11111111-1","amount":5000000}'
# → 403 Forbidden
```

### Verify Privacy on Stellar Expert

1. Get transaction hash from API response
2. Visit: `https://stellar.expert/explorer/testnet/tx/{HASH}`
3. Confirm: **No RUT visible** in transaction parameters
4. Confirm: Only `data_hash` (bytes) is stored

---

## 📁 Project Structure

```
VIGENTE-PROJECT/
├── contracts/                 # Soroban smart contract (Rust)
│   ├── src/lib.rs            # Contract logic
│   └── Cargo.toml
├── web/                       # Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx      # Main UI
│   │   │   ├── api/mint/     # Secure API endpoint
│   │   │   └── lib/
│   │   │       └── rut-validator.ts
│   │   └── public/
│   └── .env.local            # Environment config
├── .github/
│   └── workflows/
│       └── release.yml       # SEP-0055 build pipeline
└── releases/                  # Verified WASM binaries
```

---

## 🔐 Security Considerations

### What We Store On-Chain
- ✅ HMAC-SHA256 hash of validated data
- ✅ Partner public key
- ✅ Amount and timestamp
- ✅ Transaction signature

### What We NEVER Store On-Chain
- ❌ RUT (Chilean tax ID)
- ❌ Personal names
- ❌ Any PII (Personally Identifiable Information)

### Attack Vectors Mitigated

| Attack | Mitigation |
|--------|------------|
| Rainbow table | HMAC with secret key |
| Replay attack | Unique nonce per transaction |
| Unauthorized mint | Admin signature required |
| Data exposure | Zero PII on-chain |

---

## 📜 License

MIT © 2025 VIGENTE

---

## �️ Roadmap

### Phase 1: MVP (Current - Hackathon) ✅
- [x] Custom Soroban smart contract
- [x] SEP-0055 Build Verification
- [x] Privacy-first architecture (RUT never on-chain)
- [x] Production deployment on Vercel

### Phase 2: Security Hardening (Q1 2026)
- [ ] Migration to [OpenZeppelin Stellar Contracts](https://github.com/OpenZeppelin/stellar-contracts)
- [ ] RWA Token (ERC-3643) for KYC/AML compliance
- [ ] Role-Based Access Control (RBAC)
- [ ] Pausable functionality for regulatory emergencies
- [ ] Formal verification by Certora

### Phase 3: Production (Q2 2026)
- [ ] Mainnet deployment
- [ ] Integration with Chilean financial regulators (CMF)
- [ ] Multi-signature governance
- [ ] Real-time compliance monitoring

---

## �🔗 Links

- **Live Demo**: [Coming Soon]
- **Stellar Expert**: [View Contract](https://stellar.expert/explorer/testnet/contract/CDFA64ESMY2MWBBDVLKJJPQ3TMIBSBDGJGVUSGHCVHZDHCTJOUNOANG2)
- **Releases**: [GitHub Releases](https://github.com/zzzbedream/VIGENTE-RELEASES/releases)

---

<p align="center">
  Built with ❤️ for the Stellar Ecosystem
</p>
