## Preamble

```
SEP: to-be-assigned
Title: Credit Attestation Oracle Interface
Author: Vigente Protocol (zzzbedream@gmail.com)
Status: Draft (pre-submission — to be PR'd against stellar/stellar-protocol)
Created: 2026-06-10
Discussion: https://github.com/zzzbedream/VIGENTE-PROJECT/issues
Version: 0.1.0
```

## Simple Summary

A minimal, read-only Soroban contract interface for on-chain **credit
attestations**: a standard way for any contract to ask "does this address
have a usable credit signal, what is it, and has this address ever
defaulted?" — analogous to what [SEP-40] does for price feeds, but for
borrower reputation instead of asset prices.

## Motivation

Stellar DeFi has a standard for price oracles ([SEP-40]) and a standard for
tokenized vaults ([SEP-56]). It has **no standard for credit or reputation
data**, which forces every lending protocol that wants to move beyond
over-collateralization to either build its own scoring silo or integrate a
specific provider's bespoke interface.

A shared read interface fixes the integration side of that problem:

- **Lending pools** can gate borrowers or tier collateral factors against
  any compliant oracle without provider-specific code.
- **Credit oracles** can compete on attestation quality (data sources,
  signing quorums, scoring models) while exposing identical surfaces.
- **Wallets and indexers** can render any address's credit state uniformly.

This SEP deliberately standardizes only the **consumer-facing read
interface**. How attestations are issued — single signer, k-of-n threshold
quorum, zero-knowledge proofs over off-chain data — is an implementation
property that issuers should document and consumers should evaluate, but it
does not belong in the read interface.

## Abstract

A compliant Credit Attestation Oracle is a Soroban contract exposing
read-only functions that report, for any `Address`: an optional bounded
credit score, an optional default record, and a boolean default flag.
Scores are `None` when absent, expired, or revoked. Default records, once
written, are immutable.

## Specification

### Required functions

```rust
pub trait CreditAttestationOracle {
    /// Returns true if the address has a recorded default OR its current
    /// attestation has been revoked for cause. MUST NOT return true for
    /// addresses merely lacking an attestation.
    fn is_defaulted(env: Env, subject: Address) -> bool;

    /// The subject's current credit score, or None when no attestation
    /// exists, the attestation has expired, or it has been revoked.
    /// Consumers MUST treat None as "no usable signal", not as an error.
    fn get_score(env: Env, subject: Address) -> Option<u32>;
}
```

### Recommended functions

```rust
    /// Upper bound of the score range (inclusive). When absent, consumers
    /// SHOULD assume 1000. Implementations SHOULD expose this so consumers
    /// can normalize across oracles.
    fn score_max(env: Env) -> u32;

    /// The immutable default record, when one exists. Field semantics:
    /// timestamps are ledger timestamps; `reason` codes are
    /// implementation-defined but MUST be documented by the issuer.
    fn get_default(env: Env, subject: Address) -> Option<DefaultRecord>;
```

### Semantics (normative)

1. **Expiry collapses to None.** `get_score` MUST return `None` for
   expired attestations. Consumers never see stale scores as live ones.
2. **Defaults are immutable.** Once `is_defaulted(subject)` returns
   `true`, it MUST NOT return `false` for the lifetime of the record. An
   issuer MAY define record TTLs, but they MUST be documented and MUST be
   measured in years, not blocks.
3. **Read access is permissionless.** Required functions MUST NOT require
   authorization, fees beyond network costs, or token gating.
4. **No borrower context leakage.** The interface exposes only the
   subject's score and default state — never the underlying data
   (transactions, invoices, identity) the attestation was derived from.
5. **Score range.** Scores MUST be integers in `[0, score_max()]`. Higher
   MUST mean better creditworthiness.

### Events (recommended)

| Topics | Data | When |
|---|---|---|
| `("attest", subject)` | `(score, issued_at, expires_at)` | attestation issued/renewed |
| `("default", subject)` | `(score_at_default, timestamp, reason)` | default recorded |

## Design Rationale

- **Read-only by design.** SEP-40 succeeded by standardizing `lastprice`
  and letting oracle implementations differ. The same separation applies
  here: issuance models (threshold signatures, ZK attestations, single
  notary) will evolve; the consumer call sites should not have to.
- **`Option<u32>` over sentinel values.** "No signal" is a first-class
  state, not score 0 — a new wallet and a revoked borrower must be
  distinguishable from a merely bad one.
- **Immutable defaults.** The credit memory that makes under-collateralized
  lending possible at all. Without it, defaulting and re-minting is free.

## Security Concerns

- **The interface does not confer trust.** A compliant oracle can still lie.
  Consumers MUST evaluate the issuer's attestation model — who signs, with
  what quorum, against what data — before treating scores as collateral
  substitutes. Issuers SHOULD expose their signer set on-chain.
- **Oracle substitution.** Contracts SHOULD pin the oracle address at
  initialization and treat oracle migration as a governance event.
- **Liveness.** A frozen oracle returning stale `Some(score)` is prevented
  by normative rule 1 (expiry collapses to None); consumers SHOULD still
  bound `issued_at` age when reading via `get_default`/badge detail calls.

## Reference Implementation

**Vigente Protocol** (`vigente-badge`, Stellar testnet
`CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD`) implements the
required functions plus `get_default`, with a fixed score range of
`[0, 1000]` and a 3-of-5 ed25519 threshold issuance model:

- Interface documentation: [`contracts/vigente-badge/INTERFACE.md`](../../contracts/vigente-badge/INTERFACE.md)
- Live ABI: [`docs/integration/abi-v3.json`](abi-v3.json)
- Compilable consumer example: [`examples/integration-snippet/`](../../examples/integration-snippet/)
- Production consumer (lending vault with slash cascade): [`contracts/reference-vault/`](../../archive/reference-vault/)

[SEP-40]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0040.md
[SEP-56]: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0056.md

## Changelog

- `0.1.0`: initial draft for ecosystem feedback.
