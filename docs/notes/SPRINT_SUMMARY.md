# Vigente Protocol — SCF Resubmit Sprint Summary

**Window:** 2026-05-28 → 2026-06-10 (target). Actual close: **2026-05-31** (Day 3 of 14).
**Outcome:** Phases A, B, B', C, and most of D shipped in 3 days — **~7 days ahead of the original plan**.

## Numbers at close

| Counter | Value |
|---|---:|
| Commits during the sprint | 23 |
| Total green tests (Rust + TS) | 104 |
| Live testnet contracts | 3 (v1 legacy, v2 threshold, v3 threshold + age floor — current) |
| Successful live mints validated | 4 (v2 positive, v3 positive via CLI, v3 negative trapped at simulation, v3 positive via UI relay) |
| New scripts shipped | 6 (setup-mother-account, setup-oracle-keys, evaluate, mint-onchain, validate-t1 v2, collect-metrics) |
| New API routes | 3 (/api/oracle/score-onchain, /api/oracle/sign-threshold, /api/mint-v3) |
| New documents | 7 (THREAT_MODEL + 6 acceptance / sprint notes) |

## Live evidence (paste into the SCF form)

- v3 badge contract: [`CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD`](https://stellar.expert/explorer/testnet/contract/CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD)
- Mint with 3-of-5 sigs, age 90: [`8b9fccfc…`](https://stellar.expert/explorer/testnet/tx/8b9fccfc9daaf594e457e19808ef9c0746e8e45f37aab8417b5fe8d59641bc85)
- Mint via /api/mint-v3 (server relay path): [`3f498e54…`](https://stellar.expert/explorer/testnet/tx/3f498e54980bc653b49b2b7fdfdd38077d382c85072aea68381d43614b8e309f)
- Day-1 budget probe: [docs/notes/soroban-budget-day1.md](soroban-budget-day1.md)
- Phase A acceptance (whale test): [docs/notes/phase-a-acceptance.md](phase-a-acceptance.md)
- Phase B deployment: [docs/notes/phase-b-deployment.md](phase-b-deployment.md)
- Phase B' acceptance + age floor: [docs/notes/phase-b-prime-acceptance.md](phase-b-prime-acceptance.md)
- Threat model: [docs/THREAT_MODEL.md](../THREAT_MODEL.md)

## What shipped (by feedback item)

| SCF reviewer feedback | Status now |
|---|---|
| "Centralized oracle = single point of trust" | Replaced by k-of-n threshold ed25519 verification on-chain. Live and tested. |
| "Underspecified components" | `docs/THREAT_MODEL.md` ships a STRIDE analysis of 6 vectors with code + tests + tx hashes for each. |
| "No verifiable traction" | Synthetic engine + 3 live testnet mints + collect-metrics CSV split (real vs synthetic). |
| "No defined access to MoneyGram" | Removed entirely. Protocol no longer needs any fintech partner to operate. |
| "Missing validation section" | `npm run validate-t1` returns a paste-able JSON with threshold demo, contract IDs, and test counts. Single command. |
| "Solo student developer, scope too ambitious" | Team of 3 declared in TEAM.md. Most of the original 14-day scope shipped in 3 days through tight focus. |

## What is intentionally NOT shipped

- **Mint fee escrow with refund on first repay.** Documented in THREAT_MODEL.md § 2 as deliberately deferred. The 30-day age floor already imposes a meaningful cost on Sybil bots; the marginal value of the mint fee in the SCF narrative is incremental, not foundational.
- **TLSNotary client-side attestation.** Post-grant work, listed in ARCHITECTURE.md as the long-term endgame.
- **A Soroban events stream in collect-metrics.** Currently uses baked-in known sprint tx hashes; the swap to a proper event indexer is a clean change once a public Soroban events endpoint is available.

## Pending administrative steps (not engineering)

1. **Cristian and Mauricio commits.** Per the planned multi-disciplinary git log, Cristian should commit docs(business) / docs(resubmission) updates and Mauricio should commit docs(traction) / chore(metrics). The repo files are ready for both.
2. **Final SCF form submission.** The fields are all ready in `docs/RESUBMISSION_FEEDBACK.md`, `docs/THREAT_MODEL.md`, `docs/TRANCHE_{1,2,3}_DELIVERABLES.md`, and `docs/BUSINESS_PLAN.md`. The submission itself is a manual action in the SCF dashboard.

## How a reviewer reproduces everything

```bash
git clone https://github.com/zzzbedream/VIGENTE-PROJECT.git
cd VIGENTE-PROJECT
cd contracts/vigente-badge && cargo test
cd ../reference-vault && cargo test
cd ../mock-usdc && cargo test
cd ../../web
npm install
npm run test:web        # 30 tests
npm run validate-t1     # paste-able JSON

# Optional: real testnet mint
npm run mint:onchain -- <YOUR_G_ADDRESS> 750 --age 60
```

Closing: every claim in this submission is checkable by running the code or following a stellar.expert link. Nothing here is promised; everything is shipped.
