/**
 * XDR Parity Test — TypeScript ↔ Rust
 *
 * Confirms that the off-chain signer can produce byte-for-byte the same
 * mint message that the vigente-badge contract verifies on-chain. Without
 * this parity, ed25519_verify would reject every signature with InvalidInput.
 *
 * Expected output (from contracts/vigente-badge/tests/threshold_smoke.rs
 * smoke_address_xdr_parity_check):
 *   addr XDR len: 44 bytes
 *   mint msg len: 92 bytes
 *     = 44 (addr xdr) + 4 (score u32 BE) + 8 (expiration u64 BE)
 *       + 4 (account_age_days u32 BE, added in Phase B'.2) + 32 (nonce)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Address } from "@stellar/stellar-sdk";

const MOTHER_PUBKEY = "GBV676BNXDPVZDLUAB6O7DHWUIS42OTIWI5MIKCFJOWMJWTVKQNXFWCM";
const EXPECTED_ADDR_XDR =
  "0000001200000000000000006beff82db8df5c8d74007cef8cf6a225cd3a68b23ac428454bacc4da75541b72";
const EXPECTED_MINT_MSG =
  "0000001200000000000000006beff82db8df5c8d74007cef8cf6a225cd3a68b23ac428454bacc4da75541b720000035200000000655542800000003cabababababababababababababababababababababababababababababababab";

function u32BE(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

function u64BE(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(n);
  return b;
}

test("Address.toScVal().toXDR() matches Rust borrower.to_xdr(env)", () => {
  const addr = Address.fromString(MOTHER_PUBKEY);
  const scVal = addr.toScVal();
  const xdrBytes = scVal.toXDR();
  const hex = Buffer.from(xdrBytes).toString("hex");
  assert.equal(hex, EXPECTED_ADDR_XDR);
  assert.equal(xdrBytes.length, 44);
});

test("Full mint message matches Rust contract concat (with account_age_days)", () => {
  const addr = Address.fromString(MOTHER_PUBKEY);
  const xdrBytes = addr.toScVal().toXDR();
  const score = 850;
  const expiration = 1_700_086_400n;
  const accountAgeDays = 60;
  const nonce = Buffer.alloc(32, 0xab);

  const msg = Buffer.concat([
    Buffer.from(xdrBytes),
    u32BE(score),
    u64BE(expiration),
    u32BE(accountAgeDays),
    nonce,
  ]);

  const hex = msg.toString("hex");
  assert.equal(hex, EXPECTED_MINT_MSG);
  assert.equal(msg.length, 92);
});
