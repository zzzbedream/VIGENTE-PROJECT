#!/usr/bin/env node
/**
 * Vigente Protocol — zkTLS Proof Generation
 * 
 * Simulates the TLSNotary proof-of-solvency flow:
 *   1. Load Fintoc sandbox data (client-side)
 *   2. Compute aggregate financial metrics
 *   3. Evaluate solvency claim ("monthly_income > 1000 USD")
 *   4. Create SHA-256 data commitment
 *   5. Sign attestation with Ed25519 (Notary simulation)
 *   6. Output Base64-encoded proof
 * 
 * The output proof contains ONLY the claim verdict and signature.
 * Raw bank data is NEVER included in the proof.
 * 
 * Usage: npm run generate-zk-proof
 */

const path = require('path');
const CryptoEngine = require('./lib/crypto-engine');
const ClaimEvaluator = require('./lib/claim-evaluator');

// ── Load Fintoc Fixtures ───────────────────────────────────────────────────
// Reuse Tranche 1 fixtures (shared data pipeline)
const FIXTURES_DIR = path.join(__dirname, '..', '..', 'fintoc-sandbox', 'src', 'fixtures');
const movements = require(path.join(FIXTURES_DIR, 'sandbox-movements.json'));

// ── Configuration ──────────────────────────────────────────────────────────
const CLAIM_PREDICATE = 'monthly_income > 1000 USD';
const DATA_SOURCE = 'api.fintoc.com';

function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   Vigente Protocol — zkTLS Proof Generation              ║');
  console.log('║   Ed25519 Proof-of-Solvency · Tranche 2 PoC             ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  // Phase 1: Load data
  const movs = movements.movements;
  console.log(`✅ Fintoc data loaded: ${movs.length} movements`);
  console.log(`   └─ Date range: ${movements.date_range.since} → ${movements.date_range.until}`);

  // Phase 2: Compute metrics & evaluate claim
  const metrics = ClaimEvaluator.computeMetrics(movs);
  const claim = ClaimEvaluator.evaluateClaim(CLAIM_PREDICATE, metrics);
  
  const resultEmoji = claim.result ? 'TRUE' : 'FALSE';
  console.log(`✅ Claim evaluated: "${claim.predicate}" → ${resultEmoji}`);
  console.log(`   └─ Evaluated value: $${claim.evaluated_value} USD/month`);
  console.log(`   └─ Threshold: $${claim.threshold} USD/month`);

  // Phase 3: Create data commitment (binds proof to this exact dataset)
  const dataCommitment = CryptoEngine.computeCommitment(movs);
  console.log(`✅ Data commitment: SHA-256(raw_data) = ${dataCommitment.substring(0, 16)}...`);

  // Phase 4: Generate Notary keypair (simulates MPC-TLS Notary)
  const notary = CryptoEngine.generateNotaryKeypair();
  console.log(`✅ Notary keypair generated (Ed25519)`);
  console.log(`   └─ Public key: ${notary.publicKeyHex.substring(0, 16)}...`);

  // Phase 5: Build attestation payload
  const nonce = CryptoEngine.generateNonce();
  const timestamp = Math.floor(Date.now() / 1000);

  const attestationPayload = {
    claim_predicate: claim.predicate,
    claim_result: claim.result,
    data_commitment: dataCommitment,
    data_source: DATA_SOURCE,
    nonce: nonce,
    timestamp: timestamp,
    notary_pubkey: notary.publicKeyHex,
  };

  // Phase 6: Sign with Ed25519
  const signature = CryptoEngine.sign(attestationPayload, notary.privateKey);
  console.log(`✅ Ed25519 signature generated`);
  console.log(`   └─ Signature: ${signature.substring(0, 32)}...`);

  // Phase 7: Assemble complete proof
  const proof = {
    version: '1.0.0',
    protocol: 'vigente-zktls-poc',
    payload: attestationPayload,
    signature: signature,
    notary_pubkey_der: CryptoEngine.exportPublicKey(notary.publicKey),
  };

  // Serialize to Base64
  const proofBase64 = Buffer.from(JSON.stringify(proof)).toString('base64');
  console.log(`✅ Proof serialized (Base64)`);

  // Output
  console.log('');
  console.log('──── PROOF (copy this entire string) ────');
  console.log(proofBase64);
  console.log('─────────────────────────────────────────');
  console.log('');

  // Also output structured summary
  console.log('📋 PROOF SUMMARY:');
  console.log(JSON.stringify({
    predicate: claim.predicate,
    result: claim.result,
    data_source: DATA_SOURCE,
    commitment: dataCommitment.substring(0, 16) + '...',
    nonce: nonce,
    signature_algo: 'Ed25519',
    proof_size_bytes: proofBase64.length,
  }, null, 2));
  console.log('');
  console.log('💡 To verify this proof, run:');
  console.log(`   npm run verify-proof ${proofBase64.substring(0, 40)}...`);
  console.log('');

  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error(`❌ Proof generation failed: ${err.message}`);
  process.exit(1);
}
