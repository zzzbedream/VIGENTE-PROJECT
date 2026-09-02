# Registro de incidentes

Registro único de incidentes de seguridad, equidad (fairness), privacidad y quejas
de usuarios. Cumple el mecanismo de resolución de quejas (CP7) y el deber de
trazabilidad de la Ley 21.719. Un incidente sin registrar es un fallo del SGC.

Se registran también los incidentes de **terceros de los que dependemos** (Blend, Comet,
Reflector, emisores) cuando tocan una dependencia del pool, con su evaluación de impacto
(cambio de proceso P-03 en [`../../audit/11_POSTMORTEM.md`](../../audit/11_POSTMORTEM.md)).

## SLA de respuesta

| Severidad | Ejemplo | Acuse | Resolución objetivo |
|---|---|---|---|
| **Crítico** | clave de oráculo comprometida; fuga de PII; brecha de fairness grave | 4 h | 24 h |
| **Alto** | bug que afecta scores; queja de decisión automatizada injusta | 24 h | 5 días |
| **Medio** | error de UI con impacto en usuario; dato inconsistente | 3 días | 15 días |
| **Bajo** | consulta/queja menor | 5 días | 30 días |

Protocolo de respuesta a seguridad (ver `security.md` global): STOP → análisis →
fix de lo crítico antes de continuar → rotar secretos expuestos → revisar el resto
del código por patrones similares. Los niveles de contención on-chain, en orden, están en el
runbook de [`../../audit/11_POSTMORTEM.md`](../../audit/11_POSTMORTEM.md) §6 (P-09).

## Plantilla

```
### INC-AAAA-NN — <título>
- Fecha de detección:
- Detectado por:
- Severidad: crítico | alto | medio | bajo
- Categoría: seguridad | fairness | privacidad | queja-usuario | dependencia-externa | otro
- Descripción:
- Usuarios afectados:
- Acción inmediata:
- Causa raíz:
- Mitigación / fix (link a commit/PR):
- ¿Requiere actualizar DPIA / THREAT_MODEL / política de crédito?:
- Estado: abierto | en curso | cerrado
- Cierre (fecha + responsable):
```

## Incidentes

> Hasta el 2026-09-02 esta sección decía "sin incidentes registrados". Era falso: los cuatro
> de abajo ya habían ocurrido. Se registran con fecha real de detección; la fecha de
> registro es 2026-09-02.

### INC-2026-01 — Clave secreta del admin del margin-controller versionada en el repositorio (C-01)
- Fecha de detección: 2026-07-18
- Detectado por: revisión interna de seguridad (fundador)
- Severidad: crítico
- Categoría: seguridad
- Descripción: la `ADMIN_SECRET` estaba hardcodeada en 7 archivos trackeados (3 guías, 4 scripts) y en un transcript de sesión commiteado el 2026-02-07 y borrado del árbol el 2026-05-24 (no del historial).
- Usuarios afectados: ninguno (testnet, sin usuarios).
- Acción inmediata: rotación de la llave on-chain (`propose_admin`/`accept_admin`) antes de tocar el código.
- Causa raíz: sin hook ni escaneo de secretos; documentación y scripts escritos con la llave real por comodidad.
- Mitigación / fix: `50901a5` — archivos limpiados, hook `.githooks/pre-commit`, CI `secret-scan.yml`, `.gitignore` endurecido. El historial **no** se reescribió (decisión documentada en `audit/11_POSTMORTEM.md` §4.1); la llave antigua se considera quemada.
- ¿Requiere actualizar DPIA / THREAT_MODEL / política de crédito?: no.
- Estado: cerrado
- Cierre: 2026-07-26, fundador.

### INC-2026-02 — Umbral del backstop tomado de documentación (200.000) en vez del código (100.000)
- Fecha de detección: 2026-08-04
- Detectado por: equipo de Blend (`mootz12`), no por nosotros
- Severidad: medio (proceso)
- Categoría: otro (calidad de la evidencia)
- Descripción: con el umbral equivocado pedimos a Blend 2,3× los activos de testnet necesarios para activar el pool.
- Usuarios afectados: ninguno.
- Acción inmediata: verificación contra `blend-utils/.../get-backstop-threshold.ts:22`; recálculo reproducible.
- Causa raíz: número citado de documentación sin contrastarlo con la herramienta oficial.
- Mitigación / fix: regla "código o herramienta oficial, con la línea citada" (P-01); `audit/08_POOL_ACTIVATION.md` §2.
- ¿Requiere actualizar DPIA / THREAT_MODEL / política de crédito?: no.
- Estado: cerrado
- Cierre: 2026-08-08, fundador.

