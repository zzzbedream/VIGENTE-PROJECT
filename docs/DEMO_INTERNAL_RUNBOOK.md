# Vigente Demo Interno (Testnet)

Fecha de validacion tecnica: 2026-08-16/17 (PowerShell, Windows, Stellar CLI 27.0.0)

Objetivo: ejecutar la demo de 2:50 con comandos en orden del guion, minimizando riesgo en vivo y respaldando cada afirmacion con evidencia verificable.

## 1) Preflight rapido (60-90s antes de grabar)

```powershell
Set-Location C:\A-PROGRAMAS\VIGENTE-PROJECT
stellar --version
```

Esperado:
- Stellar CLI responde version (actualmente 27.0.0).
- Si aparece warning de update (27.1.0), se puede ignorar para la demo.

Definir variables:

```powershell
$POOL='CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI'
$CTRL='CAH2BHAEBYUCVQ4UQGNZKCLDD2KLP7GY3F2PWMNMXOZ7S54WLHG3C75W'
$AGG='CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4'
$SRC='GC6IPCM3OO44PW4Y62XD54HLT5Q23E5OFNFMYPMNUDSDRUK37ZFB6ECZ'
```

Smoke test rapido (evita el error de `--id` vacio):

```powershell
"CTRL=$CTRL"
"SRC=$SRC"
stellar contract invoke --id $CTRL --network testnet --source-account $SRC --send=no -- get_tier_ltv
```

Si `CTRL=` sale vacio, vuelve a pegar el bloque de variables.

## 2) Runbook en orden del guion

## [0:00-0:20] The Problem
Visual:
- Hero o camara directa.

Accion tecnica:
- Sin comando.

Soporte de evidencia:
- El producto live y contratos testnet estan listados en README.

## [0:20-0:40] Architecture
Visual:
- Diagrama de arquitectura.

Accion tecnica:
- Sin comando.

Mensaje clave:
- Blend no recibe score; la logica reputacional vive en margin-controller.

## [0:40-1:00] The Pool
Visual:
- Terminal mostrando configuracion del pool.

Comando:

```powershell
stellar contract invoke --id $POOL --network testnet --source-account $SRC --send=no -- get_config
```

Esperado (validado):
- status: 0
- oracle: CCG6EAGO... (nuestro aggregator)
- max_positions: 4

Prueba ya validada:
- Output real reciente: {"bstop_rate":1000000,"max_positions":4,"min_collateral":"100000000000000","oracle":"CCG6EAGO...","status":0}

## [1:00-1:25] Credit Passport
Visual:
- UI passport + terminal de tiers on-chain.

Comando:

```powershell
stellar contract invoke --id $CTRL --network testnet --source-account $SRC --send=no -- get_tier_ltv
```

Esperado (validado):
- [{"ltv_bps":8500,"min_score":800},{"ltv_bps":7500,"min_score":550},{"ltv_bps":6000,"min_score":300}]

Refuerzo opcional por usuario:

```powershell
stellar contract invoke --id $CTRL --network testnet --source-account $SRC --send=no -- ltv_bps_for --user GC6IPCM3OO44PW4Y62XD54HLT5Q23E5OFNFMYPMNUDSDRUK37ZFB6ECZ
stellar contract invoke --id $CTRL --network testnet --source-account $SRC --send=no -- ltv_bps_for --user GDESGH52DW7PYVRTYR43POJ7QHHLZ337SLKSAVMQ4OKFKNS2RPT3YJYF
```

Esperado (validado):
- Silver: 7500
- Gold: 8500

## [1:25-2:05] Key Shot (core)
Visual:
- Dos llamadas max_borrow lado a lado + ratio.

Comandos:

```powershell
$SRaw = stellar contract invoke --id $CTRL --network testnet --source-account $SRC --send=no -- max_borrow --user GC6IPCM3OO44PW4Y62XD54HLT5Q23E5OFNFMYPMNUDSDRUK37ZFB6ECZ
$GRaw = stellar contract invoke --id $CTRL --network testnet --source-account $SRC --send=no -- max_borrow --user GDESGH52DW7PYVRTYR43POJ7QHHLZ337SLKSAVMQ4OKFKNS2RPT3YJYF
$S=[double]($SRaw -replace '"','')
$G=[double]($GRaw -replace '"','')
"silver=$S"
"gold=$G"
"ratio=$($G/$S)"
"ltv_ratio=$(8500/7500)"
```

Esperado (validado):
- silver=1185487170
- gold=1343552126
- ratio=1.13333333333333
- ltv_ratio=1.13333333333333

Nota de narracion:
- Los absolutos pueden cambiar por precio live del oracle.
- El ratio entre tiers debe mantenerse.

## [2:05-2:30] Custody
Visual:
- pause -> intento de riesgo nuevo bloqueado -> withdraw exitoso -> unpause.

### Opcion A (recomendada para video final): evidencia inmutable por tx hashes
Usar tablas ya documentadas en:
- audit/08_POOL_ACTIVATION.md

Tx clave:
- pause: e8803f60...
- withdraw while paused: d370b84a...
- unpause: d555c94c...

### Opcion B (live state-changing, solo si hay cuenta admin y plan de rollback)
Comandos (sintaxis confirmada; requieren permisos reales):

