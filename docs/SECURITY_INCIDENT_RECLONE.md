# Purga del historial y re-clonado — procedimiento (incidente C-01)

**Estado: PREPARADO, NO EJECUTADO.** Requiere confirmación explícita del operador porque
**reescribe la historia de git** y obliga a que todos los colaboradores vuelvan a clonar.

## Contexto

El 2026-07-18 se detectó que la `ADMIN_SECRET` del `margin-controller` estaba versionada.
Superficie real (mayor que la detectada inicialmente):

| Ubicación | Estado |
|---|---|
| 7 archivos en HEAD (3 guías + 4 scripts) | ✅ Limpiados (Fase 2) |
| `Debugging Contract Signature.md` — transcript de sesión con la llave en ~10 lugares | ⚠️ **Solo en historial**: añadido en `a4f9874` (2026-02-07), borrado en `2aa6b68` (2026-05-24). `git grep` no lo ve porque no está en HEAD |
| Historial de git completo | ⚠️ Pendiente de purga (este documento) |
| Variable `ADMIN_SECRET` en **Vercel (Production)** | ⚠️ Pendiente — ver §3 |
| Alias `admin` en el keystore local del CLI de Stellar | ⚠️ Pendiente — ver §3 |

**La llave ya fue rotada on-chain** (el `margin-controller` v1 responde al nuevo admin).
La purga es higiene: **no sustituye la rotación**, y la llave antigua debe considerarse
quemada para siempre aunque se borre del historial.

## 1. Purga (ejecutar solo con confirmación)

```bash
# 1) Instalar la herramienta (no viene con git)
pip install git-filter-repo

# 2) Crear el fichero de patrones FUERA del repositorio.
#    Sustituye <LLAVE_ANTIGUA> por el valor real (lo tienes en el respaldo).
#    ⚠️ NUNCA guardes este fichero dentro del repositorio.
cat > ~/vigente-secrets-to-purge.txt <<'EOF'
<LLAVE_ANTIGUA>==>***SECRETO_PURGADO***
EOF

# 3) Clon espejo limpio (git-filter-repo exige un clon fresco)
cd ~
git clone --mirror https://github.com/zzzbedream/VIGENTE-PROJECT.git vigente-purge.git
cd vigente-purge.git

# 4a) Reemplazar el secreto en TODO el historial
git filter-repo --replace-text ~/vigente-secrets-to-purge.txt

# 4b) Además, eliminar por completo el transcript de sesión
git filter-repo --path "Debugging Contract Signature.md" --invert-paths --force

# 5) Verificar que ya no aparece en ningún commit
git log -p --all | grep -cE "S[A-Z2-7]{55}"    # debe dar 0

# 6) Publicar la historia reescrita
git push --force --mirror origin

# 7) Borrar el fichero de patrones
shred -u ~/vigente-secrets-to-purge.txt 2>/dev/null || rm -f ~/vigente-secrets-to-purge.txt
```

## 2. Re-clonado obligatorio para colaboradores

Tras el `push --force`, **todo clon existente queda incompatible**. Cada colaborador debe:

```bash
# Guardar trabajo no publicado
git branch respaldo-local-$(date +%Y%m%d)
git format-patch origin/master --stdout > ~/mis-cambios.patch

# Re-clonar desde cero (NO uses git pull: mezclaría la historia vieja)
cd ..
mv VIGENTE-PROJECT VIGENTE-PROJECT.old
git clone https://github.com/zzzbedream/VIGENTE-PROJECT.git
cd VIGENTE-PROJECT
git config core.hooksPath .githooks        # activar el hook anti-secretos

# Reaplicar el trabajo guardado
git am ~/mis-cambios.patch

# Verificar y borrar el clon viejo (contiene el secreto en su historial)
rm -rf ../VIGENTE-PROJECT.old
```

**Impacto conocido:** el CTO tiene PRs mergeados (#1, #2) y un clon activo; la integración de
Vercel con GitHub también verá la historia reescrita. Coordinar el force-push con él y avisar
antes, no después.

## 3. Acciones que la purga NO resuelve

1. **Vercel — `ADMIN_SECRET` en Production.** El historial muestra
   `vercel env add ADMIN_SECRET … Production`: la llave antigua fue cargada como variable de
   entorno de producción. Hay que reemplazarla por la nueva o eliminarla:
   ```bash
   vercel env rm ADMIN_SECRET production
   vercel env add ADMIN_SECRET production      # pega la llave NUEVA cuando lo pida
   ```
2. **Keystore local del CLI.** Existe el alias `admin` con la llave quemada
   (`stellar keys ls` lo lista). Eliminarlo para no firmar con él por accidente:
   ```bash
   stellar keys rm admin
   ```
   *(Conservar `admin-v2`, que es el admin vigente.)*
3. **Clones y forks previos.** Cualquier copia hecha antes de la purga conserva el secreto.
   Por eso la rotación era lo primero y lo verdaderamente importante.
4. **La cuenta antigua `GAJT5NOK…`** sigue existiendo en testnet. No controla ningún
   contrato del protocolo, pero conviene no reutilizarla.

## 4. Alternativa si no se puede purgar

Si el force-push se considera demasiado disruptivo: **mantener el repositorio privado** y no
publicarlo nunca con esa historia. Dado que `docs/TRANCHE_1_DELIVERABLES.md` instruye a los
revisores del SCF a clonar el repositorio público, esta alternativa exige cambiar ese
procedimiento (por ejemplo, publicar un repositorio nuevo sin historia previa).
