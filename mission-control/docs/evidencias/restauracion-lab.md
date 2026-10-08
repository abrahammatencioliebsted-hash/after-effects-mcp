---
tipo: evidencia
proyecto: Mission Control
fecha: 2026-10-08
zona_horaria: UTC (el contenedor). CDMX = UTC-6.
entorno: Cloud Linux (Node 24.21.0, paperclipai@2026.1005.0), usuario sin privilegios `mc`
estado: "Restauración completa PROBADA de verdad en Linux. Windows, macOS, Tailscale y un segundo equipo NO."
---

# Prueba de restauración en el laboratorio (copia → instancia nueva → restaurar → verificar)

Todo lo de abajo es **salida literal** de los comandos (sin colores; las animaciones del indicador de progreso y las 292 migraciones listadas se abreviaron donde se indica). Las marcas son UTC. Las claves y tokens no aparecen (los hashes mostrados son del archivo, no el valor).
Qué se probó: que, con **el volcado `.sql.gz` + `secrets/master.key` + `secrets/decision-signing.key` + `.env`** de una instancia viva, otra instancia **nueva y vacía** queda con la misma empresa, agentes (con `apiKey` como `secret_ref`), secretos descifrables y tareas. Servidor vivo (`127.0.0.1:3101`, PG 54329) **no se detuvo en ningún momento** y solo se leyó/volcó.

## Resultado

| # | Comprobación pedida | Resultado |
|---|---|---|
| 1 | `db:backup --json` con el servidor vivo arriba | **PASA** · `paperclip-20261008-083519.sql.gz` · 141 949 bytes (138,6 K) |
| 2 | 2.ª instancia nueva (`PORT=3102`, `-d …/paperclip-restore`), `/api/health` ok, `GET /api/companies` = `[]` | **PASA** · puerto API 3102, **PG 54330** (54329 estaba ocupado por la viva) |
| 3 | Parar solo la 2.ª, copiar `master.key`, `decision-signing.key` y `.env` de la viva (conservando su `config.json`), arrancar, restaurar con `scripts/common/restore-db.mjs` | **PASA** · hashes de los 3 archivos iguales en ambas; `runDatabaseRestore` (motor JS, sin `psql`) terminó en **8,4 s**; filas: companies 1 · agents 2 · issues 4 · company_secrets 3 · heartbeat_runs 8 |
| 4a | `GET /api/companies` lista “Mission Control — piloto” | **PASA** |
| 4b | `GET /api/companies/{id}/agents` lista el agente `hermes_gateway` con `apiKey.type === 'secret_ref'` | **PASA** (2 agentes `hermes_gateway`, ambos `secret_ref`) |
| 4c | `GET /api/companies/{id}/secrets` lista `HERMES_API_SERVER_KEY_LAB` | **PASA** (3 secretos) |
| 4d | `GET /api/companies/{id}/secret-providers/health` reporta el archivo de clave | **PASA** · `local_encrypted` `ok`, `keySource: file`, `keyFilePath` = la `master.key` de la instancia restaurada |
| 4e | `GET /api/issues/00eb23cc-70df-46a9-ac3d-8919f03df99a` es `done` | **PASA** · `MIS-1`, `done`, `completedAt 2026-10-08T08:14:00.888Z` |
| extra | Descifrar los 3 secretos `local_encrypted` con la `master.key` restaurada y comparar `sha256`; control negativo con clave aleatoria | **PASA** · 3/3 correctos; 3/3 fallan con clave aleatoria |
| extra | Restauración **manual con `psql`** (`gunzip -c … \| psql … ON_ERROR_STOP=1`) sobre la misma instancia | **PASA** · `exit 0`; verificación 8/8 otra vez |
| extra | Parar la 2.ª instancia (solo ella); la viva sigue en 200 | **PASA** · directorio dejado en `/home/user/mc-lab/paperclip-restore` |

**Camino que funcionó:** `runDatabaseRestore` exportada por `@paperclipai/db` (`/home/mc/.npm/_npx/2516d3db5aacea45/node_modules/@paperclipai/db`, versión 2026.1005.0), forzando el **motor JavaScript** (`--no-psql`: sentencia a sentencia con el driver `postgres`, usando los 2515 marcadores `-- paperclip statement breakpoint`). No hizo falta el plan B de escribir nuestro propio lector de sentencias. El `psql` manual también funcionó (el contenedor tiene `psql` 16 del sistema; el Postgres embebido **no** trae `psql`).

---

## Paso 1 · Copia con el servidor vivo arriba · 2026-10-08T08:35:16Z → 2026-10-08T08:35:21Z

```text
$ npx -y paperclipai@2026.1005.0 db:backup --json -d /home/user/mc-lab/paperclip-data      # como usuario mc
```
```text

  ───────────────────────────────────────────────────────
  The app people use to manage AI agents for work

T   paperclip db:backup 
|
|  Config: /home/user/mc-lab/paperclip-data/instances/default/config.json
|
|  Connection source: embedded-postgres@54329
|
|  Backup dir: /home/user/mc-lab/paperclip-data/instances/default/data/backups
|
|  Retention: 30 day(s)
|
[…fotogramas del indicador de progreso omitidos…]  Backup saved: /home/user/mc-lab/paperclip-data/instances/default/data/backups/paperclip-20261008-083519.sql.gz (138.6K)
{
  "backupFile": "/home/user/mc-lab/paperclip-data/instances/default/data/backups/paperclip-20261008-083519.sql.gz",
  "sizeBytes": 141949,
  "prunedCount": 0,
  "backupDir": "/home/user/mc-lab/paperclip-data/instances/default/data/backups",
  "retentionDays": 30,
  "connectionSource": "embedded-postgres@54329"
}
|
—  Backup completed.

exit=0
```

```text
$ ls -la /home/user/mc-lab/paperclip-data/instances/default/data/backups
-rw-rw-r-- 1 mc mc 141949 Oct  8 08:35 paperclip-20261008-083519.sql.gz
$ sha256sum (copia de trabajo en /home/user/mc-lab/restore-proof/)
80069e2fed300e1ddc43fc66b44413a2f040fc17ff5da9fc8d49c111a2fc8859  paperclip-20261008-083519.sql.gz
$ zcat paperclip-20261008-083519.sql.gz | head -4
-- Paperclip database backup
-- Created: 2026-10-08T08:35:19.689Z

BEGIN;
$ zcat … | grep -c "paperclip statement breakpoint"
2515
```

## Paso 2 · Segunda instancia, nueva y vacía · 2026-10-08T08:35:27Z

