import { Contract, rpc, TransactionBuilder, nativeToScVal, xdr, Address } from '@stellar/stellar-sdk';
import { signTransaction } from '@stellar/freighter-api';
import { createHmac } from 'crypto';

interface MintBadgeParams {
    userAddress: string;
    tier: number;
    score: number;
    rut: string;
    signature: string; // NEW: Signature from Oracle
}

interface MintResult {
    success: boolean;
    hash?: string;
    error?: string;
}

/**
 * Client-side service to mint credit badges using Freighter wallet
 */
export async function mintCreditBadge(params: MintBadgeParams): Promise<MintResult> {
    const { userAddress, tier, score, rut, signature } = params;

    try {
        // 1. Setup RPC connection
        const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'https://soroban-testnet.stellar.org';
        const server = new rpc.Server(rpcUrl);

        // 2. Get user account (the one from Freighter)
        let account;
        try {
            account = await server.getAccount(userAddress);
        } catch (err: any) {
            // Account doesn't exist - needs funding
            if (err.response?.status === 404 || err.message?.includes('not found')) {
                throw new Error(`Account not found: ${userAddress}. Please fund your account at https://laboratory.stellar.org/#account-creator?network=test`);
            }
            throw err;
        }

        // 3. Generate data hash (same logic as server)
        const rutClean = rut.replace(/[^0-9kK]/g, '').toUpperCase();
        // For client-side, we'll use a simple hash. In production, this would come from the oracle signature
        const encoder = new TextEncoder();
        const data = encoder.encode(rutClean + tier + score);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const dataHash = new Uint8Array(hashBuffer);

        // 4. Prepare contract args
        const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim();
        console.log('DEBUG: Using Contract ID:', contractId);

        if (!contractId) {
            throw new Error('NEXT_PUBLIC_CONTRACT_ID is not defined in environment');
        }

        // Check if signature is valid
        if (!signature || typeof signature !== 'string') {
            throw new Error(`Invalid Oracle signature received: ${typeof signature}. Please re-analyze while your wallet is connected.`);
        }

        const args = [
            nativeToScVal(userAddress, { type: 'address' }),
            nativeToScVal(tier, { type: 'u32' }),
            nativeToScVal(score, { type: 'u32' }),
            xdr.ScVal.scvBytes(Buffer.from(dataHash as any)),
            xdr.ScVal.scvBytes(Buffer.from(signature, 'hex')) // signature should be hex string
        ];

        // 5. Build transaction
        const networkPassphrase = (process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015').trim();
        console.log('DEBUG: Using Network:', networkPassphrase);

        const tx = new TransactionBuilder(account, { fee: '100000' })
            .addOperation(new Contract(contractId).call('mint_badge', ...args))
            .setTimeout(30)
            .setNetworkPassphrase(networkPassphrase)
            .build();

        // 6. Simulate transaction
        const preparedTx = await server.prepareTransaction(tx);

        // 7. Sign with Freighter (THIS IS THE KEY CHANGE!)
        const signedResult = await signTransaction(preparedTx.toXDR(), {
            networkPassphrase: networkPassphrase,
            address: userAddress,
        });

        if (!signedResult || signedResult.error) {
            throw new Error(signedResult.error || 'Failed to sign transaction');
        }

        // 8. Submit signed transaction
        const signedTx = TransactionBuilder.fromXDR(signedResult.signedTxXdr, networkPassphrase);
        const sendResponse = await server.sendTransaction(signedTx);

        if (sendResponse.status !== 'PENDING') {
            throw new Error(`Transaction failed: ${sendResponse.status}`);
        }

        // 9. Poll for confirmation (optional but recommended)
        let attempts = 0;
        const maxAttempts = 20;

        while (sendResponse.status === 'PENDING' && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));

            try {
                const txResult = await server.getTransaction(sendResponse.hash);
                const statusStr = String(txResult.status); // Cast enum to string

                if (statusStr === 'SUCCESS') {
                    return {
                        success: true,
                        hash: sendResponse.hash
                    };
                } else if (statusStr === 'FAILED') {
                    throw new Error('Transaction failed on-chain');
                }
            } catch (e) {
                // Transaction might not be found yet, continue polling
            }

            attempts++;
        }

        // Return hash even if polling timed out (tx is still pending)
        return {
            success: true,
            hash: sendResponse.hash
        };

    } catch (error: any) {
        console.error('Mint service error:', error);

        // Special handling for unfunded accounts
        if (error.message && error.message.includes('Account not found')) {
            return {
                success: false,
                error: `Tu cuenta no tiene fondos en Testnet. Ve a https://laboratory.stellar.org/#account-creator?network=test y fondea tu cuenta (${userAddress.slice(0, 8)}...) con Friendbot.`
            };
        }

        return {
            success: false,
            error: error.message || 'Failed to mint badge'
        };
    }
}
