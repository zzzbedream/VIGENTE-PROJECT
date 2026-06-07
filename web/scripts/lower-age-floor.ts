/**
 * Vigente Protocol — Demo helper: lower the min wallet age floor
 *
 * The vigente-badge v3 contract enforces a 30-day wallet age floor as an
 * anti-Sybil measure. That is correct production posture but kills demos
 * — a brand-new Freighter / xBull wallet has age = 0, and the contract
 * panics ("wallet age below minimum"), which the host surfaces as the
 * unhelpful Error(WasmVm, InvalidAction) trap.
 *
 * This script calls `set_min_wallet_age(env, days)` as the admin (the
 * mother account, which initialized the contract) so the demo can run
 * with any wallet. Default target is 1 day; pass a different number on
 * the command line.
 *
 * Usage:
 *   cd web && npx tsx scripts/lower-age-floor.ts [days]
 *   cd web && npm run demo:lower-age              # uses default = 1
 *
 * Reset to production posture after the demo:
 *   cd web && npx tsx scripts/lower-age-floor.ts 30
 */

import { config as dotenvConfig } from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenvConfig({ path: path.resolve(__dirname, "..", ".env.local") });

const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const CONTRACT_V3 =
  process.env.NEXT_PUBLIC_CONTRACT_ID_V3 ||
  "CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD";
const MOTHER_SECRET = process.env.VIGENTE_MOTHER_SECRET;

if (!MOTHER_SECRET) {
  console.error("VIGENTE_MOTHER_SECRET missing from .env.local");
  process.exit(1);
}
const motherSecret: string = MOTHER_SECRET;

const targetDays = (() => {
  const raw = process.argv[2];
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) {
    console.error(`days must be a non-negative u32 integer (got "${raw}")`);
    process.exit(1);
  }
  return n;
})();

async function main(): Promise<void> {
  const admin = Keypair.fromSecret(motherSecret);
  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(CONTRACT_V3);

  console.log(`contract: ${CONTRACT_V3}`);
  console.log(`admin:    ${admin.publicKey()}`);

  // Read current floor first so the demo operator sees both numbers.
  const readAccount = await server.getAccount(admin.publicKey());
  const readTx = new TransactionBuilder(readAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("get_min_wallet_age"))
    .setTimeout(30)
    .build();
  const readSim = await server.simulateTransaction(readTx);
  let currentFloor: number | null = null;
  if (rpc.Api.isSimulationSuccess(readSim) && readSim.result?.retval) {
    const v = scValToNative(readSim.result.retval);
    currentFloor = typeof v === "bigint" ? Number(v) : Number(v);
  }
  console.log(`current floor: ${currentFloor ?? "(unreadable)"}`);
  console.log(`target floor:  ${targetDays}`);

  if (currentFloor === targetDays) {
    console.log("nothing to do — floor already matches target.");
    return;
  }

  const writeAccount = await server.getAccount(admin.publicKey());
  const op = contract.call(
    "set_min_wallet_age",
    nativeToScVal(targetDays, { type: "u32" }),
  );
  const built = new TransactionBuilder(writeAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();
  const prepared = await server.prepareTransaction(built);
  prepared.sign(admin);

  const sent = await server.sendTransaction(prepared);
  console.log(`tx hash: ${sent.hash}`);
  if (sent.status === "ERROR") {
    console.error("submission rejected:", sent.errorResult?.result()?.toString());
    process.exit(1);
  }

  let resp = await server.getTransaction(sent.hash);
  for (let i = 0; i < 30 && resp.status === "NOT_FOUND"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    resp = await server.getTransaction(sent.hash);
  }
  if (resp.status !== "SUCCESS") {
    console.error("tx did not succeed:", resp.status);
    process.exit(1);
  }

  console.log(`done — floor lowered to ${targetDays} day(s).`);
  console.log(
    `explorer: https://stellar.expert/explorer/testnet/tx/${sent.hash}`,
  );
}

main().catch((err) => {
  console.error("error:", err);
  process.exit(1);
});