```text
$ rm -rf /home/user/mc-lab/paperclip-restore
$ PORT=3102 PAPERCLIP_NO_BROWSER=1 nohup npx -y paperclipai@2026.1005.0 onboard --yes -d /home/user/mc-lab/paperclip-restore --no-install-service --run > /home/user/mc-lab/logs/paperclip-restore.log 2>&1 &     # como usuario mc
```
Extracto del log (`/home/user/mc-lab/logs/paperclip-restore-arranque1.log`):
```text
o  Starting Paperclip server...
[08:35:40] WARN: Embedded PostgreSQL port is in use; using next free port (requestedPort=54329, selectedPort=54330)
[08:35:40] INFO: Using embedded PostgreSQL because no DATABASE_URL set (dataDir=/home/user/mc-lab/paperclip-restore/instances/default/db, port=54330)
[08:35:41] INFO: Created embedded PostgreSQL database: paperclip
[08:35:41] INFO: Detected first-run embedded PostgreSQL setup; applying pending migrations automatically
[08:35:41] INFO: Applying 292 pending migrations for Embedded PostgreSQL {"pendingMigrations":[… 292 migraciones …]}
[08:35:45] INFO: Embedded PostgreSQL ready
[08:35:45] INFO: Setup-token login confidential transport startup assessment {"proxyForwardingEnabled":false,"reason":"no_proxy_allowlist_local_trusted_loopback_only","deploymentMode":"local_trusted"}
[08:35:46] INFO: plugin job coordinator started — listening to lifecycle events {"service":"plugin-job-coordinator"}
[08:35:46] INFO: plugin job scheduler started {"service":"plugin-job-scheduler","tickIntervalMs":30000,"maxConcurrentJobs":10}
[08:35:46] INFO: initializing plugin tool dispatcher {"service":"plugin-tool-dispatcher"}
[08:35:46] INFO: plugin-dev-watcher: initialized {"service":"plugin-dev-watcher","resolvesInstalledPlugins":true}
[08:35:46] INFO: Server listener bound on 127.0.0.1:3102; startup recovery in progress
[08:35:46] INFO: loaded tools from ready plugins {"service":"plugin-tool-dispatcher","readyPlugins":0,"registeredTools":0}
[08:35:46] DEBUG: subscribed to lifecycle events {"service":"plugin-tool-dispatcher"}
[08:35:46] INFO: plugin tool dispatcher initialized {"service":"plugin-tool-dispatcher","totalTools":0}
[08:35:46] INFO: bundled plugin bundle not present; skipping auto-install {"pluginKey":"paperclip.kubernetes-sandbox-provider","pluginPath":"/app/packages/plugins/sandbox-providers/kubernetes"}
[08:35:46] INFO: plugin-loader: loading all ready plugins {"service":"plugin-loader"}
[08:35:46] INFO: plugin-loader: no ready plugins to load {"service":"plugin-loader"}
[08:35:46] INFO: worktree run-execution cutoff state {"state":"disarmed","cutoff":null}
[08:35:46] INFO: startup reap of orphaned heartbeat runs complete {"reaped":0,"runIds":[]}

  ───────────────────────────────────────────────────────
Mode             embedded-postgres  |  static-ui
Deploy           local_trusted (private)
Bind             loopback (127.0.0.1)
Auth             ready
Server           3102
API              http://127.0.0.1:3102/api (health: http://127.0.0.1:3102/api/health)
UI               http://127.0.0.1:3102
Database         /home/user/mc-lab/paperclip-restore/instances/default/db (pg:54330)
Migrations       applied (pending migrations)
Agent JWT        set
Heartbeat        enabled (30000ms)
DB Backup        enabled (every 60m, keep 30d)
Backup Dir       /home/user/mc-lab/paperclip-restore/instances/default/data/backups
Config           /home/user/mc-lab/paperclip-restore/instances/default/config.json
  ───────────────────────────────────────────────────────

[08:35:46] INFO: Automatic database backups enabled {"intervalMinutes":60,"retentionSource":"instance-settings-db","backupDir":"/home/user/mc-lab/paperclip-restore/instances/default/data/backups"}
[08:35:46] INFO: Server startup recovery complete on 127.0.0.1:3102
[telemetry] dropping batch 0ddcbf50883425d9f986cf9f01749cd6 after 5 attempt(s); 2 event(s) lost
[08:36:08] INFO: graceful heartbeat run drain complete {"signal":"SIGTERM","drain":{"interrupted":0,"interruptedRunIds":[],"retryRunIds":[],"restartSuspendedRunIds":[]}}
[08:36:08] INFO: plugin job scheduler stopped {"service":"plugin-job-scheduler","activeJobCount":0}
[08:36:08] INFO: plugin job coordinator stopped {"service":"plugin-job-coordinator"}
[08:36:08] INFO: Stopping embedded PostgreSQL {"signal":"SIGTERM"}
```

```text
$ curl -s http://127.0.0.1:3102/api/health   (UTC 2026-10-08T08:36:00Z, recortado)
{"status":"ok","version":"2026.1005.0","serverVersion":"2026.1005.0","commit":"467125fafb47a8520856504fecc48d6e32055db1","deploymentMode":"local_trusted","deploymentExposure":"private","localAiLoginSupported":true,"authReady":true,"bootstrapStatus":"ready",…
$ curl -s -w ' [HTTP %{http_code}]\n' http://127.0.0.1:3102/api/companies
[] [HTTP 200]
$ cat /home/user/mc-lab/paperclip-restore/instances/default/runtime-info.json
{ "schemaVersion": 1, "instanceId": "default", "pid": 18871, "host": "127.0.0.1", "port": 3102, … }
$ ps -u mc -o pid,ppid,cmd | grep paperclip-restore
18852     1 npm exec paperclipai@2026.1005.0 onboard --yes -d /home/user/mc-lab/paperclip-restore --no-install-service --run
18870 18852 sh -c 'paperclipai' onboard --yes -d /home/user/mc-lab/paperclip-restore --no-install-service --run
18871 18870 node …/node_modules/.bin/paperclipai onboard --yes -d /home/user/mc-lab/paperclip-restore --no-install-service --run
19117 18871 …/@embedded-postgres/linux-x64/native/bin/postgres -D /home/user/mc-lab/paperclip-restore/instances/default/db -p 54330
```
Dato clave: el `config.json` de esta instancia dice `embeddedPostgresPort: 54329`, pero el Postgres real escucha en **54330** (la viva ocupa 54329). Un `db:backup` contra esta instancia habría conectado a la base **viva** (hallazgo F4); por eso `backup-full.mjs` ahora lo detecta (ver “Extra 3”).

## Paso 3 · Parar SOLO la 2.ª, copiar claves y `.env`, restaurar

