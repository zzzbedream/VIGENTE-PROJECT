# Repayment Interception — design (roadmap, NOT shipped)

> **Status: roadmap / design only.** Nothing in this document is implemented
> in any contract. The Rust below is an *interface sketch* for review — it is
> not wired into `vigente-badge` or `reference-vault` and does not compile as
> part of the build. Target: Tranche 4 (post-grant). See the roadmap in
> [`../../README.md`](../../README.md), section *Status and roadmap*.

## Why this exists

Vigente is a **data/attestation layer, not a lender**. We carry no default on
our balance sheet — the originating partner (a remittance wallet / PayFi
originator that already does KYC) bears the credit risk. Our job is to lower
their **expected default**, two ways:

1. **Better selection (shipped today):** the 3-of-5 threshold score +
   immutable defaults let an originator decline or price the riskiest
   borrowers before lending.
2. **Repayment interception (this design, roadmap):** route a share of a
   borrower's *future* remittance inflow to loan repayment **before** it
   reaches their wallet. This is the Huma / Arf model — repayment is captured
   at the cash-flow source, not chased after disbursement.

Interception turns "will they pay later?" into "we are paid as the money
arrives." It is the structural moat: the more remittance flow an originator
routes through Vigente-aware rails, the lower the realized default — without
Vigente ever becoming the lender or touching custody of the principal.

## Where it sits

```
remittance sender ──► anchor / wallet (originator, does KYC) ──► borrower wallet
                              │
                              │  (roadmap) interception hook
                              ▼
                    split: repayment slice ──► originator's loan account
                           remainder       ──► borrower wallet
```

- The **originator** owns the rail and the custody. Vigente provides the
  attested obligation (how much is owed, against which badge) and the
  read interface the rail consults.
- **No principal flows through Vigente.** We attest; the originator's rail
  executes the split under its own authorization and licensing.
- On-chain, the only Vigente surface a rail needs is the existing read
  interface (`get_score` / `is_defaulted`) plus an *optional* obligation
  attestation an originator can register and query. The borrower consents
  to the interception mandate off-chain as part of the originator's KYC flow.

## Interface sketch (illustrative — not implemented)

```rust
// SKETCH ONLY. Not a contract in this repo. Names/shapes are for review.

/// An originator-registered repayment obligation tied to a borrower badge.
/// Vigente attests the obligation; the originator's rail performs the split.
pub struct RepaymentObligation {
    pub borrower: Address,        // badge subject
    pub originator: Address,      // the KYC'd rail that extended credit
    pub outstanding: i128,        // remaining principal + accrued interest
    pub intercept_bps: u32,       // share of each inbound flow routed to repay
    pub mandate_hash: BytesN<32>, // hash of the off-chain consent mandate
    pub expires_at: u64,
}

pub trait RepaymentInterception {
    /// Originator registers an obligation after disbursing credit.
    /// Auth: originator.require_auth(). Vigente never holds the funds.
    fn register_obligation(env: Env, obligation: RepaymentObligation);

    /// Rail queries how much of an inbound `amount` to divert to repayment.
    /// Pure read — returns the repayment slice given current outstanding.
    fn intercept_quote(env: Env, borrower: Address, amount: i128) -> i128;

    /// Originator reports a captured repayment, decrementing outstanding.
    /// Auth: originator.require_auth(). Settling to zero clears the obligation.
    fn settle(env: Env, borrower: Address, repaid: i128);
}
```

## Non-goals / guardrails

- Vigente does **not** custody, move, or net principal. Interception executes
  inside the originator's already-licensed rail.
- No weakening of existing security: the 3-of-5 threshold, anti-replay nonce,
  vault TVL/utilization caps, and withdrawal timelock are untouched by this
  design.
- Consent is mandatory: an obligation without a valid off-chain mandate hash
  is not honored. The borrower agrees to interception at origination.
- This is **not** a claim of present capability. It is a Tranche-4 design to
  be validated with a partner that already operates remittance rails.

## Validation (when built)

- A testnet demo where an originator registers an obligation, a simulated
  inbound flow is split via `intercept_quote`, and `settle` decrements the
  outstanding to zero — with a published tx trail and no principal touching
  any Vigente contract.
