---
tipo: lista de verificación
proyecto: Mission Control
revisado: 2026-10-08
estado: "Ninguna de las 20 verificaciones se ha hecho: el entorno Cloud es Linux, sin Windows, macOS, Tailscale ni segundo equipo. Lo que SÍ se verificó aquí (restauración, invitación/clave, HTTP remoto denegado) está en `docs/evidencias/restauracion-lab.md`."
---

# Verificaciones que solo puedes hacer en tus equipos (V1–V20)

Regla de la casa: **mencionado ≠ instalado ≠ conectado ≠ probado.** Una casilla se marca solo cuando tienes la evidencia guardada.
Origen: `ops.md` §8 (V1–V20) con los matices de la verificación adversarial (F1–F6) añadidos donde cambian la prueba.

## Cómo registrar la evidencia (una vez)

Crea `docs/evidencias/AAAA-MM-DD-<equipo>.md` (p. ej. `2026-10-12-win-principal.md`) y, por cada V, pega:
1. **Marca UTC** de inicio (`Get-Date -AsUTC -Format o` / `date -u +%FT%TZ`) y la **versión** (`paperclipai --version`, `hermes --version`, `node -v`).
2. El **comando exacto** y su **salida literal** (recorta lo largo, no lo cambies).
3. **Resultado:** PASA / FALLA / PARCIAL + qué viste distinto de lo esperado.
4. **Qué NO demuestra** (una línea).

**Nunca pegues:** valores de `API_SERVER_KEY`, `master.key`, `.env`, tokens de claim/agente/board, `XIAOMI_API_KEY`. Si una salida los contiene, sustitúyelos por `<oculto>`. Capturas de pantalla: guárdalas junto al `.md` y nómbralas `V#-descripcion.png`.

Leyenda de equipos: **Mac** · **Win** (Windows principal; ruta WSL2 salvo que diga “nativo”) · **B** (segundo equipo).

## Grupo 1 — Mac (soportado oficialmente)

| ☐ | # | Verificación | Equipo | Criterio de éxito | Cómo registrar la evidencia |
|---|---|---|---|---|---|
| ☐ | V1 | `bash scripts/macos/install-paperclip.sh --yes` (= `install.sh --version 2026.1005.0 --no-prompt --no-onboard`) termina; `paperclipai --version` | Mac | Imprime `2026.1005.0`; existen el shim `~/.local/bin/paperclipai` y el symlink `~/.paperclip/cli/current` | Salida del script + `ls -l ~/.local/bin/paperclipai ~/.paperclip/cli/` + `paperclipai --version` |
| ☐ | V2 | `paperclipai onboard --yes --install-service`; reinicia el Mac e inicia sesión | Mac | Existe `~/Library/LaunchAgents/ing.paperclip.paperclipai.plist`; `paperclipai service status --json` activo; `/api/health` ok **tras** el reinicio + login | `ls` del plist, `launchctl print gui/$(id -u)/ing.paperclip.paperclipai \| head`, `curl /api/health` antes y después del reinicio (con UTC) |
| ☐ | V3 | PATH del LaunchAgent: lanza un agente `claude_local`/`codex_local` desde el servicio | Mac | Un run sin “command not found”. Si falla: fijar `command` absoluto o `PATH` en `~/.paperclip/instances/default/.env` y repetir | `GET /api/heartbeat-runs/<id>` (`status`, `errorCode`) + `service.err.log` (últimas líneas) |
| ☐ | V4 | `brew upgrade node` y luego `paperclipai --version` / reinicio del servicio (caveat M3) | Mac | `paperclipai` sigue arrancando. Si no: `npx paperclipai@latest install --yes` con el Node nuevo | Antes/después de `node -v`, ruta dentro de `~/.local/bin/paperclipai` (`head -5`), salida de la reparación |

## Grupo 2 — Windows (ruta principal WSL2 y alternativa nativa)

