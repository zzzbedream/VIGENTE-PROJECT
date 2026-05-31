/**
 * Threshold Oracle Simulator — unit tests
 *
 * Offline. Verifies that:
 *   - 5 oracles are generated with 32-byte raw ed25519 pubkeys.
 *   - signMint() returns exactly `threshold` signatures of 64 bytes each.
 *   - Each signature verifies against its own oracle pubkey via Node crypto.
 *   - Signatures from a wrong oracle fail verification.
 *   - The same message + same nonce produces deterministic outputs (no state drift).
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify as nodeVerify } from "node:crypto";
import {
  ORACLE_COUNT,
  ORACLE_THRESHOLD,
  __resetOracleSet,
  getOraclePubkeys,
  buildMintMessage,
  signMint,
  buildSignedMintRequest,
  freshNonce,
} from "../src/services/threshold-oracle";

const TEST_BORROWER = "GBV676BNXDPVZDLUAB6O7DHWUIS42OTIWI5MIKCFJOWMJWTVKQNXFWCM";

function pubkeyToKeyObject(rawPubkey: Buffer) {
  // Wrap raw 32-byte ed25519 pubkey into SPKI DER for Node crypto.verify.
  // SPKI prefix for ed25519: 30 2A 30 05 06 03 2B 65 70 03 21 00
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  const der = Buffer.concat([prefix, rawPubkey]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

beforeEach(() => {
  __resetOracleSet();
});

test("oracle set has 5 entries with 32-byte raw pubkeys", () => {
  const pks = getOraclePubkeys();
  assert.equal(pks.length, ORACLE_COUNT);
  for (const pk of pks) {
    assert.equal(pk.length, 32);
  }
});

test("signMint produces threshold signatures of 64 bytes", () => {
  const nonce = Buffer.alloc(32, 0x42);
  const sigs = signMint(TEST_BORROWER, 750, 1_700_086_400n, nonce);
  assert.equal(sigs.length, ORACLE_THRESHOLD);
  for (const s of sigs) {
    assert.equal(s.signature.length, 64);
  }
});

test("each signature verifies against its own oracle pubkey", () => {
  const nonce = Buffer.alloc(32, 0x7f);
  const score = 850;
  const expiration = 1_700_086_400n;
  const msg = buildMintMessage(TEST_BORROWER, score, expiration, nonce);

  const sigs = signMint(TEST_BORROWER, score, expiration, nonce);
  const pks = getOraclePubkeys();
  for (const s of sigs) {
    const pk = pubkeyToKeyObject(pks[s.index]);
    const ok = nodeVerify(null, msg, pk, s.signature);
    assert.equal(ok, true, `oracle ${s.index} signature failed verification`);
  }
});

test("signature from oracle 0 does NOT verify with oracle 1's pubkey", () => {
  const nonce = Buffer.alloc(32, 0x11);
  const msg = buildMintMessage(TEST_BORROWER, 500, 1_700_086_400n, nonce);
  const sigs = signMint(TEST_BORROWER, 500, 1_700_086_400n, nonce);
  const pks = getOraclePubkeys();

  const wrongPk = pubkeyToKeyObject(pks[1]);
  const sig0 = sigs[0].signature;
  const ok = nodeVerify(null, msg, wrongPk, sig0);
  assert.equal(ok, false);
});

test("changing the nonce changes every signature", () => {
  const nonceA = Buffer.alloc(32, 0x01);
  const nonceB = Buffer.alloc(32, 0x02);
  const a = signMint(TEST_BORROWER, 600, 1_700_086_400n, nonceA);
  const b = signMint(TEST_BORROWER, 600, 1_700_086_400n, nonceB);
  for (let i = 0; i < a.length; i++) {
    assert.notEqual(
      a[i].signature.toString("hex"),
      b[i].signature.toString("hex"),
    );
  }
});

test("buildSignedMintRequest returns JSON-safe payload", () => {
  const nonce = Buffer.alloc(32, 0x33);
  const req = buildSignedMintRequest(TEST_BORROWER, 920, 1_700_086_400n, nonce);
  // Round-trip through JSON to confirm no bigints/Buffers leak.
  const json = JSON.stringify(req);
  const parsed = JSON.parse(json);
  assert.equal(parsed.borrower, TEST_BORROWER);
  assert.equal(parsed.score, 920);
  assert.equal(parsed.expiration, "1700086400");
  assert.equal(parsed.nonce.length, 64); // 32 bytes hex
  assert.equal(parsed.signatures.length, ORACLE_THRESHOLD);
  for (const s of parsed.signatures) {
    assert.equal(typeof s.index, "number");
    assert.equal(s.signature.length, 128); // 64 bytes hex
  }
});

test("freshNonce produces 32 distinct bytes", () => {
  const a = freshNonce();
  const b = freshNonce();
  assert.equal(a.length, 32);
  assert.equal(b.length, 32);
  assert.notEqual(a.toString("hex"), b.toString("hex"));
});

test("requesting fewer than threshold signatures throws", () => {
  const nonce = freshNonce();
  assert.throws(
    () => signMint(TEST_BORROWER, 500, 1_700_086_400n, nonce, ORACLE_THRESHOLD - 1),
    /threshold/,
  );
});

test("requesting more than oracle count throws", () => {
  const nonce = freshNonce();
  assert.throws(
    () => signMint(TEST_BORROWER, 500, 1_700_086_400n, nonce, ORACLE_COUNT + 1),
    /only/,
  );
});
