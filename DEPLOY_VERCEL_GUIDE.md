# 🚀 GUÍA PASO A PASO - Deploy en Vercel

## ✅ Todo Listo para Deploy

Tu código ya está en GitHub con:
- ✅ Contrato verificado en testnet
- ✅ Hash exitoso: `3a307be0111537b702db6061ef42e0a0ebf1c6e73e175bb035b282a0cc0e6be2`
- ✅ 6/6 tests pasando
- ✅ Nuevo CONTRACT_ID: `CAXGT6C5PJXPBYWNKZJXFOLMAAIPXVJWCJX3NQKHGOA4ZMQP7XE64Y7F`

---

## 📋 PASO 1: Actualizar Variables de Entorno

### 1.1 Abre Vercel Dashboard
```
https://vercel.com/dashboard
```

### 1.2 Selecciona tu Proyecto
- Busca el proyecto **vigente-hackathon-final** (o como lo hayas nombrado)
- Click en el nombre del proyecto

### 1.3 Ve a Settings → Environment Variables
1. Click en **"Settings"** en la barra superior
2. En el menú lateral izquierdo, click en **"Environment Variables"**
3. Busca la variable `NEXT_PUBLIC_CONTRACT_ID`

### 1.4 Edita la Variable
1. Click en los **tres puntos (...)** al lado de `NEXT_PUBLIC_CONTRACT_ID`
2. Click en **"Edit"**
3. **Borra** el valor viejo: `CAPDXA24E7UJXD2OES6MQRNBOENSLQPST3ZQAGUKBM57EN57IED55HEG`
4. **Pega** el valor nuevo:
   ```
   CAXGT6C5PJXPBYWNKZJXFOLMAAIPXVJWCJX3NQKHGOA4ZMQP7XE64Y7F
   ```
5. Asegúrate de que esté marcado para:
   - ✅ **Production**
   - ✅ **Preview**
   - ✅ **Development**
6. Click en **"Save"**

---

## 📋 PASO 2: Redeploy

### 2.1 Ve a Deployments
1. Click en **"Deployments"** en la barra superior
2. Verás una lista de tus deployments recientes

### 2.2 Haz Redeploy del Último Deployment
1. En el deployment más reciente (dice "✅ Unit tests completos"), busca los **tres puntos (...)**
2. Click en los tres puntos
3. En el menú que aparece, click en **"Redeploy"**
4. Confirma haciendo click en **"Redeploy"** nuevamente

### 2.3 Espera el Build
- El build tomará **2-3 minutos**
- Verás un indicador de progreso
- Cuando termine, verás un **✅ verde** al lado del deployment

---

## 📋 PASO 3: Verificar que Funciona

### 3.1 Abre tu App
```
https://vigente-hackathon-final.vercel.app/
```
(O el URL que te haya dado Vercel)

### 3.2 Test del Flujo Completo
1. **Ingresa un RUT**: `22.342.342-3`
2. Click en **"Connect & Analyze"**
3. Deberías ver el scoring
4. Click en **"Mint Credit Badge"**
5. **DEBERÍAS VER**: Un transaction hash nuevo (distinto al anterior)

### 3.3 Verifica el TX Hash
- Copia el TX hash que te dé la app
- Ábrelo en Stellar Expert:
  ```
  https://stellar.expert/explorer/testnet/tx/[TU_TX_HASH_AQUI]
  ```
- Deberías ver:
  - ✅ Status: **SUCCESS**
  - ✅ Contract: `CAXGT6C5PJXPBYWNKZJXFOLMAAIPXVJWCJX3NQKHGOA4ZMQP7XE64Y7F`
  - ✅ Function: `mint_badge`

---

## ❓ ¿Por Qué Necesito Redeploy?

Las variables de entorno con prefijo `NEXT_PUBLIC_` se **inyectan en el código** durante el **build time**.

Solo guardar la variable NO actualiza el sitio en vivo - necesitas **rebuildearlo** para que el nuevo valor se incluya en el bundle de JavaScript.

Por eso el **Redeploy** es **obligatorio**.

---

## 🎯 Checklist Final

Una vez que completes el redeploy:

- [ ] Vercel deployment terminó con ✅
- [ ] Abriste la app en el browser
- [ ] Ingresaste un RUT y viste el scoring
- [ ] Hiciste mint de un badge
- [ ] Copiaste el TX Hash nuevo
- [ ] Verificaste el TX en Stellar Expert
- [ ] El TX muestra SUCCESS y el nuevo CONTRACT_ID

---

## 🚨 Si Algo Falla

### Error: "Contract not initialized"
- Ve a Vercel → Settings → Environment Variables
- Verifica que `NEXT_PUBLIC_CONTRACT_ID` tenga el valor correcto
- Haz otro Redeploy

### Error: "Network error"
- Verifica que `NEXT_PUBLIC_RPC_URL` esté configurado: `https://soroban-testnet.stellar.org`
- Haz otro Redeploy

### Error: "ADMIN_SECRET not found"
- Verifica que tengas `ADMIN_SECRET` en las variables de entorno (sin el prefijo NEXT_PUBLIC_)
- Valor: `SB7G3OJIVJR2MUJT6WCGPMFJPASEF5KDBG2CMOUCLDNRLPNLSK5JCDDT`

---

## 📸 Para SCF Submission

Una vez que funcione, toma screenshots de:

1. **Stellar Expert** mostrando tu TX exitoso
2. **Tu app** mostrando el badge minted
3. **Vercel Dashboard** mostrando el deployment exitoso

Estas capturas + el TX hash son tu **evidencia de tracción** para el SCF.

---

## 🎊 ¡Éxito!

Una vez que veas el ✅ verde en el TX de Stellar Expert, **¡ESTÁS LISTO PARA EL SCF!**

Tienes:
- ✅ Contrato en testnet
- ✅ Transacción verificada
- ✅ Tests 100% pasando
- ✅ Frontend deployado y funcionando
- ✅ End-to-end flow completo
