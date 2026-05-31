/**
 * Vigente Protocol — Threshold Oracle Simulator (B.6)
 *
 * Off-chain ed25519 signer that produces k-of-n authorization for the
 * vigente-badge `mint()` call after Phase B. Five keypairs live in process
 * memory; 3 of them sign each mint request.
 *
 * Canonical signed message (must byte-match the contract):
 *   borrower.to_xdr(env) || score.to_be_bytes() || expiration.to_be_bytes() || nonce
 *
 * Parity is validated by web/tests/xdr-parity.test.ts against the fixtures
 * printed by contracts/vigente-badge/tests/threshold_smoke.rs.
 *
 * Production note: this simulator regenerates keypairs on every process
 * start. For a real deployment the pubkeys must be persisted (env vars, KMS,
 * or HSM) and registered on-chain via `set_oracle_keys`. The keys here are
 * suitable for testnet demos and SCF reviewers; not for mainnet.
 */

import {
  generateKeyPairSync,
  sign as nodeSign,
  type KeyObject,
} from "node:crypto";
import { Address } from "@stellar/stellar-sdk";

export const ORACLE_COUNT = 5;
export const ORACLE_THRESHOLD = 3;

interface OracleNode {
  index: number;
  pubkey: Buffer;         // raw 32 bytes ed25519 public key
  privateKey: KeyObject;  // node KeyObject (kept in memory)
}

let oracleSet: OracleNode[] | null = null;

/** DER SPKI for ed25519 is a fixed 12-byte prefix + 32-byte raw pubkey. */
function rawPubkeyFromDer(der: Buffer): Buffer {
  if (der.length !== 44) {
    throw new Error(
      `unexpected ed25519 SPKI DER length: got ${der.length}, expected 44`,
    );
  }
  return der.subarray(12);
}

function initOracleSet(): OracleNode[] {
  const nodes: OracleNode[] = [];
  for (let i = 0; i < ORACLE_COUNT; i++) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    nodes.push({
      index: i,
      pubkey: rawPubkeyFromDer(der),
      privateKey,
    });
  }
  return nodes;
}

function getOracles(): OracleNode[] {
  if (!oracleSet) {
    oracleSet = initOracleSet();
  }
  return oracleSet;
}

/**
 * Reset and regenerate the in-memory oracle set. Useful for tests; do NOT
 * call in production — it invalidates any keys already registered on-chain.
 */
export function __resetOracleSet(): void {
  oracleSet = null;
}

/** Raw 32-byte public keys of all configured oracles, in index order. */
export function getOraclePubkeys(): Buffer[] {
  return getOracles().map((o) => Buffer.from(o.pubkey));
}

/** Strkey-encoded ("G...") oracle pubkeys — for logging / display only. */
export function getOraclePubkeysStrkey(): string[] {
  // ed25519 strkey accounts: 0x30 version byte + 32 pubkey + 2 CRC
  // We don't need this on the contract side, just for human-readable display.
  // Done lazily via Address.account is overkill; skip for now.
  return getOraclePubkeys().map((b) => `raw:${b.toString("hex")}`);
}

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

/**
 * Build the canonical mint message that every oracle must sign.
 * MUST byte-match `build_mint_message` in contracts/vigente-badge/src/lib.rs.
 * Validated by web/tests/xdr-parity.test.ts.
 */
export function buildMintMessage(
  borrowerStrkey: string,
  score: number,
  expiration: bigint,
  nonce: Buffer,
): Buffer {
  if (nonce.length !== 32) {
    throw new Error(`nonce must be 32 bytes, got ${nonce.length}`);
  }
  if (score < 0 || score > 1000) {
    throw new Error(`score out of range: ${score}`);
  }
  const addrXdr = Buffer.from(
    Address.fromString(borrowerStrkey).toScVal().toXDR(),
  );
  return Buffer.concat([addrXdr, u32BE(score), u64BE(expiration), nonce]);
}

export interface ThresholdSignature {
  /** Index into the OracleKeys vector configured in the contract. */
  index: number;
  /** Raw 64-byte ed25519 signature. */
  signature: Buffer;
}

export interface SignedMintRequest {
  borrower: string;
  score: number;
  expiration: string;     // bigint serialized to string for JSON safety
  nonce: string;          // hex
  signatures: Array<{ index: number; signature: string }>;
  threshold: number;
  oracleCount: number;
}

/**
 * Produce `count` ed25519 signatures over the canonical mint message.
 * Default `count = ORACLE_THRESHOLD`. Signatures come from the first N oracles
 * in index order; the contract accepts any unique-index combination, but
 * choosing low indices keeps the test/sim flow deterministic.
 */
export function signMint(
  borrowerStrkey: string,
  score: number,
  expiration: bigint,
  nonce: Buffer,
  count: number = ORACLE_THRESHOLD,
): ThresholdSignature[] {
  if (count < ORACLE_THRESHOLD) {
    throw new Error(
      `requested ${count} signatures but threshold is ${ORACLE_THRESHOLD}`,
    );
  }
  if (count > ORACLE_COUNT) {
    throw new Error(
      `requested ${count} signatures but only ${ORACLE_COUNT} oracles exist`,
    );
  }
  const msg = buildMintMessage(borrowerStrkey, score, expiration, nonce);
  const oracles = getOracles();
  const out: ThresholdSignature[] = [];
  for (let i = 0; i < count; i++) {
    const sig = nodeSign(null, msg, oracles[i].privateKey);
    if (sig.length !== 64) {
      throw new Error(`unexpected ed25519 sig length: ${sig.length}`);
    }
    out.push({ index: oracles[i].index, signature: Buffer.from(sig) });
  }
  return out;
}

/**
 * High-level: produce a fully-formed signed mint request the frontend can
 * submit to Soroban. JSON-safe (bigints → strings, Buffers → hex).
 */
export function buildSignedMintRequest(
  borrowerStrkey: string,
  score: number,
  expiration: bigint,
  nonce: Buffer,
): SignedMintRequest {
  const sigs = signMint(borrowerStrkey, score, expiration, nonce);
  return {
    borrower: borrowerStrkey,
    score,
    expiration: expiration.toString(),
    nonce: nonce.toString("hex"),
    signatures: sigs.map((s) => ({
      index: s.index,
      signature: s.signature.toString("hex"),
    })),
    threshold: ORACLE_THRESHOLD,
    oracleCount: ORACLE_COUNT,
  };
}

/** Generate a fresh 32-byte nonce. */
export function freshNonce(): Buffer {
  // Use Node crypto.randomBytes for cryptographically strong randomness.
  // Lazy import to avoid hoisting the dependency for callers that bring their own nonce.
  const { randomBytes } = require("node:crypto");
  return randomBytes(32);
}