| ☐ | # | Verificación | Equipo | Criterio de éxito | Cómo registrar la evidencia |
|---|---|---|---|---|---|
| ☐ | V5 | **Nativo:** `npm i -g paperclipai@2026.1005.0` y `paperclipai onboard --yes --no-install-service --run` en PowerShell. ¡`--no-install-service` explícito! (F6: con `--install-service` en win32 arranca en primer plano y se queda) | Win (nativo) | Aparece el banner con `Database … (pg:NNNNN)`, existe `…\.paperclip\instances\default\db`, `/api/health` ok. Anota si el puerto de PG fue 54329 u otro | Salida del banner + `Get-ChildItem …\instances\default` + `curl.exe /api/health` |
| ☐ | V6 | **Nativo:** tarea programada `PaperclipAI` al iniciar sesión (`windows.md` §6); reinicia el PC | Win (nativo) | Reaparece sola, **una sola** instancia: un `node` de Paperclip + un `postgres.exe` | `Get-ScheduledTask PaperclipAI \| Get-ScheduledTaskInfo`, `Get-CimInstance Win32_Process -Filter "Name='node.exe' or Name='postgres.exe'" \| select ProcessId,CommandLine` |
| ☐ | V7 | **Nativo:** Defender/antivirus y ACL de `secrets\` | Win (nativo) | Sin errores EPERM/EBUSY en el log; `icacls …\secrets` muestra solo tu usuario (W9). Si Defender bloquea `postgres.exe`, anota qué regla | Log de arranque, `icacls`, captura de Seguridad de Windows si bloqueó |
| ☐ | V8 | **WSL2:** `service install --enable-linger`; `wsl --shutdown`; reinicia Windows **sin abrir Ubuntu**; acceso desde otro equipo de la tailnet | Win (WSL2) | `systemctl --user is-active paperclipai` = `active`; `curl.exe http://127.0.0.1:3100/api/health` desde Windows responde; `curl http://<ip-tailnet>:3100/api/health` desde B responde. Si el servicio quedó `failed` por Tailscale tardío (F1): `systemctl --user reset-failed paperclipai.service && systemctl --user start paperclipai.service` | Salidas con UTC antes y después de cada reinicio; `systemctl --user status paperclipai \| head -15`; qué hizo falta (mirrored, `sleep infinity`, portproxy) |
| ☐ | V9 | `paperclipai db:backup --json` en cada SO (motor JS: sin `pg_dump`); **F4:** compara el puerto de `config.json` con el real del `postgres` | Mac · Win | Crea `.sql.gz`; `health.databaseBackup.status` pasa a `ok` y `latestBackup` no es nulo; el puerto de `config.json` = el del proceso (si no, `backup-full.mjs` lo avisa y fuerza `DATABASE_URL`) | JSON de `db:backup` (ruta, tamaño), `curl …/api/health \| jq .databaseBackup`, `ps`/`Get-CimInstance` del `postgres -D … -p N`, `grep embeddedPostgresPort config.json` |

## Grupo 3 — Restauración y actualización

| ☐ | # | Verificación | Equipo | Criterio de éxito | Cómo registrar la evidencia |
|---|---|---|---|---|---|
| ☐ | V10 | **Restauración completa en un equipo limpio** (`actualizar-y-restaurar.md` §5-7): copia + `restore-files.mjs` + `restore-db.mjs` + `verify-restore.mjs` | Mac · Win | `verify-restore.mjs` sale **0**: H1–H8 PASA, en especial **H7 (los secretos se descifran con la `master.key` restaurada)** y H8 (control negativo falla). Empresa, agentes (`secret_ref`) y tareas presentes | Salida literal de los cuatro comandos con UTC, hash SHA-256 de la copia, versión de Paperclip origen/destino |
| ☐ | V11 | **Restauración cruzada Mac → Windows** con volcado lógico (formato COPY, collation, sin owner) | Mac → Win | Esquema y filas íntegros: mismos conteos (`companies`, `agents`, `issues`, `company_secrets`) que imprime `restore-db.mjs`, H1–H8 PASA | Conteos origen vs destino, salida de `verify-restore.mjs`, tamaño y hash del volcado |
| ☐ | V12 | `update --version X` y `update --rollback` en Mac, **con y sin `--stopped`** (F2: la validación post-update dura 60 s y revierte código sin revertir BD) | Mac | La versión activa cambia y vuelve; backup automático creado; el reinicio usa `--expected-version`. Anota cuánto tardó el arranque con migraciones (¿> 60 s?) | `paperclipai --version` antes/durante/después, salida de `update`, `service logs` del arranque, `GET /api/health` (`version`) |
| ☐ | V13 | **Nativo:** `update --version` en `global-npm`: confirma que **no** hace backup, no reinicia ni valida (F3); “rollback” = `update --version <anterior> --yes` | Win (nativo) | No aparece `.sql.gz` nuevo por el `update`; el servidor viejo sigue con el código viejo hasta que reinicias la tarea; tras reiniciar `/api/health.version` es la nueva | Listado de `data\backups` antes/después, `/api/health` antes y después del reinicio de la tarea |

## Grupo 4 — Red, Hermes y segundo equipo

