/**
 * Vigente Protocol — Mother Account Setup (Day 1, Track T3)
 *
 * Creates a single funded service account on Stellar testnet that will be
 * used by `generate-synthetic-profiles.ts` (Day 5) to bankroll 50 synthetic
 * PyME profiles via CreateAccount operations. This pattern avoids hammering
 * Friendbot 50 times in a row (which gets the IP rate-limited).
 *
 * Strategy:
 *   1. Generate a fresh ed25519 keypair locally.
 *   2. Ask Friendbot ONCE to fund the new account (~10,000 XLM).
 *   3. Verify the account exists on Horizon and report the balance.
 *   4. Append the pubkey + secret to web/.env.local (gitignored).
 *
 * Idempotency: if VIGENTE_MOTHER_PUBKEY is already set in .env.local, the
 * script refuses to overwrite. To regenerate, the user must manually clear
 * the existing entry first.
 *
 * Usage:
 *   cd web && npx ts-node scripts/setup-mother-account.ts
 *   or:  cd web && npm run setup:mother
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Keypair, Horizon } from "@stellar/stellar-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV_LOCAL_PATH = path.resolve(__dirname, "..", ".env.local");
const FRIENDBOT_URL = "https://friendbot.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org";

const MOTHER_PUBKEY_VAR = "VIGENTE_MOTHER_PUBKEY";
const MOTHER_SECRET_VAR = "VIGENTE_MOTHER_SECRET";

interface SetupResult {
  pubkey: string;
  balance_xlm: string;
  funded_at: string;
  env_local_updated: boolean;
}

async function ensureNoExistingMother(): Promise<void> {
  if (!fs.existsSync(ENV_LOCAL_PATH)) {
    return;
  }
  const existing = fs.readFileSync(ENV_LOCAL_PATH, "utf8");
  const lineMatcher = new RegExp(`^\\s*${MOTHER_PUBKEY_VAR}\\s*=`, "m");
  if (lineMatcher.test(existing)) {
    throw new Error(
      `${MOTHER_PUBKEY_VAR} already present in .env.local — refusing to overwrite. ` +
        `To regenerate, manually remove the existing VIGENTE_MOTHER_* lines first.`,
    );
  }
}

async function fundViaFriendbot(pubkey: string): Promise<void> {
  const url = `${FRIENDBOT_URL}?addr=${encodeURIComponent(pubkey)}`;
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => "<unreadable body>");
    throw new Error(
      `Friendbot returned ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
    );
  }
}

async function fetchNativeBalance(pubkey: string): Promise<string> {
  const server = new Horizon.Server(HORIZON_URL);
  const account = await server.loadAccount(pubkey);
  const nativeBalance = account.balances.find(
    (b) => b.asset_type === "native",
  );
  if (!nativeBalance) {
    throw new Error("native XLM balance not found on funded account");
  }
  return nativeBalance.balance;
}

function appendEnvVars(pubkey: string, secret: string): void {
  const fundedAt = new Date().toISOString();
  const block = [
    "",
    "# === VIGENTE_MOTHER_* (Day 1, Track T3 — funds synthetic profiles) ===",
    `# Funded via Friendbot on ${fundedAt}`,
    "# NEVER commit. NEVER expose. Read by web/scripts/generate-synthetic-profiles.ts only.",
    `${MOTHER_PUBKEY_VAR}=${pubkey}`,
    `${MOTHER_SECRET_VAR}=${secret}`,
    "",
  ].join("\n");

  fs.appendFileSync(ENV_LOCAL_PATH, block, { mode: 0o600 });
}

async function run(): Promise<SetupResult> {
  await ensureNoExistingMother();

  const keypair = Keypair.random();
  const pubkey = keypair.publicKey();
  const secret = keypair.secret();

  console.log(`[setup-mother] generated keypair, pubkey=${pubkey}`);
  console.log(`[setup-mother] requesting Friendbot funding (one-shot)…`);

  await fundViaFriendbot(pubkey);
  console.log(`[setup-mother] Friendbot OK, verifying on Horizon…`);

  const balance = await fetchNativeBalance(pubkey);
  console.log(`[setup-mother] balance: ${balance} XLM`);

  appendEnvVars(pubkey, secret);
  console.log(`[setup-mother] appended ${MOTHER_PUBKEY_VAR} and ${MOTHER_SECRET_VAR} to .env.local`);

  return {
    pubkey,
    balance_xlm: balance,
    funded_at: new Date().toISOString(),
    env_local_updated: true,
  };
}

run()
  .then((result) => {
    console.log("\n=== MOTHER ACCOUNT READY ===");
    console.log(JSON.stringify(result, null, 2));
    console.log("\nNext: web/scripts/generate-synthetic-profiles.ts (Day 5)");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n[setup-mother] FAILED:", err.message || err);
    process.exit(1);
  });
