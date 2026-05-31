/**
 * Vigente Protocol — Oracle Seed Setup
 *
 * Generates 5 ed25519 seeds (32 bytes each), persists them to .env.local under
 * VIGENTE_ORACLE_SEEDS_HEX, and prints the corresponding raw pubkeys so the
 * deployer can configure the on-chain ACL via:
 *
 *   stellar contract invoke --id <CONTRACT_ID_V2> --network testnet \
 *     -- set_oracle_keys \
 *     --keys '[<pubkey0>, <pubkey1>, ..., <pubkey4>]' \
 *     --threshold 3
 *
 * Idempotency: if VIGENTE_ORACLE_SEEDS_HEX is already present in .env.local
 * the script refuses to overwrite. Delete the line manually to regenerate
 * (which invalidates all on-chain signatures from those keys).
 *
 * Run: cd web && npm run setup:oracle-keys
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { randomBytes, createPrivateKey, createPublicKey } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV_LOCAL_PATH = path.resolve(__dirname, "..", ".env.local");
const VAR_NAME = "VIGENTE_ORACLE_SEEDS_HEX";
const ORACLE_COUNT = 5;
const ORACLE_THRESHOLD = 3;

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

interface OracleEntry {
  index: number;
  seedHex: string;
  pubkeyHex: string;
}

function ensureNotAlreadyConfigured(): void {
  if (!fs.existsSync(ENV_LOCAL_PATH)) return;
  const existing = fs.readFileSync(ENV_LOCAL_PATH, "utf8");
  const re = new RegExp(`^\\s*${VAR_NAME}\\s*=`, "m");
  if (re.test(existing)) {
    throw new Error(
      `${VAR_NAME} already present in .env.local. Remove the line manually to regenerate (this invalidates any keys already registered on-chain).`,
    );
  }
}

function deriveOracle(index: number, seed: Buffer): OracleEntry {
  const pkcs8 = Buffer.concat([PKCS8_ED25519_PREFIX, seed]);
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  // SPKI DER ed25519 = 12-byte prefix + 32-byte raw pubkey.
  const rawPubkey = der.subarray(12);
  return {
    index,
    seedHex: seed.toString("hex"),
    pubkeyHex: rawPubkey.toString("hex"),
  };
}

function appendToEnvLocal(seedsCsv: string): void {
  const block = [
    "",
    "# === VIGENTE_ORACLE_SEEDS_HEX (Phase B.7 — threshold oracle simulator keys) ===",
    `# Generated ${new Date().toISOString()}`,
    "# 5 comma-separated 32-byte hex seeds, one per oracle node. NEVER commit.",
    "# Pubkeys derived from these seeds must match what was registered on-chain",
    "# via set_oracle_keys. If you change this line, re-run set_oracle_keys.",
    `${VAR_NAME}=${seedsCsv}`,
    "",
  ].join("\n");
  fs.appendFileSync(ENV_LOCAL_PATH, block, { mode: 0o600 });
}

function main(): void {
  ensureNotAlreadyConfigured();

  const oracles: OracleEntry[] = [];
  for (let i = 0; i < ORACLE_COUNT; i++) {
    const seed = randomBytes(32);
    oracles.push(deriveOracle(i, seed));
  }

  const seedsCsv = oracles.map((o) => o.seedHex).join(",");
  appendToEnvLocal(seedsCsv);

  console.log(`[setup-oracle-keys] persisted ${ORACLE_COUNT} seeds to .env.local under ${VAR_NAME}`);
  console.log(`[setup-oracle-keys] threshold = ${ORACLE_THRESHOLD}\n`);

  console.log("=== Pubkeys to register on-chain (hex, raw 32 bytes) ===");
  oracles.forEach((o) => {
    console.log(`  oracle[${o.index}] = ${o.pubkeyHex}`);
  });

  console.log("\n=== stellar CLI invocation (copy / paste) ===");
  const keysJson = JSON.stringify(oracles.map((o) => o.pubkeyHex));
  console.log(
    `stellar contract invoke --id $CONTRACT_V2 --network testnet \\\n` +
      `  -- set_oracle_keys --keys '${keysJson}' --threshold ${ORACLE_THRESHOLD}`,
  );
  console.log("\n=== Done. Verify after invoke: ===");
  console.log("stellar contract invoke --id $CONTRACT_V2 --network testnet -- get_oracle_threshold");
  console.log("stellar contract invoke --id $CONTRACT_V2 --network testnet -- get_oracle_keys");
}

try {
  main();
  process.exit(0);
} catch (err) {
  console.error("[setup-oracle-keys] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
}
