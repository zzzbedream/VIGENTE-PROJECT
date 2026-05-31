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
    // --- Phase B' hardening ---
    /// Hard cap on total deposited USDC. Rejects deposits that would push
    /// total_deposits above this ceiling.
    MaxTvlUsdc,
    /// Maximum utilization (borrowed / deposited) in basis points.
    /// 8500 = 85%. Reserves at least 15% of the pool for LP withdrawals.
    MaxUtilizationBps,
    /// Withdrawal timelock window in seconds. Default 14 days.
    WithdrawalTimelock,
    /// Number of successful repays by this borrower. Drives the credit
    /// ladder: first loan capped at 10% of the score-anchored ceiling,
    /// subsequent loans get the full ceiling.
    RepayCount(Address),
    /// Active withdrawal request for an LP. Only one at a time per LP.
    WithdrawalRequest(Address),
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

/// Pending LP withdrawal request. Created by `request_withdraw`, drained
/// by `claim_withdraw` once the timelock has elapsed, cleared by
/// `cancel_withdraw` if the LP changes their mind.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct WithdrawalRequestRecord {
    pub amount: i128,
    pub requested_at: u64,
}

// =============================================================================
// CREDIT LADDER & RISK PARAMETERS
// =============================================================================

/// Bands and ceilings for the score-anchored credit ladder. Mirrors the
/// math in plan section 10.bis.1. Ceilings are denominated in USDC stroops
/// (7 decimals). Source of truth lives here so the vault is self-contained
/// — the badge contract carries only the raw 0-1000 score.
const TIER_GOLD_FLOOR_SCORE: u32 = 800;
const TIER_SILVER_FLOOR_SCORE: u32 = 550;
const TIER_BRONZE_FLOOR_SCORE: u32 = 300;

/// Tier ceilings in USDC stroops (7 decimals): 1 USDC = 10_000_000.
const TIER_GOLD_CEILING: i128 = 2_000 * 10_000_000;   // $2,000
const TIER_SILVER_CEILING: i128 = 500 * 10_000_000;   // $500
const TIER_BRONZE_CEILING: i128 = 100 * 10_000_000;   // $100

/// First loan throttle: 10% of the score-anchored ceiling. Lifts to 100%
/// after the borrower's first successful repay.
const FIRST_LOAN_FACTOR_BPS: u32 = 1_000;

/// Default values used when initialize() arguments are zero (sentinel "use
/// defaults" pattern keeps the call site short for sprint demos).
const DEFAULT_MAX_UTILIZATION_BPS: u32 = 8_500;          // 85%
const DEFAULT_WITHDRAWAL_TIMELOCK_SECS: u64 = 14 * 24 * 60 * 60; // 14 days

