# Example: consuming the Vigente Credit Oracle from your Soroban contract

Minimal, compilable example of gating a credit decision on a borrower's
Vigente badge via cross-contract calls. Two reads is all it takes:

```rust
#[contractclient(name = "BadgeClient")]
pub trait VigenteBadge {
    fn is_defaulted(env: Env, borrower: Address) -> bool;
    fn get_score(env: Env, borrower: Address) -> Option<u32>;
}

let badge = BadgeClient::new(&env, &badge_contract_address);
if badge.is_defaulted(&borrower) { panic!("borrower is in default"); }
let score = badge.get_score(&borrower).unwrap_or(0);
// your policy here
```

## Run it

```bash
cd examples/integration-snippet
cargo test          # 2 tests: score-scaled approval + default rejection
```

## Point it at the live testnet oracle

The badge contract on Stellar testnet:

```
CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD
```

Build, deploy your consumer, then `initialize` it with that address. Full
interface documentation (all six read functions, types, trust model,
versioning policy): [`contracts/vigente-badge/INTERFACE.md`](../../contracts/vigente-badge/INTERFACE.md).

For a production-grade consumer — score-tiered limits, first-loan
throttling, slash cascade on liquidation — read
[`contracts/reference-vault/`](../../archive/reference-vault/), which runs
this exact pattern with full integration tests.

No permission, registration, or token is needed to read the oracle. That is
the point of a credit primitive.
