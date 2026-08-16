# archive/ — código histórico, FUERA DEL PRODUCTO

> Nada de este directorio forma parte del producto actual de Vigente Protocol, **no se
> compila**, **no se despliega** y **está explícitamente fuera del alcance** de cualquier
> auditoría de seguridad. Se conserva por trazabilidad histórica del proyecto.
>
> El producto vigente son los crates de `contracts/`: `margin-controller` y `vigente-badge`.

## Por qué está archivado

Archivado el **2026-07-18** por decisión de producto, tras la auditoría interna
: el repositorio mezclaba producto, prueba de concepto y legacy, lo
que confunde a revisores externos y multiplica el costo de una auditoría pagada.

Los manifiestos se renombraron a `Cargo.toml.archived` para que ninguna herramienta los
compile por accidente, dejándolos legibles.

## Contenido

### `reference-vault/` — PoC de préstamo sub-colateralizado

Prueba de concepto del modelo **pre-pivote**: préstamo sub-colateralizado con límite anclado
al score de reputación. **Nunca fue el producto** y no está desplegado en mainnet.

> ⚠️ **Defecto conocido, NO corregido (se archiva en lugar de arreglarse).**
> Su función `pause()` bloquea también las salidas del usuario: `repay` (`src/lib.rs:435`),
> `request_withdraw` (`:506`), `claim_withdraw` (`:553`) y `liquidate` (`:648`).
> Es decir, el administrador podía impedir que un usuario repagara o retirara.
> **No forkear este contrato.** El `margin-controller` corrige exactamente ese patrón: su
> `pause` solo congela `deposit_collateral` y `borrow`, y jamás las salidas.

### `pyme-token-v1/` — contrato legacy (`pyme_token_v1`)

Primer contrato del proyecto, ya marcado `DEPRECATED` en su propio código
(`src/lib.rs:15`). Emitía un "CreditBadge" de reputación.

> ⚠️ **Defecto conocido:** `mint_badge` autentica al **beneficiario**, no al oráculo
> (`src/lib.rs:140` → `user.require_auth()`), pese a que su comentario afirma lo contrario
> (`:121`). En la práctica, cualquiera podía auto-emitirse un badge con tier y score
> arbitrarios. Su reputación **no tiene ningún valor**.
> El sustituto es `contracts/vigente-badge`, que exige un umbral k-de-n de firmas ed25519.

### `pyme-token-sprint1/` — scripts de sprint

Solo scripts JS de un sprint anterior; nunca fue un crate de Rust.

## Si necesitas compilar algo de aquí

Renombra su `Cargo.toml.archived` a `Cargo.toml` **en una copia fuera del repositorio**. No
lo reactives en `main`: reintroduce superficie de ataque y alcance de auditoría.