| ☐ | # | Verificación | Equipo | Criterio de éxito | Cómo registrar la evidencia |
|---|---|---|---|---|---|
| ☐ | V14 | Tailnet: `.env` con `authenticated/private/tailnet` + `PAPERCLIP_TAILNET_BIND_HOST` + `allowed-hostname`; abrir `http://<magicdns>:3100`; crear primer admin; **arranque sin Tailscale** | Mac · Win | Acceso desde B; `health.deploymentMode = authenticated`; sin el nombre MagicDNS en la lista → falla (confírmalo); con la IP fijada el servicio **resiste** arrancar antes que Tailscale (en WSL2 mira F1) | `curl` desde B (UTC), `.env` (solo nombres de variables), `paperclipai service status`/`systemctl --user status` tras reiniciar sin red |
| ☐ | V15 | `tailscale serve --bg --https=443 http://127.0.0.1:8642` delante de Hermes en B; `https://b.<tailnet>.ts.net/health` desde A; test-environment **sin** `dangerouslyAllowInsecureRemoteHttp` | B + A | `/health` 200 sobre HTTPS con certificado de confianza para Node; `POST …/adapters/hermes_gateway/test-environment` → `ok`; el agente queda “healthy”. También: confirma que con `http://100.x:8642` falla con `hermes_gateway_plain_http_remote_denied` | `tailscale serve status`, `curl -v` (cadena de certificados), JSON de test-environment (ambos casos) |
| ☐ | V16 | Interfaz en la que escucha Hermes (`API_SERVER_HOST`) y si exige `API_SERVER_KEY`; dónde quedó `HERMES_HOME` en Windows nativo (¿`%LOCALAPPDATA%\hermes` o `%USERPROFILE%\.hermes`?) | B · Win · Mac | Escucha solo en `127.0.0.1:8642` (`netstat -ano \| findstr 8642` / `lsof -iTCP:8642 -sTCP:LISTEN`); `/v1/capabilities` 200 con Bearer y rechazo sin él; sin clave el gateway **no arranca** | Salida de `netstat`/`lsof`, los dos `curl` (códigos HTTP), `hermes gateway status`, `-ShowResolvedPaths` |
| ☐ | V17 | **Flujo completo** invitación → `join approve` → `claim-key` con Hermes remoto y un **run real** (SSE `/v1/runs/{id}/events` por la tailnet); luego la **prueba de recuperación** de `segundo-equipo.md` §E | A + B | Un issue asignado se ejecuta y comenta; `approve` funciona (la empresa tiene un agente `role: ceo`, si no `409 … no active CEO`); la tabla E.1/E.2 queda rellenada con lo **observado** (estado del run, `errorCode`, tiempos, ¿el issue acabó `blocked`?, ¿MC pudo reintentar?) | JSON de `invite create` (sin token), `join list/approve`, `GET /heartbeat-runs` y `/events` de cada run, comentarios del issue; tabla E rellenada |
| ☐ | V18 | Slack: origen HTTPS público (Funnel o Cloudflare) → `PAPERCLIP_CHAT_WEBHOOK_PUBLIC_URL`; **solo** `POST /api/chat-webhooks/*` expuesto, nunca el tablero | Equipo con Funnel | La firma de Slack se verifica; el resto de rutas devuelve 404/403 desde Internet | `curl` externo a `/api/health` (debe fallar) y a la ruta del webhook; log de verificación de firma |
| ☐ | V19 | Reloj/zona y **suspensión del Mac**: heartbeats durante el sleep (M8) | Mac | Con `caffeinate -s`/energía ajustada los latidos continúan; sin ellos se pierden y se recuperan al despertar sin duplicar runs | Línea de tiempo de `GET /heartbeat-runs` alrededor del sleep, `pmset -g log \| tail` |
| ☐ | V20 | Telemetría y aviso de actualización: `PAPERCLIP_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1`, `PAPERCLIP_UPDATE_CHECK=0` — **decisión de privacidad tuya** | Mac · Win | Las variables están en el `.env` de la instancia y el arranque no consulta el registro (revisa el log); decisión anotada | `.env` (solo nombres), línea del banner/log, tu decisión y fecha |

## Extras que salieron de preparar estos runbooks (no estaban en V1–V20)

| ☐ | # | Verificación | Equipo | Criterio de éxito | Evidencia |
|---|---|---|---|---|---|
| ☐ | V21 | WSL2: ¿llega Paperclip (en WSL2) a Hermes nativo de Windows? Prueba P-a (Hermes dentro de WSL2), P-b (`tailscale serve` HTTPS) y P-c (mirrored) y deja anotada la que uses | Win | `test-environment` del agente `hermes_gateway` en `ok` con la opción elegida | JSON de test-environment, `.wslconfig` si usas mirrored |
| ☐ | V22 | `hermes gateway install` en Windows: tarea `Hermes_Gateway` registrada, sobrevive a reinicio, y qué pasa si **matas** el gateway (no se reinicia solo) | Win · B | `schtasks /Query /TN Hermes_Gateway /V /FO LIST`; tras reinicio `hermes gateway status` activo; tras matarlo sigue caído hasta `hermes gateway start` | Salidas con UTC |
| ☐ | V23 | `scripts/windows/*.ps1` y `scripts/macos/*.sh` **de verdad**: primero sin `-Yes` (plan), luego con él, uno a uno | Mac · Win | Cada uno hace lo que imprime; anota cualquier diferencia o error (los scripts solo se analizaron en Linux) | Salida literal; si algo falla, el mensaje y tu versión de Windows/macOS |
| ☐ | V24 | Token Plan de MiMo (P06): decisión escrita (solo interactivo / clave de pago por uso / otro proveedor) antes de programar nada con él | — | Decisión registrada en `07-decisiones.md` | Cita tuya con fecha |

## Resumen del estado

| Grupo | Verificado antes de hoy | Pendiente |
|---|---|---|
| Linux (Cloud) | Instalación npx, API, backup, **restauración completa**, invitación → aprobación → clave, HTTP remoto denegado | — |
| Mac | nada | V1–V4, V9–V12, V19 |
| Windows | nada | V5–V9, V10, V13 (nativo), V21–V23 |
| Red / segundo equipo | nada | V14–V18 |
