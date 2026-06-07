/**
 * Vigente Protocol — Threshold Mint Relay (Phase C)
 *
 * POST /api/mint-v3
 *   { borrower: "G...", score: 0..1000, accountAgeDays: number, expirationDays?: number }
 *
 * Server-side path: the off-chain threshold simulator signs the canonical
 * mint message with k-of-n oracles, the route assembles the Soroban
 * transaction calling vigente-badge v3 `mint()`, the mother account signs
 * for gas, and the tx is submitted and polled to inclusion.
 *
 * On success returns the tx hash and the verified on-chain score so the
 * frontend can show a single "minted" confirmation.
 *
 * Security note: in mainnet the relayer would not co-locate with the
 * oracle simulator. For sprint demonstration this single endpoint covers
 * the full flow; docs/THREAT_MODEL.md documents the separation roadmap.
 */

import { NextResponse } from "next/server";
import { config as dotenvConfig } from "dotenv";
import * as path from "path";
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
import {
  buildSignedMintRequest,
  freshNonce,
  ORACLE_THRESHOLD,
} from "@/services/threshold-oracle";
import { guardApiRequest, genericErrorResponse } from "@/lib/api-guard";

dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const CONTRACT_V3 =
  process.env.NEXT_PUBLIC_CONTRACT_ID_V3 ||
  "CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD";
const MOTHER_SECRET = process.env.VIGENTE_MOTHER_SECRET;

const PUBKEY_RE = /^G[A-Z2-7]{55}$/;

function buildSignaturesScVal(
  sigs: Array<{ index: number; signature: string }>,
): xdr.ScVal {
  return xdr.ScVal.scvVec(
    sigs.map((s) => {
      const idxScVal = nativeToScVal(s.index, { type: "u32" });
      const sigBytes = Buffer.from(s.signature, "hex");
      if (sigBytes.length !== 64) {
        throw new Error(
          `signature ${s.index} is ${sigBytes.length} bytes, expected 64`,
        );
      }
      const sigScVal = xdr.ScVal.scvBytes(sigBytes);
      return xdr.ScVal.scvVec([idxScVal, sigScVal]);
    }),
  );
}

