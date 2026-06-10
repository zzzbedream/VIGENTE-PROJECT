# Vigente Credit Oracle — Interface v1

> Canonical reference for integrating with the `vigente-badge` contract.
> Any Soroban contract or off-chain client can read borrower credit state
> through this interface — no permission, no token, no registration.

| | |
|---|---|
| **Contract ID (testnet)** | `CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD` |
| **Deployed WASM sha256** | `60fe64dc480893e28a54d35d544bc0344666e5e9f7cda6851f38ec6cc6d66c80` |
| **Network** | Stellar Testnet (`Test SDF Network ; September 2015`) |
| **Explorer** | [stellar.expert/explorer/testnet/contract/CDLLO7QE…](https://stellar.expert/explorer/testnet/contract/CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD) |
| **Interface version** | v1 — see [Versioning policy](#versioning-policy) |
| **Reference consumer** | [`contracts/reference-vault/src/lib.rs`](../reference-vault/src/lib.rs) (in production use, with integration tests) |

---

## 1. Consumer Interface (stable, public, read-only)

These six functions are the contract's public read surface. They require no
authorization, cost only read fees, and their signatures will not change
within v1.

### `is_defaulted(borrower: Address) -> bool`

Returns `true` if the borrower has an immutable `DefaultBadge` record OR an
active badge marked `slashed`. This is the primary risk gate — **call this
first** before extending any credit.

```rust
if badge_client.is_defaulted(&borrower) {
    panic!("borrower is in default");
}
```

### `get_score(borrower: Address) -> Option<u32>`

Returns the borrower's credit score in `[0, 1000]`, or `None` when:
- no badge exists for this address,
- the badge has been slashed, or
- the badge has expired (`now > expires_at`).

A `None` is **not** an error — treat it as "no usable credit signal".

### `get_badge(borrower: Address) -> Option<CreditBadge>`

Full badge details when active and valid (same `None` semantics as
`get_score`):

```rust
pub struct CreditBadge {
    pub score: u32,            // 0-1000
    pub issued_at: u64,        // ledger timestamp
    pub expires_at: u64,       // ledger timestamp
    pub data_hash: BytesN<32>, // SHA-256 privacy commitment over attested data
    pub slashed: bool,         // always false when returned via this getter
}
```

### `get_default(borrower: Address) -> Option<DefaultBadge>`

The immutable default record, if one exists. Default records survive badge
expiry and cannot be deleted — this is the long-memory half of the oracle.

```rust
pub struct DefaultBadge {
    pub score_at_default: u32,
    pub defaulted_at: u64,     // ledger timestamp
    pub slashed_by: Address,   // the vault that initiated the slash
    pub reason: u32,           // 0=unspecified 1=non_payment 2=fraud 3=collateral_shortfall
}
```

### `get_oracle_keys() -> Vec<BytesN<32>>` · `get_oracle_threshold() -> u32`

The current threshold ACL: the n ed25519 oracle public keys and the k
required co-signatures. Lets an integrator audit who attests to scores
before trusting them. Current deployment: **n = 5, k = 3**.

### `get_min_wallet_age() -> u32`

The anti-Sybil wallet age floor (days) enforced at mint. Production posture
is 30; may be temporarily lowered on testnet for demos.

---

## 2. How to consume cross-contract (Rust / Soroban)

The pattern used by `reference-vault` in production — declare a client trait
for just the functions you need:

```rust
use soroban_sdk::{contractclient, Address, Env};

#[contractclient(name = "BadgeClient")]
pub trait VigenteBadge {
    fn is_defaulted(env: Env, borrower: Address) -> bool;
    fn get_score(env: Env, borrower: Address) -> Option<u32>;
}

// In your contract logic:
let badge = BadgeClient::new(&env, &badge_contract_address);
if badge.is_defaulted(&borrower) {
    panic!("borrower is in default");
}
let score = badge.get_score(&borrower).unwrap_or(0);
// Apply your own policy on top of the score — tiering, limits, rates.
```

This is exercised end-to-end by the `reference-vault` integration tests
(`cargo test --package reference-vault`), including the slash cascade —
those tests are the living proof that the cross-contract path works.

## 3. How to consume off-chain (TypeScript)

Read via simulation — free, no signature needed:

```typescript
import { Contract, rpc, TransactionBuilder, BASE_FEE, Address, scValToNative } from "@stellar/stellar-sdk";

const server = new rpc.Server("https://soroban-testnet.stellar.org");
const contract = new Contract("CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD");

const tx = new TransactionBuilder(await server.getAccount(anyFundedAccount), {
  fee: BASE_FEE, networkPassphrase: "Test SDF Network ; September 2015",
})
  .addOperation(contract.call("get_score", Address.fromString(borrower).toScVal()))
  .setTimeout(30)
  .build();

const sim = await server.simulateTransaction(tx);
if (rpc.Api.isSimulationSuccess(sim) && sim.result?.retval) {
  const score = scValToNative(sim.result.retval); // number | null
}
```

## 4. Write surface (NOT part of the consumer interface)

For completeness — integrators do not call these:

| Function | Access | Purpose |
|---|---|---|
| `mint(borrower, score, expiration, account_age_days, nonce, signatures)` | anyone paying gas, but requires k-of-n oracle signatures over the canonical 92-byte message | Issue a badge. Signatures come from the threshold oracle set — a relayer cannot forge them |
| `slash(caller, borrower, reason)` | authorized vaults only (`add_vault` ACL) | Burn a badge + write the immutable default record |
| `initialize`, `set_oracle_keys`, `set_min_wallet_age`, `add_vault`, `remove_vault`, `pause`, `unpause` | admin only | Configuration & circuit breaker |

The canonical mint message every oracle signs:
`borrower.to_xdr() || score_be(4) || expiration_be(8) || account_age_days_be(4) || nonce(32)` = 92 bytes.

## 5. Events

| Event topic | Data | When |
|---|---|---|
| `("mint", borrower)` | `(score, issued_at, expiration)` | badge issued |
| `("slash", borrower)` | `(score, timestamp, reason, caller)` | default recorded |
| `("pause",)` / `("unpause",)` | timestamp | circuit breaker |

Indexers can reconstruct the full credit history of any address from these.

## 6. Versioning policy

- **v1 (current):** the six consumer functions in §1 keep their exact
  signatures and `Option`/`bool` semantics. Additive changes (new read
  functions, new event types) do not bump the version.
- A signature or semantics change to any §1 function requires a **v2**
  deployment at a new contract ID, with v1 left running until announced
  end-of-life. Breaking silently is not an option we reserve.

## 7. Trust model in one paragraph

Scores are attested by a k-of-n ed25519 threshold oracle set (currently
3-of-5) whose public keys are on-chain (`get_oracle_keys`). A minted badge
proves that at least k independent oracles co-signed the exact
borrower/score/age/expiry tuple — no single party, including the contract
admin, can fabricate a score. Defaults are recorded by authorized vaults
and are immutable. Read access is permissionless by design: that is the
point of a credit primitive.

---

*Questions / integration support: zzzbedream@gmail.com — or open an issue
on the repo.*