```text
2026-10-08T08:36:08Z
== antes de parar: secrets de la instancia nueva (hash, antes de sobrescribir)
total 16
drwx------ 2 mc mc 4096 Oct  8 08:35 .
drwxrwxr-x 7 mc mc 4096 Oct  8 08:35 ..
-rw------- 1 mc mc   44 Oct  8 08:35 decision-signing.key
-rw------- 1 mc mc   44 Oct  8 08:35 master.key
f96bf3c57151af640776d3ebf05209c8840d90a107ebf94a6e94956bba3abd78  …/master.key
9124b5875ad4b3b6a74426e3b4e02e69cddf1b5a34fe73c8883c59b7543e593e  …/master.key
== SIGTERM al servidor de la 2a instancia (PID 18871)
tras 1 s:
(sin procesos de paperclip-restore)
== vivo sigue arriba:
 4980 npm exec paperclipai@2026.1005.0 onboard --yes -d /home/user/mc-lab/paperclip-data --no-install-service --run
 5621 sh -c 'paperclipai' onboard --yes -d /home/user/mc-lab/paperclip-data --no-install-service --run
 5622 node /home/mc/.npm/_npx/2516d3db5aacea45/node_modules/.bin/paperclipai onboard --yes -d /home/user/mc-lab/paperclip-data --no-install-service --run
{"status":"ok","version":"2026.1005.0","serverVersion":"2026.1005.0","commit":"4
```
(En esa salida el `sed` acortó las rutas; la primera línea de hash es la `master.key` **nueva y distinta** de la 2.ª instancia —antes de sobrescribirla—, la segunda es la de la viva.)

```text
2026-10-08T08:36:20Z
== claves (solo nombres) del .env vivo y del nuevo
# Paperclip environment variables
# Generated by Paperclip CLI commands
PAPERCLIP_AGENT_JWT_SECRET=<oculto>
PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=<oculto>
--
# Paperclip environment variables
# Generated by Paperclip CLI commands
PAPERCLIP_AGENT_JWT_SECRET=<oculto>
PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=<oculto>
== copia (como mc, cp -p)
copiado
== sha256 vivo vs nuevo
secrets/master.key  vivo=9124b5875ad4b3b6  nuevo=9124b5875ad4b3b6
secrets/decision-signing.key  vivo=94db698cc5d6b471  nuevo=94db698cc5d6b471
.env  vivo=584d8bcda34ef4f7  nuevo=584d8bcda34ef4f7
-rw------- 1 mc mc  266 Oct  8 07:56 /home/user/mc-lab/paperclip-restore/instances/default/.env

/home/user/mc-lab/paperclip-restore/instances/default/secrets:
total 16
drwx------ 2 mc mc 4096 Oct  8 08:35 .
drwxrwxr-x 7 mc mc 4096 Oct  8 08:36 ..
-rw------- 1 mc mc   44 Oct  8 07:56 decision-signing.key
-rw------- 1 mc mc   44 Oct  8 07:56 master.key
1c1
< {'mode': 'embedded-postgres', 'embeddedPostgresDataDir': '/home/user/mc-lab/paperclip-data/instances/default/db', 'embeddedPostgresPort': 54329, 'backup': {'enabled': True, 'intervalMinutes': 60, 'retentionDays': 30, 'dir': '/home/user/mc-lab/paperclip-data/instances/default/data/backups'}} {'deploymentMode': 'local_trusted', 'exposure': 'private', 'bind': 'loopback', 'host': '127.0.0.1', 'port': 3100, 'allowedHostnames': [], 'serveUi': True}
---
> {'mode': 'embedded-postgres', 'embeddedPostgresDataDir': '/home/user/mc-lab/paperclip-restore/instances/default/db', 'embeddedPostgresPort': 54329, 'backup': {'enabled': True, 'intervalMinutes': 60, 'retentionDays': 30, 'dir': '/home/user/mc-lab/paperclip-restore/instances/default/data/backups'}} {'deploymentMode': 'local_trusted', 'exposure': 'private', 'bind': 'loopback', 'host': '127.0.0.1', 'port': 3102, 'allowedHostnames': [], 'serveUi': True}
```

Dry-run del script (`--paperclip-db-path /home/mc/.npm/_npx/2516d3db5aacea45/node_modules/@paperclipai/db`), luego sin `--yes` (código 2) y con `--yes`.
*Nota de honestidad:* la primera ejecución del dry-run (08:37:39Z) usó un borrador del script que contaba mal los marcadores (2513 en vez de 2515, por partir un marcador entre dos trozos de lectura) y mostraba un falso aviso de “volcado truncado”; se corrigió antes de la restauración real. Abajo, el dry-run repetido con la versión final del script:
```text
2026-10-08T09:01:03Z
$ node restore-db.mjs --dump paperclip-20261008-083519.sql.gz --db-url postgres://paperclip:paperclip@127.0.0.1:54330/paperclip --paperclip-db-path … --no-psql --dry-run   (versión final del script; la 2.ª instancia está parada: --dry-run no se conecta)
== Mission Control · restaurar base de Paperclip ==
Node            : v24.21.0 (linux)
Versión Paperclip esperada del paquete: 2026.1005.0
Volcado         : /home/user/mc-lab/restore-proof/paperclip-20261008-083519.sql.gz (141949 bytes)
Destino         : postgres://paperclip:***@127.0.0.1:54330/paperclip
Paquete db      : /home/mc/.npm/_npx/2516d3db5aacea45/node_modules/@paperclipai/db  [origen: --paperclip-db-path]
Versión @paperclipai/db: 2026.1005.0
Volcado descomprimido: 1214779 bytes · 2515 marcadores "statement breakpoint"
Cabecera        : -- Paperclip database backup | -- Created: 2026-10-08T08:35:19.689Z
Cierre          : termina en COMMIT (volcado completo)
psql            : "/home/mc/.mc-psql-inexistente" no disponible — runDatabaseRestore usará el motor JavaScript (driver postgres) con los marcadores
Comando equivalente manual: gunzip -c <dump> | psql "<db-url>" --set=ON_ERROR_STOP=1 --quiet --no-psqlrc

[--dry-run] No se tocó nada.
exit=0
```

```text
### Sin --yes: código de salida
exit=2
```

```text
### Con --yes --no-psql (motor JavaScript)
2026-10-08T08:38:00Z
== Mission Control · restaurar base de Paperclip ==
Node            : v24.21.0 (linux)
Versión Paperclip esperada del paquete: 2026.1005.0
Volcado         : /home/user/mc-lab/restore-proof/paperclip-20261008-083519.sql.gz (141949 bytes)
Destino         : postgres://paperclip:***@127.0.0.1:54330/paperclip
Paquete db      : /home/mc/.npm/_npx/2516d3db5aacea45/node_modules/@paperclipai/db  [origen: --paperclip-db-path]
Versión @paperclipai/db: 2026.1005.0
Volcado descomprimido: 1214779 bytes · 2515 marcadores "statement breakpoint"
Cabecera        : -- Paperclip database backup | -- Created: 2026-10-08T08:35:19.689Z
Cierre          : termina en COMMIT (volcado completo)
psql            : "/home/mc/.mc-psql-inexistente" no disponible — runDatabaseRestore usará el motor JavaScript (driver postgres) con los marcadores
Comando equivalente manual: gunzip -c <dump> | psql "<db-url>" --set=ON_ERROR_STOP=1 --quiet --no-psqlrc
Warning: Ignoring extra certs from `/root/.ccr/ca-bundle.crt`, load failed: error:8000000D:system library::Permission denied

> runDatabaseRestore({ connectionString: postgres://paperclip:***@127.0.0.1:54330/paperclip, backupFile: paperclip-20261008-083519.sql.gz, connectTimeoutSeconds: 5 })
Restauración terminada en 8.4 s.
Filas tras restaurar: {"companies":1,"agents":2,"issues":4,"company_secrets":3,"heartbeat_runs":8}

Siguiente paso: reiniciar el servidor de Paperclip y comprobar /api/health, /api/companies y los secretos (ver docs/04-runbooks/actualizar-y-restaurar.md).
exit=0
2026-10-08T08:38:10Z
```

