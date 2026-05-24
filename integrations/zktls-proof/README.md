# Vigente Protocol — zkTLS Proof-of-Solvency Engine

> **Tranche 2 Deliverable** — Cryptographic Proof Generation & Verification

This module implements a **proof-of-solvency** system using Ed25519 digital signatures that simulates how TLSNotary's attestation flow will work in production. A user can prove financial claims (e.g., "monthly income > $1,000 USD") without revealing raw bank data to anyone.

## Quick Start (< 2 minutes)

```bash
cd integrations/zktls-proof
npm install

# Step 1: Generate a proof
npm run generate-zk-proof

# Step 2: Copy the Base64 string from the output, then:
npm run verify-proof <paste-base64-proof-here>
```

No API keys, toolchain installs, or external dependencies required.

## How The Proof Works

```
Raw Bank Data (30 movements — merchant 6-month window)
        │
        ▼ [Client-Side Only — never leaves user's machine]
Compute Aggregate Metrics
  • monthly_income_usd: $X
  • inflow_count: N
  • consistency: 0.XX
        │
        ▼
Evaluate Claim Predicate
  "monthly_income > 1000 USD" → TRUE/FALSE
        │
        ▼
Create Data Commitment
  SHA-256(raw_data) → binds proof to this exact dataset
        │
        ▼
Sign with Ed25519 (Notary Key)
  attestation = { claim, result, commitment, nonce, timestamp }
  signature = Ed25519.sign(attestation)
        │
        ▼
Output Base64 Proof
  Contains: claim + signature + notary public key
  Does NOT contain: raw bank data
```

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run generate-zk-proof` | Full pipeline: data → claim → sign → Base64 proof |
| `npm run verify-proof <proof>` | Verify any proof's Ed25519 signature and claim structure |

## Tamper Detection

Modifying even a single character of the proof string will cause signature verification to fail:

```bash
# This will output: ❌ PROOF REJECTED — Signature verification failed
npm run verify-proof AAAA_TAMPERED_PROOF
```

## PoC vs. Production

| Component | This PoC | Production (T3+) |
|-----------|----------|-------------------|
| Signing key | Local Ed25519 keygen | MPC-TLS Notary (2PC) |
| Data source | Embedded fixtures | Live Fintoc API |
| Verification | Console (this script) | Soroban `env.crypto().ed25519_verify()` |
| Anti-replay | Nonce generated | Nonce enforced on-chain |

## File Structure

```
zktls-proof/
├── package.json
├── README.md
└── src/
    ├── generate-proof.js       # Proof generation script
    ├── verify-proof.js         # Proof verification script
    └── lib/
        ├── crypto-engine.js    # Ed25519 + SHA-256 utilities
        └── claim-evaluator.js  # Financial predicate evaluator
```

Fixture data is shared with Tranche 1 (`../fintoc-sandbox/src/fixtures/`).
