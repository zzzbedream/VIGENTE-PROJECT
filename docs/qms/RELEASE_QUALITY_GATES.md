# Gates de calidad por release

Checklist obligatorio antes de marcar un release (deploy, tag, o entrega de tramo
SCF) como listo. Ningún release pasa con un gate 🔴 sin excepción documentada y
firmada por el responsable.

## Gate 1 — Pruebas y build (automatizable hoy)

- [ ] `cargo test` verde en `contracts/vigente-badge` y `contracts/reference-vault`
- [ ] `npm run test:web` verde (incluye `test:templar`)
- [ ] `cd web && npm run build` sin errores
- [ ] `cd web && npm run lint` sin errores nuevos

## Gate 2 — Seguridad (parcialmente automatizable)

- [ ] Sin secretos en el diff (no API keys, claves privadas, `.env` versionado)
- [ ] Threat model intacto: ningún cambio rompe una mitigación de `docs/THREAT_MODEL.md`
- [ ] Cambios en `contracts/` revisados contra la frontera de valor (oráculo +
      scoring + badge no se delegan)
- [ ] Negociaciones/datos sensibles solo en `docs/private/` (gitignored)

## Gate 3 — Protección al cliente (manual)

- [ ] Si cambia la política de crédito: topes y throttle siguen alineados con CP2
      ([CLIENT_PROTECTION.md](CLIENT_PROTECTION.md)) y con `reference-vault`
- [ ] Si cambia el manejo de datos: **DPIA revisada/actualizada**
      ([DPIA_TEMPLATE.md](DPIA_TEMPLATE.md))
- [ ] Canal de quejas (CP7) operativo si hay usuarios reales en este release

## Gate 4 — Equidad (manual hasta tener datos)

- [ ] Si cambia el modelo de scoring: auditoría de *disparate impact* corrida y
      registrada ([AI_FAIRNESS.md](AI_FAIRNESS.md)); ninguna brecha sobre umbral 80%
      sin justificación
- [ ] Explicabilidad del score preservada (desglose disponible)

## Gate 5 — Impacto (por tramo)

- [ ] Métricas no-vanity de `IMPACT_MEASUREMENT.md` actualizadas con dato real
- [ ] Claims públicos (landing, README) pareados con evidencia verificable

## Registro

| Release | Fecha | Gates 🟢/🔴 | Excepciones | Responsable |
|---|---|---|---|---|
| _ej. t1-hardening_ | | | | |

Las excepciones a cualquier gate se registran aquí y, si son incidentes, también en
[INCIDENT_LOG.md](INCIDENT_LOG.md).
