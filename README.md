# Vigente Protocol — non-custodial credit, priced by reputation

![Network](https://img.shields.io/badge/stellar-testnet-blue) ![Pool](https://img.shields.io/badge/own%20pool-active-22c55e) ![Oracle](https://img.shields.io/badge/oracle-3--of--5%20threshold-22c55e) ![License](https://img.shields.io/badge/license-MIT-purple)

> **Over-collateralization is a blunt instrument.** Every borrower posts the same 150%
> regardless of history, because on-chain lending has no memory. Vigente gives it one: a
> margin controller that sets each user's LTV from an on-chain reputation badge, in front of
> an isolated Blend pool that runs on **our own SEP-40 oracle**.
>
> The lending market never reads the score. It doesn't have to — and that's what makes this
> composable without asking anyone's permission.

**The one thing to look at:** two accounts, identical collateral, same block, same contract.
The only difference is reputation.

| Account | Collateral | Score | LTV | `max_borrow` (sample read) |
|---|---|---|---|---|
| `GC6IPCM3…` | 1,000 XLM | 650 (Silver) | 7500 bps | 1223133480 |
| `GDESGH52…` | 1,000 XLM | 850 (Gold) | 8500 bps | 1386217944 |

**The invariant is the ratio, not the absolutes.** `1386217944 / 1223133480 = 1.1333…` —
exactly `8500 / 7500`. The absolute figures drift between reads because the oracle price is
live, so your numbers will differ slightly; the ratio will not. Reproduce it in §*Verify it
yourself*. Full evidence, with every transaction hash:
**[`audit/08_POOL_ACTIVATION.md`](audit/08_POOL_ACTIVATION.md)**.

---

## Live contracts (Stellar testnet)

| Component | Contract ID | What it does |
|---|---|---|
| **`margin-controller`** | [`CCZNOV65…OCLJ`](https://stellar.expert/explorer/testnet/contract/CCZNOV65BYYMJP35CJDBRSUE5S6HRAW4R2MCB7LY4SVOXOHJKWK7OCLJ) | **The product.** Enforces per-user LTV from the badge before forwarding to Blend |
| **`oracle-aggregator`** | [`CCG6EAGO…FQH4`](https://stellar.expert/explorer/testnet/contract/CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4) | **Ours.** SEP-40 price feed: per-asset routes with a 48h timelock, staleness bound, deviation guard |
| **Vigente pool** | [`CDYUHA3T…HNUI`](https://stellar.expert/explorer/testnet/contract/CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI) | Isolated Blend pool, **`status: 0` (active)**, wired to our aggregator. XLM collateral / USDC debt |
| **`vigente-badge` v3** | [`CDLLO7QE…HWVD`](https://stellar.expert/explorer/testnet/contract/CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD) | Soulbound reputation token. `mint` requires **3-of-5** ed25519 signatures verified on-chain |
| Reflector | `CCYOZJCO…RN63` | Upstream price source — **third party**, not ours |

`margin-controller` v1 [`CA4SFW73…CHDV`](https://stellar.expert/explorer/testnet/contract/CA4SFW7354P7AR6JQWLPNP4LUAH74KILBWMM2KFOJUJAOUM74XCMCHDV)
is still live on Blend's canonical pool. It is **published history, not the product** — kept
because prior evidence should stay verifiable. It runs the identical binary (same wasm hash);
the new instance exists only to point at our own pool, since `blend_pool` is immutable after
`init` ([`lib.rs:245`](contracts/margin-controller/src/lib.rs#L245)).

## How it works

```
user deposits collateral
   → controller reads the user's score from vigente-badge
   → derives the tier LTV        (≥800 → 85% · ≥550 → 75% · ≥300 → 60%)
   → checks capacity against the oracle (fresh price, or revert)
   → only then forwards a Request to the Blend pool

price chain:  Blend pool ──lastprice()──▶ OUR aggregator ──▶ Reflector (third party)
```

**Blend never sees the score.** Its interface takes `Request{address, amount, request_type}` —
there is no reputation field. All the credit logic lives in our wrapper, which is exactly why
this composes with an immutable lending market that was never designed for it.

### Non-custodial, as a property of the code

The admin's strongest lever is `pause()`, and it **cannot trap funds**: `withdraw_collateral`,
`repay` and `liquidate` never consult the pause flag. Demonstrated on-chain — admin pauses,
deposit reverts, and the user still withdraws their entire collateral
([tx `d370b84a`](https://stellar.expert/explorer/testnet/tx/d370b84aab83cce899a3d944e7f9916520a202bdc4a4258e4a465d6006b6ba32)).
The full inventory of what the admin can and cannot do is in
[`contracts/margin-controller/README.md`](contracts/margin-controller/README.md).

## Verify it yourself

No keys needed — every call below is a read. Substitute any funded testnet account for
`<YOUR_ACCOUNT>`.

```bash
POOL=CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI
CTRL=CCZNOV65BYYMJP35CJDBRSUE5S6HRAW4R2MCB7LY4SVOXOHJKWK7OCLJ

# 1. The pool is active AND runs on our oracle → status 0, oracle CCG6EAGO…
stellar contract invoke --id $POOL --network testnet \
  --source-account <YOUR_ACCOUNT> --send=no -- get_config

# 2. Reputation moves credit: same collateral, different score, different capacity
stellar contract invoke --id $CTRL --network testnet --source-account <YOUR_ACCOUNT> \
  --send=no -- max_borrow --user GC6IPCM3OO44PW4Y62XD54HLT5Q23E5OFNFMYPMNUDSDRUK37ZFB6ECZ
stellar contract invoke --id $CTRL --network testnet --source-account <YOUR_ACCOUNT> \
  --send=no -- max_borrow --user GDESGH52DW7PYVRTYR43POJ7QHHLZ337SLKSAVMQ4OKFKNS2RPT3YJYF

# 3. The tier ladder is on-chain, not in a config file
stellar contract invoke --id $CTRL --network testnet \
  --source-account <YOUR_ACCOUNT> --send=no -- get_tier_ltv
```

Tests — run them rather than trusting a badge:

```bash
for c in vigente-badge margin-controller oracle-aggregator; do
  printf "%-20s " "$c"; (cd contracts/$c && cargo test -j 1 2>&1 | grep "^test result" | head -1)
done
```

<details><summary>Expected output (2026-08-08)</summary>

```
vigente-badge        test result: ok. 41 passed; 0 failed; ...
margin-controller    test result: ok. 37 passed; 0 failed; ...
oracle-aggregator    test result: ok. 19 passed; 0 failed; ...
```
</details>

> On a memory-constrained machine use `cargo test -j 1`; the default parallelism can exhaust
> the compiler.

## Status — the unvarnished version

Both columns are equally true. Reviewers and partners deserve the second one.

| ✅ Works today, verifiable | ❌ Does not exist yet |
|---|---|
| Own Blend pool, active, on our own SEP-40 oracle | Mainnet — testnet only, by design, until audit |
| Full credit cycle on it: supply → borrow → repay → withdraw | Fee module — deliberately deferred |
| Per-user LTV from on-chain reputation, verified across two tiers | Partial liquidation — full-position only |
| Non-custodial guarantee proven under `pause()` | Fiat on/off ramp — integration not built |
| 3-of-5 threshold mint, ed25519 verified on-chain | Stablebond / RWA collateral — XLM only today |
| 48h timelock + deviation guard on oracle route changes | External users — all accounts so far are ours or labeled synthetics |
| **Signed commercial agreement** with Etherfuse (tokenized-asset issuer and fiat ramp), KYB approved, production API access granted | The ramp integration itself — access exists, the client does not |
| 97 Rust tests across three crates | Security audit — SCF audit credits apply at T3 |

**Two limits worth stating plainly.** First, **the reputation layer is not trustless**: the
score is computed off-chain and signed k-of-n; the chain only verifies signatures. That is a
deliberate design decision, not an oversight, and reducing that trust — independent signer
hosts, a methodology a third party can recompute — is explicit Tranche 2 work. Second, this
runs at **testnet scale**: ~1,400 USDC of lendable liquidity proves the mechanics, not
behavior under load.

## For integrators — credit oracle interface

The badge is readable by any Soroban contract or off-chain client. No permission, no
registration, no token.

```rust
#[contractclient(name = "BadgeClient")]
pub trait VigenteBadge {
    fn is_defaulted(env: Env, borrower: Address) -> bool;
    fn get_score(env: Env, borrower: Address) -> Option<u32>;
}
```

| Resource | Where |
|---|---|
| Interface spec — read functions, types, trust model, versioning | [`contracts/vigente-badge/INTERFACE.md`](contracts/vigente-badge/INTERFACE.md) |
| Machine-readable ABI, exported from the live contract | [`docs/integration/abi-v3.json`](docs/integration/abi-v3.json) |
| Compilable consumer example + cross-contract tests | [`examples/integration-snippet/`](examples/integration-snippet/) |
| Proposed ecosystem standard (SEP draft) | [`docs/integration/sep-draft-credit-attestation.md`](docs/integration/sep-draft-credit-attestation.md) |

`margin-controller` is itself the reference consumer: it reads the badge and enforces policy
without the lending market participating.

## Architecture

On-chain is only half the system. The scoring engine, the threshold signers and the API run
off-chain, and the split matters for the trust model — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Threat model, 6 STRIDE vectors each mapped to code and a named test:
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Install

```bash
git clone https://github.com/zzzbedream/VIGENTE-PROJECT.git
cd VIGENTE-PROJECT

# Contracts — standalone crates, no workspace
cd contracts/margin-controller && cargo test -j 1

# Web app
cd ../../web
npm install
cp .env.local.example .env.local   # required vars documented in the file
npm run dev                        # http://localhost:3000

npm run validate-t1                # JSON status report for reviewers
```

| Layer | Technology |
|---|---|
| Contracts | Rust + Soroban SDK — margin controller, oracle aggregator, badge SBT, mock USDC |
| Scoring + oracle | Node.js / TypeScript — Horizon scoring, 3-of-5 threshold signers, fintech adapters |
| Frontend | Next.js + Tailwind + Stellar Wallets Kit |
| Network | Stellar testnet — sub-cent fees, ~5s finality |

## Evidence and history

| Document | What it holds |
|---|---|
| [`audit/08_POOL_ACTIVATION.md`](audit/08_POOL_ACTIVATION.md) | **Start here.** Pool activation, full cycle, custody proof, reproduction commands |
| [`audit/07_OWN_POOL_EVIDENCE.md`](audit/07_OWN_POOL_EVIDENCE.md) | Pool deployment. Its "why it can't activate" section is superseded by `08` |
| [`contracts/margin-controller/README.md`](contracts/margin-controller/README.md) | Admin powers inventory: what the admin can and, more importantly, cannot do |
| [`docs/SCF_REBUTTAL.md`](docs/SCF_REBUTTAL.md) | SCF #41 rejection points answered with artifacts |

Superseded documents are kept and labeled rather than deleted — the trail of decisions is part
of the evidence.

## Team, license, disclosure

Three defined roles — protocol/contracts, backend and integrations, partnerships — with
profiles in [`docs/TEAM.md`](docs/TEAM.md). Contact: zzzbedream@gmail.com

**Being straight about execution risk:** this is founder-led. Essentially the entire commit
history is the founder's — a contributing engineer has two commits, and the other roles have
contributed in design and business rather than code. Don't take the number from us, it moves
with every push:

```bash
git shortlog -sne --all   # four lines, two people: each of us commits under two name spellings
```

That concentration is a real risk, and it is the one the SCF #41 panel identified. What the
same history shows is what got shipped anyway: four contracts on testnet, a custom SEP-40
aggregator, an isolated Blend pool running on it, a security audit with documented
remediation, and a signed commercial agreement with a tokenized-asset issuer. The plan is to
hire from the grant rather than claim a team that does not exist yet.

AI assistance is disclosed per SCF Open Track requirements in
[`docs/AI_DISCLOSURE.md`](docs/AI_DISCLOSURE.md). Contributions welcome via
[issues](https://github.com/zzzbedream/VIGENTE-PROJECT/issues).

MIT — see [LICENSE](./LICENSE).

---

<p align="center">
  <strong>Vigente Protocol</strong><br/>
  Non-custodial credit, priced by reputation<br/>
  <a href="audit/08_POOL_ACTIVATION.md">Evidence</a> ·
  <a href="https://stellar.expert/explorer/testnet/contract/CCZNOV65BYYMJP35CJDBRSUE5S6HRAW4R2MCB7LY4SVOXOHJKWK7OCLJ">Margin controller</a> ·
  <a href="https://stellar.expert/explorer/testnet/contract/CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI">Pool</a>
</p>

[SEP-40]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0040.md
