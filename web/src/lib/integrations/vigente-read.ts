/**
 * Vigente Credit Oracle — minimal read client (Interface v1).
 *
 * The copy-paste integration surface for partners: read a borrower's credit
 * state from the live `vigente-badge` contract with zero permission, zero
 * token, and no signature. Reads are done via Soroban *simulation* — free, and
 * the source account never needs funding (read-only invocations don't touch
 * the ledger).
 *
 * This is the canonical reader used across the app (UI, /passport demo) and is
 * the off-chain twin of the cross-contract pattern in
 * `contracts/vigente-badge/INTERFACE.md` §3. It implements the `BadgeReader`
 * shape from `eligibility-adapter.ts`, so the eligibility gate composes directly:
 *
 *   const state = await readBadgeState(vigenteReader, borrower);
 *   const decision = evaluateEligibility(state, { requestedUsd });
 *
 * Network defaults to testnet + the live contract `CDLLO7QE…`; override via env
 * (`NEXT_PUBLIC_CONTRACT_ID_V3`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_NETWORK_PASSPHRASE`).
 */

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type { BadgeReader, BadgeState } from "./eligibility-adapter";

export const VIGENTE_CONTRACT_ID =
  process.env.NEXT_PUBLIC_CONTRACT_ID_V3 ||
  process.env.CONTRACT_ID_V3 ||
  "CDLLO7QEPX2FGOF4VVEV7ISD7PL6FGEBO4N7XMGSIPVULOW43DZRHWVD";

export const VIGENTE_RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ||
  process.env.RPC_URL ||
  "https://soroban-testnet.stellar.org";

export const VIGENTE_NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ||
  process.env.NETWORK_PASSPHRASE ||
  Networks.TESTNET;

/**
 * Throwaway source for read-only simulation. A read invocation never moves
 * funds, so this account does not need to exist or be funded; sequence "0" is
 * fine because simulation ignores it.
 */
const READ_SOURCE = Keypair.random().publicKey();

const PUBKEY_RE = /^G[A-Z2-7]{55}$/;

function assertPubkey(borrower: string): void {
  if (!PUBKEY_RE.test(borrower)) {
    throw new Error(`invalid Stellar pubkey: ${borrower}`);
  }
}

/**
 * Simulate a read-only call and return the raw ScVal, or `undefined` when the
 * contract returned void (Soroban `None`). `args` are the ScVal arguments — an
 * empty array for the no-arg oracle-status reads.
 */
async function simulateRead(
  method: string,
  args: xdr.ScVal[] = [],
): Promise<xdr.ScVal | undefined> {
  const server = new rpc.Server(VIGENTE_RPC_URL, {
    allowHttp: VIGENTE_RPC_URL.startsWith("http://"),
  });
  const contract = new Contract(VIGENTE_CONTRACT_ID);
  const source = new Account(READ_SOURCE, "0");

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: VIGENTE_NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`vigente read '${method}' failed: ${sim.error}`);
  }
  if (rpc.Api.isSimulationSuccess(sim) && sim.result?.retval) {
    return sim.result.retval;
  }
  return undefined;
}

function borrowerArg(borrower: string): xdr.ScVal[] {
  assertPubkey(borrower);
  return [Address.fromString(borrower).toScVal()];
}

/**
 * Borrower credit score in [0, 1000], or `null` when there is no usable signal
 * (no badge, expired, or slashed). `null` is not an error.
 */
export async function getScore(borrower: string): Promise<number | null> {
  const retval = await simulateRead("get_score", borrowerArg(borrower));
  if (!retval) return null;
  const native = scValToNative(retval);
  if (native === null || native === undefined) return null;
  return typeof native === "number" ? native : Number(native);
}

/**
 * `true` when the borrower has an immutable default record or a slashed badge.
 * This is the primary risk gate — call it first.
 */
export async function isDefaulted(borrower: string): Promise<boolean> {
  const retval = await simulateRead("is_defaulted", borrowerArg(borrower));
  if (!retval) return false;
  return Boolean(scValToNative(retval));
}

/**
 * Live oracle status (Interface v1 §1): the k-of-n threshold, the n public
 * keys, and the anti-Sybil wallet-age floor — read straight from the contract,
 * no arguments. Powers the "live on-chain status" panel.
 */
export interface OracleStatus {
  threshold: number; // k required co-signatures
  keyCount: number; // n oracle keys
  minWalletAgeDays: number;
  contractId: string;
}

export async function getOracleThreshold(): Promise<number> {
  const retval = await simulateRead("get_oracle_threshold");
  return retval ? Number(scValToNative(retval)) : 0;
}

export async function getOracleKeyCount(): Promise<number> {
  const retval = await simulateRead("get_oracle_keys");
  if (!retval) return 0;
  const keys = scValToNative(retval) as unknown[];
  return Array.isArray(keys) ? keys.length : 0;
}

export async function getMinWalletAge(): Promise<number> {
  const retval = await simulateRead("get_min_wallet_age");
  return retval ? Number(scValToNative(retval)) : 0;
}

/** Read the full live oracle status in parallel. */
export async function getOracleStatus(): Promise<OracleStatus> {
  const [threshold, keyCount, minWalletAgeDays] = await Promise.all([
    getOracleThreshold(),
    getOracleKeyCount(),
    getMinWalletAge(),
  ]);
  return { threshold, keyCount, minWalletAgeDays, contractId: VIGENTE_CONTRACT_ID };
}

/** Read both Interface v1 risk signals in parallel. */
export async function getBadgeState(borrower: string): Promise<BadgeState> {
  const [score, defaulted] = await Promise.all([
    getScore(borrower),
    isDefaulted(borrower),
  ]);
  return { score, isDefaulted: defaulted };
}

/** A `BadgeReader` (see eligibility-adapter) backed by the live contract. */
export const vigenteReader: BadgeReader = {
  getScore,
  isDefaulted,
};