### INC-2026-03 — Dependencia externa: manipulación de oráculo en el pool YieldBlox de Blend (2026-02-22)
- Fecha de detección: 2026-02-22 (incidente público); evaluación de impacto formal 2026-09-02
- Detectado por: Script3 / comunidad
- Severidad: alto (para nuestro diseño; sin exposición de fondos propios)
- Categoría: dependencia-externa
- Descripción: precio de USTRY empujado ~100× en un mercado ilíquido del SDEX; el feed de Reflector basado en SDEX lo propagó; el pool prestó ~$10,9M contra colateral inflado.
- Usuarios afectados: ninguno de Vigente.
- Acción inmediata: ninguna en su momento (no teníamos pool). Evaluación en `audit/11_POSTMORTEM.md` §1.
- Causa raíz (en lo que nos toca): nuestro guard de desviación frena pero no impide una manipulación paciente, y falla cerrado ante movimientos legítimos grandes (hallazgo H-03); los activos RWA de nuestro roadmap son la misma clase que USTRY.
- Mitigación / fix: política de listado y oráculos (P-04); rediseño del guard para el aggregator de mainnet (Tranche 2.1).
- ¿Requiere actualizar DPIA / THREAT_MODEL / política de crédito?: THREAT_MODEL sí (vector de manipulación de precio con fuente DEX) — pendiente.
- Estado: en curso
- Cierre: —

### INC-2026-04 — Dependencia externa: exploit del LP BLND:USDC de Comet, token de backstop de Blend (2026-08-25)
- Fecha de detección: 2026-08-26 (reporte de Script3); verificación de hashes 2026-09-02
- Detectado por: Blockaid → Script3
- Severidad: alto (bloquea el plan de mainnet tal como está escrito; sin fondos propios en riesgo)
- Categoría: dependencia-externa
- Descripción: swap con `token_in == token_out` corrompe la contabilidad de reservas de Comet; 717.518,92 USDC extraídos con flash loans de Blend. El LP de Comet es el token de backstop de Blend V1/V2.
- Usuarios afectados: ninguno de Vigente. Nuestro backstop de testnet (22.980 LP) es el mismo wasm (`8abc2891…`) que el contrato explotado; son tokens de testnet sin valor.
- Acción inmediata: confirmar ausencia de exposición en mainnet; comparar hashes; revisar nuestros contratos por la misma clase de bug (resultado negativo, `audit/11_POSTMORTEM.md` §3).
- Causa raíz (en lo que nos toca): el plan de Tranche 3.1 asumía un backstop V2 en mainnet sin un inventario de dependencias con radio de impacto.
- Mitigación / fix: P-03 (inventario y evaluación en 72 h); decisión sobre el objetivo de mainnet cuando Script3 publique el plan de remediación; no se fondea ningún backstop V2 en mainnet mientras el LP esté comprometido.
- ¿Requiere actualizar DPIA / THREAT_MODEL / política de crédito?: THREAT_MODEL sí (dependencia del backstop) — pendiente.
- Estado: en curso
- Cierre: —

### INC-2026-05 — TTL de la instancia del vigente-badge expirado (H-04)
- Fecha de detección: 2026-09-02
- Detectado por: revisión interna al redactar `audit/10_SECURITY_REVIEW_REPORT.md`
- Severidad: alto (operativo; testnet)
- Categoría: seguridad (disponibilidad)
- Descripción: `getLedgerEntries` devuelve `liveUntilLedgerSeq: 0` para la instancia del badge (dos RPC independientes). El contrato solo extiende el TTL de instancia en `initialize`; expiró ≈ 2026-08-29. Toda llamada del controller que lee el badge falla en una transacción real hasta restaurar la entrada. El CLI restaura automáticamente, por eso las corridas manuales no lo notaron.
- Usuarios afectados: ninguno (testnet). Sí afecta a los comandos de verificación del README que usa el panel.
- Acción inmediata: restaurar y extender la instancia del badge; extender pool (≈ 8,6 días restantes al 2026-09-02), aggregator, controller y controller v1.
- Causa raíz: nadie es dueño del mantenimiento de TTL; el contrato no extiende su instancia en cada escritura.
- Mitigación / fix: P-08 (keeper semanal + alerta a 21 días); próximos builds extienden el TTL de instancia en cada entry point que escribe.
- ¿Requiere actualizar DPIA / THREAT_MODEL / política de crédito?: no.
- Estado: abierto
- Cierre: —

> Al incorporar el primer usuario real con datos personales, este registro y el
> canal de quejas (CP7) deben estar operativos. Es un prerrequisito de release
> (Gate 3 en [RELEASE_QUALITY_GATES.md](RELEASE_QUALITY_GATES.md)).
