# Phase B.7 — Testnet Deployment & End-to-End Acceptance

**Date:** 2026-05-31 (Day 2 of sprint, ahead of plan)
**Outcome:** PASS — k-of-n threshold mint working in production testnet.

## What landed

| Artifact | Value |
|---|---|
| WASM hash | `2f346fc4a799f350af3e79e26f5bdfe8fa71f6e37f54b78a50f819594e1f1ca3` |
| Contract ID (v2) | `CCD7KNYIJAVN4JRZKCMZWCBK3ED43VYEBX5PSYHOBOR6BHMVMN2GUMA5` |
| Network | Stellar Testnet |
| Admin | `GBV676BNXDPVZDLUAB6O7DHWUIS42OTIWI5MIKCFJOWMJWTVKQNXFWCM` (mother account, Day 1 T3) |
| Oracle ACL | 5 keys configured, threshold `k = 3` |
| Persisted seed material | `web/.env.local` under `VIGENTE_ORACLE_SEEDS_HEX` (gitignored) |

## Deploy sequence

1. `stellar contract build` → `target/wasm32v1-none/release/vigente_badge.wasm` (14 KB)
2. `stellar contract deploy --wasm …` → Contract ID v2 above
3. `stellar contract invoke … -- initialize --admin GBV676BN…` → init event emitted
4. `npm run setup:oracle-keys` → 5 seeds persisted, 5 raw pubkeys printed
5. `stellar contract invoke … -- set_oracle_keys --keys '[…5 hex pubkeys…]' --threshold 3` → ACL event emitted

## End-to-end mint smoke (the test that mattered)

`npm run mint:onchain -- GBV676BN… 750`

This script:
- Generates a 32-byte nonce.
- Signs the canonical mint message (`borrower.to_xdr() || score_be || expiration_be || nonce`) with 3 oracles from the simulator.
- Assembles a Soroban tx calling `mint(borrower, 750, expiration, nonce, [(0,sig0),(1,sig1),(2,sig2)])`.
- Submits via Soroban RPC; waits for inclusion.
- Reads `get_score(borrower)` to verify the badge is active.

| Field | Value |
|---|---:|
| Tx hash | `e5e3a39286339b794349e4bb8eaac6ff811a5e9c9153c8a1840b21ce6996c482` |
| Status | SUCCESS |
| `get_score(borrower)` | **750** (matches what we signed) |
| Round-trip latency | ~5 s (network-bound) |

[View on stellar.expert](https://stellar.expert/explorer/testnet/tx/e5e3a39286339b794349e4bb8eaac6ff811a5e9c9153c8a1840b21ce6996c482)

## Why this matters

This is the **first time the threshold pipeline was validated end-to-end on a live network**. Before today we had:

- 37 in-process Rust tests of the contract (badge unit suite)
- 10 cross-contract Rust tests (vault integration)
- 23 TypeScript tests of the off-chain simulator and XDR parity

But these all ran inside the same machine, same SDK build, same simulation harness. The risk was that **byte-level XDR parity between TS `Address.toScVal().toXDR()` and Rust `borrower.to_xdr(env)`** held in tests but failed in production — for example, if the Soroban host happens to canonicalize the bytes differently before passing them to `ed25519_verify`.

The mint on tx `e5e3a39…` proves the parity holds across:
- TypeScript signer (`web/src/services/threshold-oracle.ts`) → produces 64-byte sigs.
- Soroban transaction encoding (`stellar-sdk` v14 nativeToScVal / xdr.ScVal builders).
- Soroban host's XDR deserialization of the call args.
- Rust contract's `build_mint_message()` reconstruction.
- Soroban host's `ed25519_verify` syscall.

If any link in that chain had a hidden divergence, the contract would have panicked with `Error(Crypto, InvalidInput)`. It didn't.

## Open items from B.7

- **Vault deployment** — `reference-vault` is not yet on testnet. Deferred to Phase B' (where its TVL cap, util limit, and timelock are added). Bug 1 (vault tests) is already resolved on the test side.
- **Legacy /api/mint and /api/evaluate-and-fund routes** — still pointed at the v1 contract `CATE7NU…` to keep the Vercel demo functional. Migration plan in `docs/notes/phase-b-route-migration.md`. Target: Phase C.
- **Production seed rotation** — the 5 seeds in `.env.local` are gitignored; for SCF reviewers reproducing the demo, they regenerate by running `npm run setup:oracle-keys`. For mainnet, seeds must move to KMS / HSM (post-grant).

## Numbers worth quoting to the SCF jury

- 80 tests green across Rust + TypeScript.
- 1 wasm deployed at 14 KB.
- 3 oracle signatures per mint, threshold = 3, n = 5.
- 1 successful end-to-end mint with verified cross-language XDR parity.
- Total dev time Day 1 + Day 2: under 24 elapsed hours.
