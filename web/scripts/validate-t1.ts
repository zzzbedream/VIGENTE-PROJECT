/**
 * Vigente Protocol — Tranche 1 Validation Script (post Phase B' update)
 *
 * Verifies the MVP + threshold + age-floor surface is operational.
 *
 * Usage: npm run validate-t1
 * Output: JSON to stdout. Non-zero exit on failure.
 */

import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import {
  buildMintMessage,
  signMint,
  getOraclePubkeys,
  ORACLE_THRESHOLD,
  ORACLE_COUNT,
  freshNonce,
  __resetOracleSet,
} from "../src/services/threshold-oracle";
import { createPublicKey, verify as nodeVerify } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ThresholdDemo {
  k: number;
  n: number;
  three_sigs_verify_against_pubkeys: boolean;
  two_sigs_below_threshold: boolean;
  tampered_msg_rejected: boolean;
}

interface ValidationResult {
  tranche: 1;
  status: "complete" | "incomplete" | "error";
  vigente_badge: {
    contract_id_v3: string | null;
    contract_id_v2: string | null;
    contract_id_v1_legacy: string | null;
    tests_passed: number | null;
    code_compiles: boolean;
  };
  reference_vault: {
    tests_passed: number | null;
    code_compiles: boolean;
  };
  scoring_engine: {
    horizon_module_present: boolean;
    ecosystem_whitelist_present: boolean;
    payku_adapter_preserved: boolean;
  };
  threshold_demo: ThresholdDemo;
  frontend: {
    legacy_url: string;
    v3_route: string;
  };
  notes: string[];
  timestamp: string;
}

