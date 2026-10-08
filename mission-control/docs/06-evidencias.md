# Registro de evidencias — entorno Cloud (contenedor Linux de Anthropic)

Zona horaria de las marcas: UTC (el contenedor). CDMX = UTC-6.
Cada entrada: qué se ejecutó, dónde, resultado literal resumido, y qué NO demuestra.

## 2026-10-08 07:34 UTC — Entorno
- Node 22.22.0 del sistema; Paperclip exige >= 24.11.0 (package.json `engines`).
- Instalado Node 24.21.0 LTS en /opt/node24 desde nodejs.org con verificación SHA256 (OK).
- pnpm 10.28.0, Python 3.13.16 (+ uv 0.11.32 con CPython 3.14.6 disponible), Rust 1.97.0, Docker CLI sin daemon.
- Red: npm registry y PyPI alcanzables; GitHub sólo vía proxy git anónimo (clones públicos); docs.paperclip.ing, hermes-agent.nousresearch.com, komputermechanic.com NO alcanzables desde el contenedor.

## 2026-10-08 07:4x UTC — Clones de referencia (solo lectura)
- paperclipai/paperclip @ 5717523b (2026-10-07 19:52 -0700), profundidad 1.
- NousResearch/hermes-agent @ a28a5d03 (2026-10-07 23:07 -0700), profundidad 1.

## 2026-10-08 07:47–07:59 UTC — Paperclip publicado (npm paperclipai@2026.1005.0)
- dist-tags npm: latest 2026.1005.0, beta 2026.1006.0-beta.0, nightly 2026.1007.0-nightly.0, canary 2026.1008.0-canary.4.
- `npx paperclipai@2026.1005.0 onboard --yes -d <dataDir> --no-install-service --run`
  - Como root: doctor 12/12 OK; falló al arrancar PostgreSQL embebido (`initdb` EACCES/root). PostgreSQL no se inicializa como root.
  - Como usuario sin privilegios `mc`: arranque correcto. Banner: Mode embedded-postgres | static-ui; Deploy local_trusted (private); Bind loopback; Auth ready; Server 3101 (requested 3100); DB pg:54329; Migrations already applied; Heartbeat enabled (30000ms); DB Backup enabled (every 60m, keep 30d).
  - `GET /api/health` → {"status":"ok","version":"2026.1005.0",...,"deploymentMode":"local_trusted","authReady":true,"bootstrapStatus":"ready"}.
- Lo que NO demuestra: nada sobre Windows/macOS (ahí el servicio corre con el usuario de sesión, sin el problema de root); nada sobre red entre equipos.

