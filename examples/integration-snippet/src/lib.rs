//! Example consumer of the Vigente Credit Oracle Interface v1.
//!
//! This is the minimal pattern for gating any credit decision in your own
//! Soroban contract on a borrower's Vigente badge. Copy `VigenteBadge` +
//! the two calls in `try_borrow` into your contract and replace the body
//! with your pool logic.
//!
//! The production-grade version of this pattern lives in
//! `contracts/reference-vault/src/lib.rs` (score-tiered limits, first-loan
//! throttle, slash cascade) with full integration tests.
//!
//! Interface reference: `contracts/vigente-badge/INTERFACE.md`
//! Testnet contract: CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD

#![no_std]

use soroban_sdk::{contract, contractclient, contractimpl, Address, Env, Symbol};

/// The slice of the Vigente Credit Oracle Interface v1 this consumer needs.
/// Declare only the functions you call — the client is generated from the
/// trait, no WASM import required.
#[contractclient(name = "BadgeClient")]
pub trait VigenteBadge {
    fn is_defaulted(env: Env, borrower: Address) -> bool;
    fn get_score(env: Env, borrower: Address) -> Option<u32>;
}

const BADGE_CONTRACT: Symbol = soroban_sdk::symbol_short!("badge");

#[contract]
pub struct ExampleLender;

#[contractimpl]
impl ExampleLender {
    /// One-time setup: store the address of the Vigente badge contract.
    pub fn initialize(env: Env, badge_contract: Address) {
        env.storage().instance().set(&BADGE_CONTRACT, &badge_contract);
    }

    /// Gate a borrow request on the borrower's Vigente credit state.
    ///
    /// Returns the approved amount. The policy here is intentionally
    /// simplistic — replace it with your own (tiers, collateral factors,
    /// rate curves). What matters is the two oracle reads.
    pub fn try_borrow(env: Env, borrower: Address, requested: i128) -> i128 {
        let badge_contract: Address = env
            .storage()
            .instance()
            .get(&BADGE_CONTRACT)
            .expect("not initialized");
        let badge = BadgeClient::new(&env, &badge_contract);

        // Gate 1: hard reject anyone with a default record. This survives
        // badge expiry — defaults are immutable in Vigente.
        if badge.is_defaulted(&borrower) {
            panic!("borrower is in default");
        }

        // Gate 2: scale the approval by score. None = no usable signal
        // (no badge, expired, or slashed) — treat as zero credit.
        let score: u32 = badge.get_score(&borrower).unwrap_or(0);
        if score == 0 {
            return 0;
        }

        // Example policy: approve (score / 1000) of the requested amount.
        requested * (score as i128) / 1000
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{contract as sdk_contract, contractimpl as sdk_contractimpl, testutils::Address as _};

    /// Minimal in-test stand-in for vigente-badge implementing the same
    /// Interface v1 read functions. In production the real contract at
    /// CDLLO7QE… answers these calls; the cross-contract mechanics are
    /// identical.
    #[sdk_contract]
    pub struct MockBadge;

    #[sdk_contractimpl]
    impl MockBadge {
        pub fn is_defaulted(env: Env, borrower: Address) -> bool {
            env.storage().instance().get(&(borrower,)).unwrap_or(false)
        }
        pub fn get_score(_env: Env, _borrower: Address) -> Option<u32> {
            Some(700)
        }
        pub fn set_defaulted(env: Env, borrower: Address) {
            env.storage().instance().set(&(borrower,), &true);
        }
    }

    #[test]
    fn cross_contract_gate_scales_by_score() {
        let env = Env::default();
        let badge_id = env.register_contract(None, MockBadge);
        let lender_id = env.register_contract(None, ExampleLender);

        let lender = ExampleLenderClient::new(&env, &lender_id);
        lender.initialize(&badge_id);

        let borrower = Address::generate(&env);
        // score 700/1000 → 70% of the requested amount approved
        assert_eq!(lender.try_borrow(&borrower, &1000), 700);
    }

    #[test]
    #[should_panic(expected = "borrower is in default")]
    fn cross_contract_gate_rejects_defaulted() {
        let env = Env::default();
        let badge_id = env.register_contract(None, MockBadge);
        let lender_id = env.register_contract(None, ExampleLender);

        ExampleLenderClient::new(&env, &lender_id).initialize(&badge_id);

        let borrower = Address::generate(&env);
        MockBadgeClient::new(&env, &badge_id).set_defaulted(&borrower);

        ExampleLenderClient::new(&env, &lender_id).try_borrow(&borrower, &1000);
    }
}
