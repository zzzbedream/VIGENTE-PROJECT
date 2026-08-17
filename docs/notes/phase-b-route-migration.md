# Phase B Hardening — API Route Migration Plan

> ## 🗄️ HISTORICAL — completed and superseded
>
> This was a **May 2026 migration plan**. It is kept for traceability only. The legacy routes it
> discusses (`api/mint`, `api/evaluate-and-fund`, `services/mint-service.ts`) were **deleted** from
> the codebase in July 2026 — they no longer exist and cannot be called. The live API surface today
> is `api/mint-v3`, `api/oracle`, `api/score` and `api/waitlist`.

**Status:** Bug 2 ack'd, simulator delivered, legacy routes intentionally left intact.
**Owner:** Founder (zzzbedream)
**Target completion:** Phase C (Day 8-9, ~Jun 4-5)

---

## Why the legacy routes still exist

Two API routes currently call the **V1 legacy contract** (`CATE7NUICQNBSUKF3RMA2HQAJK2RWCHCYH4NCPTQDLFNWNUNSFTTUH4W`) via the `mint_badge(user, tier, score, data_hash)` interface:

- `web/src/app/api/mint/route.ts` (eliminado)
- `web/src/app/api/evaluate-and-fund/route.ts` (eliminado)

These power the **currently-live Vercel demo** at https://vigente-hackathon-final.vercel.app. Replacing them before Phase B.7 (testnet deploy of `vigente-badge` v2) would break the demo and the existing tracking story.

The Phase B refactor of `vigente-badge` is real (37 unit tests + 10 vault integration tests + 4 smoke tests, all green), but until v2 is deployed and a fresh CONTRACT_ID is in `.env.local`, the legacy routes are still the *only* working path to a real mint.

## What is ready for Phase C consumption

The threshold oracle is fully implemented and tested off-chain:

| Artifact | Path | Tests |
|---|---|---|
| Simulator | `web/src/services/threshold-oracle.ts` | 9 unit tests (`tests/threshold-oracle.test.ts`) |
| XDR parity check vs Rust | `web/tests/xdr-parity.test.ts` | 2 tests, validated against `threshold_smoke::smoke_address_xdr_parity_check` |
| API endpoint (sign) | `web/src/app/api/oracle/sign-threshold/route.ts` | manual smoke pending Phase C |
| API endpoint (pubkeys) | same route, GET method | manual smoke pending Phase C |

A Phase C frontend hitting `POST /api/oracle/sign-threshold` with `{ borrower, score, expiration }` receives a `SignedMintRequest` that can be handed straight to a Soroban transaction builder.

## Migration checklist for Phase C

The full migration to the threshold flow is **5 concrete steps**:

1. **Deploy `vigente-badge` v2 to testnet** (Phase B.7).
   - Build wasm: `cd contracts/vigente-badge && cargo build --release --target wasm32-unknown-unknown`
   - Deploy: `stellar contract deploy --wasm target/.../vigente-badge.wasm --network testnet`
   - Init: `stellar contract invoke ... -- initialize --admin <ADMIN_KEY>`
   - Configure oracle ACL: `stellar contract invoke ... -- set_oracle_keys --keys '[<5 pubkeys hex>]' --threshold 3`
     - Pubkeys come from `GET /api/oracle/sign-threshold`.
   - Register vault: `stellar contract invoke ... -- add_vault --vault <VAULT_CONTRACT_ID>`
   - **Persist new CONTRACT_ID** in `web/.env.local` as `NEXT_PUBLIC_CONTRACT_ID_V2`.

2. **Add the v2 mint route** at `web/src/app/api/mint-v2/route.ts`.
   - Body: `{ borrower, score, expiration }`.
   - Internally: call `buildSignedMintRequest`, assemble a `Contract(CONTRACT_ID_V2).call("mint", ...)` operation with the threshold signature vector, sign with a relayer keypair (covers gas only), submit via Soroban RPC.
   - The signature vector is passed as `ScVal::Vec` of `ScVal::Tuple(u32, BytesN<64>)`.

3. **Update frontend** ([web/src/app/page.tsx](../../web/src/app/page.tsx)) to call `mint-v2` instead of `mint`. UI shows "3 oracles signed" badge in the success state.

4. **Keep the legacy routes alive as deprecated** for two business days post-migration. Add `@deprecated` JSDoc and a console warning. After observing zero usage, delete in a single commit.

5. **Update `validate-t1` script** to exercise the new flow end-to-end (already in the plan as D.4).

## Why NOT do this now

- The Phase B refactor commit `69668f0` is the only thing we needed to validate that the threshold contract path is feasible. The next deps are testnet deploy + frontend UX, which belong in B.7 / Phase C respectively.
- Migrating the routes now would require either (a) keeping the legacy CONTRACT_ID in env (false positive — looks like v2 is live when it isn't) or (b) breaking the Vercel demo for 5+ days.
- Option (b) jeopardizes the SCF narrative ("live MVP since hackathon"). Option (a) is dishonest.
- Cleanly deferring to Phase C is the cheapest correct path.

## Verification at Phase C completion

After the migration, this command should succeed against the **new** CONTRACT_ID:

```bash
curl -X POST http://localhost:3000/api/mint-v2 \
  -H "Content-Type: application/json" \
  -d '{"borrower":"GBV676BN...","score":750,"expiration":1727000000}'
# Expect: { "ok": true, "tx_hash": "...", "contract_id": "C...v2", "signatures": 3 }
```

And the GET pubkeys endpoint matches whatever was passed to `set_oracle_keys`:

```bash
curl http://localhost:3000/api/oracle/sign-threshold
# pubkeysHex must equal what stellar-expert shows for the contract's OracleKeys storage.
```
