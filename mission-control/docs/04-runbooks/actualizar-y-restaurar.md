---
tipo: runbook
proyecto: Mission Control
revisado: 2026-10-08
estado: "Copia completa y restauración ensayadas DE VERDAD en Linux (Paperclip 2026.1005.0, usuario sin privilegios). Actualización y rollback: leídos del código, NO ejecutados. Windows y macOS: scripts sin ejecutar."
---

# Fijar, actualizar, revertir, respaldar y restaurar Paperclip

Claves: **[H]** comprobado en el entorno Cloud · **[F]** código/documentación leído · **[I]** inferencia · **[Pr]** propuesta sin aprobar.
Prueba con salida literal y marcas UTC: `docs/evidencias/restauracion-lab.md`. Scripts: `scripts/README.md`.

## 0. Cinco reglas que salen de los hallazgos

1. **No existe `db:restore`.** Solo `db:backup`. Restaurar = `psql` con el `.sql.gz`, o la función `runDatabaseRestore` de `@paperclipai/db` (nuestro `scripts/common/restore-db.mjs`, que **no necesita `psql`**). El Postgres embebido **no trae `psql` ni `pg_dump`** (solo `initdb`, `pg_ctl`, `postgres`) [H].
2. **La base sola no sirve.** Sin `secrets/master.key` los secretos cifrados no se pueden descifrar (“either artifact alone is insufficient”, `DATABASE.md:467`). La copia automática de Paperclip (cada 60 min en `data/backups`) guarda **solo el volcado**.
3. **El Postgres embebido solo existe mientras el servidor corre**: el backup y la restauración se hacen con el servidor arriba.
4. **El puerto del Postgres no siempre es 54329.** Si estaba ocupado, el servidor usa el siguiente libre **sin guardarlo** en `config.json`, y `db:backup` conecta al de `config.json` (o 54329): puede volcar **otra** base (hallazgo F4). Lo viví en el laboratorio: la 2.ª instancia tenía `config.json = 54329` y escuchaba en 54330 [H]. `backup-full.mjs` lo detecta y fuerza `DATABASE_URL`.
5. **`update --rollback` revierte el código, no las migraciones.** Si la base ya migró hacia delante, el rollback del código no basta: restaura la copia (`update.ts:178`).

## 1. Fijar versión

| Canal (hoy, `npm view paperclipai dist-tags` [F]) | Versión |
|---|---|
| `latest` (la que usamos) | **2026.1005.0** |
| `beta` / `nightly` / `canary` | 2026.1006.0-beta.0 / 2026.1007.0-nightly.0 / 2026.1008.0-canary.4 (sin evaluar) |

El build vivo que probamos **no es el mismo código** que el clon de referencia (umbrales de silencio, política de presupuesto sin precio…, `reliability.md` §0): prueba cualquier versión nueva antes de adoptarla. Todas exigen Node ≥ 24.11.

| Modo de instalación | Cómo se fija | Cómo se detecta (`update.ts:78-91`) |
|---|---|---|
| **Gestionado** (macOS, Linux, WSL2) — recomendado | `bash install.sh --version 2026.1005.0 …` o `paperclipai install --version 2026.1005.0` (versión exacta ⇒ canal `pinned`; `update` sin argumentos **no** se mueve) | manifiesto + ejecutable dentro de `~/.paperclip/cli` |
| **global-npm** (Windows nativo, sin soporte oficial) | `npm install --global --registry https://registry.npmjs.org paperclipai@2026.1005.0` | ruta con `/node_modules/paperclipai/` |
| **npx** (laboratorio) | `npx -y paperclipai@2026.1005.0 …` en cada comando | ruta `/.npm/_npx/`: `update` solo avisa |

Guarda el tarball de la versión buena para poder reinstalar sin red: `npm pack paperclipai@2026.1005.0`.
Reduce ruido y envíos: `PAPERCLIP_UPDATE_CHECK=0` (desactiva el aviso de actualización) y, si lo decides, `PAPERCLIP_TELEMETRY_DISABLED=1` (V20).

## 2. Qué contiene una copia completa

Raíz: `<PAPERCLIP_HOME>/instances/<id>/` (por defecto `~/.paperclip/instances/default/`; en el laboratorio `/home/user/mc-lab/paperclip-data/instances/default`).