export async function POST(request: Request) {
  // G.2: drains the mother account if abused — strict rate limit, gate by
  // same-origin (browser) or webhook secret (server-to-server). Anonymous
  // cross-origin callers get 401.
  const blocked = guardApiRequest(request, { limit: 3 });
  if (blocked) return blocked;

  if (!MOTHER_SECRET) {
    // Configuration error — surface generic 500 to the client, log details server-side.
    console.error("[mint-v3] VIGENTE_MOTHER_SECRET missing");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const borrower =
    typeof body.borrower === "string" ? body.borrower.trim() : "";
  if (!PUBKEY_RE.test(borrower)) {
    return NextResponse.json(
      { error: "borrower must be a Stellar G-pubkey" },
      { status: 400 },
    );
  }

  const score = typeof body.score === "number" ? body.score : NaN;
  if (!Number.isInteger(score) || score < 0 || score > 1000) {
    return NextResponse.json(
      { error: "score must be an integer in [0, 1000]" },
      { status: 400 },
    );
  }

  const ageRaw = body.accountAgeDays ?? body.account_age_days;
  if (
    typeof ageRaw !== "number" ||
    !Number.isInteger(ageRaw) ||
    ageRaw < 0 ||
    ageRaw > 0xffff_ffff
  ) {
    return NextResponse.json(
      { error: "accountAgeDays must be a non-negative u32 integer" },
      { status: 400 },
    );
  }

  const expirationDaysRaw = body.expirationDays;
  const expirationDays =
    typeof expirationDaysRaw === "number" &&
    Number.isInteger(expirationDaysRaw) &&
    expirationDaysRaw > 0
      ? expirationDaysRaw
      : 90;

  try {
    const motherKeypair = Keypair.fromSecret(MOTHER_SECRET);
    const server = new rpc.Server(RPC_URL);
    const contract = new Contract(CONTRACT_V3);

    // Pre-flight: read the on-chain age floor and bounce the call BEFORE we
    // burn a tx. Without this, an underage wallet hits the contract panic
    // ("wallet age below minimum") and the host returns the unhelpful
    // Error(WasmVm, InvalidAction) / UnreachableCodeReached that we see in
    // logs. Reading the floor is a free simulation.
    let minAge = 30;
    try {
      const preAccount = await server.getAccount(motherKeypair.publicKey());
      const ageOp = contract.call("get_min_wallet_age");
      const ageTx = new TransactionBuilder(preAccount, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(ageOp)
        .setTimeout(30)
        .build();
      const sim = await server.simulateTransaction(ageTx);
      if (rpc.Api.isSimulationSuccess(sim) && sim.result?.retval) {
        const v = scValToNative(sim.result.retval);
        if (typeof v === "number" && Number.isFinite(v)) minAge = v;
        else if (typeof v === "bigint") minAge = Number(v);
      }
    } catch {
      // If the simulation fails we fall through with the default floor and
      // let the actual mint surface the error. Worst case is the same 500
      // we had before this guard.
    }
    if (ageRaw < minAge) {
      return NextResponse.json(
        {
          error: "wallet age below minimum",
          detail: `This wallet is ${ageRaw} days old. The contract requires at least ${minAge} days as an anti-Sybil floor. Either use an older wallet, or ask the admin to lower the floor for the demo (set_min_wallet_age).`,
          account_age_days: ageRaw,
          min_wallet_age_days: minAge,
        },
        { status: 400 },
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const expiration = BigInt(now + expirationDays * 24 * 60 * 60);
    const nonce = freshNonce();
    const signed = buildSignedMintRequest(
      borrower,
      score,
      expiration,
      ageRaw,
      nonce,
    );
    if (signed.signatures.length < ORACLE_THRESHOLD) {
      return NextResponse.json(
        { error: "simulator did not produce enough signatures" },
        { status: 500 },
      );
    }
    const op = contract.call(
      "mint",
      Address.fromString(borrower).toScVal(),
      nativeToScVal(score, { type: "u32" }),
      nativeToScVal(expiration, { type: "u64" }),
      nativeToScVal(ageRaw, { type: "u32" }),
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
    const prepared = await server.prepareTransaction(built);
    prepared.sign(motherKeypair);

    const sent = await server.sendTransaction(prepared);
    if (sent.status === "ERROR") {
      return NextResponse.json(
        {
          error: "submission rejected by Soroban RPC",
          detail: sent.errorResult?.result()?.toString() ?? "unknown",
          hash: sent.hash,
        },
        { status: 502 },
      );
    }

    let resp = await server.getTransaction(sent.hash);
    for (let i = 0; i < 30 && resp.status === "NOT_FOUND"; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      resp = await server.getTransaction(sent.hash);
    }
    if (resp.status !== "SUCCESS") {
      return NextResponse.json(
        {
          error: "tx did not succeed",
          status: resp.status,
          hash: sent.hash,
        },
        { status: 502 },
      );
    }

    // Verify the badge landed by reading back the score.
    const readAccount = await server.getAccount(motherKeypair.publicKey());
    const readOp = contract.call(
      "get_score",
      Address.fromString(borrower).toScVal(),
    );
    const readTx = new TransactionBuilder(readAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(readOp)
      .setTimeout(60)
      .build();
    const sim = await server.simulateTransaction(readTx);
    let scoreOnChain: unknown = null;
    if (rpc.Api.isSimulationSuccess(sim) && sim.result?.retval) {
      scoreOnChain = scValToNative(sim.result.retval);
    }

    return NextResponse.json({
      ok: true,
      contract_id: CONTRACT_V3,
      tx_hash: sent.hash,
      explorer_url: `https://stellar.expert/explorer/testnet/tx/${sent.hash}`,
      borrower,
      score,
      account_age_days: ageRaw,
      expiration_seconds: expiration.toString(),
      signed_by_oracles: signed.signatures.map((s) => s.index),
      score_on_chain: scoreOnChain,
    });
  } catch (err) {
    // G.2: log the full error server-side, return generic to the client so
    // we don't leak stack traces, RPC endpoints, or secret material via
    // error messages.
    return genericErrorResponse("mint-v3", err, 500);
  }
}