## 2026-10-08 08:0x UTC — API de Paperclip en vivo (modo local_trusted, sin autenticación en loopback)
- `GET /api/companies` → `[]` [200] sin cabeceras de autenticación.
- `GET /api/openapi.json` → OpenAPI 3.0.0, 728 rutas (guardado en /home/user/mc-lab/paperclip-openapi.json).
- `GET /api/adapters` → 16 adaptadores integrados: acpx_local, claude_local (12 modelos, skills, ACP), codex_local (16, skills, ACP), cursor, cursor_cloud, gemini_local, grok_local (4 modelos, skills), hermes_gateway (skills: NO, instrucciones: NO), hermes_local (skills: SÍ), http, kimi_local (Moonshot Kimi, no Xiaomi MiMo), openclaw_gateway, opencode_local, paperclip_runner, pi_local, process.
- `GET /api/adapters/hermes_gateway/config-schema` → campos: apiBaseUrl (obligatorio; ej. http://127.0.0.1:8642), apiKey (obligatorio; "Hermes API_SERVER_KEY"; se guarda como referencia a secreto), dangerouslyAllowInsecureRemoteHttp (por defecto false: gateways remotos deben usar HTTPS; loopback HTTP permitido), sessionKeyStrategy (issue|agent|run|none; por defecto issue), timeoutSec (600), eventReconnectMs (2000), paperclipApiUrl, headers, instructions.
- Consecuencia para el piloto: un Hermes en otro equipo vía Tailscale (IP 100.x) cuenta como remoto → hace falta HTTPS (p. ej. `tailscale serve`/certs) o el interruptor inseguro sólo para pruebas.
- Lo que NO demuestra: que un run llegue a Hermes (aún no hay servidor Hermes conectado).

## 2026-10-08 08:03 UTC — Empresa de prueba creada en Paperclip (API real)
- `POST /api/companies` {"name":"Mission Control — piloto"} → 201, id b0d4c18c-7069-499f-8879-26cdc29738dc, issuePrefix "MIS".

## 2026-10-08 08:05 UTC — Prueba de humo CI-safe del adaptador hermes_gateway (clon de Paperclip, Node 24)
- `node --test scripts/smoke/hermes-gateway-smoke.test.mjs` → 6/6 pasan (sintaxis bash de join/e2e/entrypoint; ayuda con HERMES_GATEWAY_API_BASE_URL y HERMES_GATEWAY_PROBE_URL; semilla de config de modelo sin secretos; redacción de secretos; distinción loopback HTTP vs HTTP remoto inseguro; normalización de barras).
- Lo que NO demuestra (lo dice doc/HERMES_GATEWAY_SMOKE.md): no arranca Docker, Hermes ni Paperclip; la E2E real (`smoke:hermes-gateway-e2e`) requiere Docker y una clave de proveedor de inferencia.

## 2026-10-08 08:08 UTC — Servidor API de Hermes: pruebas unitarias del clon (Python 3.14.6 vía uv)
- `uv sync --python 3.14` en el clon de hermes-agent: instalación completa sin errores (deps fijadas a versión exacta en pyproject).
- `pytest tests/gateway/test_api_server.py tests/gateway/test_api_server_jobs.py tests/gateway/test_api_server_bind_guard.py` → 142 passed, 1 skipped (21 s). Requirió instalar aiohttp (dependencia de la extra de gateway/linux, no del núcleo).
- Lo que NO demuestra: que un Hermes real con modelo responda a Paperclip (eso es la prueba E2E siguiente); ni nada en Windows/macOS.

## 2026-10-08 08:06–08:08 UTC — Ejecutor de prueba: Hermes REAL + modelo SIMULADO
- Modelo simulado (stub) `mc-lab/stub-llm/server.mjs`: servidor OpenAI-compatible (/v1/models, /v1/chat/completions con y sin streaming, /v1/responses) con respuesta determinista marcada "MC-STUB-OK". **Es una simulación**: no hay inferencia real.
- Hermes (clon a28a5d03, venv Python 3.14.6) con HERMES_HOME aislado `/home/user/mc-lab/hermes-home`: `model.provider: custom`, `base_url: http://127.0.0.1:8700/v1`, `platforms.api_server.enabled: true` con clave de 48 hex (archivo 600).
- `hermes gateway run` arrancó; `GET /health` → {"status":"ok","platform":"hermes-agent"}; `GET /v1/capabilities` (Bearer) → runs_idempotency durable (retención 86400 s), run_events_sse, run_stop, run_steer, session_key_header X-Hermes-Session-Key, tool_execution: server (las herramientas se ejecutan en el host del API server).
- Lo que NO demuestra: calidad de un modelo real; permisos de herramientas en un equipo real.

## 2026-10-08 08:08 UTC — Run directo contra el servidor API de Hermes (real) con modelo simulado
- `POST /v1/runs` (Bearer, Idempotency-Key mc-probe-001, X-Hermes-Session-Key) → 202 {"run_id":"run_6166…","status":"started"}.
- `GET /v1/runs/{id}` → status completed en ~3 s; output con la marca MC-STUB-OK; usage input_tokens 13416 / output 40; runtime provider custom, model stub-model.
- `GET /v1/runs/{id}/events` (SSE) → message.delta ×7, reasoning.available, run.completed; cierre limpio ("stream closed").
- Replay con la misma Idempotency-Key y distinta cabecera de sesión → 409 idempotency_key_conflict (protección frente a duplicados funciona del lado de Hermes).
- Observación de coste: Hermes envió ~53 KB (≈13 400 tokens) de sistema+herramientas al modelo por un turno trivial. Con un proveedor de pago hay que recortar herramientas/instrucciones del perfil usado por Mission Control.
- Lo que NO demuestra: el recorrido Paperclip → hermes_gateway → Hermes (siguiente paso).

## 2026-10-08 08:09 UTC — Secreto y agente ejecutor en Paperclip (API real)
- `POST /api/companies/{c}/secrets` {name HERMES_API_SERVER_KEY_LAB, provider local_encrypted, managedMode paperclip_managed} → 201, id 10c5a67c-…; la respuesta no devuelve el valor.
- `POST /api/companies/{c}/agents` {adapterType hermes_gateway, adapterConfig.apiKey = {type secret_ref, secretId, version latest}, apiBaseUrl http://127.0.0.1:8642, sessionKeyStrategy issue, timeoutSec 120} → 201, id 5bdd4ae7-…, status idle. Paperclip añade projectionClass "unclassified" a la referencia y guarda runtimeConfig.heartbeat.enabled=false por defecto.
- Comprobado en el código (server/src/__tests__/agents-service-secret-bindings.test.ts): una apiKey literal también se convierte en secret_ref al persistir; la config no contiene la clave en claro.

## 2026-10-08 08:10–08:14 UTC — RECORRIDO REAL COMPLETO: solicitud → asignación → ejecución → revisión → resultado
Componentes: Paperclip 2026.1005.0 (real) · adaptador hermes_gateway (real, integrado) · Hermes API server a28a5d03 (real) · modelo: SIMULADO (stub) · revisor: humano (operador por API).
1. **Solicitud** 08:10:31 — `POST /api/companies/{c}/issues` {title "Recorrido piloto 01…", status todo, priority high, assigneeAgentId <Ejecutor Hermes>, reviewPolicy human_only} → 201, identificador **MIS-1**. Actividad: `issue.created` (user).
2. **Asignación** 08:10:31 — Paperclip despertó al agente automáticamente (heartbeat run c9d0e2d3, invocationSource **assignment**), sin invocación manual.
3. **Ejecución** 08:10:31–32 — eventos del run: `run started` → `adapter.invoke {command: "POST /v1/runs", timeoutSec 120, hasSessionKey true, eventReconnectMs 2000}` → `succeeded exitCode 0` → `run.presentation.resolved` (comentario) → limpieza del directorio temporal. Comentario del agente en MIS-1: "Respuesta del MODELO SIMULADO (stub)… Marca: MC-STUB-OK". usageJson: inputTokens 14374, outputTokens 41, biller hermes_gateway, costStatus **unpriced**, model unknown.
4. **Reintentos acotados** 08:10:32 y 08:11:36 — dos runs `automation` (reparación de disposición) porque el agente no cambió el estado de la tarea (el stub no ejecuta herramientas). Actividad 08:11:37: `issue.disposition_repair_escalated` {maxAttempts 2, attemptCount 2, routingPolicy board_escalation_no_takeover_v1} → MIS-1 **blocked** y comentario de sistema "Terminal reason: unchanged_source_state_exhausted - Recovery owner: board". Esto es la protección nativa frente a bucles de reintento + escalado a humano.
5. **Revisión** 08:13 — operador: `PATCH /api/issues/{id}` {status in_review, comment "[Operador humano] …"} → 200.
6. **Resultado** 08:14:00 — `PATCH /api/issues/{id}` {status done, comment "[Operador humano] Revisado y aceptado…"} → 200, completedAt 2026-10-08T08:14:00.888Z. Dashboard: tasks.done 1; costs/by-agent: inputTokens 32645, outputTokens 81, costCents 0.
Run manual adicional 08:12:05 (`POST /api/agents/{a}/heartbeat/invoke` → queued → succeeded en 0,8 s).
**Qué NO demuestra:** (i) que un agente con modelo real mueva la tarea a in_review por sí mismo (requiere modelo con herramientas: siguiente prueba con MiMo/Token Plan en Hermes del usuario); (ii) red entre equipos, HTTPS en tailnet, Windows/macOS; (iii) precio por token (hermes_gateway informa tokens pero no modelo).

## 2026-10-08 08:31 UTC — Recorrido reproducible por script (lab/e2e.mjs)
- `PAPERCLIP_URL=http://127.0.0.1:3101 PAPERCLIP_COMPANY_ID=b0d4c18c… HERMES_URL=http://127.0.0.1:8642 HERMES_API_KEY=<oculta> node lab/e2e.mjs` → **16/16 pasos correctos** en ~3 s: salud de Paperclip y Hermes; clave aceptada; adaptador presente; secreto guardado sin eco; agente hermes_gateway (secret_ref); solicitud MIS-2 con human_only; despertar por asignación (run 339b6c94, source=assignment, succeeded; tokens in 14255 / out 41, unpriced); comentario con MC-STUB-OK en 2 s; evento adapter.invoke; in_review → done (completedAt 08:31:16Z); consumo por agente registrado; agente e2e pausado.
- Informe: docs/evidencias/e2e-2026-10-08T08-31-13Z.md. Lo que NO demuestra: lo mismo que el recorrido manual (modelo simulado, un solo equipo).

## 2026-10-08 08:4x UTC — Paquetes construidos y probados en este entorno
- `@mc/node-agent`: build, typecheck y 19/19 pruebas (node:test) en verde. `checkHermes` contra el Hermes real → apiServer.reachable true; CLI `hermes` no instalada en el contenedor (installed false). Windows/macOS: NO ejecutado (schtasks, launchd, PowerShell, rutas C:\).
- `@mc/paperclip-client`: build y typecheck en verde; 16 pruebas unitarias; 15/15 pruebas en vivo contra Paperclip 127.0.0.1:3101 (health, adaptadores, agentes con secret_ref, MIS-1 done, runs ≥4, evento adapter.invoke, costes ≥32645 tokens, dashboard, budgets, secretos sin valor, 404/400 reales). Objetos de prueba creados con prefijo "[auto-test]" (MIS-3 cancelada, rutina archivada, secreto AUTO_TEST_SECRET_PCC).
- Hallazgo del cliente: `GET /companies/{c}/issues` pagina por `limit/offset` (sin cursor); `POST /routines/{id}/run` existe (422 sin asignado).
- `@mc/catalog`: build, typecheck y 16/16 pruebas; `validate` sobre la semilla: 22 capacidades válidas, 0 errores, 0 avisos. Solo tres capacidades figuran como "probada" (hermes-api-server, paperclip-hermes-gateway, modelo-simulado-stub), todas con evidencia de este entorno Cloud; el resto "descubierta"/"pendiente".
- `@mc/node-agent` (ajuste): confirmación obligatoria en los 5 comandos; latido con maxHeavyJobs/activeHeavyJobs/nodeAgentUrl; 20/20 pruebas.
- `@mc/hermes-mock` (SIMULACIÓN del API server de Hermes): build, typecheck y 25/25 pruebas (3 ejecuciones consecutivas iguales). Imita 401/404/405/capabilities comprobados en vivo contra el Hermes real (solo lecturas); estados de run reales (queued→running→stopping→completed|failed|cancelled|interrupted); 7 fallos inyectables. Pendiente: probarlo con el adaptador REAL de Paperclip (tarea en curso).

## 2026-10-08 08:53–08:56 UTC — BFF (`@mc/bff`) construido y probado contra Paperclip real
- build/typecheck OK; `pnpm --filter @mc/bff test` → 39/39 sin Paperclip (API demo, unitarias, cliente falso, servidor); con `MC_PAPERCLIP_URL` → 45/45 (6 en vivo: health con avisos, overview, MIS-1 delivered con eventos escalated/message MC-STUB-OK, agente hermes, actividad/agenda/docs/equipos, misión [auto-test] por POST).
- Misión de prueba MIS-17 creada por el BFF con `Idempotency-Key` (segundo POST devuelve la misma misión); issue con reviewPolicy human_only e `idempotencyKey` de Paperclip; línea de tiempo fusionada: created → assigned → run_started(assignment) → run_finished → message MC-STUB-OK → retry → … → system/escalated a los 94 s (vigilante 2/2 → blocked). Evento SSE `mission.changed` verificado.
- Agentes creados por MC: permissions canCreateAgents/canCreateSkills=false; runtimeConfig.heartbeat {maxConcurrentRuns 1, maxDailyRuns 40, maxDailyCostCents 500}.
- Lo que NO demuestra: adapterConfig de claude_local/codex_local/grok_local no verificado creando agentes reales; límites maxMinutes/maxSteps se guardan pero no se imponen; reenvío de comandos al node-agent solo en demo.

## 2026-10-08 08:45–08:56 UTC — Fallos principales con el adaptador REAL `hermes_gateway` contra el mock de Hermes (SIMULADO)
Informe completo: docs/evidencias/fallos-adaptador-mock.md (generado por tests/lab/fallos.test.mjs). 9 agentes "[auto-test fallos]" creados y pausados al terminar.
| Escenario | Observado | Veredicto |
| --- | --- | --- |
| Camino feliz | assignment succeeded 3,1 s; MC-MOCK-OK; Idempotency-Key = id del run; X-Hermes-Session-Key por tarea; 2 runs de reparación → blocked → revisión → done; tokens 801/18 unpriced | cubre |
| Corte de SSE (tras 2 eventos) | el adaptador reconecta y además sondea el estado; run succeeded 4,7 s; sin duplicar; log "event stream disconnected: terminated" | cubre |
| Ejecutor colgado | timeoutSec 15 → run timed_out (errorCode `timeout`) a 16,1 s; POST /stop al mock; sin reintento | cubre |
| Fallo del run | failed, errorCode hermes_gateway_run_failed; 1 solo run en 90 s; issue blocked; evento "Automatic recovery stopped" | cubre |
| Clave rechazada (401) | failed, errorCode hermes_gateway_auth_failed, mensaje accionable; sin tormenta de reintentos | cubre |
| 429 (concurrencia) | failed, hermes_gateway_rate_limited; sin reintento ni respeto de Retry-After | parcial (MC debe encolar) |
| Duplicados (invoke ×2) | aserción de la prueba mal planteada con duplicateReplayAsNew; pendiente de corregir la prueba | no cubre (prueba) |
| Reinicio del ejecutor a mitad | el run remoto se pierde; Paperclip cierra timed_out a los 45 s (404 del mock reiniciado → "falling back to polling"); sin runs adicionales; issue blocked con `issue.execution_recovery_settled {replay: not_authorized, outcome: blocked}` | parcial (MC debe detectar y re-despachar) |
Lo que NO demuestra: mock ≠ Hermes real; un solo equipo; sin HTTPS; reinicio del servidor Paperclip no simulado; coste en dinero no demostrado.

## 2026-10-08 08:35–08:40 UTC — Restauración completa probada entre dos instancias de Paperclip (laboratorio)
Informe literal: docs/evidencias/restauracion-lab.md. Scripts: scripts/common/{backup-full,restore-files,restore-db,verify-restore}.mjs (ejecutados de verdad en Linux).
- `db:backup --json` con la instancia viva arriba → paperclip-20261008-083519.sql.gz (141 949 bytes).
- Segunda instancia nueva en el puerto 3102 (PostgreSQL embebido en 54330, no 54329) → `/api/companies` = [].
- Copia de `secrets/master.key`, `decision-signing.key` y `.env` + `restore-db.mjs --no-psql` (motor JS de `runDatabaseRestore`, 2515 sentencias, 8,4 s) → `/api/companies` lista "Mission Control — piloto"; agentes hermes_gateway con `apiKey.type == secret_ref`; secreto HERMES_API_SERVER_KEY_LAB presente; `secret-providers/health` reporta la master.key; MIS-1 `done`; los 3 secretos se descifran con la clave restaurada y fallan con una clave aleatoria. **8/8**.
- Hallazgos: `db:backup` usa el puerto de config.json aunque PG escuche en otro (backup-full.mjs lo detecta); `invite create` necesita `{"allowedJoinTypes":"agent"}`; `join approve` exige un agente con rol `ceo` (409 si no); HTTP a IP de Tailscale → `hermes_gateway_plain_http_remote_denied`.
- Lo que NO demuestra: Windows/macOS, servicio launchd/systemd, `update --rollback`, segundo equipo real.

## 2026-10-08 09:0x UTC — Panel (`@mc/ui`) con datos REALES vía BFF en modo paperclip
- `@mc/ui`: typecheck, build y 32/32 pruebas; 22 capturas con datos simulados (`?mock=1`) en apps/ui/docs-assets/.
- BFF arrancado en modo paperclip (puerto 3300) sirviendo la UI compilada: `GET /api/mc/health` → paperclip reachable v2026.1005.0, catálogo 23 capacidades; `overview` → 24 misiones, 86,3 % de éxito, 20 agentes, 108 703 tokens de entrada; `ideas` → N01, N02, N05 "sin-decision".
- Capturas con datos reales (Chromium headless): apps/ui/docs-assets/real-{cockpit,misiones,agentes,salud,ideas}.png. Cockpit muestra 25 misiones, 85 % de éxito, equipos "Sin datos" (sin node-agent conectado). Sin errores de página registrados en las vistas capturadas.

## 2026-10-08 09:2x UTC — Batería completa del workspace (`pnpm -r test`, sin variables de entorno de laboratorio)
| Paquete | Pruebas | Pasan | Fallan | Omitidas |
| --- | --- | --- | --- | --- |
| apps/bff | 39 | 39 | 0 | 0 |
| apps/node-agent | 20 | 20 | 0 | 0 |
| apps/ui | 32 | 32 | 0 | 0 |
| packages/catalog | 16 | 16 | 0 | 0 |
| packages/hermes-mock | 26 | 26 | 0 | 0 |
| packages/paperclip-client | 31 | 16 | 0 | 15 (en vivo, requieren PAPERCLIP_URL; pasaron 15/15 cuando se ejecutaron) |
| tests | 9 | 9 | 0 | 0 (los 8 escenarios de laboratorio requieren MC_PAPERCLIP_URL) |
| **Total** | **173** | **158** | **0** | **15** |
`pnpm -r typecheck` en verde en los 8 paquetes. Además, en vivo: cliente 15/15, BFF 6/6, `lab/e2e.mjs` 16/16, 8 escenarios de fallo registrados.

## 2026-10-08 09:08 UTC — Suite de fallos re-ejecutada (8/8 escenarios registrados, 599 s)
- `pnpm --filter @mc/tests test:lab` → 8 pass / 0 fail. Escenario 7 (duplicados) corregido: dos `POST /agents/{id}/heartbeat/invoke` simultáneos crean **dos runs on_demand distintos** (dos POST al mock con Idempotency-Key distintas): Paperclip **no deduplica** invocaciones manuales ni liga el run a la issue → veredicto parcial; MC debe usar el wakeup con idempotencia o un candado propio.
- Hallazgos adicionales: tras cualquier run failed/timed_out la tarea pasa a `blocked` (`issue.execution_recovery_settled {outcome: blocked, replay: not_authorized}`) sin reintento; el 429 no se reintenta; un run fallido puede dejar igualmente un comentario del agente con texto parcial (comentario ≠ éxito); con el ejecutor reiniciado el adaptador insiste ~2 peticiones/s hasta `timeoutSec` (con el 600 s por defecto, 10 min colgado).
- Objetos "[auto-test fallos]" que quedaron en la instancia: agentes pausados, tareas canceladas/cerradas y un secreto por ejecución.

## 2026-10-08 09:3x UTC — BFF tras las tres correcciones
- `pnpm --filter @mc/bff test` con laboratorio → **47/47** (41 locales + 6 en vivo). `rerunMission` usa `POST /agents/{id}/wakeup` con idempotencyKey e issueId (ruta existente en el build vivo; comprobado sobre MIS-9 → run on_demand ligado a la issue) con candado de 60 s por misión; el resultado de una misión solo proviene de runs no fallidos; `timeoutSec` por defecto 300 s configurable en Ajustes.