## Paso 4 · Reiniciar y verificar

```text
2026-10-08T08:38:22Z
== reinicio: SIGTERM al servidor de la 2a instancia (PID 19808)
parado tras ~1s
(2a instancia detenida)
health tras ~12 s
2026-10-08T08:38:35Z
```
Extracto del log del segundo arranque (`…/paperclip-restore-arranque2.log`):
```text
o  Starting Paperclip server...
[08:36:35] WARN: Embedded PostgreSQL port is in use; using next free port (requestedPort=54329, selectedPort=54330)
[08:36:35] INFO: Using embedded PostgreSQL because no DATABASE_URL set (dataDir=/home/user/mc-lab/paperclip-restore/instances/default/db, port=54330)
[08:36:35] INFO: Embedded PostgreSQL cluster already exists (/home/user/mc-lab/paperclip-restore/instances/default/db/PG_VERSION); skipping init
[08:36:35] INFO: Embedded PostgreSQL ready
[08:36:35] INFO: Setup-token login confidential transport startup assessment {"proxyForwardingEnabled":false,"reason":"no_proxy_allowlist_local_trusted_loopback_only","deploymentMode":"local_trusted"}
[08:36:35] INFO: plugin job coordinator started — listening to lifecycle events {"service":"plugin-job-coordinator"}
[08:36:35] INFO: plugin job scheduler started {"service":"plugin-job-scheduler","tickIntervalMs":30000,"maxConcurrentJobs":10}
[08:36:35] INFO: initializing plugin tool dispatcher {"service":"plugin-tool-dispatcher"}
[08:36:35] INFO: plugin-dev-watcher: initialized {"service":"plugin-dev-watcher","resolvesInstalledPlugins":true}
[08:36:35] INFO: Server listener bound on 127.0.0.1:3102; startup recovery in progress
[08:36:35] INFO: bundled plugin bundle not present; skipping auto-install {"pluginKey":"paperclip.kubernetes-sandbox-provider","pluginPath":"/app/packages/plugins/sandbox-providers/kubernetes"}
[08:36:35] INFO: plugin-loader: loading all ready plugins {"service":"plugin-loader"}
[08:36:35] INFO: loaded tools from ready plugins {"service":"plugin-tool-dispatcher","readyPlugins":0,"registeredTools":0}
[08:36:35] DEBUG: subscribed to lifecycle events {"service":"plugin-tool-dispatcher"}
[08:36:35] INFO: plugin tool dispatcher initialized {"service":"plugin-tool-dispatcher","totalTools":0}
[08:36:35] INFO: plugin-loader: no ready plugins to load {"service":"plugin-loader"}
[08:36:35] INFO: worktree run-execution cutoff state {"state":"disarmed","cutoff":null}
[08:36:36] INFO: startup reap of orphaned heartbeat runs complete {"reaped":0,"runIds":[]}

  ───────────────────────────────────────────────────────
Mode             embedded-postgres  |  static-ui
Deploy           local_trusted (private)
Bind             loopback (127.0.0.1)
Auth             ready
Server           3102
API              http://127.0.0.1:3102/api (health: http://127.0.0.1:3102/api/health)
UI               http://127.0.0.1:3102
Database         /home/user/mc-lab/paperclip-restore/instances/default/db (pg:54330)
Migrations       already applied
Agent JWT        set
Heartbeat        enabled (30000ms)
DB Backup        enabled (every 60m, keep 30d)
Backup Dir       /home/user/mc-lab/paperclip-restore/instances/default/data/backups
Config           /home/user/mc-lab/paperclip-restore/instances/default/config.json
  ───────────────────────────────────────────────────────

[08:36:36] INFO: Automatic database backups enabled {"intervalMinutes":60,"retentionSource":"instance-settings-db","backupDir":"/home/user/mc-lab/paperclip-restore/instances/default/data/backups"}
[08:36:36] INFO: Server startup recovery complete on 127.0.0.1:3102
[08:38:03] ERROR: Failed to reconcile chat publications {"lane":"publications"}
    err: { "type": "DrizzleQueryError", "message": "Failed query: select \"chat_actions\".\"id\", … from \"chat_actions\" where … " , … }
    [… traza y consulta SQL recortadas (≈5 000 caracteres); ver el log completo en /home/user/mc-lab/logs/paperclip-restore-arranque2.log …]
```

**Observación operativa (única línea ERROR del log):** a las 08:38:03, en plena restauración (08:38:00–08:38:10), una tarea de fondo del servidor (`reconcile chat publications`) falló al consultar `chat_actions` porque la tabla estaba siendo borrada y recreada **con el servidor en marcha**. Fue transitorio (una sola vez, el servidor siguió sano y se reinició después), pero confirma la recomendación de `actualizar-y-restaurar.md` §5.2: restaurar con el servidor arriba solo porque el Postgres embebido lo exige, sin tráfico ni trabajo pendiente, y reiniciar al terminar (opcionalmente con `HEARTBEAT_SCHEDULER_ENABLED=false` durante la restauración).