| Artefacto | Ruta relativa | Si falta |
|---|---|---|
| Volcado lógico | `data/backups/paperclip-<ts>.sql.gz` | no hay datos |
| **Master key** | `secrets/master.key` | los secretos cifrados (claves de Hermes, etc.) son **irrecuperables**: habría que volver a crearlos |
| Clave de firma de decisiones | `secrets/decision-signing.key` | firmas de decisiones no verificables |
| `.env` de la instancia | `.env` (`PAPERCLIP_AGENT_JWT_SECRET`, `PAPERCLIP_TOOL_ACTION_SIGNING_SECRET`) | sesiones y JWT de agentes se invalidan; `doctor --repair` genera otros |
| Configuración | `config.json` | puertos, bind, modo, rutas |
| Adjuntos | `data/storage/` (si `local_disk`) | adjuntos huérfanos |
| Espacios de trabajo | `workspaces/`, `companies/`, `projects/` | repos y estado de agentes locales |
| Contexto del cliente CLI | `<PAPERCLIP_HOME>/context.json` | perfiles de la CLI |

Opcional: `data/run-logs` (grande; `--include-run-logs`). `db/` (los archivos de PostgreSQL) en frío **no es portable** entre Windows, macOS y Linux ni quizá entre arquitecturas [I]: para mover datos entre equipos usa siempre el volcado lógico.

## 3. Hacer la copia

Con el servidor **arriba**:
```sh
node scripts/common/backup-full.mjs --data-dir ~/.paperclip --out ~/mc-backups        # Linux/WSL2/macOS
.\scripts\windows\backup.ps1                                                          # Windows (WSL2 por defecto; -Target native)
bash scripts/macos/backup.sh
```
Qué hace (cada comando se imprime): comprueba el puerto real del Postgres → `paperclipai db:backup --json -d <dataDir>` → crea `MANIFEST.json` (hash del volcado, lista de entradas; **sin secretos**) → `tar -czf mc-backup-<instancia>-<UTC>.tar.gz` (modo 600) → lista el archivo y exige volcado + `master.key` + `decision-signing.key` + `.env` → imprime tamaño y SHA-256. `--skip-db` reutiliza el último volcado; `--dry-run` solo muestra el plan. Resultado real en el laboratorio: 15 entradas, 157 931 bytes [H].

Después:
- Copia el `.tar.gz` **fuera del equipo** y cífralo (contiene la `master.key`). Nunca al repositorio.
- Estado de la copia automática: `curl -s http://127.0.0.1:<puerto>/api/health | jq .databaseBackup` (`status ok|warning`, `latestBackup`). Variables: `PAPERCLIP_DB_BACKUP_{ENABLED,INTERVAL_MINUTES,RETENTION_DAYS,DIR,MAX_AGE_HOURS}`.
- Recomendación `reliability.md` §8: `PAPERCLIP_SECRETS_MASTER_KEY_FILE` fuera del directorio de datos y respaldada aparte.
- Windows nativo: cada parada del servidor mata PostgreSQL con `taskkill /f` (F5): copia con más frecuencia y evita apagados bruscos.

## 4. Actualizar y revertir

### 4.1 Instalación gestionada (macOS, WSL2)

```sh
bash scripts/macos/update.sh --check                        # (en WSL2: bash scripts/common/update-managed.sh --check; desde Windows: .\scripts\windows\update.ps1 -Check)
bash scripts/macos/update.sh --to 2026.1006.0 --stopped --yes
bash scripts/macos/update.sh --rollback --yes
```
Equivale a: `paperclipai update --check --json` (código de salida **10** = hay actualización) → copia completa (`backup-full.mjs`) → `paperclipai update --dry-run` → [`service stop` → `update --version X --no-backup` → `service start`]. `update --version X` salta a una versión exacta y la **fija** (`update.ts:120`). Se conservan 2 payloads anteriores (`INSTALLING.md:119-120`).

Por qué `--stopped` (hallazgo F2): `update` por sí solo hace backup de BD (solo en modo gestionado), instala el payload, hace *smoke* de `--version`, cambia `current` y reinicia el servicio, esperando `/api/health` con la versión nueva **solo 60 s**; si no responde, **revierte el código dejando la base ya migrada** (`service.ts:42-50`, `update.ts:147-165`). Si tus migraciones tardan, ese límite te deja en el peor caso. Con el servicio parado `update` no valida ni revierte: tú arrancas y vigilas (`paperclipai service logs -f`). Las migraciones se aplican solas sin TTY (`server/src/index.ts:246-248`); con TTY pregunta, salvo `PAPERCLIP_MIGRATION_AUTO_APPLY=true`.

**Rollback del código:** `paperclipai update --rollback`. No toca la base. Si la versión nueva ya migró el esquema, restaura la copia previa (§5) con el código viejo.

### 4.2 global-npm (Windows nativo)

