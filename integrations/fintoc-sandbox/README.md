# Vigente Protocol — Fintoc Sandbox Integration

> **Tranche 1 Deliverable** — zkTLS Architecture Foundation

This module demonstrates the open banking data pipeline that the Vigente protocol consumes: retrieving Chilean bank account data via Fintoc's open banking API, filtering for Payku merchant settlement inflows, computing a reputation score, and generating an attestation stub. Full TLSNotary integration is on the post-grant roadmap.

## Quick Start (< 2 minutes)

```bash
# From repo root:
cd integrations/fintoc-sandbox
npm install
npm run quickstart
```

**No API key required** — this integration uses embedded sandbox fixtures for deterministic, reviewable output.

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run quickstart` | Full pipeline: connection → accounts → movements → scoring → attestation stub |
| `npm run test:connection` | Verify sandbox data loads correctly |

## What This Demonstrates

1. **Data Retrieval**: Loading bank account and transaction data (30 movements over 6 months)
2. **Merchant Filter**: Selecting Payku settlement deposits (Abonos) from broader bank activity
3. **Scoring Engine**: Computing `V` (Volume), `F` (Frequency), `C` (Consistency), and composite `S`
4. **Attestation Stub**: Generating a TLSNotary-compatible session stub with nonce and hash

## Scoring Formula

```
V = min(1000, monthly_usd * 1.5)
F = min(1000, payout_count * 35)
C = max(0, 1000 - coefficient_of_variation * 2000)
S = 0.4·V + 0.35·F + 0.25·C
```

| Tier | Score Range |
|------|------------|
| 🥇 Gold | S ≥ 800 |
| 🥈 Silver | 600 ≤ S < 800 |
| 🥉 Bronze | 400 ≤ S < 600 |
| ❌ Fail | S < 400 |

## Architecture Context

This sandbox integration is **Phase 1** of the zkTLS pipeline:

```
[Pre-submission]  Fintoc Sandbox fixtures → Scoring Engine → Attestation Stub
[Tranche 2]       Fintoc Live API (real HTTP) → Signed Attestation
[Post-grant]      Fintoc Live API → TLSNotary MPC-TLS → Decentralized Notary
```

See `docs/ARCHITECTURE.md` for the full specification.

## File Structure

```
fintoc-sandbox/
├── package.json
├── README.md
└── src/
    ├── quickstart.js        # Main pipeline script
    ├── test-connection.js   # Connection verification
    └── fixtures/
        ├── sandbox-accounts.json    # 2 simulated bank accounts
        └── sandbox-movements.json   # 30 transactions (6-month merchant activity)
```