Llamadas literales a la API de la instancia restaurada (`127.0.0.1:3102`):
```text
2026-10-08T08:39:41Z
$ curl -s http://127.0.0.1:3102/api/companies   (campos id,name,issuePrefix)
[{"id": "b0d4c18c-7069-499f-8879-26cdc29738dc", "name": "Mission Control — piloto", "issuePrefix": "MIS", "status": "active"}]
$ curl -s http://127.0.0.1:3102/api/companies/b0d4c18c-7069-499f-8879-26cdc29738dc/agents   (id,name,adapterType,status,adapterConfig.apiKey)
[
 {
  "id": "5bdd4ae7-fe3c-40a2-a34e-fdd37c623926",
  "name": "Ejecutor Hermes (lab)",
  "adapterType": "hermes_gateway",
  "status": "idle",
  "apiKey": {
   "type": "secret_ref",
   "secretId": "10c5a67c-00d2-45f8-b5a6-af3490e504b1",
   "version": "latest",
   "projectionClass": "unclassified",
   "projectionAllowlistKey": null
  }
 },
 {
  "id": "5abca212-ec5a-4baa-9767-b67e77defeca",
  "name": "[e2e] Ejecutor Hermes 08-31-13",
  "adapterType": "hermes_gateway",
  "status": "paused",
  "apiKey": {
   "type": "secret_ref",
   "secretId": "82cb5705-3c1c-4243-9f19-26d9228ac1b5",
   "version": "latest",
   "projectionClass": "unclassified",
   "projectionAllowlistKey": null
  }
 }
]
$ curl -s http://127.0.0.1:3102/api/companies/b0d4c18c-7069-499f-8879-26cdc29738dc/secrets   (id,name,provider,latestVersion)
[
 {
  "id": "e8528cf6-9560-4259-b183-0d0c8f5f3dfc",
  "name": "AUTO_TEST_SECRET_PCC",
  "provider": "local_encrypted",
  "latestVersion": 1
 },
 {
  "id": "82cb5705-3c1c-4243-9f19-26d9228ac1b5",
  "name": "HERMES_API_SERVER_KEY_E2E_2026-10-08T08-31-13-832Z",
  "provider": "local_encrypted",
  "latestVersion": 1
 },
 {
  "id": "10c5a67c-00d2-45f8-b5a6-af3490e504b1",
  "name": "HERMES_API_SERVER_KEY_LAB",
  "provider": "local_encrypted",
  "latestVersion": 1
 }
]
$ curl -s http://127.0.0.1:3102/api/companies/b0d4c18c-7069-499f-8879-26cdc29738dc/secret-providers/health   (proveedor local_encrypted)
{
 "provider": "local_encrypted",
 "status": "ok",
 "message": "Local encrypted provider configured with key file /home/user/mc-lab/paperclip-restore/instances/default/secrets/master.key",
 "warnings": [],
 "backupGuidance": [
  "Back up the key file together with database backups.",
  "The database alone cannot restore local encrypted secret values."
 ],
 "details": {
  "keySource": "file",
  "keyFilePath": "/home/user/mc-lab/paperclip-restore/instances/default/secrets/master.key"
 }
}
$ curl -s http://127.0.0.1:3102/api/issues/00eb23cc-70df-46a9-ac3d-8919f03df99a   (identifier,status,completedAt,title)
{"identifier": "MIS-1", "status": "done", "completedAt": "2026-10-08T08:14:00.888Z", "title": "Recorrido piloto 01: solicitud → asignación → ejecución → revisión → resultado", "reviewPolicy": "human_only"}
$ comentarios de MIS-1
user | [Operador humano] Revisado y aceptado. Recorrido piloto 01 completado: solicitud (MIS-1) → asignación (wake au
user | [Operador humano] Resultado recibido del ejecutor Hermes (marca MC-STUB-OK). Paso a revisión. El agente no mov
system | Paperclip exhausted the bounded original-owner disposition repair without a durable source-state change.  - At
agent | Respuesta del MODELO SIMULADO (stub). Petición recibida con 9111 caracteres. No se ejecutó ninguna acción exte
agent | Respuesta del MODELO SIMULADO (stub). Petición recibida con 8654 caracteres. No se ejecutó ninguna acción exte
agent | Respuesta del MODELO SIMULADO (stub). Petición recibida con 3650 caracteres. No se ejecutó ninguna acción exte
```

Verificación con `scripts/common/verify-restore.mjs` (incluye el descifrado real de los secretos):
```text
2026-10-08T08:39:29Z
$ GET sobre 3102 (instancia restaurada) con verify-restore.mjs
PASA   H1  GET /health — HTTP 200; status=ok; version=2026.1005.0; authReady=true; bootstrapStatus=ready
PASA   H2  empresa "Mission Control — piloto" listada — HTTP 200; 1 empresa(s): Mission Control — piloto
PASA   H3  agente(s) hermes_gateway con apiKey.type === "secret_ref" — Ejecutor Hermes (lab) [idle] apiKey.type=secret_ref ; [e2e] Ejecutor Hermes 08-31-13 [paused] apiKey.type=secret_ref
PASA   H4  secreto HERMES_API_SERVER_KEY_LAB listado — 3 secreto(s): AUTO_TEST_SECRET_PCC | HERMES_API_SERVER_KEY_E2E_2026-10-08T08-31-13-832Z | HERMES_API_SERVER_KEY_LAB
PASA   H5  secret-providers/health: local_encrypted ok con archivo de clave — status=ok; keySource=file; keyFilePath=/home/user/mc-lab/paperclip-restore/instances/default/secrets/master.key
PASA   H6  tarea 00eb23cc-70df-46a9-ac3d-8919f03df99a en estado done — HTTP 200; MIS-1; status=done; completedAt=2026-10-08T08:14:00.888Z
PASA   H7  secretos local_encrypted se descifran con la master.key restaurada (sha256 coincide) — 3/3 correctos
PASA   H8  control negativo: con una clave aleatoria el descifrado FALLA — 3/3 fallaron como se esperaba

Resumen: 8/8 comprobaciones correctas.
exit=0
```

Camino manual con `psql` sobre la misma instancia, y verificación otra vez:
```text
2026-10-08T08:39:48Z
$ gunzip -c paperclip-20261008-083519.sql.gz | psql "postgres://paperclip:paperclip@127.0.0.1:54330/paperclip" --set=ON_ERROR_STOP=1 --quiet --no-psqlrc
 setval 
--------
    292
(1 row)

 setval 
--------
      1
(1 row)

 setval 
--------
     33
(1 row)

psql exit=0
2026-10-08T08:39:52Z
$ verify-restore.mjs (después del restore manual con psql)
PASA   H1  GET /health — HTTP 200; status=ok; version=2026.1005.0; authReady=true; bootstrapStatus=ready
PASA   H2  empresa "Mission Control — piloto" listada — HTTP 200; 1 empresa(s): Mission Control — piloto
PASA   H3  agente(s) hermes_gateway con apiKey.type === "secret_ref" — Ejecutor Hermes (lab) [idle] apiKey.type=secret_ref ; [e2e] Ejecutor Hermes 0
PASA   H4  secreto HERMES_API_SERVER_KEY_LAB listado — 3 secreto(s): AUTO_TEST_SECRET_PCC | HERMES_API_SERVER_KEY_E2E_2026-10-08T08-31-13-832Z | HER
PASA   H5  secret-providers/health: local_encrypted ok con archivo de clave — status=ok; keySource=file; keyFilePath=/home/user/mc-lab/paperclip-res
PASA   H6  tarea 00eb23cc-70df-46a9-ac3d-8919f03df99a en estado done — HTTP 200; MIS-1; status=done; completedAt=2026-10-08T08:14:00.888Z
PASA   H7  secretos local_encrypted se descifran con la master.key restaurada (sha256 coincide) — 3/3 correctos
PASA   H8  control negativo: con una clave aleatoria el descifrado FALLA — 3/3 fallaron como se esperaba

Resumen: 8/8 comprobaciones correctas.
exit=0
```

