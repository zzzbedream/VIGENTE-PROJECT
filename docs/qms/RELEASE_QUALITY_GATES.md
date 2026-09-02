# Gates de calidad por release

Checklist obligatorio antes de marcar un release (deploy, tag, o entrega de tramo
SCF) como listo. Ningún release pasa con un gate 🔴 sin excepción documentada y
firmada por el responsable.

> Actualizado el 2026-09-02 tras el post-mortem [`../../audit/11_POSTMORTEM.md`](../../audit/11_POSTMORTEM.md):
> el Gate 1 apuntaba a `reference-vault`, un crate archivado; el Gate 2 no cubría
> dependencias externas ni TTL; no existía un gate de auditoría independiente.

## Gate 1 — Pruebas y build (automatizable hoy)

- [ ] `cargo test -j 1` verde en `contracts/vigente-badge`, `contracts/margin-controller`
      y `contracts/oracle-aggregator` (son crates independientes, sin workspace)
- [ ] `npm run test:web` verde
- [ ] `cd web && npm run build` sin errores
- [ ] `cd web && npm run lint` sin errores nuevos
- [ ] Si se despliega un contrato: toolchain fijada (`rust-toolchain.toml`) y hash del wasm
      compilado igual al del ledger, registrado junto al commit (P-10)

## Gate 2 — Seguridad (parcialmente automatizable)

- [ ] Sin secretos en el diff: hook `.githooks/pre-commit` activo y CI `secret-scan` verde (P-02)
- [ ] Threat model intacto: ningún cambio rompe una mitigación de `docs/THREAT_MODEL.md`
- [ ] Cambios en `contracts/` revisados contra la frontera de valor (oráculo +
      scoring + badge no se delegan)
- [ ] **Inventario de dependencias** al día: cada contrato de terceros del que depende el pool
      con hash de wasm, actualizable o no, admin, estado de auditoría y qué se rompe si falla
      (`audit/10_SECURITY_REVIEW_REPORT.md` §1). Incidente upstream → evaluación escrita en 72 h (P-03)
- [ ] **Revisión de fallos cruzados** entre contratos: para cada par, qué pasa si el otro está
      pausado, archivado, reinicializado o devuelve error (P-11)
- [ ] **Entradas degeneradas**: toda función que reciba dos activos o dos registros tiene un
      test con entradas iguales; montos cero y negativos revierten (P-04.e)
- [ ] **TTL**: ninguna instancia ni clave caliente con menos de 21 días de vida al momento del
      release; keeper operativo o extensión manual registrada (P-08)
- [ ] Negociaciones/datos sensibles solo en `docs/private/` (gitignored)

## Gate 3 — Protección al cliente (manual)

- [ ] Si cambia la política de crédito: topes y throttle siguen alineados con CP2
      ([CLIENT_PROTECTION.md](CLIENT_PROTECTION.md)) y con el `margin-controller`
- [ ] Si cambia el manejo de datos: **DPIA revisada/actualizada**
      ([DPIA_TEMPLATE.md](DPIA_TEMPLATE.md))
- [ ] Canal de quejas (CP7) operativo si hay usuarios reales en este release

## Gate 4 — Equidad (manual hasta tener datos)

- [ ] Si cambia el modelo de scoring: auditoría de *disparate impact* corrida y
      registrada ([AI_FAIRNESS.md](AI_FAIRNESS.md)); ninguna brecha sobre umbral 80%
      sin justificación
- [ ] Explicabilidad del score preservada (desglose disponible)

## Gate 5 — Impacto y claims (por tramo)

- [ ] Métricas no-vanity de `IMPACT_MEASUREMENT.md` actualizadas con dato real
- [ ] Claims públicos (landing, README, postulación) pareados con evidencia verificable:
      lectura on-chain con su comando, código con archivo:línea, o salida de comando (P-06)
- [ ] La palabra "auditoría" solo se usa en el sentido del Gate 7

## Gate 6 — Listado de colateral y oráculos (por activo nuevo)

- [ ] Fuente de precio con metodología documentada; **ningún activo cuyo precio derive de un
      libro de órdenes delgado en un DEX**; para RWA, precio NAV/redención o multi-fuente (P-04.a)
- [ ] Banda de desviación por activo calibrada con dispersión medida y escalada por tiempo;
      modo degradado definido en vez de pánico indefinido (P-04.b)
- [ ] Topes derivados de la capacidad de redención del emisor: `supply_cap` de la reserva,
      tope por activo y tope por usuario (P-04.c)
- [ ] Solo activos respaldados por Stellar Asset Contracts (P-04.d)

## Gate 7 — Mainnet: auditoría independiente (bloqueante)

- [ ] Informe de auditoría **independiente** publicado — de una firma o revisor que no escribió
      el código, contratado por escrito, con informe público. La revisión interna asistida por IA
      **no** cuenta (P-05)
- [ ] Hallazgos críticos, altos y medios remediados dentro de la ventana de 20 días hábiles
      del Audit Bank, con hashes de verificación
- [ ] Admin de pool, aggregator, controller y badge migrado a multisig 2-de-3 antes del primer
      fondo real
- [ ] Decisión documentada sobre el primitivo de liquidez de mainnet (Blend V2 con backstop
      remediado, V3 u otro), posterior al plan de remediación de Script3 (INC-2026-04)

## Registro

| Release | Fecha | Gates 🟢/🔴 | Excepciones | Responsable |
|---|---|---|---|---|
| _ej. t1-hardening_ | | | | |

Las excepciones a cualquier gate se registran aquí y, si son incidentes, también en
[INCIDENT_LOG.md](INCIDENT_LOG.md).
