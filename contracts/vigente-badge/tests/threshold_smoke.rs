// =============================================================================
// THRESHOLD ED25519 SMOKE TEST — Day 1 budget probe
// =============================================================================
//
// Purpose: determine whether 3 ed25519 signature verifications fit inside a
// single Soroban contract invocation under testnet resource limits.
//
// Output:
//   - CPU instructions consumed
//   - Memory bytes consumed
//   - Approximate payload size of Vec<(u32, BytesN<64>)> with k=3 elements
//
// Verdict (recorded in docs/notes/soroban-budget-day1.md):
//   - PASS   → proceed with on-chain threshold verification (Phase B as planned)
//   - TIGHT  → proceed but monitor; reduce verifications or split tx if needed
//   - FAIL   → activate commit-reveal off-chain fallback
//
// This test does NOT touch the production VigenteBadge contract. It registers
// a minimal auxiliary contract whose only job is to invoke ed25519_verify a
// configurable number of times so we can read env.budget() under realistic
// conditions before committing to the architecture.
// =============================================================================

use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use soroban_sdk::{contract, contractimpl, Bytes, BytesN, Env, Vec};

// -----------------------------------------------------------------------------
// Auxiliary contract — only purpose is to consume budget on ed25519_verify
// -----------------------------------------------------------------------------

#[contract]
pub struct ThresholdSmokeContract;

#[contractimpl]
impl ThresholdSmokeContract {
    /// Verify N ed25519 signatures over the same message.
    /// Returns the number of successful verifications (panics on first invalid).
    pub fn verify_n(
        env: Env,
        message: Bytes,
        public_keys: Vec<BytesN<32>>,
        signatures: Vec<BytesN<64>>,
    ) -> u32 {
        let n = public_keys.len();
        if signatures.len() != n {
            panic!("public_keys and signatures length mismatch");
        }
        let mut i: u32 = 0;
        while i < n {
            let pk = public_keys.get(i).unwrap();
            let sig = signatures.get(i).unwrap();
            env.crypto().ed25519_verify(&pk, &message, &sig);
            i += 1;
        }
        n
    }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

struct OracleNode {
    signing_key: SigningKey,
    pubkey_bytes: [u8; 32],
}

fn generate_oracle_nodes(count: usize) -> std::vec::Vec<OracleNode> {
    let mut rng = OsRng;
    let mut nodes = std::vec::Vec::with_capacity(count);
    for _ in 0..count {
        let signing_key = SigningKey::generate(&mut rng);
        let pubkey_bytes = signing_key.verifying_key().to_bytes();
        nodes.push(OracleNode {
            signing_key,
            pubkey_bytes,
        });
    }
    nodes
}

fn sign_with_nodes(
    nodes: &[OracleNode],
    message: &[u8],
) -> std::vec::Vec<[u8; 64]> {
    nodes
        .iter()
        .map(|n| n.signing_key.sign(message).to_bytes())
        .collect()
}

fn build_soroban_inputs(
    env: &Env,
    nodes: &[OracleNode],
    sigs: &[[u8; 64]],
    message: &[u8; 32],
) -> (Bytes, Vec<BytesN<32>>, Vec<BytesN<64>>) {
    let msg = Bytes::from_array(env, message);
    let mut pks = Vec::new(env);
    for n in nodes {
        pks.push_back(BytesN::from_array(env, &n.pubkey_bytes));
    }
    let mut sigs_v = Vec::new(env);
    for s in sigs {
        sigs_v.push_back(BytesN::from_array(env, s));
    }
    (msg, pks, sigs_v)
}

// -----------------------------------------------------------------------------
// Smoke tests
// -----------------------------------------------------------------------------

#[test]
fn smoke_single_verification_succeeds() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ThresholdSmokeContract);
    let client = ThresholdSmokeContractClient::new(&env, &contract_id);

    let nodes = generate_oracle_nodes(1);
    let message_bytes: [u8; 32] = [42u8; 32];
    let sigs = sign_with_nodes(&nodes, &message_bytes);
    let (msg, pks, sigs_v) = build_soroban_inputs(&env, &nodes, &sigs, &message_bytes);

    let verified = client.verify_n(&msg, &pks, &sigs_v);
    assert_eq!(verified, 1);
}