Parada de la 2.ª instancia (y solo de ella) y estado final:
```text
2026-10-08T08:40:01Z
PID del servidor de la 2a instancia (runtime-info.json): 21192
  PID CMD
21192 node /home/mc/.npm/_npx/2516d3db5aacea45/node_modules/.bin/paperclipai onboard --yes -d /home/user/mc-lab/paperclip-restore --no-install-service --run
detenido tras ~1s
== procesos de mc que quedan:
 4980 npm exec paperclipai@2026.1005.0 onboard --yes -d /home/user/mc-lab/paperclip-data --no-install-service --run
 5621 sh -c 'paperclipai' onboard --yes -d /home/user/mc-lab/paperclip-data --no-install-service --run
 5622 node /home/mc/.npm/_npx/2516d3db5aacea45/node_modules/.bin/paperclipai onboard --yes -d /home/user/mc-lab/paperclip-data --no-install-service --run
 5653 /home/mc/.npm/_npx/2516d3db5aacea45/node_modules/@embedded-postgres/linux-x64/native/bin/postgres -D /home/user/mc-lab/paperclip-data/instances/default/db -p 54329
 5670 postgres: paperclip paperclip 127.0.0.1(34566) idle
 5675 postgres: paperclip paperclip 127.0.0.1(34594) idle
 5676 postgres: paperclip paperclip 127.0.0.1(34606) idle
 5677 postgres: paperclip paperclip 127.0.0.1(34620) idle
 5772 npm exec paperclipai@2026.1005.0 onboard --yes -d /home/user/mc-lab/paperclip-data --no-install-service --run
 5785 sh -c 'paperclipai' onboard --yes -d /home/user/mc-lab/paperclip-data --no-install-service --run
 5786 node /home/mc/.npm/_npx/2516d3db5aacea45/node_modules/.bin/paperclipai onboard --yes -d /home/user/mc-lab/paperclip-data --no-install-service --run
 5827 postgres: paperclip paperclip 127.0.0.1(54948) idle
 5828 postgres: paperclip paperclip 127.0.0.1(54958) idle
 5830 postgres: paperclip paperclip 127.0.0.1(54976) idle
 5831 postgres: paperclip paperclip 127.0.0.1(54986) idle
 5832 postgres: paperclip paperclip 127.0.0.1(54994) idle
 5833 postgres: paperclip paperclip 127.0.0.1(55006) idle
 5834 postgres: paperclip paperclip 127.0.0.1(55018) idle
 5835 postgres: paperclip paperclip 127.0.0.1(55034) idle
 5836 postgres: paperclip paperclip 127.0.0.1(55042) idle
14438 postgres: paperclip paperclip 127.0.0.1(32946) idle
14512 postgres: paperclip paperclip 127.0.0.1(48482) idle
16473 postgres: paperclip paperclip 127.0.0.1(35472) idle
16755 postgres: paperclip paperclip 127.0.0.1(39158) idle
21011 postgres: paperclip paperclip 127.0.0.1(47700) idle
21710 postgres: paperclip paperclip 127.0.0.1(49294) idle
21782 postgres: paperclip paperclip 127.0.0.1(58206) idle
== 3101 (vivo):
{"status":"ok","version":"2026.1005.0","serverVersion":"2026.1005.0","commit":"467125fafb47a8520856504fecc48d6e32055db1"
== 3102:
[HTTP 000]
(sin respuesta, correcto)
== directorio dejado para inspección:
config.json
data
db
logs
secrets
telemetry
```

---

## Extra 1 · `backup-full.mjs` sobre la instancia viva · 2026-10-08T08:41Z
```text
2026-10-08T08:41:00Z
== Mission Control · copia completa de Paperclip ==
Raíz de datos : /home/user/mc-lab/paperclip-data
Instancia     : default (/home/user/mc-lab/paperclip-data/instances/default)
Se incluirán  : instances/default/secrets, instances/default/.env, instances/default/config.json, instances/default/data/storage, instances/default/workspaces, instances/default/companies
No existen (se omiten): instances/default/projects, context.json
> npx -y paperclipai@2026.1005.0 db:backup --json -d /home/user/mc-lab/paperclip-data
Volcado creado: /home/user/mc-lab/paperclip-data/instances/default/data/backups/paperclip-20261008-084103.sql.gz (156251 bytes)
> tar -czf /home/user/mc-lab/restore-proof/backups/mc-backup-default-20261008T084105Z.tar.gz -C /tmp/mc-backup-BmRbj1 MANIFEST.json -C /home/user/mc-lab/paperclip-data instances/default/secrets instances/default/.env instances/default/config.json instances/default/data/storage instances/default/workspaces instances/default/companies instances/default/data/backups/paperclip-20261008-084103.sql.gz

Archivo       : /home/user/mc-lab/restore-proof/backups/mc-backup-default-20261008T084105Z.tar.gz
Tamaño        : 157931 bytes · 15 entradas
SHA-256       : 189f8a253f8367f32399a5a2a7128e77bd23267f185f391d2ab9e3f1bb207405
AVISO: este archivo contiene la master.key y el .env. Guárdalo cifrado y fuera del equipo (nunca en el repositorio).
exit=0
```
El archivo (157 931 bytes, 15 entradas) lleva `MANIFEST.json`, el volcado, `secrets/` (las dos claves), `.env`, `config.json`, `data/storage`, `workspaces` y `companies`.