```powershell
# pause (admin)
stellar contract invoke --id $CTRL --network testnet --source-account <ADMIN_G...> --send=yes -- pause

# withdraw_collateral (usuario con posicion activa)
stellar contract invoke --id $CTRL --network testnet --source-account <USER_G...> --send=yes -- withdraw_collateral --user <USER_G...> --asset CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC --amount <AMOUNT_I128>

# unpause (admin)
stellar contract invoke --id $CTRL --network testnet --source-account <ADMIN_G...> --send=yes -- unpause
```

Riesgo:
- Esto modifica estado real.
- Requiere que la posicion del usuario permita retiro (health check pasa).

## [2:30-2:50] What's Next
Visual:
- Roadmap.

Accion tecnica:
- Sin comando.

Soporte de evidencia:
- Seccion "What does not exist yet" en README.

## 3) Oracle proof (apoyo opcional)

Problema conocido en PowerShell:
- `--asset '{"Stellar":"..."}'` puede fallar por parseo.

Solucion robusta validada:

```powershell
Set-Content -Path asset.json -Value '{"Stellar":"CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"}' -NoNewline
stellar contract invoke --id $AGG --network testnet --source-account $SRC --send=no -- lastprice --asset-file-path asset.json
```

Esperado (validado):
- JSON con price y timestamp, por ejemplo {"price":"15821128535994","timestamp":1786937400}

## 4) Validacion automatizada del repo (evidencia adicional)

```powershell
Set-Location C:\A-PROGRAMAS\VIGENTE-PROJECT\web
npm run validate-t1
```

Esperado (validado):
- status: complete
- vigente-badge tests_passed: 41
- margin-controller tests_passed: 37
- margin_controller.live.ltv_bps_demo_user: 7500

## 5) Checklist de grabacion

Pre-demo (tecnico)
- [ ] Terminal en PowerShell y carpeta correcta.
- [ ] Variables $POOL, $CTRL, $AGG, $SRC seteadas.
- [ ] No hay secretos en pantalla (.env cerrado).
- [ ] `get_config` responde status 0 y oracle correcto.
- [ ] `get_tier_ltv` responde 85/75/60.
- [ ] `max_borrow` de Silver/Gold responde y ratio coincide con 8500/7500.
- [ ] `npm run validate-t1` listo como backup de evidencia.

Durante demo
- [ ] Mostrar comando y salida completa (sin cortar la linea de oracle/status).
- [ ] En Key Shot, decir ratio (85/75) en vez de decimales largos.
- [ ] Si cambia el valor absoluto, enfatizar que el ratio es el invariante.

Fallback si algo falla en vivo
- [ ] Si falla parseo de Asset: usar `--asset-file-path`.
- [ ] Si `max_borrow` da 0: explicar que la cuenta no tiene colateral activo y usar tx hashes historicos.
- [ ] Si hay latencia RPC: repetir una vez; si persiste, pasar a evidencia inmutable (tx hashes + validate-t1).

Post-demo
- [ ] Volver a carpeta raiz del repo.
- [ ] Borrar asset.json temporal si no se usara mas.

```powershell
Set-Location C:\A-PROGRAMAS\VIGENTE-PROJECT
Remove-Item .\asset.json -ErrorAction SilentlyContinue
```

## 6) Error que te estaba bloqueando (confirmado)

Causa:
- Se uso sintaxis Bash en PowerShell: `POOL=...`.

Correcto en PowerShell:

```powershell
$POOL='CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI'
stellar contract invoke --id $POOL --network testnet --source-account $SRC --send=no -- get_config
```

## 7) Troubleshooting express

Error:
- `error: a value is required for '--id <CONTRACT_ID>' but none was supplied`

Causa mas comun:
- Abriste una terminal nueva y las variables `$POOL/$CTRL/$AGG/$SRC` ya no existen en esa sesion.

Fix inmediato (copiar/pegar):

```powershell
$POOL='CDYUHA3TPDCAP5FAJMVPMFDW35ZCPSUV2ND2K2G5EB3QYMUDERKPHNUI'
$CTRL='CAH2BHAEBYUCVQ4UQGNZKCLDD2KLP7GY3F2PWMNMXOZ7S54WLHG3C75W'
$AGG='CCG6EAGO3VJIEP6DCY3WTNCNO4KCBQM2D6TXSAFOFRV67ZSBBXX2FQH4'
$SRC='GC6IPCM3OO44PW4Y62XD54HLT5Q23E5OFNFMYPMNUDSDRUK37ZFB6ECZ'
"POOL=$POOL"
"CTRL=$CTRL"
"AGG=$AGG"
"SRC=$SRC"
```

Bypass sin variables (si estas contra reloj):

```powershell
stellar contract invoke --id CAH2BHAEBYUCVQ4UQGNZKCLDD2KLP7GY3F2PWMNMXOZ7S54WLHG3C75W --network testnet --source-account GC6IPCM3OO44PW4Y62XD54HLT5Q23E5OFNFMYPMNUDSDRUK37ZFB6ECZ --send=no -- get_tier_ltv
```

Nota:
- `unpause --help` puede terminar con exit code 1 aunque muestre ayuda; es normal en este flujo y no implica fallo del contrato.