/// Maps a score to the tier ceiling. Below `TIER_BRONZE_FLOOR_SCORE` the
/// borrower has no tier and cannot borrow.
fn tier_ceiling_for_score(score: u32) -> i128 {
    if score >= TIER_GOLD_FLOOR_SCORE {
        TIER_GOLD_CEILING
    } else if score >= TIER_SILVER_FLOOR_SCORE {
        TIER_SILVER_CEILING
    } else if score >= TIER_BRONZE_FLOOR_SCORE {
        TIER_BRONZE_CEILING
    } else {
        0
    }
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

    /// One-time setup. Sets admin and references to badge + token contracts,
    /// plus the three risk parameters introduced in Phase B':
    ///
    /// - `max_tvl_usdc`: hard ceiling on total deposits (stroops). 0 = no cap.
    /// - `max_utilization_bps`: max borrowed / deposited ratio. 0 = use default 85%.
    /// - `withdrawal_timelock`: seconds an LP withdrawal request must age before
    ///    `claim_withdraw` can drain it. 0 = use default 14 days.
    pub fn initialize(
        env: Env,
        admin: Address,
        badge_contract: Address,
        token_contract: Address,
        interest_rate_bps: u32,
        loan_duration: u64,
        max_tvl_usdc: i128,
        max_utilization_bps: u32,
        withdrawal_timelock: u64,
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
        if max_tvl_usdc < 0 {
            panic!("max_tvl_usdc must be non-negative");
        }
        if max_utilization_bps > 10_000 {
            panic!("max_utilization_bps cannot exceed 10000 (100%)");
        }

        let effective_util_cap = if max_utilization_bps == 0 {
            DEFAULT_MAX_UTILIZATION_BPS
        } else {
            max_utilization_bps
        };
        let effective_timelock = if withdrawal_timelock == 0 {
            DEFAULT_WITHDRAWAL_TIMELOCK_SECS
        } else {
            withdrawal_timelock
        };

        env.storage().instance().set(&VaultKey::Admin, &admin);
        env.storage().instance().set(&VaultKey::BadgeContract, &badge_contract);
        env.storage().instance().set(&VaultKey::TokenContract, &token_contract);
        env.storage().instance().set(&VaultKey::InterestRateBps, &interest_rate_bps);
        env.storage().instance().set(&VaultKey::LoanDuration, &loan_duration);
        env.storage().instance().set(&VaultKey::TotalDeposits, &0_i128);
        env.storage().instance().set(&VaultKey::TotalBorrowed, &0_i128);
        env.storage().instance().set(&VaultKey::Paused, &false);
        env.storage().instance().set(&VaultKey::MaxTvlUsdc, &max_tvl_usdc);
        env.storage().instance().set(&VaultKey::MaxUtilizationBps, &effective_util_cap);
        env.storage().instance().set(&VaultKey::WithdrawalTimelock, &effective_timelock);

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

        let total_deposits: i128 = env
            .storage()
            .instance()
            .get(&VaultKey::TotalDeposits)
            .unwrap_or(0);

        // TVL cap (Phase B'.4). 0 = uncapped; otherwise reject deposits that
        // would push the pool above the configured ceiling.
        let max_tvl: i128 = env
            .storage()
            .instance()
            .get(&VaultKey::MaxTvlUsdc)
            .unwrap_or(0);
        if max_tvl > 0 && total_deposits + amount > max_tvl {
            panic!("deposit exceeds TVL cap");
        }

        let token = Self::token_client(&env);
        let vault_address = env.current_contract_address();
        token.transfer(&depositor, &vault_address, &amount);

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

        // --- Liquidity & utilization (Phase B'.4) ---
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

        let max_util_bps: u32 = env
            .storage()
            .instance()
            .get(&VaultKey::MaxUtilizationBps)
            .unwrap_or(DEFAULT_MAX_UTILIZATION_BPS);
        // (total_borrowed + amount) * 10000 must not exceed total_deposits * max_util_bps.
        if (total_borrowed + amount).saturating_mul(10_000)
            > total_deposits.saturating_mul(max_util_bps as i128)
        {
            panic!("amount exceeds utilization cap");
        }

        // --- Score-anchored credit ladder (Phase B'.3) ---
        let tier_ceiling = tier_ceiling_for_score(score);
        if tier_ceiling == 0 {
            panic!("score below minimum tier (Bronze floor)");
        }
        let score_anchored = (tier_ceiling * score as i128) / 1000;

        let repays: u32 = env
            .storage()
            .persistent()
            .get(&VaultKey::RepayCount(borrower.clone()))
            .unwrap_or(0);

        // First-loan throttle: until the borrower repays at least once, they
        // can only access FIRST_LOAN_FACTOR_BPS / 10_000 of the ceiling.
        let credit_cap = if repays == 0 {
            (score_anchored * FIRST_LOAN_FACTOR_BPS as i128) / 10_000
        } else {
            score_anchored
        };

        // Per-pool cap stays in force as a defense in depth: even a Gold
        // borrower can't take more than 10% of available liquidity.
        let per_pool_cap = available / 10;
        let allowed = if credit_cap < per_pool_cap {
            credit_cap
        } else {
            per_pool_cap
        };

        if amount > allowed {
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

        // Bump the repay count so the next loan exits the first-loan throttle
        // (Phase B'.3). This is the only place that updates RepayCount.
        let repays: u32 = env
            .storage()
            .persistent()
            .get(&VaultKey::RepayCount(borrower.clone()))
            .unwrap_or(0);
        env.storage().persistent().set(
            &VaultKey::RepayCount(borrower.clone()),
            &(repays + 1),
        );
        env.storage().persistent().extend_ttl(
            &VaultKey::RepayCount(borrower.clone()),
            1_555_200,
            1_555_200,
        );

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
    // CORE: LP WITHDRAWAL WITH TIMELOCK (Phase B'.5)
    // -------------------------------------------------------------------------

    /// LP signals intent to withdraw `amount`. Funds are NOT transferred until
    /// `claim_withdraw` is called after the timelock elapses. Only one active
    /// request per LP at a time.
    pub fn request_withdraw(env: Env, lp: Address, amount: i128) {
        Self::require_not_paused(&env);
        lp.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let balance: i128 = env
            .storage()
            .persistent()
            .get(&VaultKey::LPBalance(lp.clone()))
            .unwrap_or(0);
        if amount > balance {
            panic!("request exceeds LP balance");
        }

        if env
            .storage()
            .persistent()
            .has(&VaultKey::WithdrawalRequest(lp.clone()))
        {
            panic!("withdrawal already requested");
        }

        let req = WithdrawalRequestRecord {
            amount,
            requested_at: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&VaultKey::WithdrawalRequest(lp.clone()), &req);
        env.storage().persistent().extend_ttl(
            &VaultKey::WithdrawalRequest(lp.clone()),
            1_555_200,
            1_555_200,
        );

        env.events().publish(
            (symbol_short!("wd_req"), lp),
            (amount, req.requested_at),
        );
    }

    /// Drains a previously-requested withdrawal once the timelock has elapsed
    /// AND the vault has enough free liquidity. Caps at the LP's current
    /// balance in case it shrank since the request (defaulted loans, etc.).
    pub fn claim_withdraw(env: Env, lp: Address) {
        Self::require_not_paused(&env);
        lp.require_auth();

        let req: WithdrawalRequestRecord = env
            .storage()
            .persistent()
            .get(&VaultKey::WithdrawalRequest(lp.clone()))
            .expect("no pending withdrawal");

        let now = env.ledger().timestamp();
        let timelock: u64 = env
            .storage()
            .instance()
            .get(&VaultKey::WithdrawalTimelock)
            .unwrap_or(DEFAULT_WITHDRAWAL_TIMELOCK_SECS);
        if now < req.requested_at + timelock {
            panic!("withdrawal is still locked");
        }

        let balance: i128 = env
            .storage()
            .persistent()
            .get(&VaultKey::LPBalance(lp.clone()))
            .unwrap_or(0);
        let payout = if req.amount <= balance {
            req.amount
        } else {
            balance
        };
        if payout <= 0 {
            // Balance fully eaten by losses since the request — nothing to send,
            // but we still consume the request so the LP can retry later.
            env.storage()
                .persistent()
                .remove(&VaultKey::WithdrawalRequest(lp.clone()));
            return;
        }

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
        if payout > available {
            panic!("insufficient available liquidity");
        }

        let token = Self::token_client(&env);
        let vault_address = env.current_contract_address();
        token.transfer(&vault_address, &lp, &payout);

        env.storage()
            .persistent()
            .set(&VaultKey::LPBalance(lp.clone()), &(balance - payout));
        env.storage()
            .instance()
            .set(&VaultKey::TotalDeposits, &(total_deposits - payout));
        env.storage()
            .persistent()
            .remove(&VaultKey::WithdrawalRequest(lp.clone()));

        env.events()
            .publish((symbol_short!("wd_claim"), lp), payout);
    }

    /// LP cancels an active withdrawal request. Safe at any time.
    pub fn cancel_withdraw(env: Env, lp: Address) {
        lp.require_auth();
        if !env
            .storage()
            .persistent()
            .has(&VaultKey::WithdrawalRequest(lp.clone()))
        {
            panic!("no pending withdrawal");
        }
        env.storage()
            .persistent()
            .remove(&VaultKey::WithdrawalRequest(lp.clone()));
        env.events()
            .publish((symbol_short!("wd_canc"), lp), env.ledger().timestamp());
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

    /// Calculate the long-term ceiling (post first-repay) for a given score
    /// against current liquidity. Returns the smaller of the score-anchored
    /// ceiling and the per-pool cap.
    pub fn max_loan_for_score(env: Env, score: u32) -> i128 {
        let available = Self::get_available_liquidity(env);
        if available <= 0 || score == 0 {
            return 0;
        }
        let tier_ceiling = tier_ceiling_for_score(score);
        if tier_ceiling == 0 {
            return 0;
        }
        let score_anchored = (tier_ceiling * score as i128) / 1000;
        let per_pool_cap = available / 10;
        if score_anchored < per_pool_cap {
            score_anchored
        } else {
            per_pool_cap
        }
    }

    /// Calculate the *currently applicable* loan ceiling for a specific
    /// borrower, factoring in whether they have repayments on record.
    /// First-time borrowers are throttled to 10% of the score-anchored ceiling.
    pub fn max_loan_for_borrower(env: Env, borrower: Address) -> i128 {
        let badge = Self::badge_client(&env);
        if badge.is_defaulted(&borrower) {
            return 0;
        }
        let score = match badge.get_score(&borrower) {
            Some(s) => s,
            None => return 0,
        };
        let available = Self::get_available_liquidity(env.clone());
        if available <= 0 {
            return 0;
        }
        let tier_ceiling = tier_ceiling_for_score(score);
        if tier_ceiling == 0 {
            return 0;
        }
        let score_anchored = (tier_ceiling * score as i128) / 1000;
        let repays: u32 = env
            .storage()
            .persistent()
            .get(&VaultKey::RepayCount(borrower))
            .unwrap_or(0);
        let credit_cap = if repays == 0 {
            (score_anchored * FIRST_LOAN_FACTOR_BPS as i128) / 10_000
        } else {
            score_anchored
        };
        let per_pool_cap = available / 10;
        if credit_cap < per_pool_cap {
            credit_cap
        } else {
            per_pool_cap
        }
    }

    pub fn get_repay_count(env: Env, borrower: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&VaultKey::RepayCount(borrower))
            .unwrap_or(0)
    }

    pub fn get_withdrawal_request(env: Env, lp: Address) -> Option<WithdrawalRequestRecord> {
        env.storage().persistent().get(&VaultKey::WithdrawalRequest(lp))
    }

    pub fn get_max_tvl(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&VaultKey::MaxTvlUsdc)
            .unwrap_or(0)
    }

    pub fn get_max_utilization_bps(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&VaultKey::MaxUtilizationBps)
            .unwrap_or(DEFAULT_MAX_UTILIZATION_BPS)
    }

    pub fn get_withdrawal_timelock(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&VaultKey::WithdrawalTimelock)
            .unwrap_or(DEFAULT_WITHDRAWAL_TIMELOCK_SECS)
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
