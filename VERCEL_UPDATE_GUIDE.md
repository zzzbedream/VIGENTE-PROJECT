# 🚨 PASO CRÍTICO - Actualizar Vercel AHORA

## ⚡ Opción 1: Push al Repo (AUTOMÁTICO - Ya lo hice por ti)

Acabo de hacer commit y push de los cambios al repo. Si tienes Vercel conectado a GitHub, **el redeploy se disparará automáticamente** y tomará los cambios del `.env.local` actualizado.

⏱️ Espera 2-3 minutos y verifica el deployment en Vercel.

---

## ⚡ Opción 2: Actualizar Variables de Entorno Manualmente (MÁS SEGURO)

Si el archivo `.env.local` no se sincroniza automáticamente (lo cual es común), **DEBES** hacer esto manualmente:

### 📋 Pasos Exactos:

1. **Abre Vercel Dashboard**:
   ```
   https://vercel.com/dashboard
   ```

2. **Selecciona tu proyecto**:
   - Busca el proyecto `vigente-hackathon-final` (o como lo hayas llamado)
   - Click en el proyecto

3. **Ve a Settings**:
   - Click en "Settings" en el menú superior
   - Click en "Environment Variables" en el sidebar izquierdo

4. **Actualiza la variable**:
   - Busca `NEXT_PUBLIC_CONTRACT_ID`
   - Click en el botón de editar (lápiz) o los tres puntos
   - Click "Edit"
   - **Pega este valor**:
     ```
     CAXGT6C5PJXPBYWNKZJXFOLMAAIPXVJWCJX3NQKHGOA4ZMQP7XE64Y7F
     ```
   - Asegúrate de que esté marcado para `Production`, `Preview`, y `Development`
   - Click "Save"

5. **Redeploy**:
   - Ve a la pestaña "Deployments"
   - Busca el último deployment
   - Click en los tres puntos (...)
   - Click "Redeploy"
   - Confirma el redeploy

---

## ✅ Verificación

Después del redeploy, verifica que funcionó:

1. **Abre tu app**:
   ```
   https://vigente-hackathon-final.vercel.app/
   ```

2. **Test el flujo completo**:
   - Ingresa RUT: `22.342.342-3`
   - Click "Connect & Analyze"
   - Click "Mint Credit Badge"
   - **Deberías ver un TX Hash nuevo** (no debería fallar)

3. **Si falla**, verifica en Vercel:
   - Settings → Environment Variables
   - Confirma que `NEXT_PUBLIC_CONTRACT_ID` tiene el valor correcto
   - Confirma que `ADMIN_SECRET` está presente

---

## 🎯 Valores Críticos para Vercel

Asegúrate de que estas variables estén configuradas:

```bash
# PÚBLICAS (Frontend puede leer)
NEXT_PUBLIC_CONTRACT_ID=CAXGT6C5PJXPBYWNKZJXFOLMAAIPXVJWCJX3NQKHGOA4ZMQP7XE64Y7F
NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org

# PRIVADAS (Solo backend/API routes)
ADMIN_SECRET=SB7G3OJIVJR2MUJT6WCGPMFJPASEF5KDBG2CMOUCLDNRLPNLSK5JCDDT
NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

---

## 🚨 IMPORTANTE

**El archivo `.env.local` NO se sube a GitHub** (y no debería).

Las variables de entorno en Vercel son **completamente separadas** del archivo `.env.local` local.

Por eso **DEBES** actualizar manualmente en Vercel, incluso si ya hicimos el push.

---

## 📸 Screenshot de Referencia

Cuando estés en Vercel → Settings → Environment Variables, deberías ver algo como:

```
NEXT_PUBLIC_CONTRACT_ID    CAXGT6C5... [Edit] [Delete]
ADMIN_SECRET               SB7G3OJ...  [Edit] [Delete]
...
```

Edita `NEXT_PUBLIC_CONTRACT_ID` y pega el nuevo valor.

---

## ⏱️ Timeline Esperado

1. **Ahora**: Update environment variable en Vercel
2. **+30 segundos**: Trigger redeploy
3. **+2-3 minutos**: Build completo
4. **+3-4 minutos**: Deployment live
5. **Verificar**: Test con RUT real

---

## 🎯 Una Vez Funcionando

Cuando el frontend funcione con el nuevo contrato:

1. **Ejecuta un mint real desde la web**
2. **Copia el TX Hash que te devuelva**
3. **Úsalo como evidencia adicional para SCF** (además del que ya tienes)

Esto mostrará que **toda tu stack end-to-end funciona**, no solo el script de verificación.

---

**¡HAZLO AHORA! ⚡**

No esperes. Literalmente toma 2 minutos y es la diferencia entre un demo que funciona y uno que no.
