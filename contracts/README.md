# PymeToken v2.0 - Privacy-First Soroban Contract

[![Build and Release](https://github.com/YOUR_USERNAME/PymeTokenV1/actions/workflows/release.yml/badge.svg)](https://github.com/YOUR_USERNAME/PymeTokenV1/actions/workflows/release.yml)

## 🔐 Arquitectura Privacy-First & Low-Cost

Este contrato implementa una arquitectura **stateless** optimizada para:

- **Privacidad**: Los RUTs nunca se exponen en blockchain (solo hashes SHA256)
- **Bajo Costo**: ~90% menos gas usando eventos en lugar de storage persistente
- **Verificabilidad**: Builds con GitHub attestations para auditoría

## 📦 Contract Info

| Campo | Valor |
|-------|-------|
| **Contract ID (Testnet)** | `CBBHQMIATELVVIFMRCIOQJHHSZJOGWH3PQNX7WOKGHK4FLZEWZUOMJKN` |
| **WASM Size** | ~1,957 bytes |
| **Funciones** | `mint_deal` |

## 🚀 Uso

### Función `mint_deal`

```rust
pub fn mint_deal(
    env: Env, 
    data_hash: BytesN<32>,  // SHA256(RUT + SECRET)
    partner: Address,       // Backend que autoriza
    amount: i128,           // Monto en stroops
    nonce: i128             // Timestamp único
)
```

### Desde el Backend (TypeScript)

```typescript
const hash = createHmac('sha256', ADMIN_SECRET).update(rut).digest();

const tx = new TransactionBuilder(account, { fee: "100000", networkPassphrase: Networks.TESTNET })
  .addOperation(new Contract(CONTRACT_ID).call("mint_deal", 
    nativeToScVal(hash, { type: 'bytes' }),
    nativeToScVal(keypair.publicKey(), { type: 'address' }),
    nativeToScVal(BigInt(amount), { type: 'i128' }),
    nativeToScVal(BigInt(Date.now()), { type: 'i128' })
  ))
  .setTimeout(TimeoutInfinite)
  .build();
```

## 🔍 Verificación de Build

Este contrato usa **GitHub Attestations** (SEP) para verificación criptográfica.

### Verificar que el WASM fue compilado desde este repo:

```bash
# 1. Obtener hash del WASM deployado
stellar contract info --id CBBHQMIATELVVIFMRCIOQJHHSZJOGWH3PQNX7WOKGHK4FLZEWZUOMJKN --network testnet

# 2. Verificar attestation
curl https://api.github.com/repos/YOUR_USERNAME/PymeTokenV1/attestations/sha256:<wasm_hash>
```

## 🧪 Tests

```bash
# Tests unitarios
cargo test

# Build
stellar contract build

# Deploy a testnet
stellar contract deploy --wasm target/wasm32v1-none/release/pyme_token_v1.wasm --source admin --network testnet
```

## 📋 Releases

Los releases se crean automáticamente cuando:
1. Se pushea un tag `v*` (ej: `v1.0.0`)
2. Se dispara manualmente desde GitHub Actions

Cada release incluye:
- WASM optimizado
- Attestation de build
- Hash verificable

## 🏗️ Arquitectura

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Backend/API   │────▶│  Smart Contract  │────▶│   Blockchain    │
│  (Validación)   │     │   (Solo firma)   │     │   (Eventos)     │
│                 │     │                  │     │                 │
│ • Valida RUT    │     │ • require_auth() │     │ • Inmutable     │
│ • Crea Hash     │     │ • Emite evento   │     │ • Auditable     │
│ • Decide mint   │     │ • Sin storage    │     │ • Indexable     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## 📄 Licencia

MIT
