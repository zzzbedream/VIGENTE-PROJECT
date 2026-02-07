# 🧪 Live Contract Test - Vigente Protocol

## Testing Credentials for SCF Submission

### 📋 Contract Information

**Network**: Stellar Testnet  
**Contract ID**: `CAXGT6C5PJXPBYWNKZJXFOLMAAIPXVJWCJX3NQKHGOA4ZMQP7XE64Y7F`  
**Admin Address**: `GAJT5NOKLJYDMO6WSUQAKYAWSH56YLPXLZTYPFP3PIJAKZ4PH7S235TU`  

**Stellar Expert**: https://stellar.expert/explorer/testnet/contract/CAXGT6C5PJXPBYWNKZJXFOLMAAIPXVJWCJX3NQKHGOA4ZMQP7XE64Y7F

**✅ VERIFIED TRANSACTION**:
- **TX Hash**: `3a307be0111537b702db6061ef42e0a0ebf1c6e73e175bb035b282a0cc0e6be2`
- **Stellar Expert**: https://stellar.expert/explorer/testnet/tx/3a307be0111537b702db6061ef42e0a0ebf1c6e73e175bb035b282a0cc0e6be2
- **Status**: SUCCESS ✅
- **Function**: `mint_badge`
- **Badge Tier**: 1 (Gold - Tier A)

---

## 🚀 How to Perform Live Test

### Method 1: Via Production Web App (Recommended for SCF)

1. **Visit the live app**:
   ```
   https://vigente-hackathon-final.vercel.app/
   ```

2. **Enter a test RUT** (any of these):
   - `22.342.342-3` → Tier A (Gold Badge)
   - `9.876.543-5` → Tier B (Silver Badge)
   - `5.555.555-9` → Tier D (No Badge)

3. **Click "Connect & Analyze"**
   - Oracle will fetch mock remittance data
   - Scoring engine will calculate credit tier
   - Dashboard will display results

4. **Click "Mint Credit Badge"**
   - Backend will call Smart Contract
   - Transaction will be signed by admin
   - Response will include TX Hash

5. **Copy the Transaction Hash**
   - Format: `abcd1234...` (64 characters)
   - Example: `e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2`

6. **Verify on Stellar Expert**:
   ```
   https://stellar.expert/explorer/testnet/tx/[YOUR_TX_HASH]
   ```

---

### Method 2: Via Local Test (For Development)

If running locally (`npm run dev`):

1. Start dev server:
   ```bash
   cd c:\A-PROGRAMAS\VIGENTE-PROJECT\web
   npm run dev
   ```

2. Open: http://localhost:3000

3. Follow same steps as Method 1

4. Check browser console (F12) for detailed logs

---

## 📊 Expected Test Results

### ✅ Successful Mint (Tier A Example)

**Input**:
- RUT: `22.342.342-3`
- Expected Tier: A (Gold)
- Expected Score: ~1000

**Oracle Response**:
```json
{
  "found": true,
  "scoring": {
    "tier": 1,
    "badgeType": "Gold",
    "totalScore": 1000,
    "maxLoanAmount": 5000
  }
}
```

**Mint Response**:
```json
{
  "success": true,
  "hash": "e5f6g7h8...",
  "status": "PENDING",
  "mintedTo": "GABC123..."
}
```

**On-Chain Result**:
- Contract: `mint_badge` function called
- User: Random keypair (demo mode)
- Arguments:
  - `user`: Address
  - `tier`: 1 (u32)
  - `score`: 1000 (u32)
  - `data_hash`: SHA-256(RUT)

---

## 🔍 Verification Checklist for SCF

Use this checklist when filling the SCF form:

- [ ] **Live App URL**: https://vigente-hackathon-final.vercel.app/
- [ ] **GitHub Repo**: https://github.com/zzzbedream/VIGENTE-PROJECT
- [ ] **Contract ID**: `CAPDXA24E7UJXD2OES6MQRNBOENSLQPST3ZQAGUKBM57EN57IED55HEG`
- [ ] **Test RUT Used**: `22.342.342-3` (or any valid RUT)
- [ ] **Transaction Hash**: `[PASTE FROM MINT RESPONSE]`
- [ ] **Stellar Expert Link**: `https://stellar.expert/explorer/testnet/tx/[HASH]`
- [ ] **Screenshots**: Dashboard + Success State

---

## 📸 Screenshots to Include in SCF

1. **Landing Page**: https://vigente-hackathon-final.vercel.app/landing
2. **Dashboard State**: After "Connect & Analyze"
   - Show Credit Profile
   - Show Transaction History Chart
   - Show Tier Badge (Gold/Silver/Bronze)

3. **Success State**: After "Mint Credit Badge"
   - Show TX Hash
   - Show Stellar Expert verification

4. **Stellar Expert**: Transaction details
   - Contract call details
   - Function: `mint_badge`
   - Status: SUCCESS

---

## 🐛 Troubleshooting

### Error: "404 - Failed to load resource"
**Solution**: Make sure you're using the production URL, not localhost

### Error: "RUT faltante"
**Solution**: Make sure RUT has format `12345678-K` (with dash)

### Error: "User not found"
**Solution**: You may have entered a RUT not in the test list. Use `22.342.342-3`

### Error: "Transaction failed"
**Solution**: 
- Check that CONTRACT_ID is correct in Vercel env vars
- Verify ADMIN_SECRET is set and funded
- Confirm contract is deployed on Testnet

---

## 📝 For SCF Submission Form

### Traction Evidence Section

Copy this:

```
Live Demo: https://vigente-hackathon-final.vercel.app/

Contract Deployed:
- Network: Stellar Testnet
- Contract ID: CAXGT6C5PJXPBYWNKZJXFOLMAAIPXVJWCJX3NQKHGOA4ZMQP7XE64Y7F
- Stellar Expert: https://stellar.expert/explorer/testnet/contract/CAXGT6C5PJXPBYWNKZJXFOLMAAIPXVJWCJX3NQKHGOA4ZMQP7XE64Y7F

✅ VERIFIED Test Transaction:
- TX Hash: 3a307be0111537b702db6061ef42e0a0ebf1c6e73e175bb035b282a0cc0e6be2
- View on Explorer: https://stellar.expert/explorer/testnet/tx/3a307be0111537b702db6061ef42e0a0ebf1c6e73e175bb035b282a0cc0e6be2
- Function Called: mint_badge
- Status: SUCCESS
- Badge Tier Minted: 1 (Gold/Tier A)

Functional MVP Features:
✅ MoneyGram Oracle integration (mock)
✅ Deterministic scoring engine
✅ On-chain badge minting (Soroban) - VERIFIED
✅ Privacy-preserving architecture (SHA-256 commitments)
✅ Landing page + Dashboard UI
```

---

**Next Step**: Run the test, copy the TX Hash, and paste it into the SCF form! 🚀
