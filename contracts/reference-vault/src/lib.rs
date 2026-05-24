#![no_std]
//! =============================================================================
//! VIGENTE PROTOCOL — Reference Lending Vault
//! =============================================================================
//!
//! Minimal credit-gated lending vault demonstrating Vigente CreditBadge
//! integration. This is a REFERENCE IMPLEMENTATION, not a production protocol.
//!
//! Functions:
//!   - initialize: one-time setup with badge + token contract addresses
//!   - deposit:    LP supplies USDC, receives proportional LP shares
//!   - borrow:     score-gated loan (calls badge.is_defaulted + badge.get_score)
//!   - repay:      full repayment of principal + interest
//!   - liquidate:  enforces default after due date (calls badge.slash)
//!
//! Out of scope (production protocols would add):
//!   - Dynamic interest rate curves
//!   - Liquidation auctions
//!   - Multi-asset collateral
//!   - Governance
//! =============================================================================

use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short,
    token::TokenClient, Address, Env,
};

#[cfg(test)]
mod test;

// =============================================================================
// CROSS-CONTRACT CLIENT: vigente-badge interface
// =============================================================================

/// Subset of vigente-badge interface that this vault calls.
/// Generated client bindings handle the cross-contract invocation.
#[contractclient(name = "BadgeClient")]
pub trait Badge {
    fn is_defaulted(env: Env, borrower: Address) -> bool;
    fn get_score(env: Env, borrower: Address) -> Option<u32>;
    fn slash(env: Env, caller: Address, borrower: Address, reason: u32);
}

// =============================================================================
// STORAGE KEYS & TYPES
// =============================================================================

#[derive(Clone)]
#[contracttype]
pub enum VaultKey {
    Admin,
    BadgeContract,
    TokenContract,
    InterestRateBps,    // basis points (500 = 5%)
    LoanDuration,       // ledger seconds
    TotalDeposits,
    TotalBorrowed,
    Paused,
    LPBalance(Address),
    Loan(Address),
}

/// Active loan record.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct LoanRecord {
    pub principal: i128,
    pub interest: i128,           // fixed at origination
    pub borrowed_at: u64,
    pub due_at: u64,
    pub score_at_origination: u32,
    pub repaid: bool,
}

// =============================================================================
// CONTRACT
// =============================================================================

#[contract]
pub struct ReferenceVault;

#[contractimpl]
impl ReferenceVault {
    // -------------------------------------------------------------------------
    // INITIALIZATION
    // -------------------------------------------------------------------------