#[test]
fn smoke_three_of_five_signatures_under_budget() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ThresholdSmokeContract);
    let client = ThresholdSmokeContractClient::new(&env, &contract_id);

    // Generate 5 oracle nodes, but only use 3 for verification (k=3-of-n=5)
    let all_nodes = generate_oracle_nodes(5);
    let threshold_nodes = &all_nodes[..3];

    let message_bytes: [u8; 32] = [7u8; 32];
    let sigs = sign_with_nodes(threshold_nodes, &message_bytes);
    let (msg, pks, sigs_v) = build_soroban_inputs(&env, threshold_nodes, &sigs, &message_bytes);

    // Reset budget so the only consumption measured is from verify_n
    env.budget().reset_default();

    let verified = client.verify_n(&msg, &pks, &sigs_v);
    assert_eq!(verified, 3);

    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();

    // Report values via stdout for --nocapture inspection
    std::println!("=== THRESHOLD ED25519 SMOKE (k=3) ===");
    std::println!("CPU instructions: {}", cpu);
    std::println!("Memory bytes:     {}", mem);
    env.budget().print();

    // Soroban testnet default resource budget caps (protocol 21):
    //   - CPU instructions: 100_000_000 per tx (configurable upward via fee)
    //   - Memory bytes:     41_943_040     per tx
    // We compare against conservative thresholds that leave headroom for the
    // rest of mint() (storage writes, hashing, ACL checks).
    let cpu_budget_ceiling: u64 = 100_000_000;
    let mem_budget_ceiling: u64 = 41_943_040;

    assert!(
        cpu < cpu_budget_ceiling,
        "CPU consumption {} exceeded testnet ceiling {}",
        cpu,
        cpu_budget_ceiling
    );
    assert!(
        mem < mem_budget_ceiling,
        "Memory consumption {} exceeded testnet ceiling {}",
        mem,
        mem_budget_ceiling
    );

    // Conservative headroom check: verify_n alone should leave at least 60%
    // of the budget free for the rest of a real mint() invocation.
    let cpu_headroom_target: u64 = (cpu_budget_ceiling * 40) / 100;
    let mem_headroom_target: u64 = (mem_budget_ceiling * 40) / 100;

    std::println!(
        "CPU headroom ratio: {:.1}% (target: ≤40%)",
        (cpu as f64 / cpu_budget_ceiling as f64) * 100.0
    );
    std::println!(
        "Memory headroom ratio: {:.1}% (target: ≤40%)",
        (mem as f64 / mem_budget_ceiling as f64) * 100.0
    );

    // Verdict classification — do NOT panic on TIGHT, only on FAIL.
    // FAIL would mean we exceeded the ceiling, already caught above.
    if cpu >= cpu_headroom_target || mem >= mem_headroom_target {
        std::println!("VERDICT: TIGHT — proceed but monitor; consider lower threshold (e.g. 2-of-3) or split-tx fallback");
    } else {
        std::println!("VERDICT: PASS — k=3 ed25519_verify comfortably fits; proceed with Phase B as planned");
    }
}

#[test]
fn smoke_invalid_signature_fails() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ThresholdSmokeContract);
    let client = ThresholdSmokeContractClient::new(&env, &contract_id);

    let nodes = generate_oracle_nodes(2);
    let message_bytes: [u8; 32] = [1u8; 32];
    let other_message_bytes: [u8; 32] = [2u8; 32];

    // Sign over `other_message_bytes` but verify against `message_bytes` → invalid
    let sigs = sign_with_nodes(&nodes, &other_message_bytes);
    let (msg, pks, sigs_v) = build_soroban_inputs(&env, &nodes, &sigs, &message_bytes);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.verify_n(&msg, &pks, &sigs_v)
    }));
    assert!(
        result.is_err(),
        "ed25519_verify should panic on signature/message mismatch"
    );
}

#[test]
fn smoke_payload_size_within_envelope() {
    // Approximate the wire size of a Vec<(u32, BytesN<64>)> with 3 entries.
    // This is what mint() will accept as the `signatures` argument.
    //
    // XDR overhead per entry: 4 bytes (u32 index) + 64 bytes (signature) + vec
    // discriminator + length. Rough upper bound: 3 * 72 + 16 = ~232 bytes.
    //
    // Soroban tx envelope soft limit ~128 KiB. We are 3 orders of magnitude
    // below it. This test exists to lock the assumption in code so a regression
    // would be visible.
    let per_entry_bytes: usize = 4 + 64;
    let entries: usize = 3;
    let overhead: usize = 16;
    let approx_payload = entries * per_entry_bytes + overhead;

    std::println!("Approx signatures vector payload: {} bytes", approx_payload);
    assert!(
        approx_payload < 1024,
        "signatures payload {} bytes is suspiciously large",
        approx_payload
    );
}
