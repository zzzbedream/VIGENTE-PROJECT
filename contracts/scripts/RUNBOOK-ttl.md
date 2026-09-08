# Runbook - TTL of the deployed contracts

Closes the manual half of finding **M-01** (`audit/10_SECURITY_REVIEW_REPORT.md`). The
automated half is `web/scripts/ttl-check.ts`, run weekly by
`.github/workflows/ttl-keeper.yml`.

## Why this matters

Soroban archives a contract instance once its TTL ledger passes. An archived instance makes
every **real** transaction against that contract fail until someone pays for a
`RestoreFootprint`.

This is not hypothetical here. On 2026-09-02 the badge instance was already archived
(`liveUntilLedgerSeq: 0`, finding H-04) and the pool had 2.8 days left. It went unnoticed
because **the Stellar CLI auto-restores an archived entry before invoking**, so manual
testing kept working while a real integration would have failed.

## Watched instances

| Name | Contract | Why it is watched |
|---|---|---|
| badge | `CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD` | Every controller path reads it. Expired once. |
| pool | `CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI` | Our isolated Blend pool |
| aggregator | `CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4` | Sits in the pool immutable oracle slot |
| controller | see the canonical table in the root `README.md` | Active instance |
| controller-prev | idem | Published evidence links to it, and it still holds locked collateral (N-01) |

Keep this list in sync with `WATCHED` in `web/scripts/ttl-check.ts` whenever a contract is
redeployed. That array is the source of truth for the keeper.

## Check

```bash
cd web && npm run ttl-check          # threshold 30 days
TTL_MIN_DAYS=60 npm run ttl-check    # stricter
TTL_JSON=1 npm run ttl-check         # machine-readable block as well
```

Exit codes: `0` all above threshold, `1` at least one below or archived, `2` the check itself
could not run. **`2` is not a pass** - treat an unreachable RPC as unknown, not healthy.

## Fix

Both operations are **permissionless**: any funded account can pay for them. There is no need
to touch an admin key.

> Do **not** use the burned key `GAJT5NOK...` (rotated in C-01). Use `admin-v2` or any funded
> testnet account.

Extend an instance that is still live:

```bash
stellar contract extend --id <CONTRACT_ID> \
  --source-account <ANY_FUNDED_ACCOUNT> --network testnet \
  --ledgers-to-extend 3110000        # about 180 days at 5s per ledger
```

Restore an instance that already archived, then extend it:

```bash
stellar contract restore --id <CONTRACT_ID> \
  --source-account <ANY_FUNDED_ACCOUNT> --network testnet \
  --ledgers-to-extend 3110000
```

Verify afterwards with `npm run ttl-check`, and record the transaction hash in
`audit/12_FINDINGS_CLOSED.md` if the entry had actually expired.

## One more entry the keeper does not cover

The aggregator writes `LastGood(asset)` on every successful `lastprice` (finding L-02), and
those persistent entries expire on their own. If they archive, the next real read needs a
restore, and after a restore the deviation guard compares against a **stale** reference
(H-03 b), which can reject a legitimate price.

Do not merely restore them - refresh them, so the reference is current:

```bash
stellar contract invoke --network testnet --source-account <ANY_FUNDED_ACCOUNT> \
  --id <AGGREGATOR_ID> -- lastprice --asset '{"Stellar":"<ASSET_ID>"}'
```

This must be a real transaction, not `--send=no`: a simulation does not write.
