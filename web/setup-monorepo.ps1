# ============================================================
# VIGENTE-PROJECT Monorepo Setup Script
# ============================================================
# Este script unifica tu contrato Soroban y tu frontend Next.js
# en una estructura de monorepo profesional.
#
# USO: Ejecutar desde el directorio padre donde están las carpetas
#      del contrato y del frontend.
#
# Ejemplo:
#   cd C:\A-PROGRAMAS
#   .\pyme-web\setup-monorepo.ps1 -ContractPath ".\pyme-web\contracts" -WebPath ".\pyme-web"
# ============================================================

param(
    [Parameter(Mandatory=$false)]
    [string]$ContractPath = ".\contracts",
    
    [Parameter(Mandatory=$false)]
    [string]$WebPath = ".\web-source",
    
    [Parameter(Mandatory=$false)]
    [string]$MonorepoName = "VIGENTE-PROJECT",
    
    [Parameter(Mandatory=$false)]
    [switch]$DryRun = $false
)

# Colores para output
function Write-Step { param($msg) Write-Host "`n🔹 $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "✅ $msg" -ForegroundColor Green }
function Write-Warning { param($msg) Write-Host "⚠️  $msg" -ForegroundColor Yellow }
function Write-Error { param($msg) Write-Host "❌ $msg" -ForegroundColor Red }
function Write-Info { param($msg) Write-Host "   $msg" -ForegroundColor Gray }

Write-Host "`n" + "="*60 -ForegroundColor Magenta
Write-Host "   VIGENTE-PROJECT - Monorepo Setup Script" -ForegroundColor Magenta
Write-Host "="*60 -ForegroundColor Magenta

if ($DryRun) {
    Write-Warning "MODO DRY-RUN: No se realizarán cambios reales"
}

# ============================================================
# PASO 1: Validar rutas de entrada
# ============================================================
Write-Step "Validando rutas de entrada..."

$contractFullPath = Resolve-Path $ContractPath -ErrorAction SilentlyContinue
$webFullPath = Resolve-Path $WebPath -ErrorAction SilentlyContinue

if (-not $contractFullPath) {
    Write-Error "No se encontró la carpeta de contratos: $ContractPath"
    Write-Info "Asegúrate de que la ruta exista y contenga tu proyecto Rust/Soroban"
    exit 1
}

if (-not $webFullPath) {
    Write-Error "No se encontró la carpeta web: $WebPath"
    Write-Info "Asegúrate de que la ruta exista y contenga tu proyecto Next.js"
    exit 1
}

Write-Success "Carpeta contratos: $contractFullPath"
Write-Success "Carpeta web: $webFullPath"

# ============================================================
# PASO 2: Crear estructura del monorepo
# ============================================================
Write-Step "Creando estructura del monorepo..."

$monorepoPath = Join-Path (Get-Location) $MonorepoName
$contractsDestPath = Join-Path $monorepoPath "contracts"
$webDestPath = Join-Path $monorepoPath "web"

Write-Info "Monorepo raíz: $monorepoPath"
Write-Info "Destino contracts: $contractsDestPath"
Write-Info "Destino web: $webDestPath"

if (Test-Path $monorepoPath) {
    Write-Warning "La carpeta $MonorepoName ya existe!"
    $confirm = Read-Host "¿Deseas continuar y sobrescribir? (y/N)"
    if ($confirm -ne "y" -and $confirm -ne "Y") {
        Write-Info "Operación cancelada por el usuario"
        exit 0
    }
}

if (-not $DryRun) {
    # Crear carpetas
    New-Item -ItemType Directory -Path $monorepoPath -Force | Out-Null
    New-Item -ItemType Directory -Path $contractsDestPath -Force | Out-Null
    New-Item -ItemType Directory -Path $webDestPath -Force | Out-Null
    Write-Success "Estructura de carpetas creada"
}

# ============================================================
# PASO 3: Copiar contenido de contratos
# ============================================================
Write-Step "Copiando contratos Soroban..."

if (-not $DryRun) {
    # Copiar todo el contenido de contracts
    Copy-Item -Path "$contractFullPath\*" -Destination $contractsDestPath -Recurse -Force
    Write-Success "Contratos copiados a $contractsDestPath"
}

# ============================================================
# PASO 4: Copiar contenido web (excluyendo contracts y node_modules)
# ============================================================
Write-Step "Copiando proyecto Next.js..."

$excludeFolders = @("node_modules", ".next", "contracts", ".git", $MonorepoName)

if (-not $DryRun) {
    Get-ChildItem -Path $webFullPath | ForEach-Object {
        $itemName = $_.Name
        if ($excludeFolders -notcontains $itemName) {
            Copy-Item -Path $_.FullName -Destination $webDestPath -Recurse -Force
            Write-Info "Copiado: $itemName"
        } else {
            Write-Info "Omitido: $itemName"
        }
    }
    Write-Success "Proyecto web copiado a $webDestPath"
}

# ============================================================
# PASO 5: Crear package.json raíz
# ============================================================
Write-Step "Creando package.json raíz con workspaces..."

$rootPackageJson = @"
{
  "name": "vigente-project",
  "version": "1.0.0",
  "private": true,
  "description": "Monorepo para VIGENTE - Plataforma de verificación de vigencia con Soroban",
  "workspaces": [
    "web"
  ],
  "scripts": {
    "dev": "npm run dev --workspace=web",
    "build": "npm run build --workspace=web",
    "start": "npm run start --workspace=web",
    "lint": "npm run lint --workspace=web",
    
    "build:contract": "cd contracts/vigente && cargo build --release --target wasm32-unknown-unknown",
    "test:contract": "cd contracts/vigente && cargo test",
    "optimize:contract": "cd contracts/vigente && stellar contract optimize --wasm target/wasm32-unknown-unknown/release/vigente.wasm",
    "deploy:contract": "cd contracts/vigente && stellar contract deploy --wasm target/wasm32-unknown-unknown/release/vigente.wasm --network testnet",
    
    "setup": "npm install && echo 'Para contratos: rustup target add wasm32-unknown-unknown'",
    "clean": "rm -rf web/node_modules web/.next contracts/vigente/target",
    "clean:win": "if exist web\\node_modules rmdir /s /q web\\node_modules && if exist web\\.next rmdir /s /q web\\.next"
  },
  "keywords": [
    "soroban",
    "stellar",
    "blockchain",
    "nextjs",
    "monorepo"
  ],
  "author": "",
  "license": "MIT",
  "engines": {
    "node": ">=18.0.0"
  }
}
"@

if (-not $DryRun) {
    $rootPackageJson | Out-File -FilePath (Join-Path $monorepoPath "package.json") -Encoding utf8
    Write-Success "package.json raíz creado"
}

# ============================================================
# PASO 6: Crear .gitignore raíz
# ============================================================
Write-Step "Creando .gitignore..."

$gitignore = @"
# Dependencies
node_modules/
.pnpm-store/

# Build outputs
.next/
out/
dist/
target/

# Environment
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Rust/Soroban
contracts/*/target/
**/*.rs.bk
Cargo.lock

# Testing
coverage/
.nyc_output/
"@

if (-not $DryRun) {
    $gitignore | Out-File -FilePath (Join-Path $monorepoPath ".gitignore") -Encoding utf8
    Write-Success ".gitignore creado"
}

# ============================================================
# PASO 7: Crear README.md
# ============================================================
Write-Step "Creando README.md..."

$readme = @"
# VIGENTE-PROJECT 🔐

Monorepo para la plataforma VIGENTE - Sistema de verificación de vigencia empresarial utilizando blockchain Soroban/Stellar.

## 📁 Estructura del Proyecto

``````
VIGENTE-PROJECT/
├── contracts/           # Contratos inteligentes Soroban (Rust)
│   └── vigente/        # Contrato principal
│       ├── Cargo.toml
│       └── src/
│           └── lib.rs
├── web/                # Frontend Next.js
│   ├── src/
│   │   └── app/
│   ├── package.json
│   └── ...
├── package.json        # Scripts del monorepo
└── README.md
``````

## 🚀 Quick Start

### Prerequisitos

- Node.js >= 18
- Rust + cargo
- Stellar CLI (``stellar``)
- Target wasm: ``rustup target add wasm32-unknown-unknown``

### Instalación

``````bash
# Clonar e instalar dependencias
cd VIGENTE-PROJECT
npm install
``````

### Desarrollo

``````bash
# Iniciar frontend en modo desarrollo
npm run dev

# Compilar contrato
npm run build:contract

# Ejecutar tests del contrato
npm run test:contract
``````

### Despliegue

``````bash
# Optimizar y desplegar contrato a testnet
npm run optimize:contract
npm run deploy:contract

# Build de producción del frontend
npm run build
``````

## 📜 Scripts Disponibles

| Script | Descripción |
|--------|-------------|
| ``npm run dev`` | Inicia el frontend en modo desarrollo |
| ``npm run build`` | Build de producción del frontend |
| ``npm run build:contract`` | Compila el contrato Rust a WASM |
| ``npm run test:contract`` | Ejecuta tests del contrato |
| ``npm run deploy:contract`` | Despliega contrato a testnet |

## 🔧 Configuración

Crea un archivo ``.env.local`` en ``/web`` con:

``````env
ADMIN_SECRET=tu_secret_key
NEXT_PUBLIC_CONTRACT_ID=tu_contract_id
RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
``````

## 📄 Licencia

MIT
"@

if (-not $DryRun) {
    $readme | Out-File -FilePath (Join-Path $monorepoPath "README.md") -Encoding utf8
    Write-Success "README.md creado"
}

# ============================================================
# RESUMEN FINAL
# ============================================================
Write-Host "`n" + "="*60 -ForegroundColor Green
Write-Host "   ✅ MONOREPO CREADO EXITOSAMENTE" -ForegroundColor Green
Write-Host "="*60 -ForegroundColor Green

Write-Host "`n📁 Estructura creada:" -ForegroundColor White
Write-Host "   $monorepoPath/"
Write-Host "   ├── contracts/"
Write-Host "   │   └── vigente/"
Write-Host "   ├── web/"
Write-Host "   ├── package.json"
Write-Host "   ├── .gitignore"
Write-Host "   └── README.md"

Write-Host "`n📋 Próximos pasos:" -ForegroundColor Yellow
Write-Host "   1. cd $MonorepoName"
Write-Host "   2. npm install"
Write-Host "   3. npm run dev"

Write-Host "`n💡 Scripts disponibles:" -ForegroundColor Cyan
Write-Host "   npm run dev           - Inicia el frontend"
Write-Host "   npm run build:contract - Compila el contrato Rust"
Write-Host "   npm run deploy:contract - Despliega a testnet"

if ($DryRun) {
    Write-Host "`n⚠️  MODO DRY-RUN: Ejecuta sin -DryRun para aplicar cambios" -ForegroundColor Yellow
}

Write-Host ""
