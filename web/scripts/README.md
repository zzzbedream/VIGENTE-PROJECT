# Contract Verification Script

This directory contains scripts for testing and verifying the deployed VIGENTE Protocol Soroban contract on Stellar Testnet.

## verify-contract.ts

**Purpose**: Verifies the deployed contract by executing a real transaction on the Stellar Testnet.

**What it does**:
1. ✅ Loads environment variables from `.env.local`
2. ✅ Connects to Soroban RPC (`https://soroban-testnet.stellar.org`)
3. ✅ Invokes `mint_badge()` for the admin's own address (self-test)
4. ✅ Simulates, signs, and submits the transaction
5. ✅ Polls for transaction confirmation (with timeout handling)
6. ✅ Displays transaction hash and Stellar Expert link
7. ✅ Verifies the badge was written by calling `get_tier()`

**Prerequisites**:
- `.env.local` must be configured with:
  - `NEXT_PUBLIC_CONTRACT_ID` - Your deployed contract address
  - `ADMIN_SECRET` - Admin keypair secret (must be funded on testnet)
  - `NEXT_PUBLIC_RPC_URL` - Soroban RPC endpoint (optional, defaults to testnet)
  - `NETWORK_PASSPHRASE` - Network passphrase (optional, defaults to testnet)

**Usage**:

```bash
# Using npm script (recommended)
npm run verify

# Or directly with ts-node
npx ts-node scripts/verify-contract.ts
```

**Expected Output**:

```
🚀 VIGENTE PROTOCOL - Contract Verification

═══════════════════════════════════════════════════════

📋 Step 1: Loading Configuration...
   RPC URL: https://soroban-testnet.stellar.org
   Contract ID: CAPDXA24E7UJXD2OES6MQRNBOENSLQPST3ZQAGUKBM57EN57IED55HEG
   Network: Test SDF Network ; September 2015

🔗 Step 2: Connecting to Soroban RPC...
   Admin Address: GCFH...
   ✅ Admin account found (sequence: 12345)

🏷️  Step 3: Preparing Test Badge...
   User: GCFH...
   Tier: 1 (A)
   Score: 950
   Data Hash: a3f2c1...

📝 Step 4: Building Transaction...
   ✅ Transaction built

🧪 Step 5: Simulating Transaction...
   ✅ Simulation successful

🚀 Step 6: Submitting Transaction...
   ✅ Transaction submitted
   TX Hash: abc123...

⏳ Step 7: Waiting for Confirmation...
   ✅ Transaction confirmed after 5 attempts

✅ Transaction Confirmed!

═══════════════════════════════════════════════════════
   TX Hash: abc123def456...
   Stellar Expert: https://stellar.expert/explorer/testnet/tx/abc123def456...
═══════════════════════════════════════════════════════

🔍 Step 8: Verifying Badge was Written...
   ✅ Badge verified! Tier: 1
   ✅ Tier matches expected value (1)

✅ Contract Verification Complete!
```

**Troubleshooting**:

| Error | Solution |
|-------|----------|
| `Missing NEXT_PUBLIC_CONTRACT_ID` | Add contract ID to `.env.local` |
| `Admin account not found` | Fund admin account with testnet XLM from [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test) |
| `Simulation error` | Check contract is initialized with correct admin address |
| `Transaction polling timeout` | RPC may be slow; increase timeout in script or retry |

**Security Notes**:
- ⚠️ Never commit `.env.local` with real secrets to version control
- ⚠️ The `ADMIN_SECRET` is sensitive - only use testnet keys for development
- ✅ This script uses read-only verification calls (`get_tier`) for final checks

**Contract Methods Used**:
- `mint_badge(user: Address, tier: u32, score: u32, data_hash: BytesN<32>)` - Mints a credit badge
- `get_tier(user: Address) -> u32` - Reads the tier of an existing badge

**Next Steps**:
1. View your transaction on [Stellar Expert](https://stellar.expert/explorer/testnet)
2. Test the frontend integration with the verified contract
3. Set up automated testing in CI/CD pipeline
