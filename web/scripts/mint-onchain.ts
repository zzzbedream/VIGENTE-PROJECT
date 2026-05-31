/**
 * Vigente Protocol — End-to-End On-Chain Mint Smoke (Phase B.7 acceptance)
 *
 * Drives the full happy-path through real testnet:
 *   1. Generate fresh nonce.
 *   2. Have the off-chain simulator sign the canonical mint message with 3 of 5 oracles.
 *   3. Assemble a Soroban transaction calling vigente-badge.mint(...).
 *   4. Sign with the mother account (gas only).
 *   5. Submit, wait for inclusion, log tx hash.
 *   6. Read get_score(borrower) and assert the badge is active.
 *
 * Success here proves the XDR parity (TS off-chain signers ↔ Rust on-chain
 * verifier) holds in production, not just in unit tests.
 *
 * Usage:
 *   cd web && npm run mint:onchain -- <BORROWER_PUBKEY> <SCORE>
 */

import { config as dotenvConfig } from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { buildSignedMintRequest, freshNonce, ORACLE_THRESHOLD } from "../src/services/threshold-oracle";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenvConfig({ path: path.resolve(__dirname, "..", ".env.local") });

const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const CONTRACT_V2 = process.env.NEXT_PUBLIC_CONTRACT_ID_V2 || "CCD7KNYIJAVN4JRZKCMZWCBK3ED43VYEBX5PSYHOBOR6BHMVMN2GUMA5";
const MOTHER_SECRET = process.env.VIGENTE_MOTHER_SECRET;

if (!MOTHER_SECRET) {
  console.error("VIGENTE_MOTHER_SECRET missing from .env.local");
  process.exit(1);
}

const PUBKEY_RE = /^G[A-Z2-7]{55}$/;

function buildSignaturesScVal(
  sigs: Array<{ index: number; signature: string }>,
): xdr.ScVal {
  // Vec<(u32, BytesN<64>)> in Soroban: a vec of 2-element tuples (also vecs at the host layer).
  return xdr.ScVal.scvVec(
    sigs.map((s) => {
      const idxScVal = nativeToScVal(s.index, { type: "u32" });
      const sigBytes = Buffer.from(s.signature, "hex");
      if (sigBytes.length !== 64) {
        throw new Error(`signature ${s.index} is ${sigBytes.length} bytes, expected 64`);
      }
      const sigScVal = xdr.ScVal.scvBytes(sigBytes);
      return xdr.ScVal.scvVec([idxScVal, sigScVal]);
    }),
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const borrower = argv[0]?.trim() ?? "";
  const score = Number(argv[1] ?? 750);

  if (!PUBKEY_RE.test(borrower)) {
    console.error(`Invalid borrower pubkey. Usage: npm run mint:onchain -- <G...> <score>`);
    process.exit(1);
  }
  if (!Number.isInteger(score) || score < 0 || score > 1000) {
    console.error(`score must be an integer in [0, 1000], got ${argv[1]}`);
    process.exit(1);
  }

  const motherKeypair = Keypair.fromSecret(MOTHER_SECRET!);
  const server = new rpc.Server(RPC_URL);

  // Expiration: now + 90 days. Soroban ledger uses Unix-style timestamps.
  const now = Math.floor(Date.now() / 1000);
  const expiration = BigInt(now + 90 * 24 * 60 * 60);

  // Account age supplied off-chain. CLI default 60 days — comfortably above
  // the 30-day floor. Override with `--age <days>` for testing edge cases.
  const ageFlagIdx = argv.indexOf("--age");
  const accountAgeDays = ageFlagIdx >= 0 ? Number(argv[ageFlagIdx + 1]) : 60;
  if (!Number.isInteger(accountAgeDays) || accountAgeDays < 0) {
    console.error(`Invalid --age value: ${argv[ageFlagIdx + 1]}`);
    process.exit(1);
  }

  // Generate nonce and sign with the threshold simulator.
  const nonce = freshNonce();
  const signed = buildSignedMintRequest(borrower, score, expiration, accountAgeDays, nonce);
  console.log(`[mint-onchain] borrower=${borrower} score=${score} expiration=${expiration} age_days=${accountAgeDays}`);
  console.log(`[mint-onchain] nonce=${nonce.toString("hex")}`);
  console.log(`[mint-onchain] signatures from oracles ${signed.signatures.map((s) => s.index).join(",")}`);

  if (signed.signatures.length < ORACLE_THRESHOLD) {
    throw new Error("simulator did not produce enough signatures");
  }

  // Assemble Soroban call.
  const contract = new Contract(CONTRACT_V2);
  const op = contract.call(
    "mint",
    Address.fromString(borrower).toScVal(),
    nativeToScVal(score, { type: "u32" }),
    nativeToScVal(expiration, { type: "u64" }),
    nativeToScVal(accountAgeDays, { type: "u32" }),
    xdr.ScVal.scvBytes(nonce),
    buildSignaturesScVal(signed.signatures),
  );

  const sourceAccount = await server.getAccount(motherKeypair.publicKey());
  const built = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();

  console.log("[mint-onchain] simulating…");
  const prepared = await server.prepareTransaction(built);
  prepared.sign(motherKeypair);

  console.log("[mint-onchain] submitting…");
  const sent = await server.sendTransaction(prepared);
  console.log(`[mint-onchain] tx hash: ${sent.hash} (status: ${sent.status})`);

  if (sent.status === "ERROR") {
    console.error("[mint-onchain] submission rejected:", JSON.stringify(sent.errorResult?.result(), null, 2));
    process.exit(1);
  }

  // Poll for inclusion.
  let resp = await server.getTransaction(sent.hash);
  for (let i = 0; i < 30 && resp.status === "NOT_FOUND"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    resp = await server.getTransaction(sent.hash);
  }
  console.log(`[mint-onchain] final status: ${resp.status}`);
  if (resp.status !== "SUCCESS") {
    console.error("[mint-onchain] tx did not succeed:", JSON.stringify(resp, null, 2));
    process.exit(1);
  }

  // Verify via get_score.
  const sourceAccountReread = await server.getAccount(motherKeypair.publicKey());
  const readOp = contract.call("get_score", Address.fromString(borrower).toScVal());
  const readTx = new TransactionBuilder(sourceAccountReread, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(readOp)
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(readTx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    console.error("[mint-onchain] read simulation failed:", sim);
    process.exit(1);
  }
  const readRetval = sim.result?.retval;
  const scoreOnChain = readRetval ? scValToNative(readRetval) : null;
  console.log(`[mint-onchain] get_score(borrower) → ${JSON.stringify(scoreOnChain)}`);

  if (scoreOnChain !== score) {
    console.error(`[mint-onchain] score mismatch: expected ${score}, got ${scoreOnChain}`);
    process.exit(1);
  }

  console.log("\n✅ END-TO-END SUCCESS");
  console.log(`   contract:  ${CONTRACT_V2}`);
  console.log(`   tx:        https://stellar.expert/explorer/testnet/tx/${sent.hash}`);
  console.log(`   borrower:  ${borrower}`);
  console.log(`   score:     ${scoreOnChain}`);
}

main().catch((err) => {
  console.error("[mint-onchain] FAILED:", err.message ?? err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
