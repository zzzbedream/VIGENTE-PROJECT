#![cfg(test)]
//! Mock USDC — basic test coverage

use crate::{MockUsdc, MockUsdcClient};
use soroban_sdk::{
    testutils::Address as _,
    token::TokenClient,
    Address, Env, String,
};

fn setup_token(env: &Env) -> (Address, MockUsdcClient, TokenClient) {
    let contract_id = env.register_contract(None, MockUsdc);
    let admin = Address::generate(env);
    env.mock_all_auths();

    let client = MockUsdcClient::new(env, &contract_id);
    client.initialize(
        &admin,
        &7_u32,
        &String::from_str(env, "Mock USDC"),
        &String::from_str(env, "USDC"),
    );

    let token_client = TokenClient::new(env, &contract_id);
    (admin, client, token_client)
}

#[test]
fn test_initialize_sets_metadata() {
    let env = Env::default();
    let (_admin, _client, token) = setup_token(&env);
    assert_eq!(token.decimals(), 7);
    assert_eq!(token.symbol(), String::from_str(&env, "USDC"));
    assert_eq!(token.name(), String::from_str(&env, "Mock USDC"));
}

#[test]
fn test_mint_and_balance() {
    let env = Env::default();
    let (_admin, client, token) = setup_token(&env);
    let user = Address::generate(&env);

    client.mint(&user, &1_000_000_i128);
    assert_eq!(token.balance(&user), 1_000_000_i128);
}

#[test]
fn test_transfer_moves_balance() {
    let env = Env::default();
    let (_admin, client, token) = setup_token(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.mint(&alice, &500_i128);
    token.transfer(&alice, &bob, &200_i128);

    assert_eq!(token.balance(&alice), 300_i128);
    assert_eq!(token.balance(&bob), 200_i128);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_transfer_overdraft_panics() {
    let env = Env::default();
    let (_admin, client, token) = setup_token(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.mint(&alice, &100_i128);
    token.transfer(&alice, &bob, &500_i128);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_init_fails() {
    let env = Env::default();
    let (_admin, client, _token) = setup_token(&env);
    let another_admin = Address::generate(&env);
    client.initialize(
        &another_admin,
        &7_u32,
        &String::from_str(&env, "X"),
        &String::from_str(&env, "X"),
    );
}
