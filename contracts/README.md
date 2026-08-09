# Contracts

Four Soroban crates. **Each is a standalone crate — there is no Cargo workspace**, so build and
test them individually.

| Crate | Deployed (testnet) | Role |
|---|---|---|
| [`margin-controller`](margin-controller/) | [`CCZNOV65…OCLJ`](https://stellar.expert/explorer/testnet/contract/CCZNOV65BYYMJP35CJDBRSUE5S6HRAW4R2MCB7LY4SVOXOHJKWK7OCLJ) | **The product.** Prices each user's LTV from their reputation badge, then forwards to Blend |
| [`oracle-aggregator`](oracle-aggregator/) | [`CCG6EAGO…FQH4`](https://stellar.expert/explorer/testnet/contract/CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4) | SEP-40 price feed. Sits in the immutable oracle slot of our Blend pool |
| [`vigente-badge`](vigente-badge/) | [`CDLLO7QE…HWVD`](https://stellar.expert/explorer/testnet/contract/CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD) | Soulbound reputation token. `mint` verifies 3-of-5 ed25519 signatures on-chain |
| [`mock-usdc`](mock-usdc/) | — | Test token for local runs |

The margin controller operates over Vigente's own isolated Blend pool
[`CDYUHA3T…HNUI`](https://stellar.expert/explorer/testnet/contract/CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI)
(`status: 0`, active). Full activation evidence and reproduction commands:
[`../audit/08_POOL_ACTIVATION.md`](../audit/08_POOL_ACTIVATION.md).

A previous instance, `margin-controller` v1
[`CA4SFW73…CHDV`](https://stellar.expert/explorer/testnet/contract/CA4SFW7354P7AR6JQWLPNP4LUAH74KILBWMM2KFOJUJAOUM74XCMCHDV),
is still live on Blend's canonical pool. Same binary, same wasm hash — it exists only because
`blend_pool` is immutable after `init`, so pointing at a new pool required a new instance. It
is kept so previously published evidence stays verifiable.

## Build and test

```bash
# One crate
cd margin-controller && cargo test

# All of them
for c in vigente-badge margin-controller oracle-aggregator; do
  printf "%-20s " "$c"; (cd "$c" && cargo test -j 1 2>&1 | grep "^test result" | head -1)
done
```

> Use `cargo test -j 1` on memory-constrained machines: default parallelism can exhaust the
> compiler and abort the build.

**About `test_snapshots/`:** Soroban writes a ledger snapshot per test. They are deterministic
for a given compiled binary, so they catch unintended changes to contract behavior — but they
embed the wasm hash, which changes whenever the contract is recompiled with a different
toolchain or dependency set. If `git status` shows them modified after your first
`cargo test`, that is expected and not a failure; the pass/fail counts are what matter.

## Deploying

Contracts are **not upgradeable** — none of them implements
`update_current_contract_wasm`. Any change means a new deployment and voluntary user
migration, which is why new functionality is batched into a single redeploy rather than
shipped one function at a time.

To deploy a byte-identical copy of something already on-chain, reuse the installed wasm hash
instead of recompiling:

```bash
stellar contract fetch --id <EXISTING_ID> --network testnet --out-file c.wasm
sha256sum c.wasm                       # this is the installed wasm hash
stellar contract deploy --wasm-hash <hash> --source-account <ALIAS> --network testnet
```

After deploying a new `margin-controller`, authorize it on the badge or slashing will silently
fail on liquidation:

```bash
stellar contract invoke --id <BADGE_ID> --source-account <BADGE_ADMIN> --network testnet \
  -- add_vault --vault <NEW_CONTROLLER_ID>
```

## Where to look

- [`margin-controller/README.md`](margin-controller/README.md) — tier ladder, safety rules, and
  the inventory of what the admin **cannot** do
- [`oracle-aggregator/src/lib.rs`](oracle-aggregator/src/lib.rs) — the 48h route timelock, with
  the reasoning in the comments
- [`vigente-badge/INTERFACE.md`](vigente-badge/INTERFACE.md) — the public read interface for
  integrators

Archived contracts (`reference-vault`, `pyme_token_v1`) live in [`../archive/`](../archive/)
and are **out of scope** — that folder's README documents their known defects. Do not fork
them.
