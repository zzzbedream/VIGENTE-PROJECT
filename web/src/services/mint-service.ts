import { Contract, rpc, TransactionBuilder, nativeToScVal, xdr, Address } from '@stellar/stellar-sdk';
import { signTransaction } from '@stellar/freighter-api';
import { createHmac } from 'crypto';

interface MintBadgeParams {
    userAddress: string;
    tier: number;
    score: number;
    rut: string;
    creditProfile: any; // Full response from /api/score (signature no longer needed)
}

interface MintResult {
    success: boolean;
    hash?: string;
    error?: string;
}

/**
 * Client-side service to mint credit badges using Freighter wallet
 * SIMPLIFIED: No Oracle signature verification - user.require_auth() provides security
 */
export async function mintCreditBadge(params: MintBadgeParams): Promise<MintResult> {
    const { userAddress, tier, score, rut, creditProfile } = params;

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

        // 3. Use data_hash from server response (already computed with HMAC)
        // The server calculates: createHmac('sha256', ADMIN_SECRET).update(rutClean).digest()
        // We need to get this value from the scoring response
        if (!creditProfile?.scoring?.dataHash) {
            throw new Error('Server did not provide dataHash. Please re-analyze.');
        }

        const dataHash = Buffer.from(creditProfile?.dataHash || creditProfile?.scoring?.dataHash, 'hex');

        // 4. Prepare contract args (SIMPLIFIED - no signature required)
        const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim();
        console.log('DEBUG: Using Contract ID:', contractId);

        if (!contractId) {
            throw new Error('NEXT_PUBLIC_CONTRACT_ID is not defined in environment');
        }

        // Contract now only needs: user, tier, score, data_hash (no signature)
        const args = [
            nativeToScVal(userAddress, { type: 'address' }),
            nativeToScVal(tier, { type: 'u32' }),
            nativeToScVal(score, { type: 'u32' }),
            xdr.ScVal.scvBytes(Buffer.from(dataHash as any))
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
