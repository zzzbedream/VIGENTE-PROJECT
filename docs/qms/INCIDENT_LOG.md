# Registro de incidentes

Registro único de incidentes de seguridad, equidad (fairness), privacidad y quejas
de usuarios. Cumple el mecanismo de resolución de quejas (CP7) y el deber de
trazabilidad de la Ley 21.719. Un incidente sin registrar es un fallo del SGC.

## SLA de respuesta

| Severidad | Ejemplo | Acuse | Resolución objetivo |
|---|---|---|---|
| **Crítico** | clave de oráculo comprometida; fuga de PII; brecha de fairness grave | 4 h | 24 h |
| **Alto** | bug que afecta scores; queja de decisión automatizada injusta | 24 h | 5 días |
| **Medio** | error de UI con impacto en usuario; dato inconsistente | 3 días | 15 días |
| **Bajo** | consulta/queja menor | 5 días | 30 días |

Protocolo de respuesta a seguridad (ver `security.md` global): STOP → análisis →
fix de lo crítico antes de continuar → rotar secretos expuestos → revisar el resto
del código por patrones similares.

## Plantilla

```
### INC-AAAA-NN — <título>
- Fecha de detección:
- Detectado por:
- Severidad: crítico | alto | medio | bajo
- Categoría: seguridad | fairness | privacidad | queja-usuario | otro
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

_(sin incidentes registrados — el proyecto está en testnet, sin usuarios reales)_

> Al incorporar el primer usuario real con datos personales, este registro y el
> canal de quejas (CP7) deben estar operativos. Es un prerrequisito de release
> (Gate 3 en [RELEASE_QUALITY_GATES.md](RELEASE_QUALITY_GATES.md)).
