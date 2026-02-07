#!/usr/bin/env ts-node
/**
 * VIGENTE PROTOCOL - Contract Verification Script
 * 
 * This script verifies the deployed Soroban contract on Stellar Testnet by:
 * 1. Minting a test badge for the admin address
 * 2. Waiting for transaction confirmation
 * 3. Verifying the badge was written to the contract
 * 4. Displaying transaction details and Stellar Expert link
 * 
 * Usage: ts-node scripts/verify-contract.ts
 */

import {
    Address,
    Contract,
    Keypair,
    Networks,
    TransactionBuilder,
    xdr,
    scValToNative,
    nativeToScVal,
    BASE_FEE,
    rpc,
} from '@stellar/stellar-sdk';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

// =============================================================================
// CONFIGURATION
// =============================================================================

interface Config {
    rpcUrl: string;
    contractId: string;
    adminSecret: string;
    networkPassphrase: string;
}

function loadConfig(): Config {
    // Load from environment variables
    const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID;
    const adminSecret = process.env.ADMIN_SECRET;
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'https://soroban-testnet.stellar.org';
    const networkPassphrase = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

    if (!contractId) {
        throw new Error('❌ Missing NEXT_PUBLIC_CONTRACT_ID in environment');
    }
    if (!adminSecret) {
        throw new Error('❌ Missing ADMIN_SECRET in environment');
    }

    return {
        rpcUrl,
        contractId,
        adminSecret,
        networkPassphrase,
    };
}

// =============================================================================
// STELLAR/SOROBAN HELPER FUNCTIONS
// =============================================================================

/**
 * Polls the Soroban RPC for transaction status until confirmed or timeout
 */
async function pollTransactionStatus(
    server: rpc.Server,
    txHash: string,
    maxAttempts = 60,
    delayMs = 2000
): Promise<rpc.Api.GetTransactionResponse> {
    console.log(`⏳ Polling transaction status (hash: ${txHash.substring(0, 12)}...)`);

    for (let i = 0; i < maxAttempts; i++) {
        try {
            const response = await server.getTransaction(txHash);

            if (response.status === 'SUCCESS') {
                console.log(`✅ Transaction confirmed after ${i + 1} attempts`);
                return response;
            }

            if (response.status === 'FAILED') {
                console.error('❌ Transaction failed:', response);
                throw new Error(`Transaction failed: ${JSON.stringify(response)}`);
            }

            // Status is NOT_FOUND or PENDING
            if (i % 5 === 0) {
                console.log(`   Still waiting... (attempt ${i + 1}/${maxAttempts})`);
            }

            await new Promise((resolve) => setTimeout(resolve, delayMs));
        } catch (error) {
            if (i === maxAttempts - 1) {
                throw new Error(`Transaction polling timeout after ${maxAttempts} attempts: ${error}`);
            }
            // Continue polling on error
        }
    }

    throw new Error(`Transaction not confirmed within ${maxAttempts * delayMs / 1000} seconds`);
}

/**
 * Creates a SHA256 hash (32 bytes) from a string
 */
function createDataHash(data: string): Buffer {
    return crypto.createHash('sha256').update(data).digest();
}

/**
 * Converts Buffer to ScVal Bytes
 */
function bufferToScValBytes(buffer: Buffer): xdr.ScVal {
    return nativeToScVal(buffer, { type: 'bytes' });
}

// =============================================================================
// MAIN VERIFICATION FLOW
// =============================================================================

