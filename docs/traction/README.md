# Traction data — status and how to read it

> **These files are a historical snapshot from June 2026, kept for traceability.**
> They predate the pivot to collateralized credit and the activation of our own pool.
> For current evidence, read [`audit/08_POOL_ACTIVATION.md`](../../audit/08_POOL_ACTIVATION.md)
> and [`audit/09_RAMP_CONNECTIVITY.md`](../../audit/09_RAMP_CONNECTIVITY.md), where every claim
> is backed by a transaction hash or an on-chain read with its command.

## What each file is

| File | Generated | What it holds |
|---|---|---|
| `metrics-real.csv` | 2026-05-31 | **Header only — no rows.** Zero real users had minted a badge at that date. |
| `metrics-synthetic.csv` | 2026-05-31 | Two badge mints against our own test account, explicitly classified `synthetic`. |
| `kpi-baseline.json` | 2026-06-16 | KPI baseline from before the pool existed. |

## Why the empty file is here

`metrics-real.csv` has a header and no data. That is the point: the collection script emits real
and synthetic records into **separate files** so that test activity can never be counted as
adoption. When there were no real users, the real file stayed empty rather than being padded with
our own transactions.

We keep it in the repository for the same reason — a reviewer can verify that we were not
reporting our own test mints as traction.

## What we do not claim

No users on mainnet. No TVL. The activity that exists is on testnet and is documented, with
hashes, in the `audit/` reports linked above.
