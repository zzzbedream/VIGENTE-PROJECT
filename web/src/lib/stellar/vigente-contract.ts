import {
    isConnected,
    getPublicKey,
    signTransaction,
    requestAccess,
} from "@stellar/freighter-api";
import {
    Contract,
    SorobanRpc,
    TransactionBuilder,
    Networks,
    BASE_FEE,
    xdr,
    Address,
    nativeToScVal,
    Account,
} from "@stellar/stellar-sdk";
import { createHmac } from "crypto";

// Environment Variables
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || "";
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;

// Initialize RPC Server
const server = new SorobanRpc.Server(RPC_URL);

/**
 * Connects to Freighter Wallet
 * @returns User's public key (Stellar address)
 */
export async function connectWallet(): Promise<string> {
    // Check if Freighter is installed
    const connected = await isConnected();
    if (!connected) {
        throw new Error("Freighter wallet is not installed. Please install it from https://www.freighter.app/");
    }

    // Request access (triggers popup if first time)
    const accessResponse = await requestAccess();
    if (accessResponse.error) {
        throw new Error(`Wallet connection failed: ${accessResponse.error}`);
    }

    // Get public key
    const publicKey = await getPublicKey();
    if (!publicKey) {
        throw new Error("Failed to retrieve public key from Freighter");
    }

    return publicKey;
}

/**
 * Mints a CreditBadge NFT for the connected user
 * @param tier - Credit tier (1-4: Gold, Silver, Bronze, None)
 * @param score - Credit score (0-1000)
 * @param rut - User's RUT (for data hash generation)
 * @returns Transaction hash
 */
export async function mintCreditBadge(
    tier: number,
    score: number,
    rut: string
): Promise<string> {
    // 1. Get user's public key from Freighter
    const userPublicKey = await getPublicKey();
    if (!userPublicKey) {
        throw new Error("No wallet connected. Please connect Freighter first.");
    }

    // 2. Load user's account from network
    const account = await server.getAccount(userPublicKey);

    // 3. Generate data hash (privacy hash for the badge)
    // In production, this would be generated securely on client-side with user's consent
    const rutClean = rut.replace(/[^0-9kK]/g, "");
    const dataHash = createHmac("sha256", "vigente-protocol")
        .update(rutClean)
        .digest();

    // 4. Build contract call arguments
    const contract = new Contract(CONTRACT_ID);

    const args = [
        nativeToScVal(userPublicKey, { type: "address" }), // user (Address)
        nativeToScVal(tier, { type: "u32" }),               // tier (u32)
        nativeToScVal(score, { type: "u32" }),              // score (u32)
        xdr.ScVal.scvBytes(dataHash),                       // data_hash (Bytes)
    ];

    // 5. Build the transaction
    const builtTx = new TransactionBuilder(new Account(userPublicKey, account.sequence), {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
    })
        .addOperation(contract.call("mint_badge", ...args))
        .setTimeout(180)
        .build();

    // 6. Simulate to get accurate resource fees
    const preparedTx = await server.prepareTransaction(builtTx);

    // 7. Sign transaction with Freighter
    const signedXdr = await signTransaction(preparedTx.toXDR(), {
        network: NETWORK_PASSPHRASE,
        accountToSign: userPublicKey,
    });

    if (!signedXdr) {
        throw new Error("Transaction signing was cancelled by user");
    }

    // 8. Parse signed transaction
    const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);

    // 9. Submit to network
    const sendResponse = await server.sendTransaction(signedTx as any);

    if (sendResponse.status !== "PENDING") {
        console.error("Transaction submission failed:", sendResponse);
        throw new Error(`Transaction failed: ${sendResponse.status}`);
    }

    // 10. Return transaction hash
    return sendResponse.hash;
}

/**
 * Checks if user has a CreditBadge
 * @param userAddress - Stellar address to check
 * @returns Badge data or null
 */
export async function verifyBadge(userAddress: string): Promise<any | null> {
    try {
        const contract = new Contract(CONTRACT_ID);

        const account = await server.getAccount(userAddress);

        const tx = new TransactionBuilder(new Account(userAddress, account.sequence), {
            fee: BASE_FEE,
            networkPassphrase: NETWORK_PASSPHRASE,
        })
            .addOperation(
                contract.call("verify_badge", nativeToScVal(userAddress, { type: "address" }))
            )
            .setTimeout(180)
            .build();

        const preparedTx = await server.prepareTransaction(tx);
        const result = await server.simulateTransaction(preparedTx);

        if (result.results && result.results.length > 0) {
            // Parse the result (would need proper ScVal decoding)
            return result.results[0].retval;
        }

        return null;
    } catch (error) {
        console.error("Error verifying badge:", error);
        return null;
    }
}

/**
 * Utility to check Freighter installation
 */
export async function isFreighterInstalled(): Promise<boolean> {
    return await isConnected();
}
