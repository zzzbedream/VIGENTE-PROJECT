# Test RUTs — Vigente Protocol Demo

Test RUTs to demonstrate Vigente's tiering for SCF reviewers and Payku integration testing.

---

## Preconfigured RUTs (Mock Fallback)

The Payku oracle uses a hybrid strategy: when Payku Sandbox credentials are configured, it returns real merchant data; otherwise, it falls back to deterministic mock data based on the RUT's verification digit.

### Tier A (Gold) — Score 80–100

Merchants with high monthly volume ($15,000+ USD equivalent) and 6+ months of consistent transactions:

- `20.244.452-1`
- `7.452.862-K`
- `21.151.115-1`

Approximate profile in mock mode:
- ~60 transactions per 6-month window
- Average transaction: $80,000–$950,000 CLP
- Max loan: **10,000,000 CLP** (~$10,500 USD)
- Badge: 🥇 Gold

### Tier B (Silver) — Score 55–79

Medium-volume merchants ($5,000–$15,000 USD equivalent) with stable activity:

- `12.345.678-2`
- `6.531.561-5`

Approximate profile in mock mode:
- ~35 transactions per 6-month window
- Average transaction: $30,000–$450,000 CLP
- Max loan: **5,000,000 CLP** (~$5,250 USD)
- Badge: 🥈 Silver

### Tier C (Bronze) — Score 30–54

Lower-volume but credit-eligible merchants ($1,500–$5,000 USD equivalent):

- `11.222.333-4`
- `13.456.789-5`

Approximate profile in mock mode:
- ~15 transactions per 6-month window
- Average transaction: $10,000–$150,000 CLP
- Max loan: **2,000,000 CLP** (~$2,100 USD)
- Badge: 🥉 Bronze

### Tier D (No Badge) — Score < 30

Insufficient transaction history:

- `99.999.999-9`
- `5.555.555-9`

Approximate profile in mock mode:
- ≤3 transactions
- Average transaction: $5,000–$25,000 CLP
- Max loan: **0 CLP** (rejected)
- Badge: ❌ None

---

## Fallback Logic (Random RUTs)

For any RUT not in the preconfigured list, the mock oracle uses the verification digit (or last character) to deterministically assign a tier:

| Last character | Tier |
|----------------|------|
| `1`, `K` | Gold (A) |
| `2`, `3` | Silver (B) |
| `4`, `5`, `6` | Bronze (C) |
| `9` | None (fail) |
| Other | Silver (B, default) |

### Examples

- `18.123.456-1` → ends in `1` → **Gold**
- `19.999.884-2` → ends in `2` → **Silver**
- `15.000.007-7` → ends in `7` → defaults to **Silver**
- `12.345.679-9` → ends in `9` → **None** (fail case)

---

## Real Mode (Payku Sandbox Credentials)

When `PAYKU_PUBLIC_TOKEN` and `PAYKU_PRIVATE_TOKEN` are set in `.env.local`, the oracle queries the live Payku Sandbox API for the given RUT's conciliation data. The mock fallback is not used unless the API call fails.

To enable real mode:

```bash
# In web/.env.local
PAYKU_BASE_URL="https://des.payku.cl/api"
PAYKU_PUBLIC_TOKEN="<your-sandbox-public-token>"
PAYKU_PRIVATE_TOKEN="<your-sandbox-private-token>"
USD_CLP_RATE="950"
```

Verify which mode is active by checking the `dataSource` field in the API response:
- `"payku_sandbox_real"` → live Payku API call succeeded
- `"payku_fallback_mock"` → using mock data (no credentials, or API failure)

---

## RUT Format Validation

Accepted formats:
- `12.345.678-9` (dots + dash)
- `12345678-9` (dash only)
- Verification digit: `0–9` or `K`

Rejected:
- No verification digit
- Letters other than `K` as verification digit
- Fewer than 7 digits

---

## Demo Flow

1. Open https://vigente-hackathon-final.vercel.app (or `npm run dev` locally → http://localhost:3000)
2. Connect Freighter wallet (Testnet mode)
3. Enter one of the RUTs above
4. Click **Connect & Analyze**
5. Review the score, tier, and transaction chart
6. Click **Mint Credit Badge**
7. Approve the transaction in Freighter
8. Verify the transaction hash on stellar.expert

---

**Note:** All preconfigured RUTs above are sample data for the mock fallback. They do not correspond to real Chilean taxpayers. Real merchant data comes from the Payku Sandbox or production API when credentials are configured.