## Extra 2 · `restore-files.mjs` (plan, negativa sin `--yes`, aplicar) en un directorio de prueba
```text
2026-10-08T08:41:32Z
> tar -xzf /home/user/mc-lab/restore-proof/backups/mc-backup-default-20261008T084105Z.tar.gz -C /tmp/mc-restore-mjPW5m
== Mission Control · restaurar archivos ==
Copia         : mc-backup-default-20261008T084105Z.tar.gz (formato mc-backup-v1, creada 2026-10-08T08:41:05.406Z en vm/linux)
Instancia origen "default" → destino "default" en /home/user/mc-lab/restore-proof/target-files-test
Volcado       : instances/default/data/backups/paperclip-20261008-084103.sql.gz (156251 bytes, sha256 coincide)
  (se conserva el config.json del destino; usa --include-config para sobrescribirlo)
  crea        instances/default/secrets
  crea        instances/default/.env
  crea        instances/default/data/storage
  crea        instances/default/workspaces
  crea        instances/default/companies
  crea        instances/default/data/backups/paperclip-20261008-084103.sql.gz

[--dry-run] No se tocó nada.
exit=0
> tar -xzf /home/user/mc-lab/restore-proof/backups/mc-backup-default-20261008T084105Z.tar.gz -C /tmp/mc-restore-CVUId3
== Mission Control · restaurar archivos ==
Copia         : mc-backup-default-20261008T084105Z.tar.gz (formato mc-backup-v1, creada 2026-10-08T08:41:05.406Z en vm/linux)
Instancia origen "default" → destino "default" en /home/user/mc-lab/restore-proof/target-files-test
Volcado       : instances/default/data/backups/paperclip-20261008-084103.sql.gz (156251 bytes, sha256 coincide)
  (se conserva el config.json del destino; usa --include-config para sobrescribirlo)
  crea        instances/default/secrets
  crea        instances/default/.env
  crea        instances/default/data/storage
  crea        instances/default/workspaces
  crea        instances/default/companies
  crea        instances/default/data/backups/paperclip-20261008-084103.sql.gz

PASO DESTRUCTIVO: vuelve a ejecutar con --yes para aplicar el plan.
exit sin --yes=2
> tar -xzf /home/user/mc-lab/restore-proof/backups/mc-backup-default-20261008T084105Z.tar.gz -C /tmp/mc-restore-GQg5az
== Mission Control · restaurar archivos ==
Copia         : mc-backup-default-20261008T084105Z.tar.gz (formato mc-backup-v1, creada 2026-10-08T08:41:05.406Z en vm/linux)
Instancia origen "default" → destino "default" en /home/user/mc-lab/restore-proof/target-files-test
Volcado       : instances/default/data/backups/paperclip-20261008-084103.sql.gz (156251 bytes, sha256 coincide)
  (se conserva el config.json del destino; usa --include-config para sobrescribirlo)
  crea        instances/default/secrets
  crea        instances/default/.env
  crea        instances/default/data/storage
  crea        instances/default/workspaces
  crea        instances/default/companies
  crea        instances/default/data/backups/paperclip-20261008-084103.sql.gz
  copiado instances/default/secrets
  copiado instances/default/.env
  copiado instances/default/data/storage
  copiado instances/default/workspaces
  copiado instances/default/companies

Volcado listo para restore-db.mjs: /home/user/mc-lab/restore-proof/target-files-test/instances/default/data/backups/paperclip-20261008-084103.sql.gz
Tamaño: 156251 bytes
exit=0

instances/default/.env
instances/default/data/backups/paperclip-20261008-084103.sql.gz
instances/default/secrets/decision-signing.key
instances/default/secrets/master.key
total 16
drwx------ 2 root root 4096 Oct  8 08:41 .
drwxr-xr-x 6 root root 4096 Oct  8 08:41 ..
-rw------- 1 root root   44 Oct  8 07:56 decision-signing.key
-rw------- 1 root root   44 Oct  8 07:56 master.key
master.key idéntica
```
(El listado final muestra solo archivos; las carpetas vacías `workspaces`, `companies` y `data/storage` también se crearon. La comprobación `cmp` confirma que la `master.key` es idéntica.)

## Extra 3 · Hallazgo F4 corregido: puerto real del Postgres + copia de la instancia restaurada · 2026-10-08T08:48Z
Se volvió a arrancar la 2.ª instancia (log `/home/user/mc-lab/logs/paperclip-restore-extra.log`) y se ejecutó `backup-full.mjs` contra ella:
```text
2026-10-08T08:48:58Z
== config.json de la 2a instancia (puerto PG configurado):
54329
postgres -D /home/user/mc-lab/paperclip-restore/instances/default/db -p 54330
== backup-full.mjs sobre la 2a instancia
== Mission Control · copia completa de Paperclip ==
Raíz de datos : /home/user/mc-lab/paperclip-restore
Instancia     : default (/home/user/mc-lab/paperclip-restore/instances/default)
Se incluirán  : instances/default/secrets, instances/default/.env, instances/default/config.json, instances/default/data/storage
No existen (se omiten): instances/default/workspaces, instances/default/companies, instances/default/projects, context.json
AVISO (F4): el Postgres embebido de esta instancia escucha en 54330, pero config.json dice 54329: db:backup conectaría a OTRA base. Se fuerza DATABASE_URL=postgres://paperclip:***@127.0.0.1:54330/paperclip solo para este comando.
> npx -y paperclipai@2026.1005.0 db:backup --json -d /home/user/mc-lab/paperclip-restore
Volcado creado: /home/user/mc-lab/paperclip-restore/instances/default/data/backups/paperclip-20261008-084904.sql.gz (141948 bytes)
> tar -czf /home/user/mc-lab/restore-proof/backups2/mc-backup-default-20261008T084907Z.tar.gz -C /tmp/mc-backup-sEz1cZ MANIFEST.json -C /home/user/mc-lab/paperclip-restore instances/default/secrets instances/default/.env instances
  OK    MANIFEST.json
  OK    volcado .sql.gz
  OK    secrets/master.key
  OK    secrets/decision-signing.key
  OK    .env

Archivo       : /home/user/mc-lab/restore-proof/backups2/mc-backup-default-20261008T084907Z.tar.gz
Tamaño        : 143382 bytes · 8 entradas
SHA-256       : 369452a3ee8769d6e6c49f98c676d9a608557906106208f157091e57fd3553ea
AVISO: este archivo contiene la master.key y el .env. Guárdalo cifrado y fuera del equipo (nunca en el repositorio).
```
- Detectó 54330 ≠ 54329 y forzó `DATABASE_URL` solo para ese comando; el volcado de la instancia **restaurada** pesa 141 948 bytes (el original 141 949) y contiene la empresa (`grep -c "Mission Control"` → 11). Es un **round-trip**: copia → restaurar → copiar de nuevo.
```text
2026-10-08T08:49:13Z
PID 2a instancia: 24696
24696 node /home/mc/.npm/_npx/2516d3db5aacea45/node_modules/.bin/paperclipai onboard --yes -d /home/user/mc-lab/paperclip-restore --no-install-service
detenido tras ~1s
(sin procesos de paperclip-restore)
vivo 3101: HTTP 200
```

## Extra 4 · Flujo de invitación → aprobación → clave, y negativa a HTTP remoto (instancia desechable, loopback)

Tercera instancia desechable (`-d /home/user/mc-lab/paperclip-flow`, `PORT=3103`, `local_trusted`, ya borrada; log en `/home/user/mc-lab/logs/paperclip-flow.log`), 08:53–08:56 UTC, empresa “Flujo de invitación (prueba)”. Se muestran los pasos relevantes con la salida tal como se vio; tokens, `claimSecret` y claves aparecen como `<oculto>`. Un intento mío de `token agent create` falló por comillas del shell (nombre con espacios y paréntesis); se hizo el equivalente por API, que funcionó.