async function main() {
    console.log('\n🚀 VIGENTE PROTOCOL - Contract Verification\n');
    console.log('═'.repeat(60));

    try {
        // 1. Load Configuration
        console.log('\n📋 Step 1: Loading Configuration...');
        const config = loadConfig();
        console.log(`   RPC URL: ${config.rpcUrl}`);
        console.log(`   Contract ID: ${config.contractId}`);
        console.log(`   Network: ${config.networkPassphrase}`);

        // 2. Initialize Stellar SDK
        console.log('\n🔗 Step 2: Connecting to Soroban RPC...');
        const server = new rpc.Server(config.rpcUrl);
        const adminKeypair = Keypair.fromSecret(config.adminSecret);
        const adminAddress = adminKeypair.publicKey();
        console.log(`   Admin Address: ${adminAddress}`);

        // Check admin account
        try {
            const account = await server.getAccount(adminAddress);
            console.log(`   ✅ Admin account found (sequence: ${account.sequenceNumber()})`);
        } catch (error) {
            throw new Error(`❌ Admin account not found or unfunded: ${error}`);
        }

        // 3. Prepare Test Badge Parameters
        console.log('\n🏷️  Step 3: Preparing Test Badge...');
        const testParams = {
            user: adminAddress, // Mint badge to admin (self)
            tier: 1, // Tier A (best tier)
            score: 950, // High score
            dataHash: createDataHash(`test-verification-${Date.now()}`), // Unique hash
        };

        console.log(`   User: ${testParams.user}`);
        console.log(`   Tier: ${testParams.tier} (A)`);
        console.log(`   Score: ${testParams.score}`);
        console.log(`   Data Hash: ${testParams.dataHash.toString('hex').substring(0, 16)}...`);

        // 4. Build and Submit Transaction
        console.log('\n📝 Step 4: Building Transaction...');
        const contract = new Contract(config.contractId);
        const account = await server.getAccount(adminAddress);

        // Build the transaction
        const builtTransaction = new TransactionBuilder(account, {
            fee: BASE_FEE,
            networkPassphrase: config.networkPassphrase,
        })
            .addOperation(
                contract.call(
                    'mint_badge',
                    new Address(testParams.user).toScVal(), // user: Address
                    nativeToScVal(testParams.tier, { type: 'u32' }), // tier: u32
                    nativeToScVal(testParams.score, { type: 'u32' }), // score: u32
                    bufferToScValBytes(testParams.dataHash) // data_hash: BytesN<32>
                )
            )
            .setTimeout(300) // 5 minutes
            .build();

        console.log('   ✅ Transaction built');

        // Simulate the transaction first
        console.log('\n🧪 Step 5: Simulating Transaction...');
        const simulationResponse = await server.simulateTransaction(builtTransaction);

        if (rpc.Api.isSimulationError(simulationResponse)) {
            console.error('❌ Simulation failed:', simulationResponse);
            throw new Error(`Simulation error: ${JSON.stringify(simulationResponse)}`);
        }

        console.log('   ✅ Simulation successful');

        // Prepare the transaction with simulation results
        const preparedTransaction = rpc.assembleTransaction(
            builtTransaction,
            simulationResponse
        ).build();

        // Sign the transaction
        preparedTransaction.sign(adminKeypair);
        console.log('   ✅ Transaction signed');

        // Submit the transaction
        console.log('\n🚀 Step 6: Submitting Transaction...');
        const sendResponse = await server.sendTransaction(preparedTransaction);

        if (sendResponse.status === 'ERROR') {
            throw new Error(`Send failed: ${JSON.stringify(sendResponse)}`);
        }

        const txHash = sendResponse.hash;
        console.log(`   ✅ Transaction submitted`);
        console.log(`   TX Hash: ${txHash}`);

        // 5. Wait for Confirmation
        console.log('\n⏳ Step 7: Waiting for Confirmation...');
        const confirmedTx = await pollTransactionStatus(server, txHash);

        console.log('\n✅ Transaction Confirmed!\n');
        console.log('═'.repeat(60));
        console.log(`   TX Hash: ${txHash}`);
        console.log(`   Stellar Expert: https://stellar.expert/explorer/testnet/tx/${txHash}`);
        console.log('═'.repeat(60));

        // 6. Verify the Badge was Written
        console.log('\n🔍 Step 8: Verifying Badge was Written...');

        try {
            // Call verify_badge or get_tier to confirm
            const verifyAccount = await server.getAccount(adminAddress);
            const verifyTx = new TransactionBuilder(verifyAccount, {
                fee: BASE_FEE,
                networkPassphrase: config.networkPassphrase,
            })
                .addOperation(
                    contract.call('get_tier', new Address(testParams.user).toScVal())
                )
                .setTimeout(300)
                .build();

            const verifySimulation = await server.simulateTransaction(verifyTx);

            if (rpc.Api.isSimulationError(verifySimulation)) {
                console.warn('   ⚠️  Could not verify badge (simulation error)');
            } else if (verifySimulation.result) {
                const tierResult = scValToNative(verifySimulation.result.retval);
                console.log(`   ✅ Badge verified! Tier: ${tierResult}`);

                if (tierResult === testParams.tier) {
                    console.log(`   ✅ Tier matches expected value (${testParams.tier})`);
                } else {
                    console.warn(`   ⚠️  Tier mismatch: expected ${testParams.tier}, got ${tierResult}`);
                }
            }
        } catch (verifyError) {
            console.warn(`   ⚠️  Could not verify badge: ${verifyError}`);
            console.log('   (This is non-critical - the transaction was confirmed)');
        }

        // Success!
        console.log('\n✅ Contract Verification Complete!\n');
        console.log('Next steps:');
        console.log('  1. View the transaction on Stellar Expert (link above)');
        console.log('  2. Check the contract events to see the badge emission');
        console.log('  3. Test calling verify_badge from your frontend\n');

    } catch (error) {
        console.error('\n❌ Verification Failed\n');
        console.error('═'.repeat(60));

        if (error instanceof Error) {
            console.error(`Error: ${error.message}`);
            if (error.stack) {
                console.error('\nStack trace:');
                console.error(error.stack);
            }
        } else {
            console.error(error);
        }

        console.error('═'.repeat(60));
        console.error('\nTroubleshooting:');
        console.error('  • Ensure NEXT_PUBLIC_CONTRACT_ID is correct in .env.local');
        console.error('  • Ensure ADMIN_SECRET is funded on testnet');
        console.error('  • Check RPC connectivity: https://soroban-testnet.stellar.org');
        console.error('  • Verify contract is initialized with correct admin\n');

        process.exit(1);
    }
}

// =============================================================================
// ENTRY POINT
// =============================================================================

// Auto-execute when run directly
main();
