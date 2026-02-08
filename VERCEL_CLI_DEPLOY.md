# 🚀 Deploy Manual a Vercel - Guía Rápida

## Paso 1: Instalar Vercel CLI

Ya ejecuté: `npm install -g vercel`

Espera que termine (puede tomar 30 segundos).

---

## Paso 2: Login a Vercel

Una vez que termine la instalación, ejecuta:

```bash
cd c:\A-PROGRAMAS\VIGENTE-PROJECT\web
vercel login
```

**Te pedirá elegir un método de login:**
- Email (más fácil)
- GitHub
- GitLab

**Recomendación**: Usa Email. Te enviará un link de confirmación.

---

## Paso 3: Deploy

Una vez logueado, ejecuta:

```bash
vercel
```

**Vercel te hará preguntas interactivas:**

### Pregunta 1: Setup and deploy?
```
? Set up and deploy "~/web"? [Y/n]
```
**Responde**: `Y` (Enter)

### Pregunta 2: Which scope?
```
? Which scope do you want to deploy to?
```
**Responde**: Tu username personal (usa las flechas para seleccionar)

### Pregunta 3: Link to existing project?
```
? Link to existing project? [y/N]
```
**Responde**: `N` (es un proyecto nuevo)

### Pregunta 4: Project name?
```
? What's your project's name?
```
**Responde**: `vigente-protocol` (o el nombre que quieras)

### Pregunta 5: Directory?
```
? In which directory is your code located?
```
**Responde**: `./` (Enter - es el directorio actual)

### Pregunta 6: Framework detected
```
Auto-detected Project Settings (Next.js):
- Build Command: next build
- Development Command: next dev --port $PORT
- Install Command: npm install
? Want to modify these settings? [y/N]
```
**Responde**: `N` (Enter - la configuración es correcta)

---

## ⏳ Build en Progreso

Vercel comenzará a:
1. Subir tus archivos
2. Instalar dependencias (`npm install`)
3. Compilar el proyecto (`next build`)
4. Deployar

**Esto toma 2-4 minutos.**

---

## ✅ Deploy Exitoso

Cuando termine, verás algo como:

```
✅  Production: https://vigente-protocol.vercel.app [copied to clipboard]
📝  Deployed to production. Run `vercel --prod` to overwrite later deployments.
```

**ESE ES TU LINK!** 🎉

---

## 🔧 Paso 4: Configurar Variables de Entorno

Ahora necesitas agregar las variables de entorno:

```bash
vercel env add NEXT_PUBLIC_CONTRACT_ID production
```

Cuando te pregunte el valor, pega:
```
CAXGT6C5PJXPBYWNKZJXFOLMAAIPXVJWCJX3NQKHGOA4ZMQP7XE64Y7F
```

Repite para cada variable:

```bash
vercel env add NEXT_PUBLIC_RPC_URL production
# Valor: https://soroban-testnet.stellar.org

vercel env add NEXT_PUBLIC_STELLAR_NETWORK production
# Valor: TESTNET

vercel env add ADMIN_SECRET production
# Valor: SB7G3OJIVJR2MUJT6WCGPMFJPASEF5KDBG2CMOUCLDNRLPNLSK5JCDDT

vercel env add NETWORK_PASSPHRASE production
# Valor: Test SDF Network ; September 2015
```

---

## 🔄 Paso 5: Redeploy con Variables

Una vez que agregaste las variables, redeploy:

```bash
vercel --prod
```

Esto hará un nuevo build con las variables de entorno configuradas.

---

## 🎯 Verificar

Abre el link que te dio Vercel en el navegador:

```
https://vigente-protocol.vercel.app
```

Deberías ver:
- ✅ Navbar con "Connect Wallet"
- ✅ Landing page bonita
- ✅ Todo funcionando

---

## 🚨 Si Algo Falla

### Error: "vercel: command not found"
Cierra y abre una nueva terminal PowerShell.

### Error en el build
Revisa los logs en la terminal. Probablemente falta una dependencia.

### Variables de entorno no funcionan
Asegúrate de haber executado `vercel --prod` DESPUÉS de agregar las variables.

---

## 💡 Pro Tip

Puedes ver todos tus deploys en:
```
https://vercel.com/dashboard
```

¡Ahí aparecerá tu proyecto una vez deployado!

---

**¡ADELANTE! Ejecuta los comandos paso a paso y avísame si algo falla.** 🚀