```text
2026-10-08T08:54:09Z
$ paperclipai invite create -C <cid> --payload-json '{"allowedJoinTypes":"agent"}' --api-base http://127.0.0.1:3103 --json
{ "id": "2b0b8b34-…", "inviteType": "company_join", "allowedJoinTypes": "agent", "defaultsPayload": null,
  "expiresAt": "2026-10-11T08:54:12.591Z", "invitedByUserId": "local-board", "token": "<oculto>",
  "inviteUrl": "http://127.0.0.1:3103/invite/<oculto>", "onboardingTextUrl": "http://127.0.0.1:3103/api/invites/<oculto>/onboarding.txt", … }

$ paperclipai invite create -C <cid> --payload-json '{"requestType":"agent"}' …      # payload del ejemplo de la documentación upstream
→ allowedJoinTypes: 'both'   defaultsPayload: {'human': {'role': 'operator', 'grants': [{'scope': None, 'permissionKey': 'tasks:assign'}]}}   # el payload se IGNORÓ

$ paperclipai invite onboarding:text <token>          # primeras líneas
# Paperclip Agent Onboarding
This document is meant to be readable by both humans and agents.
## Invite
- inviteType: company_join
- allowedJoinTypes: agent
- expiresAt: 2026-10-11T08:54:12.591Z
- companyName: Flujo de invitación (prueba)
## Step 0
Decide which Paperclip adapter type matches your runtime.

$ paperclipai invite accept <token> --payload-json '{"requestType":"agent","agentName":"Hermes laptop (prueba)","adapterType":"hermes_gateway","capabilities":"prueba de flujo","agentDefaultsPayload":{"apiBaseUrl":"https://laptop1.tail0000.ts.net","apiKey":"<clave de prueba, no real>","paperclipApiUrl":"http://127.0.0.1:3103","sessionKeyStrategy":"issue"}}'
{ "id": "de8ab4e7-…", "requestType": "agent", "status": "pending_approval", "agentName": "Hermes laptop (prueba)", "adapterType": "hermes_gateway",
  "agentDefaultsPayload": { "apiKey": { "type": "secret_ref", "version": "latest", "secretId": "4590b983-…" },
                            "apiBaseUrl": "https://laptop1.tail0000.ts.net/", "paperclipApiUrl": "http://127.0.0.1:3103", "sessionKeyStrategy": "issue" },
  "claimSecretExpiresAt": "2026-10-15T08:54:27.099Z", "claimSecretConsumedAt": null, "createdAgentId": null,
  "claimSecret": "<oculto>", "claimApiKeyPath": "/api/join-requests/de8ab4e7-…/claim-api-key", … }

$ paperclipai join list --company-id <cid> --status pending_approval
[('de8ab4e7', 'pending_approval', 'Hermes laptop (prueba)', 'hermes_gateway')]

$ paperclipai join approve <requestId> --company-id <cid>
API error 409: Join request cannot be approved because this company has no active CEO

$ paperclipai join claim-key <requestId> --claim-secret <oculto>          # antes de aprobar
API error 409: Join request must be approved before key claim

$ curl -s -X POST …/api/companies/<cid>/agents -d '{"name":"Coordinador (prueba)","role":"ceo","adapterType":"hermes_gateway",…}'
{'name': 'Coordinador (prueba)', 'role': 'ceo', 'status': 'idle'}

$ paperclipai join approve <requestId> --company-id <cid>
{'status': 'approved', 'createdAgentId': '658854c0-69ec-4570-8bea-38573728a59d', 'approvedAt': '2026-10-08T08:55:31.298Z', 'claimSecretConsumedAt': None}

$ curl -s …/api/companies/<cid>/agents          # name | role adapterType status apiKey.type apiBaseUrl reportsTo
Coordinador (prueba)   | ceo     hermes_gateway idle  apiKey.type= secret_ref  http://127.0.0.1:8642                reportsTo=
Hermes laptop (prueba) | general hermes_gateway idle  apiKey.type= secret_ref  https://laptop1.tail0000.ts.net/      reportsTo= 174d0c35

$ paperclipai join claim-key <requestId> --claim-secret <oculto> --json
{ "keyId": "c3abf907-…", "token": "<oculto>", "agentId": "658854c0-…", "createdAt": "2026-10-08T08:55:34.648Z" }
$ paperclipai join claim-key <requestId> --claim-secret <oculto> --json          # segundo intento
API error 409: Claim secret already used

$ curl -s -X POST …/api/agents/<id>/keys -d '{"name":"hermes-laptop-1","scope":{"kind":"standard"}}'
{"id":"72d2e985-…","name":"hermes-laptop-1","scope":{"kind":"standard"},"responsibleUserId":"local-board","token":"<oculto>","createdAt":"2026-10-08T08:55:45.893Z"}
$ curl -s …/api/agents/<id>/keys              # lista sin valores: initial-join-key (del claim) y hermes-laptop-1

$ paperclipai token board create --name mc-bff --ttl-days 90 --json
{ "key": { "id": "1fdd8db2-…", "name": "mc-bff", "token": "<oculto>", "createdAt": "2026-10-08T08:55:48.480Z", "lastUsedAt": null, "revokedAt": null, "expiresAt": "2027-01-06T08:55:48.422Z" } }

$ POST /api/companies/<cid>/adapters/hermes_gateway/test-environment  {"adapterConfig":{"apiBaseUrl":"http://127.0.0.1:8699","apiKey":"<prueba>"}}     # puerto cerrado
fail
  info hermes_gateway_loopback_http_allowed - Loopback HTTP Hermes gateway URL is allowed.
  error hermes_gateway_health_unreachable - Could not reach Hermes Gateway health endpoint.
$ POST …/test-environment  {"adapterConfig":{"apiBaseUrl":"http://100.64.0.9:8642","apiKey":"<prueba>"}}     # IP CGNAT de Tailscale, HTTP
fail
  error hermes_gateway_plain_http_remote_denied - Hermes gateway apiBaseUrl uses remote plain HTTP for "100.64.0.9". Use HTTPS or set dangerouslyAllowInsecureRemoteHttp=true only for unsafe local development.
```
Conclusiones (detalle en `docs/04-runbooks/segundo-equipo.md` §C): (a) `invite create --payload-json '{"requestType":"agent"}'` (el ejemplo de la documentación upstream) **se ignora**: crea una invitación `allowedJoinTypes: "both"`; usar `{"allowedJoinTypes":"agent"}`. (b) `join approve` falla con **409 “no active CEO”** si la empresa no tiene un agente con `role: "ceo"`. (c) la `claimSecret` es de un solo uso. (d) `http://100.64.0.9:8642` (IP CGNAT de Tailscale) cuenta como HTTP remoto y se **deniega**. Después se paró solo esa instancia (la viva siguió en HTTP 200) y se borró su directorio.

---

## Lo que esta prueba NO demuestra
- Nada de Windows ni de macOS (servicio, tarea programada, WSL2, permisos, `tar.exe`, rutas con espacios, Defender). Los `.ps1`/`.sh` se analizaron o se simularon, no se ejecutaron en esos sistemas.
- Nada de red: ni Tailscale, ni `tailscale serve`/HTTPS, ni modo `authenticated`, ni un segundo equipo real, ni SSE por la tailnet.
- Que la restauración funcione entre sistemas operativos distintos (Mac → Windows) ni entre versiones distintas de Paperclip.
- Un Hermes con modelo real: los agentes del laboratorio apuntan a un Hermes con modelo simulado; **no se lanzó ningún run** desde la instancia restaurada (el contenido de los secretos se comprobó por descifrado directo, no llamando a Hermes).
- Actualización (`update`) ni `--rollback`: nunca se ejecutaron.
- Que la restauración sea transaccional frente a un corte a mitad (el volcado va en una transacción `BEGIN…COMMIT` con `psql`; el motor JS ejecuta sentencia a sentencia con el mismo contenido: no se probó interrumpirlo).