`update` **solo ejecuta `npm install -g`**: no hace backup, no para ni reinicia nada, no valida (F3); y `--rollback` no existe (`update.ts:174`). Usa:
```powershell
.\scripts\windows\update.ps1 -Target native -To 2026.1006.0 -Yes                       # copia → parar tarea → npm i -g → iniciar tarea
.\scripts\windows\update.ps1 -Target native -To 2026.1005.0 -AllowDowngrade -Yes        # "rollback" = update explícito a la versión previa (pide --yes)
```
y comprueba a mano `/api/health` → `version`. En Windows, `npx paperclipai update` podría clasificarse como `global-npm` por la ruta de la caché [I, F3]: no lo uses sin probarlo.

## 5. Restaurar

> **Destructivo.** El volcado hace `DROP TABLE IF EXISTS … CASCADE` por tabla y recrea los datos (`backup-lib.ts:594,742,1047`): sobrescribe lo que haya. Ensáyalo siempre primero en un directorio de prueba (§7) y usa una versión de Paperclip **igual o posterior** a la del volcado [I].

### 5.1 Procedimiento automatizado (macOS / Linux / WSL2 gestionados)

```sh
bash scripts/macos/restore.sh --archive ~/mc-backups/mc-backup-default-<UTC>.tar.gz            # plan
bash scripts/macos/restore.sh --archive ~/mc-backups/mc-backup-default-<UTC>.tar.gz --yes
.\scripts\windows\restore.ps1 -Archive C:\ruta\mc-backup-….tar.gz -Yes                        # Windows (WSL2 por defecto)
```
Secuencia: `paperclipai service stop` → `restore-files.mjs --yes` (claves, `.env`, storage, workspaces; **conserva el `config.json` del destino** salvo `--include-config`) → `service start` → esperar al Postgres y leer su **puerto real** → `restore-db.mjs --yes` → `service restart` → `verify-restore.mjs`.

### 5.2 Procedimiento manual con nuestros scripts (el que se ensayó en el laboratorio)

Con el servidor **parado**:
```sh
node scripts/common/restore-files.mjs --archive <copia.tar.gz> --data-dir <PAPERCLIP_HOME> --instance default           # plan
node scripts/common/restore-files.mjs --archive <copia.tar.gz> --data-dir <PAPERCLIP_HOME> --instance default --yes
```
(Se niega a actuar si `runtime-info.json` apunta a un PID vivo.) Arranca el servidor y espera a `/api/health`. Lee el puerto real del Postgres: línea del banner `Database … (pg:NNNNN)` del log, o `ps -ax -o command= | grep 'postgres -D <instancia>/db'`. Entonces:
```sh
node scripts/common/restore-db.mjs --dump <PAPERCLIP_HOME>/instances/default/data/backups/paperclip-<ts>.sql.gz \
     --db-url postgres://paperclip:paperclip@127.0.0.1:<puerto>/paperclip \
     [--paperclip-db-path <carpeta de @paperclipai/db>] --no-psql --yes
```
- Sin `--yes` imprime el plan y sale con código **2**; `--dry-run` hace las comprobaciones y sale 0.
- Localiza `@paperclipai/db` en este orden: `--paperclip-db-path`, `MC_PAPERCLIP_DB_PATH`, `$(npm root -g)/paperclipai/node_modules/@paperclipai/db`, `~/.paperclip/cli/current/node_modules/@paperclipai/db` (y variante anidada), y la caché `~/.npm/_npx/*/node_modules/@paperclipai/db`. En el laboratorio: `/home/mc/.npm/_npx/2516d3db5aacea45/node_modules/@paperclipai/db`.
- Llama a `runDatabaseRestore({ connectionString, backupFile, connectTimeoutSeconds })` (firma leída en `backup-lib.ts:39-43,1080` y en el `dist` instalado). Esa función prueba `psql` (`PAPERCLIP_PSQL_PATH` o el del PATH) con `ON_ERROR_STOP=1`; si no existe o falla **y** el volcado tiene marcadores `-- paperclip statement breakpoint`, repite **sentencia a sentencia con el driver `postgres`**. `--no-psql` fuerza ese camino (lo normal en tus equipos, que no traen `psql`). Con `--psql <ruta>` fuerzas un `psql` concreto.
- Al terminar imprime duración y el conteo de filas (`companies`, `agents`, `issues`, `company_secrets`, `heartbeat_runs`).
- Reinicia el servidor y verifica (§6).

Para evitar que el planificador despierte agentes sobre datos a medio restaurar puedes poner `HEARTBEAT_SCHEDULER_ENABLED=false` en el `.env` durante la restauración y quitarlo después **[I]** (en el laboratorio no había trabajo pendiente).

### 5.3 Procedimiento manual con `psql` (alternativa; también ensayado)

