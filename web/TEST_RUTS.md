# 🧪 RUTs de Prueba - Vigente Protocol Demo

Este documento lista los RUTs válidos para testing del demo de Vigente Protocol.

## 📋 RUTs Preconfigurados

### ✅ Tier A (Gold Badge) - Score: 1000 pts
Usuarios con alto volumen ($600+/mes) y historial de 6+ meses:

- **22.342.342-3** → María García (KYC Nivel 3)
- **12.345.671-K** → María García (KYC Nivel 3)

**Características:**
- 20 transacciones en 6 meses
- Promedio: $180 USD por transacción
- Max Loan: $5,000 USDC

---

### 🥈 Tier B (Silver Badge) - Score: ~673 pts
Usuarios con volumen medio ($350+/mes) y historial de 4+ meses:

- **9.876.543-5** → Carlos Rodríguez (KYC Nivel 2)
- **11.111.111-K** → Carlos Rodríguez (KYC Nivel 2)

**Características:**
- 10 transacciones en 4 meses
- Promedio: $140 USD por transacción
- Max Loan: $2,000 USDC

---

### ❌ Tier D (No Califica) - Score: <250 pts
Usuarios con datos insuficientes:

- **5.555.555-9** → Ana López (KYC Nivel 1)
- **9.999.999-0** → Ana López (KYC Nivel 1)

**Características:**
- Solo 2 transacciones
- Promedio: $50 USD por transacción
- Max Loan: $0 USDC

---

## 🎲 Lógica de Fallback (RUTs Aleatorios)

Si ingresas un RUT que **NO** está en la lista preconfigurada, el sistema usa el **último dígito del número** (antes del verificador) para asignar el tier:

| Último Dígito | Tier Asignado |
|--------------|---------------|
| 1, 2, 3      | **Tier A** (Gold) |
| 4, 5, 6      | **Tier B** (Silver) |
| 7, 8, 9, 0   | **Tier D** (Fail) |

### Ejemplos de Fallback:

- `18.123.456-1` → Termina en **1** → **Tier A**
- `19.999.884-2` → Termina en **4** → **Tier B**
- `15.000.007-7` → Termina en **7** → **Tier D (Fail)**

---

## 🔧 Para Agregar Más RUTs de Prueba

Edita el archivo `web/src/services/moneygram-oracle.ts` en la función `mapRutToUserId()`:

```typescript
const testRuts: Record<string, string> = {
    '223423423': 'user_tier_a',     // 22.342.342-3
    '12345671K': 'user_tier_a',     // 12.345.671-K
    // Agrega aquí tus RUTs personalizados
};
```

---

## ✅ RUT Válido - Formato Aceptado

El validador acepta:
- Dígitos verificadores numéricos: `0-9`
- Dígito verificador `K`
- Formato con puntos y guión: `12.345.678-9`
- Formato sin puntos: `12345678-9`

**NO acepta:**
- RUTs sin guión
- Letras diferentes a 'K' en el verificador
- RUTs con menos de 7 dígitos

---

## 🚀 Uso en el Demo

1. Ve a: http://localhost:3000
2. Ingresa uno de los RUTs de arriba
3. Click en "Connect & Analyze"
4. Verifica el Score y Tier asignado
5. Click en "Mint Credit Badge" para probar Freighter

---

**Nota**: Este es un sistema de prueba (MOCK). En producción, los RUTs se validarían contra la API real de MoneyGram Access.