    /// One-time setup. Sets admin and references to badge + token contracts.
    pub fn initialize(
        env: Env,
        admin: Address,
        badge_contract: Address,
        token_contract: Address,
        interest_rate_bps: u32,
        loan_duration: u64,
    ) {
        if env.storage().instance().has(&VaultKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();

        if interest_rate_bps > 5000 {
            panic!("interest rate too high: max 50%");
        }
        if loan_duration == 0 {
            panic!("loan duration must be positive");
        }

        env.storage().instance().set(&VaultKey::Admin, &admin);
        env.storage().instance().set(&VaultKey::BadgeContract, &badge_contract);
        env.storage().instance().set(&VaultKey::TokenContract, &token_contract);
        env.storage().instance().set(&VaultKey::InterestRateBps, &interest_rate_bps);
        env.storage().instance().set(&VaultKey::LoanDuration, &loan_duration);
        env.storage().instance().set(&VaultKey::TotalDeposits, &0_i128);
        env.storage().instance().set(&VaultKey::TotalBorrowed, &0_i128);
        env.storage().instance().set(&VaultKey::Paused, &false);

        env.storage().instance().extend_ttl(1_555_200, 1_555_200);

        env.events().publish(
            (symbol_short!("v_init"), admin.clone()),
            (badge_contract, token_contract, interest_rate_bps),
        );
    }

    // -------------------------------------------------------------------------
    // CORE: DEPOSIT
    // -------------------------------------------------------------------------

    /// LP supplies USDC in exchange for proportional LP shares.
    pub fn deposit(env: Env, depositor: Address, amount: i128) {
        Self::require_not_paused(&env);
        depositor.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let token = Self::token_client(&env);
        let vault_address = env.current_contract_address();
        token.transfer(&depositor, &vault_address, &amount);

        let total_deposits: i128 = env
            .storage()
            .instance()
            .get(&VaultKey::TotalDeposits)
            .unwrap_or(0);

        // LP shares: 1:1 for first deposit, otherwise proportional
        let current_balance: i128 = env
            .storage()
            .persistent()
            .get(&VaultKey::LPBalance(depositor.clone()))
            .unwrap_or(0);
        let shares = if total_deposits == 0 {
            amount
        } else {
            // shares = amount × total_shares / total_deposits
            // For simplicity in the reference: total_shares == total_deposits
            amount
        };

        env.storage().persistent().set(
            &VaultKey::LPBalance(depositor.clone()),
            &(current_balance + shares),
        );
        env.storage().persistent().extend_ttl(
            &VaultKey::LPBalance(depositor.clone()),
            1_555_200,
            1_555_200,
        );
        env.storage()
            .instance()
            .set(&VaultKey::TotalDeposits, &(total_deposits + amount));

        env.events().publish(
            (symbol_short!("deposit"), depositor),
            (amount, shares),
        );
    }

    // -------------------------------------------------------------------------
    // CORE: BORROW (credit-gated)
    // -------------------------------------------------------------------------

    /// Borrower requests a loan. Limit calculated from CreditBadge score.
    pub fn borrow(env: Env, borrower: Address, amount: i128) {
        Self::require_not_paused(&env);
        borrower.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        // CROSS-CONTRACT: check default status
        let badge = Self::badge_client(&env);
        if badge.is_defaulted(&borrower) {
            panic!("borrower is in default");
        }

        let score = badge
            .get_score(&borrower)
            .expect("no active credit badge — mint a badge first");

        // Calculate max loan
        let total_deposits: i128 = env
            .storage()
            .instance()
            .get(&VaultKey::TotalDeposits)
            .unwrap_or(0);
        let total_borrowed: i128 = env
            .storage()
            .instance()
            .get(&VaultKey::TotalBorrowed)
            .unwrap_or(0);
        let available = total_deposits - total_borrowed;
        if available <= 0 {
            panic!("no available liquidity");
        }

        // max_loan = (available / 10) × (score / 1000), with 10% per-borrower cap
        let per_borrower_cap = available / 10;
        let max_loan = (per_borrower_cap * (score as i128)) / 1000;

        if amount > max_loan {
            panic!("amount exceeds credit limit for score");
        }

        // Check no existing active loan
        if let Some(existing) = env
            .storage()
            .persistent()
            .get::<VaultKey, LoanRecord>(&VaultKey::Loan(borrower.clone()))
        {
            if !existing.repaid {
                panic!("borrower has existing active loan");
            }
        }

        let interest_rate_bps: u32 = env
            .storage()
            .instance()
            .get(&VaultKey::InterestRateBps)
            .unwrap_or(500);
        let loan_duration: u64 = env
            .storage()
            .instance()
            .get(&VaultKey::LoanDuration)
            .unwrap_or(518_400); // ~30 days

        let now = env.ledger().timestamp();
        let interest = (amount * interest_rate_bps as i128) / 10_000;
        let loan = LoanRecord {
            principal: amount,
            interest,
            borrowed_at: now,
            due_at: now + loan_duration,
            score_at_origination: score,
            repaid: false,
        };

        env.storage()
            .persistent()
            .set(&VaultKey::Loan(borrower.clone()), &loan);
        env.storage().persistent().extend_ttl(
            &VaultKey::Loan(borrower.clone()),
            1_555_200,
            1_555_200,
        );

        // Disburse funds to borrower
        let token = Self::token_client(&env);
        let vault_address = env.current_contract_address();
        token.transfer(&vault_address, &borrower, &amount);

        env.storage()
            .instance()
            .set(&VaultKey::TotalBorrowed, &(total_borrowed + amount));

        env.events().publish(
            (symbol_short!("borrow"), borrower),
            (amount, score, loan.due_at),
        );
    }

    // -------------------------------------------------------------------------
    // CORE: REPAY
    // -------------------------------------------------------------------------

    /// Borrower repays loan in full (principal + interest).
    pub fn repay(env: Env, borrower: Address) {
        Self::require_not_paused(&env);
        borrower.require_auth();

        let loan_key = VaultKey::Loan(borrower.clone());
        let mut loan: LoanRecord = env
            .storage()
            .persistent()
            .get(&loan_key)
            .expect("no active loan");

        if loan.repaid {
            panic!("loan already repaid");
        }

        let total_owed = loan.principal + loan.interest;
        let token = Self::token_client(&env);
        let vault_address = env.current_contract_address();
        token.transfer(&borrower, &vault_address, &total_owed);

        loan.repaid = true;
        env.storage().persistent().set(&loan_key, &loan);

        // Update aggregates: principal returns, interest is added to deposits (LP yield)
        let total_borrowed: i128 = env
            .storage()
            .instance()
            .get(&VaultKey::TotalBorrowed)
            .unwrap_or(0);
        let total_deposits: i128 = env
            .storage()
            .instance()
            .get(&VaultKey::TotalDeposits)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&VaultKey::TotalBorrowed, &(total_borrowed - loan.principal));
        env.storage()
            .instance()
            .set(&VaultKey::TotalDeposits, &(total_deposits + loan.interest));

        env.events().publish(
            (symbol_short!("repay"), borrower),
            (loan.principal, loan.interest),
        );
    }