Necesitas un `psql` ≥ la versión del servidor embebido (18) — `brew install libpq` en macOS, el instalador de PostgreSQL en Windows, `apt install postgresql-client` en Ubuntu — o `PAPERCLIP_PSQL_PATH`. `psql` no lee `.gz`:
```sh
gunzip -c paperclip-<ts>.sql.gz | psql "postgres://paperclip:paperclip@127.0.0.1:<puerto>/paperclip" --set=ON_ERROR_STOP=1 --quiet --no-psqlrc
```
(en PowerShell: descomprime con `tar -xzf`/7-Zip y usa `psql … -f archivo.sql`). Ensayado en Linux con un `psql` 16 contra el Postgres 18 embebido: `exit 0`, verificación 8/8 [H].

### 5.4 Si solo tienes la base y NO la `master.key`

Los secretos locales cifrados quedan ilegibles (el agente verá un error de descifrado “master key fingerprint …”). Restaura el volcado igualmente, **borra y vuelve a crear** los secretos (`HERMES_API_SERVER_KEY_*`) y rota las claves de los equipos. Si usaste `PAPERCLIP_SECRETS_MASTER_KEY` (variable) en vez de archivo, guarda ese valor en tu gestor de contraseñas.

## 6. Verificación después de restaurar

```sh
node scripts/common/verify-restore.mjs --api http://127.0.0.1:<puertoAPI>/api \
     --issue <uuid de una tarea cerrada> --issue-status done \
     --db-url postgres://paperclip:paperclip@127.0.0.1:<puertoPG>/paperclip \
     --master-key-file <instancia>/secrets/master.key --paperclip-db-path <carpeta de @paperclipai/db>
```
| # | Comprobación | Criterio |
|---|---|---|
| H1 | `GET /api/health` | `status ok`, `version` esperada, `authReady true`, `bootstrapStatus ready` |
| H2 | `GET /api/companies` | aparece “Mission Control — piloto” (en una instancia limpia era `[]`) |
| H3 | `GET /api/companies/{id}/agents` | agentes `hermes_gateway` con `adapterConfig.apiKey.type == "secret_ref"` |
| H4 | `GET /api/companies/{id}/secrets` | están los secretos (sin valores) |
| H5 | `GET /api/companies/{id}/secret-providers/health` | `local_encrypted` `ok`, `keySource: file`, `keyFilePath` = la `master.key` restaurada |
| H6 | `GET /api/issues/{id}` | estado y `completedAt` previos |
| H7 | descifrar cada secreto `local_encrypted` vigente con la `master.key` y comparar `sha256` con el guardado | N/N correctos (**prueba real** de que la clave sirve; no imprime valores) |
| H8 | control negativo: una clave aleatoria **debe fallar** | N/N fallan |
Y a mano: abrir la UI de Paperclip y la de Mission Control, y lanzar una tarea trivial al agente restaurado (comprueba también la clave `API_SERVER_KEY` de Hermes y el `.env`). Sale con código 1 si algo falla.

## 7. Ensayo de restauración (hazlo en tus equipos: V10/V11)

Instancia nueva y desechable en otro directorio y otro puerto (no toques la real):
```sh
PORT=3102 npx -y paperclipai@2026.1005.0 onboard --yes -d ~/paperclip-restore --no-install-service --run     # banner → API y "pg:NNNNN"
curl -s http://127.0.0.1:3102/api/companies            # []   en una instancia limpia
# parar SOLO ese servidor; copiar secrets/master.key, secrets/decision-signing.key y .env de la instancia real; arrancar otra vez
node scripts/common/restore-db.mjs --dump <volcado> --db-url postgres://paperclip:paperclip@127.0.0.1:<pg>/paperclip --no-psql --yes
# reiniciar; node scripts/common/verify-restore.mjs … ; parar el servidor de prueba
```
Resultado en Linux (todo literal en `docs/evidencias/restauracion-lab.md`): 8,4 s para 2515 sentencias, 8/8 comprobaciones, dos veces (motor JS y `psql`), más una copia de la instancia restaurada que contiene la empresa (round-trip). Pendiente en tus equipos: **Windows (WSL2 y nativo) y macOS**, y la restauración cruzada Mac→Windows con volcado lógico (V11).

## 8. Qué no está verificado

- Que `update --version`/`--rollback` funcionen en tu Mac o en WSL2 (nunca se ejecutaron aquí), ni el comportamiento ante el límite de 60 s (F2).
- Cualquier cosa en Windows o macOS: servicio, tarea programada, permisos, `tar.exe`, rutas con espacios, Defender.
- Restauración sobre una instancia con datos reales de producción y una versión distinta de Paperclip.
- `psql` de tu equipo contra el Postgres embebido (en el laboratorio fue `psql` 16 del sistema).