function runCargoTest(cwd: string): { passed: number | null; ok: boolean } {
  try {
    const out = execSync("cargo test --lib", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const passed = [...out.matchAll(/(\d+) passed/g)].reduce(
      (acc, m) => acc + parseInt(m[1], 10),
      0,
    );
    return { passed, ok: true };
  } catch {
    return { passed: null, ok: false };
  }
}

function pubkeyToKeyObject(rawPubkey: Buffer) {
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  const der = Buffer.concat([prefix, rawPubkey]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

function runThresholdDemo(): ThresholdDemo {
  __resetOracleSet();
  const borrower = "GBV676BNXDPVZDLUAB6O7DHWUIS42OTIWI5MIKCFJOWMJWTVKQNXFWCM";
  const score = 750;
  const expiration = BigInt(Math.floor(Date.now() / 1000) + 60 * 86400);
  const ageDays = 60;
  const nonce = freshNonce();

  // Three signatures.
  const sigs = signMint(borrower, score, expiration, ageDays, nonce);
  const msg = buildMintMessage(borrower, score, expiration, ageDays, nonce);
  const pks = getOraclePubkeys();
  let allValid = sigs.length === ORACLE_THRESHOLD;
  for (const s of sigs) {
    const ok = nodeVerify(null, msg, pubkeyToKeyObject(pks[s.index]), s.signature);
    allValid = allValid && ok;
  }

  // Two signatures must be rejected by the threshold rule (we model that
  // rule client-side here: simply check the engine's invariant).
  let twoRejected = false;
  try {
    signMint(borrower, score, expiration, ageDays, nonce, 2);
  } catch {
    twoRejected = true;
  }

  // Tampered message: same sigs against a different score must fail to verify.
  const tamperedMsg = buildMintMessage(borrower, 999, expiration, ageDays, nonce);
  let tamperedRejected = true;
  for (const s of sigs) {
    const ok = nodeVerify(null, tamperedMsg, pubkeyToKeyObject(pks[s.index]), s.signature);
    if (ok) tamperedRejected = false;
  }

  return {
    k: ORACLE_THRESHOLD,
    n: ORACLE_COUNT,
    three_sigs_verify_against_pubkeys: allValid,
    two_sigs_below_threshold: twoRejected,
    tampered_msg_rejected: tamperedRejected,
  };
}

function findEnvVar(envContent: string, name: string): string | null {
  const re = new RegExp(`^\\s*${name}\\s*=\\s*"?([^"\\n]+)"?`, "m");
  const m = envContent.match(re);
  return m ? m[1].trim() : null;
}

async function run(): Promise<ValidationResult> {
  const notes: string[] = [];
  const projectRoot = path.resolve(__dirname, "..", "..");

  const badge = runCargoTest(path.join(projectRoot, "contracts", "vigente-badge"));
  if (badge.ok) notes.push(`vigente-badge: ${badge.passed} tests passed`);
  else notes.push("vigente-badge: cargo test failed");

  const vault = runCargoTest(path.join(projectRoot, "contracts", "reference-vault"));
  if (vault.ok) notes.push(`reference-vault: ${vault.passed} tests passed`);
  else notes.push("reference-vault: cargo test failed");

  const horizon = fs.existsSync(
    path.join(projectRoot, "web", "src", "services", "horizon-scoring.ts"),
  );
  const ecosystem = fs.existsSync(
    path.join(projectRoot, "web", "src", "services", "ecosystem-whitelist.ts"),
  );
  const payku = fs.existsSync(
    path.join(projectRoot, "web", "src", "services", "payku-client.ts"),
  );
  if (horizon) notes.push("horizon-scoring.ts present");
  if (ecosystem) notes.push("ecosystem-whitelist.ts present");
  if (payku) notes.push("payku-client.ts preserved");

  const envPath = path.join(projectRoot, "web", ".env.local");
  let v1: string | null = null,
    v2: string | null = null,
    v3: string | null = null;
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    v1 = findEnvVar(envContent, "NEXT_PUBLIC_CONTRACT_ID");
    v2 = findEnvVar(envContent, "NEXT_PUBLIC_CONTRACT_ID_V2");
    v3 = findEnvVar(envContent, "NEXT_PUBLIC_CONTRACT_ID_V3");
  }

  let threshold: ThresholdDemo = {
    k: ORACLE_THRESHOLD,
    n: ORACLE_COUNT,
    three_sigs_verify_against_pubkeys: false,
    two_sigs_below_threshold: false,
    tampered_msg_rejected: false,
  };
  try {
    threshold = runThresholdDemo();
    notes.push(
      `threshold demo: ${threshold.k}-of-${threshold.n}, sigs valid=${threshold.three_sigs_verify_against_pubkeys}, k-1 rejected=${threshold.two_sigs_below_threshold}, tampered rejected=${threshold.tampered_msg_rejected}`,
    );
  } catch (err) {
    notes.push(
      `threshold demo failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const allOk =
    badge.ok &&
    vault.ok &&
    horizon &&
    ecosystem &&
    payku &&
    !!v3 &&
    threshold.three_sigs_verify_against_pubkeys &&
    threshold.two_sigs_below_threshold &&
    threshold.tampered_msg_rejected;

  const result: ValidationResult = {
    tranche: 1,
    status: allOk ? "complete" : "incomplete",
    vigente_badge: {
      contract_id_v3: v3,
      contract_id_v2: v2,
      contract_id_v1_legacy: v1,
      tests_passed: badge.passed,
      code_compiles: badge.ok,
    },
    reference_vault: {
      tests_passed: vault.passed,
      code_compiles: vault.ok,
    },
    scoring_engine: {
      horizon_module_present: horizon,
      ecosystem_whitelist_present: ecosystem,
      payku_adapter_preserved: payku,
    },
    threshold_demo: threshold,
    frontend: {
      legacy_url: "https://vigente-hackathon-final.vercel.app",
      v3_route: "/v3 (threshold demo)",
    },
    notes,
    timestamp: new Date().toISOString(),
  };

  return result;
}

run()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === "complete" ? 0 : 1);
  })
  .catch((err) => {
    console.error(
      JSON.stringify({ status: "error", error: err.message }, null, 2),
    );
    process.exit(2);
  });