    // -------------------------------------------------------------------------
    // CORE: LIQUIDATE
    // -------------------------------------------------------------------------

    /// Anyone can trigger liquidation of an overdue loan.
    /// Cascades into a cross-contract slash on the badge.
    pub fn liquidate(env: Env, liquidator: Address, borrower: Address) {
        Self::require_not_paused(&env);
        liquidator.require_auth();

        let loan_key = VaultKey::Loan(borrower.clone());
        let mut loan: LoanRecord = env
            .storage()
            .persistent()
            .get(&loan_key)
            .expect("no active loan");

        if loan.repaid {
            panic!("loan already repaid");
        }

        let now = env.ledger().timestamp();
        if now < loan.due_at {
            panic!("loan is not yet overdue");
        }

        // CROSS-CONTRACT: slash the borrower's badge
        // The vault contract acts as the caller — must be registered as a vault
        // in the badge contract's AuthVaults list before this call.
        let vault_address = env.current_contract_address();
        let badge = Self::badge_client(&env);
        badge.slash(&vault_address, &borrower, &1_u32); // reason: 1 = non_payment

        // Mark loan as closed (defaulted)
        loan.repaid = true;
        env.storage().persistent().set(&loan_key, &loan);

        // Recognize loss for LPs
        let total_borrowed: i128 = env
            .storage()
            .instance()
            .get(&VaultKey::TotalBorrowed)
            .unwrap_or(0);
        let total_deposits: i128 = env
            .storage()
            .instance()
            .get(&VaultKey::TotalDeposits)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&VaultKey::TotalBorrowed, &(total_borrowed - loan.principal));
        env.storage()
            .instance()
            .set(&VaultKey::TotalDeposits, &(total_deposits - loan.principal));

        env.events().publish(
            (symbol_short!("liq"), borrower),
            (loan.principal, loan.score_at_origination, 1_u32),
        );
    }

    // -------------------------------------------------------------------------
    // VIEW FUNCTIONS
    // -------------------------------------------------------------------------

    pub fn get_total_deposits(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&VaultKey::TotalDeposits)
            .unwrap_or(0)
    }

    pub fn get_total_borrowed(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&VaultKey::TotalBorrowed)
            .unwrap_or(0)
    }

    pub fn get_available_liquidity(env: Env) -> i128 {
        let total_deposits = Self::get_total_deposits(env.clone());
        let total_borrowed = Self::get_total_borrowed(env);
        total_deposits - total_borrowed
    }

    pub fn get_lp_balance(env: Env, depositor: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&VaultKey::LPBalance(depositor))
            .unwrap_or(0)
    }

    pub fn get_loan(env: Env, borrower: Address) -> Option<LoanRecord> {
        env.storage().persistent().get(&VaultKey::Loan(borrower))
    }

    /// Calculate max borrowable amount for a given score against current liquidity.
    pub fn max_loan_for_score(env: Env, score: u32) -> i128 {
        let available = Self::get_available_liquidity(env);
        if available <= 0 || score == 0 {
            return 0;
        }
        let per_borrower_cap = available / 10;
        (per_borrower_cap * (score as i128)) / 1000
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&VaultKey::Admin)
            .expect("not initialized")
    }

    // -------------------------------------------------------------------------
    // CIRCUIT BREAKER
    // -------------------------------------------------------------------------

    pub fn pause(env: Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&VaultKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        env.storage().instance().set(&VaultKey::Paused, &true);
        env.events()
            .publish((symbol_short!("pause"),), env.ledger().timestamp());
    }

    pub fn unpause(env: Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&VaultKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        env.storage().instance().set(&VaultKey::Paused, &false);
        env.events()
            .publish((symbol_short!("unpause"),), env.ledger().timestamp());
    }

    // -------------------------------------------------------------------------
    // INTERNAL HELPERS
    // -------------------------------------------------------------------------

    fn require_not_paused(env: &Env) {
        let paused: bool = env
            .storage()
            .instance()
            .get(&VaultKey::Paused)
            .unwrap_or(false);
        if paused {
            panic!("contract is paused");
        }
    }

    fn token_client(env: &Env) -> TokenClient {
        let token_contract: Address = env
            .storage()
            .instance()
            .get(&VaultKey::TokenContract)
            .expect("not initialized");
        TokenClient::new(env, &token_contract)
    }

    fn badge_client(env: &Env) -> BadgeClient {
        let badge_contract: Address = env
            .storage()
            .instance()
            .get(&VaultKey::BadgeContract)
            .expect("not initialized");
        BadgeClient::new(env, &badge_contract)
    }
}
