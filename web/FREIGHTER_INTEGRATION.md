# 🦊 Freighter Wallet Integration Guide

This guide explains how to integrate Freighter wallet for client-side badge minting in the Vigente Protocol demo.

## 📦 Prerequisites

1. **Install Freighter Extension**:
   - Chrome: https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk
   - Firefox: https://addons.mozilla.org/en-US/firefox/addon/freighter/

2. **Fund Test Account**:
   - Visit https://laboratory.stellar.org/#account-creator?network=test
   - Generate a new keypair and fund it with test XLM

3. **Import Test Account to Freighter**:
   - Open Freighter extension
   - Create/Import account using your test secret key
   - Switch network to "Testnet"

## 🔧 Configuration

### 1. Set Environment Variables

Create `.env.local` in `web/` directory:

```bash
# Frontend (Public)
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
NEXT_PUBLIC_CONTRACT_ID=YOUR_CONTRACT_ID_HERE

# Backend (Private - for API routes)
RPC_URL=https://soroban-testnet.stellar.org
ADMIN_SECRET=your_admin_secret_key
NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

**Get your CONTRACT_ID**:
1. Go to https://stellar.expert/explorer/testnet
2. Search for your deployed contract
3. Copy the Contract ID (starts with `C...`)

### 2. Install Dependencies

```bash
cd web
npm install @stellar/freighter-api
```

## 🎯 Usage in Frontend

### Basic Wallet Connection

```typescript
import { connectWallet, mintCreditBadge } from '@/lib/stellar/vigente-contract';

// Connect wallet
const handleConnect = async () => {
  try {
    const address = await connectWallet();
    console.log('Connected:', address);
  } catch (error) {
    console.error('Connection failed:', error);
  }
};
```

### Minting a Badge

```typescript
const handleMint = async () => {
  try {
    const txHash = await mintCreditBadge(
      1,              // tier: 1 (Gold), 2 (Silver), 3 (Bronze), 4 (None)
      850,            // score: 0-1000
      '12345678-K'    // rut: for privacy hash generation
    );
    
    console.log('Success! TX Hash:', txHash);
    
    // Show Stellar Expert link
    const explorerUrl = `https://stellar.expert/explorer/testnet/tx/${txHash}`;
    window.open(explorerUrl, '_blank');
  } catch (error) {
    console.error('Minting failed:', error);
  }
};
```

## 🔄 Integration Patterns

### Pattern 1: Two-Step Flow (Current MVP)

**Backend calculates score → Frontend mints with Freighter**

```typescript
// Step 1: Get score from Oracle API
const response = await fetch(`/api/oracle/score?rut=${rut}`);
const { scoring } = await response.json();

// Step 2: User mints their own badge
const txHash = await mintCreditBadge(
  scoring.tier,
  scoring.totalScore,
  rut
);
```

### Pattern 2: Fully Client-Side (Future)

**Frontend generates ZK proof → Mints directly**

```typescript
// Generate ZK proof client-side (no backend)
const proof = await generateCreditProof(transactions);

// Mint with proof
const txHash = await mintCreditBadgeWithProof(proof);
```

## 🐛 Troubleshooting

### Error: "Freighter is not installed"
**Solution**: Install Freighter browser extension

### Error: "Failed to retrieve public key"
**Solution**: 
1. Open Freighter
2. Make sure you're on Testnet
3. Click "Connect" when prompted

### Error: "Transaction failed: ERROR"
**Solution**:
1. Check CONTRACT_ID is correct
2. Verify your test account has XLM balance
3. Check Soroban contract function signature matches

### Error: "Account not found"
**Solution**: Fund your Freighter account at https://laboratory.stellar.org/#account-creator?network=test

## 🔐 Security Best Practices

1. **Never expose ADMIN_SECRET** in frontend code
2. **Use NEXT_PUBLIC_* prefix** only for truly public variables
3. **Validate user inputs** before constructing transactions
4. **Simulate transactions** before signing (done automatically by `prepareTransaction`)

## 📊 Testing Checklist

- [ ] Freighter installed and funded
- [ ] CONTRACT_ID set in .env.local
- [ ] Wallet connection works (shows address)
- [ ] Badge minting signed by user
- [ ] Transaction hash returned
- [ ] Badge visible on Stellar Expert
- [ ] Error handling works (user cancels, insufficient balance, etc.)

## 🚀 Deployment to Vercel

Add environment variables in Vercel Dashboard:

```
Settings → Environment Variables:
- NEXT_PUBLIC_CONTRACT_ID
- NEXT_PUBLIC_RPC_URL
- NEXT_PUBLIC_NETWORK_PASSPHRASE
```

**Note**: Backend variables (ADMIN_SECRET) should only be set if using API routes for admin functions.

---

## 📚 References

- [Freighter API Docs](https://docs.freighter.app/)
- [Soroban SDK](https://stellar.github.io/js-stellar-sdk/)
- [Stellar Laboratory](https://laboratory.stellar.org/)
- [Stellar Expert](https://stellar.expert/explorer/testnet)
