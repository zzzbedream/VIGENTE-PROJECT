/**
 * Vigente Protocol — thin stellar/badge helpers for the web app.
 *
 * The WRITE path (mint) goes through the server relay at `/api/mint-v3`, which
 * holds the threshold oracle simulator and the gas-paying mother account — the
 * browser never signs a mint. The READ path is permissionless and lives in
 * `@/lib/integrations/vigente-read` (Soroban simulation, no wallet needed).
 *
 * Freighter-based client signing stays disabled on purpose: minting is a
 * server/oracle concern, not a user-wallet concern. Reads do not need a wallet.
 */

import { getBadgeState } from "@/lib/integrations/vigente-read";
import type { BadgeState } from "@/lib/integrations/templar-adapter";

export async function connectWallet(): Promise<string> {
  throw new Error("Client-side minting is disabled. Mint via /api/mint-v3.");
}

export async function mintCreditBadge(): Promise<string> {
  throw new Error("Client-side minting is disabled. Mint via /api/mint-v3.");
}

/**
 * Read a borrower's on-chain credit state from the live vigente-badge contract.
 * Permissionless, no wallet, no signature — backed by Interface v1 reads.
 * Returns `{ score, isDefaulted }`; `score` is `null` when there is no usable
 * badge (absent, expired, or slashed).
 */
export async function verifyBadge(userAddress: string): Promise<BadgeState> {
  return getBadgeState(userAddress);
}

export async function isFreighterInstalled(): Promise<boolean> {
  return false;
}
