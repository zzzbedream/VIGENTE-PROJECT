# Reputation-Priced Credit for Tokenized Assets on Soroban

![Network](https://img.shields.io/badge/stellar-testnet-blue) ![Pool](https://img.shields.io/badge/own%20pool-active-22c55e) ![Oracle](https://img.shields.io/badge/oracle-3--of--5%20threshold-22c55e) ![License](https://img.shields.io/badge/license-MIT-purple)

**Borrow against a tokenized asset instead of selling it — with a credit limit set by your
on-chain history, not by a flat 150% rule that ignores it.**

## The problem, in three lines

Someone holding a tokenized treasury bill who needs cash today has one option: **sell**. They
lose the yield and they lose the position, permanently, to solve a temporary liquidity need.

Lending markets could solve this, but on-chain lending has no memory: every borrower posts the
same over-collateralization whether they have repaid fifty loans or none. **The information
that would make credit cheaper exists on the ledger and nothing reads it.**

## What is live right now

| Contract | ID | What it does | Status |
|---|---|---|---|
| **`margin-controller`** | [`CCZNOV65…OCLJ`](https://stellar.expert/explorer/testnet/contract/CCZNOV65BYYMJP35CJDBRSUE5S6HRAW4R2MCB7LY4SVOXOHJKWK7OCLJ) | Sets each user's LTV from their reputation, then forwards to the pool | **active** |
| **`oracle-aggregator`** | [`CCG6EAGO…FQH4`](https://stellar.expert/explorer/testnet/contract/CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4) | Our SEP-40 feed: per-asset routes, 48h timelock, staleness and deviation guards | **active** |
| **Vigente pool** | [`CDYUHA3T…HNUI`](https://stellar.expert/explorer/testnet/contract/CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI) | Isolated Blend pool wired to our aggregator. XLM collateral / USDC debt | **`status: 0`** |
| **`vigente-badge` v3** | [`CDLLO7QE…HWVD`](https://stellar.expert/explorer/testnet/contract/CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD) | Soulbound reputation. `mint` needs 3-of-5 ed25519 signatures verified on-chain | **active** |
| Reflector | `CCYOZJCO…RN63` | Upstream price source — **third party**, not ours | — |
| `margin-controller` **v1** | [`CA4SFW73…CHDV`](https://stellar.expert/explorer/testnet/contract/CA4SFW7354P7AR6JQWLPNP4LUAH74KILBWMM2KFOJUJAOUM74XCMCHDV) | **History, not the product.** Same binary, but wired to Blend's *canonical* pool — kept so earlier published evidence stays verifiable | historical |

> Don't confuse v1 with the product. If you query `CA4SFW73…` you will see it pointing at
> Blend's canonical pool, because that is where it has always run. The product is `CCZNOV65…`.

## The evidence

Transaction hashes, not adjectives. Every one opens in a browser and says the same thing in a
year that it says today.

| What it proves | Transaction |
|---|---|
| Pool activated — `status: 2 → 0` | [`00130c83`](https://stellar.expert/explorer/testnet/tx/00130c8361571de6c0d7fdd57633bd4e3698c0a1b7103d5f6425518d813c3bab) |
| Silver deposits 1,000 XLM | [`787a44ad`](https://stellar.expert/explorer/testnet/tx/787a44ad68998cdeca21d0fda19970a70b08c3b594cf0af73b7a246e6b33d0e4) |
| Gold deposits **the same** 1,000 XLM | [`98c0ea45`](https://stellar.expert/explorer/testnet/tx/98c0ea45007a18838640e78064505129477a469b9e2e721340116897aa0c842f) |
| Borrow through the controller | [`e85cb1a6`](https://stellar.expert/explorer/testnet/tx/e85cb1a6f9786ff95068c80acb9ca56da3a70670f371c0167b09526f68d78692) |
| Repay → debt reaches zero | [`a1436a2d`](https://stellar.expert/explorer/testnet/tx/a1436a2dc0a48948aee5a36179366af27e835d475fcf44f90a2f389ecc7c5305) |
| Withdraw collateral | [`c07ed1a2`](https://stellar.expert/explorer/testnet/tx/c07ed1a2bad54897ba3cd5d057eb0fa2e6c07f49b4b2aa727255e7a9b8668e2f) |
| **Admin pauses the contract** | [`e8803f60`](https://stellar.expert/explorer/testnet/tx/e8803f60719d78e29dfcc4b593b8e687e4c93d2c49092701d132ef3dc9d12a82) |
| **User withdraws everything anyway, while paused** | [`d370b84a`](https://stellar.expert/explorer/testnet/tx/d370b84aab83cce899a3d944e7f9916520a202bdc4a4258e4a465d6006b6ba32) |

### Reputation actually changes the credit

Two accounts. **Identical collateral**, deposited in the two transactions above. Same block,
same contract. The only difference is the score.

| Account | Score | LTV | `max_borrow` (sample read) |
|---|---|---|---|
| `GC6IPCM3…` | 650 — Silver | 7500 bps | 1219070589 |
| `GDESGH52…` | 850 — Gold | 8500 bps | 1381613334 |

`1381613334 / 1219070589 = 1.13333…` — **exactly `8500 / 7500`.**

The ratio is the invariant. The absolute figures drift between reads because the oracle price
is live, so yours will differ; the ratio will not. **Recompute it yourself** with the commands
below.

### Non-custodial is a property of the code, not a promise

The admin's strongest lever is `pause()`, and it **cannot trap funds**: `withdraw_collateral`,
`repay` and `liquidate` never read the pause flag. The two last transactions in the table show
it under adversarial conditions — the admin pauses, and the user still withdraws their entire
collateral in the next block.

Full inventory of what the admin can and cannot do:
[`contracts/margin-controller/README.md`](contracts/margin-controller/README.md).

## Verify it yourself

No keys needed for any of this. Substitute any funded testnet account for `<YOUR_ACCOUNT>`.

```bash
POOL=CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI
CTRL=CCZNOV65BYYMJP35CJDBRSUE5S6HRAW4R2MCB7LY4SVOXOHJKWK7OCLJ

# 1. The pool is active AND runs on our oracle → status 0, oracle CCG6EAGO…
stellar contract invoke --id $POOL --network testnet \
  --source-account <YOUR_ACCOUNT> --send=no -- get_config

# 2. The tier ladder lives on-chain, not in a config file
stellar contract invoke --id $CTRL --network testnet \
  --source-account <YOUR_ACCOUNT> --send=no -- get_tier_ltv

# 3. Borrowing capacity for each demo account — recompute the ratio
stellar contract invoke --id $CTRL --network testnet --source-account <YOUR_ACCOUNT> \
  --send=no -- max_borrow --user GC6IPCM3OO44PW4Y62XD54HLT5Q23E5OFNFMYPMNUDSDRUK37ZFB6ECZ
stellar contract invoke --id $CTRL --network testnet --source-account <YOUR_ACCOUNT> \
  --send=no -- max_borrow --user GDESGH52DW7PYVRTYR43POJ7QHHLZ337SLKSAVMQ4OKFKNS2RPT3YJYF
```

**The transactions above are immutable; these commands read current state.** If an account has
withdrawn its collateral since, `max_borrow` returns 0 — that is the system working, not the
record being wrong. Deposit first if you want to reproduce the comparison live.

## Architecture

```
user ──deposit / borrow / repay / withdraw──▶ margin-controller
                                                     │
                          reads score ───────────────┤
                                 │                   │
                          vigente-badge      prices both legs
                          (3-of-5 SBT)              │
                                                     ▼
                                            oracle-aggregator (ours, SEP-40)
                                                     │
                                                     ├──▶ Reflector (third party)
                                                     │
                                            Blend pool ◀── lastprice()
```

**Blend never sees the score.** Its interface takes `Request{address, amount, request_type}` —
there is no reputation field, and we never ask it to add one. All the credit policy lives in
our wrapper, which is precisely why this composes with an immutable lending market that was
never designed for it.

A Blend pool's oracle slot is **immutable after deployment**, so this pool is permanently bound
to a feed we operate. Full design, including the off-chain half and the trust boundary:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## What does not exist yet

This section is what makes the rest of the document credible.

- **Proportional liquidation.** `liquidate` currently seizes *all* collateral, and there is no
  extraction path for seized funds. A borrower with 1,000 of collateral and 10 of debt would
  lose everything. First deliverable of Tranche 1.
- **Per-user exposure cap** — the only cap today is per asset.
- **Origination fee module** — `borrow` disburses the full amount, no deduction.
- **Tokenized assets as collateral** — XLM only. Everything about RWA collateral is roadmap.
- **Fiat ramp integration** — authenticated access to the provider works; the client is not
  built.
- **dApp** — contracts and CLI only.
- **Mainnet** — testnet by design, until an audit.
- **External users** — every account here is ours or a labelled synthetic. No TVL.

**And the honest limit of the design:** the reputation layer is **not trustless**. Scores are
computed off-chain and signed 3-of-5; the chain verifies signatures, not methodology. The five
signers are cryptographically independent but co-located, which removes single-key compromise,
not single-operator compromise. Both are deliberate trade-offs, and reducing them is funded
work, not a claim.

## Run the tests

From a fresh clone. These are standalone crates — **there is no cargo workspace**, so
`--workspace` will not work.

```bash
for c in vigente-badge margin-controller oracle-aggregator; do
  printf "%-20s " "$c"; (cd contracts/$c && cargo test -j 1 2>&1 | grep "^test result" | head -1)
done
```

Use `-j 1` on memory-constrained machines; default parallelism can exhaust the compiler.

```bash
cd web && npm install && cp .env.local.example .env.local && npm run dev
npm run validate-t1     # JSON status report for reviewers
```

## Status and roadmap

**Stellar testnet.** The credit cycle runs end to end on our own pool with our own oracle;
evidence above and in [`audit/08_POOL_ACTIVATION.md`](audit/08_POOL_ACTIVATION.md).

Grant funding covers, in order: **core hardening** (proportional liquidation, per-user caps,
fee module, custody property tests) · **RWA collateral and the fiat ramp** (third-party SEP-40
routing, first tokenized asset listed, ramp client, monitoring plan and threat model) ·
**capped mainnet** (multisig and timelock, public SDK, and a pilot that publishes repayment
rate **by reputation band** — the number that validates or refutes the whole thesis).

## For integrators

The badge is readable by any Soroban contract. No permission, no registration, no token.

```rust
#[contractclient(name = "BadgeClient")]
pub trait VigenteBadge {
    fn is_defaulted(env: Env, borrower: Address) -> bool;
    fn get_score(env: Env, borrower: Address) -> Option<u32>;
}
```

Interface spec: [`contracts/vigente-badge/INTERFACE.md`](contracts/vigente-badge/INTERFACE.md) ·
live ABI: [`docs/integration/abi-v3.json`](docs/integration/abi-v3.json) · compilable example:
[`examples/integration-snippet/`](examples/integration-snippet/) · proposed ecosystem standard:
[`docs/integration/sep-draft-credit-attestation.md`](docs/integration/sep-draft-credit-attestation.md).

`margin-controller` is itself the reference consumer.

## Team, license, disclosure

Founder-led. Roles and the honest authorship distribution in [`docs/TEAM.md`](docs/TEAM.md) —
verify with `git shortlog -sne --all`. Contact: zzzbedream@gmail.com

AI assistance disclosed per SCF Open Track requirements in
[`docs/AI_DISCLOSURE.md`](docs/AI_DISCLOSURE.md). Threat model:
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

MIT — see [LICENSE](./LICENSE).

---

<p align="center">
  <strong>Vigente Protocol</strong><br/>
  Reputation-priced credit for tokenized assets on Soroban<br/>
  <a href="audit/08_POOL_ACTIVATION.md">Evidence</a> ·
  <a href="https://stellar.expert/explorer/testnet/contract/CCZNOV65BYYMJP35CJDBRSUE5S6HRAW4R2MCB7LY4SVOXOHJKWK7OCLJ">Margin controller</a> ·
  <a href="https://stellar.expert/explorer/testnet/contract/CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI">Pool</a>
</p>

[SEP-40]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0040.md
