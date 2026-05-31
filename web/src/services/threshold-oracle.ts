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
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  type KeyObject,
} from "node:crypto";
import { Address } from "@stellar/stellar-sdk";

/** PKCS8 DER prefix for an ed25519 private key followed by the 32-byte seed. */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

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

function nodeFromSeed(index: number, seedHex: string): OracleNode {
  const seed = Buffer.from(seedHex.trim(), "hex");
  if (seed.length !== 32) {
    throw new Error(
      `oracle seed at index ${index} is ${seed.length} bytes, expected 32`,
    );
  }
  const pkcs8 = Buffer.concat([PKCS8_ED25519_PREFIX, seed]);
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return {
    index,
    pubkey: rawPubkeyFromDer(der),
    privateKey,
  };
}

function initOracleSet(): OracleNode[] {
  // Production path: deterministic keys persisted via env. Required for the
  // off-chain simulator to keep producing signatures that verify against the
  // pubkeys committed to the contract via set_oracle_keys.
  const envSeeds = process.env.VIGENTE_ORACLE_SEEDS_HEX;
  if (envSeeds) {
    const seeds = envSeeds.split(",").map((s) => s.trim()).filter(Boolean);
    if (seeds.length !== ORACLE_COUNT) {
      throw new Error(
        `VIGENTE_ORACLE_SEEDS_HEX must list exactly ${ORACLE_COUNT} comma-separated ` +
          `32-byte hex seeds, got ${seeds.length}`,
      );
    }
    return seeds.map((hex, i) => nodeFromSeed(i, hex));
  }

  // Development fallback: ephemeral keys. Print a one-line warning so anyone
  // running this in a non-test context sees the gap explicitly.
  if (process.env.NODE_ENV !== "test") {
    console.warn(
      "[threshold-oracle] VIGENTE_ORACLE_SEEDS_HEX not set — generating ephemeral " +
        "keypairs. These will NOT match anything registered on-chain. Run " +
        "`npm run setup:oracle-keys` before deploying or calling set_oracle_keys.",
    );
  }
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
 *
 * Phase B'.2 added `accountAgeDays` (u32 BE) between `expiration` and `nonce`
 * so the on-chain age floor cannot be bypassed by a tampered relayer.
 */
export function buildMintMessage(
  borrowerStrkey: string,
  score: number,
  expiration: bigint,
  accountAgeDays: number,
  nonce: Buffer,
): Buffer {
  if (nonce.length !== 32) {
    throw new Error(`nonce must be 32 bytes, got ${nonce.length}`);
  }
  if (score < 0 || score > 1000) {
    throw new Error(`score out of range: ${score}`);
  }
  if (!Number.isInteger(accountAgeDays) || accountAgeDays < 0 || accountAgeDays > 0xffff_ffff) {
    throw new Error(`accountAgeDays out of range: ${accountAgeDays}`);
  }
  const addrXdr = Buffer.from(
    Address.fromString(borrowerStrkey).toScVal().toXDR(),
  );
  return Buffer.concat([
    addrXdr,
    u32BE(score),
    u64BE(expiration),
    u32BE(accountAgeDays),
    nonce,
  ]);
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
  expiration: string;         // bigint serialized to string for JSON safety
  accountAgeDays: number;
  nonce: string;              // hex
  signatures: Array<{ index: number; signature: string }>;
  threshold: number;
  oracleCount: number;
}

/**
 * Produce `count` ed25519 signatures over the canonical mint message.
 * Default `count = ORACLE_THRESHOLD`.
 */
export function signMint(
  borrowerStrkey: string,
  score: number,
  expiration: bigint,
  accountAgeDays: number,
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
  const msg = buildMintMessage(borrowerStrkey, score, expiration, accountAgeDays, nonce);
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
  accountAgeDays: number,
  nonce: Buffer,
): SignedMintRequest {
  const sigs = signMint(borrowerStrkey, score, expiration, accountAgeDays, nonce);
  return {
    borrower: borrowerStrkey,
    score,
    expiration: expiration.toString(),
    accountAgeDays,
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
