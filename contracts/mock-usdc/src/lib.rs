#![no_std]
//! =============================================================================
//! MOCK USDC TOKEN — Vigente Protocol Reference Vault Companion
//! =============================================================================
//!
//! Minimal SEP-41-compatible token used as the lending asset on testnet.
//! Implements the subset of the token interface required by `reference-vault`:
//!   - mint (admin only)
//!   - balance
//!   - transfer
//!   - allowance / approve (for cross-contract auth patterns)
//!
//! On mainnet, the reference vault is initialized with the real Stellar USDC
//! Stellar Asset Contract (SAC) address instead of this mock. The vault code
//! does not change — only the `token_contract` parameter passed to `initialize`.
//! =============================================================================

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    token::Interface as TokenInterface,
    Address, Env, String,
};

#[cfg(test)]
mod test;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Balance(Address),
    Allowance(AllowanceKey),
    Decimals,
    Name,
    Symbol,
}

#[derive(Clone)]
#[contracttype]
pub struct AllowanceKey {
    pub from: Address,
    pub spender: Address,
}

#[derive(Clone)]
#[contracttype]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[contract]
pub struct MockUsdc;

#[contractimpl]
impl MockUsdc {
    /// One-time setup. Admin controls minting.
    pub fn initialize(env: Env, admin: Address, decimals: u32, name: String, symbol: String) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Decimals, &decimals);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().extend_ttl(1_555_200, 1_555_200);
    }

    /// Admin-only: mint new tokens to an account.
    pub fn mint(env: Env, to: Address, amount: i128) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        if amount < 0 {
            panic!("amount must be non-negative");
        }
        let current: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(to.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &(current + amount));
        env.storage().persistent().extend_ttl(
            &DataKey::Balance(to.clone()),
            1_555_200,
            1_555_200,
        );
        env.events().publish((symbol_short!("mint"), to), amount);
    }
}

// =============================================================================
// SEP-41 TOKEN INTERFACE
// =============================================================================

#[contractimpl]
impl TokenInterface for MockUsdc {
    fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        let key = DataKey::Allowance(AllowanceKey { from, spender });
        let val: Option<AllowanceValue> = env.storage().temporary().get(&key);
        match val {
            Some(v) => {
                if env.ledger().sequence() > v.expiration_ledger {
                    0
                } else {
                    v.amount
                }
            }
            None => 0,
        }
    }

    fn approve(env: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        from.require_auth();
        if amount < 0 {
            panic!("amount must be non-negative");
        }
        let key = DataKey::Allowance(AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        let value = AllowanceValue {
            amount,
            expiration_ledger,
        };
        env.storage().temporary().set(&key, &value);
        env.events()
            .publish((symbol_short!("approve"), from, spender), amount);
    }

    fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(id))
            .unwrap_or(0)
    }

    fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        Self::do_transfer(&env, &from, &to, amount);
    }

    fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();

        // Check + decrement allowance
        let key = DataKey::Allowance(AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        let val: AllowanceValue = env
            .storage()
            .temporary()
            .get(&key)
            .expect("no allowance");
        if val.amount < amount {
            panic!("insufficient allowance");
        }
        if env.ledger().sequence() > val.expiration_ledger {
            panic!("allowance expired");
        }
        let new_val = AllowanceValue {
            amount: val.amount - amount,
            expiration_ledger: val.expiration_ledger,
        };
        env.storage().temporary().set(&key, &new_val);

        Self::do_transfer(&env, &from, &to, amount);
    }

    fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        let current: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(from.clone()))
            .unwrap_or(0);
        if current < amount {
            panic!("insufficient balance");
        }
        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(current - amount));
        env.events().publish((symbol_short!("burn"), from), amount);
    }

    fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        let key = DataKey::Allowance(AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        let val: AllowanceValue = env
            .storage()
            .temporary()
            .get(&key)
            .expect("no allowance");
        if val.amount < amount {
            panic!("insufficient allowance");
        }
        let new_val = AllowanceValue {
            amount: val.amount - amount,
            expiration_ledger: val.expiration_ledger,
        };
        env.storage().temporary().set(&key, &new_val);

        let current: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(from.clone()))
            .unwrap_or(0);
        if current < amount {
            panic!("insufficient balance");
        }
        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(current - amount));
        env.events().publish((symbol_short!("burnfrom"), from), amount);
    }

    fn decimals(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Decimals).unwrap_or(7)
    }

    fn name(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "Mock USDC"))
    }

    fn symbol(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "USDC"))
    }
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

impl MockUsdc {
    fn do_transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
        if amount < 0 {
            panic!("amount must be non-negative");
        }
        let from_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(from.clone()))
            .unwrap_or(0);
        if from_balance < amount {
            panic!("insufficient balance");
        }
        let to_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(to.clone()))
            .unwrap_or(0);

        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(from_balance - amount));
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &(to_balance + amount));
        env.storage().persistent().extend_ttl(
            &DataKey::Balance(from.clone()),
            1_555_200,
            1_555_200,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::Balance(to.clone()),
            1_555_200,
            1_555_200,
        );

        env.events()
            .publish((symbol_short!("transfer"), from.clone(), to.clone()), amount);
    }
}
