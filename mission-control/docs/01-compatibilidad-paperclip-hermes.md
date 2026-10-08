# Compatibilidad de Paperclip y del adaptador Hermes Gateway (verificación del 8 oct 2026)

Claves: **[H]** comprobado en este entorno Cloud (comandos y salidas en `06-evidencias.md`) · **[F]** leído en código/documentación con cita · **[I]** inferencia. Versiones: Paperclip **npm `paperclipai@2026.1005.0`** (build publicado, el que correrá en tus equipos) y clon `paperclipai/paperclip@5717523b` (más nuevo que el publicado: cuando difieren, manda el publicado); Hermes clon `NousResearch/hermes-agent@a28a5d03` (tu Mac tiene `v0.21.4+canary.20261006`, commit `3d304a1`: contrato no confirmado allí).

## Veredicto

**Paperclip sirve como base del piloto y el adaptador `hermes_gateway` funciona de punta a punta** [H]: solicitud → despertar automático por asignación → `POST /v1/runs` al servidor API real de Hermes → resultado como comentario → vigilante con tope de 2 reintentos y escalado al humano → revisión humana → `done`, con consumo registrado por agente. Lo comprobamos con un **modelo simulado** detrás de Hermes y en **un solo equipo Linux**. Cuatro hallazgos cambian el plan original y están incorporados en `03-arquitectura.md` §5b:

1. **Windows nativo no está soportado** por Paperclip para instalación gestionada ni servicio → Paperclip va en **WSL2** (o en la Mac). [F]
2. **No hay `db:restore`**; el PostgreSQL embebido no trae `psql`. La restauración se hace con `runDatabaseRestore` de `@paperclipai/db` (nuestro `scripts/common/restore-db.mjs`) y exige respaldar también `secrets/master.key`, `decision-signing.key`, `.env` y `config.json`. [F]
3. **Un Hermes remoto necesita HTTPS** en la tailnet (`tailscale serve`); `tailscale-https-broker` de Paperclip no sirve para eso. [F]
4. **El presupuesto en centavos no ve el consumo de `hermes_gateway`** (`costStatus: unpriced`, `model: unknown`) → los topes son `maxDailyRuns`/`maxDailyCostCents` por agente y una tabla de precios propia en MC. [H]

## 1. Lo comprobado aquí [H]

| Comprobación | Resultado |
| --- | --- |
| Arranque de Paperclip 2026.1005.0 con PostgreSQL embebido | OK como usuario sin privilegios (`initdb` rechaza root). Banner: `local_trusted`, loopback, migraciones aplicadas, heartbeat 30 s, respaldo automático cada 60 min |
| API sin autenticación en loopback (`local_trusted`) | `GET /api/companies` → 200; OpenAPI 3.0 con 728 rutas |
| Adaptadores integrados | 16; `hermes_gateway` presente, `supportsSkills: false`, `supportsInstructionsBundle: false`; `hermes_local`, `claude_local`, `codex_local`, `grok_local`, `kimi_local` (Moonshot Kimi, no Xiaomi) soportan skills |
| Esquema de `hermes_gateway` | `apiBaseUrl`, `apiKey` (secreto), `dangerouslyAllowInsecureRemoteHttp` (false), `sessionKeyStrategy` (issue), `timeoutSec` (600), `eventReconnectMs` (2000), `paperclipApiUrl`, `headers`, `instructions` |
| Prueba de humo CI-safe del adaptador (clon) | 6/6 |
| Hermes API server (clon, Python 3.14) | 142 pruebas unitarias pasan; `GET /health`; `/v1/capabilities` con `runs_idempotency` durable, `run_events_sse`, `run_stop`, `run_steer`, `X-Hermes-Session-Key` |
| Run directo a Hermes | `POST /v1/runs` → 202; completado en ~3 s; SSE `message.delta`… `run.completed`; replay con misma clave y distinta sesión → **409 idempotency_key_conflict** |
| Recorrido completo vía Paperclip | MIS-1 y MIS-2 (script `lab/e2e.mjs`, 16/16 pasos en 3 s): wake por asignación, `adapter.invoke POST /v1/runs`, comentario con la marca, escalado 2/2 → `blocked`, revisión humana → `done`; costes: tokens por agente, 0 centavos |
| Cliente tipado (`@mc/paperclip-client`) | 15/15 pruebas en vivo contra la instancia |

## 2. Fiabilidad nativa frente a tus requisitos (resumen de `understand/reliability.md`)

| Requisito | Paperclip cubre | Brecha que cubre Mission Control |
| --- | --- | --- |
| Tareas y resultados persistentes | Postgres: issues, comentarios, documentos, runs con `usageJson`/`resultJson`, eventos, actividad, logs NDJSON en disco; respaldo automático | Un solo Postgres local: respaldo fuera del equipo; definir qué es el "entregable" canónico (comentario, documento o work product) |
| Recuperación tras reinicio | Al arrancar: recoge runs huérfanos (`startup reap`), reanuda `queued`, promueve reintentos, reconcilia tareas varadas (una continuación automática; si falla → `blocked`) | Para `hermes_gateway` **no hay reintento por pérdida de proceso** (solo adaptadores locales); el run remoto puede quedar huérfano → MC supervisa y relanza |
| Duplicados y reintentos infinitos | `idempotencyKey` al crear issues (+ dedupe por título 48 h); wakes coalescidos; `Idempotency-Key` = runId hacia Hermes; reparación de disposición 2 intentos (legacy) / 5 con backoff 0-60-120-240-480 s; transitorios 2×30 s; rondas de revisión máx. 3 → escalado humano | Los topes son constantes de código: MC cuenta reintentos por misión y pausa; MC siempre envía `idempotencyKey` propio |
| Credenciales y permisos | Secretos AES-256-GCM con `master.key` (0600) o `PAPERCLIP_SECRETS_MASTER_KEY`; `secret_ref` en configs; redacción en logs; permisos por agente, `trustPreset`, gobernanza MCP con aprobación/cuarentena | Activar `PAPERCLIP_SECRETS_STRICT_MODE=true`; ejecutores con `canCreateAgents/canCreateSkills=false`; las claves de Claude/Codex/Grok/MiMo viven en cada equipo, fuera de Paperclip |
| Registro de ejecutor, modelo, consumo, errores | Runs con `invocationSource`, `errorCode`, tokens, `costStatus`; costes por agente/modelo/proveedor; incidentes de presupuesto; actividad | Con Hermes: `model: unknown`, `unpriced` → MC etiqueta modelo por agente y estima con precios propios; topes diarios por runs |
| Revisión antes de aceptar | `reviewPolicy: human_only`; `executionPolicy.stages`; aprobaciones formales | MC lo impone en toda misión; criterios de aceptación como texto |

## 3. Skills, MCP y plugins con `hermes_gateway`

- `hermes_gateway` **no entrega skills ni paquete de instrucciones** (ausencia de `listSkills/syncSkills`; `supportsInstructionsBundle: false`) [F]. Vías: (a) instalar las skills en el `HERMES_HOME` del equipo (Hermes las ve, Paperclip no las audita); (b) `adapterConfig.instructions`; (c) `adapterConfig.payloadTemplate` (se esparce en el cuerpo de `/v1/runs`, p. ej. `model` como alias de `model_routes`) [F, no probado]; (d) la skill `paperclip-task-bridge` de Hermes con clave de agente `task_bridge` para que Hermes cree/comente issues [F].
- Herramientas de Paperclip hacia el agente: MCP nativo solo para `claude_local`/`codex_local`; el resto por variables de entorno; `hermes_gateway` recibe `invocation_context` que el código del gateway no lee [F].
- Catálogo de skills de Paperclip (17 empaquetadas), biblioteca por empresa, políticas allow/deny, pruebas de skill (`test-runs`) [F]. Plugins: instalación por instancia (`paperclipai plugin install`), manifest con capacidades, sin plugins instalados en el laboratorio [H].

## 4. Las cinco plataformas como ejecutores

| Plataforma | Vía | Estado |
| --- | --- | --- |
| Hermes | `hermes_gateway` (otro equipo, HTTPS) o `hermes_local` (mismo equipo, con skills) | **Probado** (gateway, modelo simulado) |
| Claude | `claude_local` (CLI `claude`, ACP; login por suscripción o `ANTHROPIC_API_KEY`; `model`, `effort`) | Listado en Paperclip; pendiente de tu Windows principal |
| Codex | `codex_local` (CLI `codex`; login ChatGPT o `OPENAI_API_KEY`; `model`, `modelReasoningEffort`) | Listado; pendiente |
| Grok | `grok_local` = CLI **Grok Build** (`grok login` o `XAI_API_KEY`; `model`, `reasoningEffort`). **Grok Bot no es controlable** (sin API/CLI) | Grok Build no instalado en tu Mac; pendiente |
| MiMo | Como modelo dentro de Hermes: `model.provider: xiaomi` + `XIAOMI_API_KEY` en `config.yaml` del equipo (Paperclip no acepta `provider: xiaomi` en `hermes_local`: se fija en Hermes). Sin adaptador propio; `kimi_local` es Moonshot | Pendiente; riesgo de términos del Token Plan para scripts automatizados [F, tus notas] |

## 5. Entrada por Slack

No hay Socket Mode en Paperclip: su conector Slack usa webhooks y exige URL HTTPS pública (`PAPERCLIP_CHAT_WEBHOOK_PUBLIC_URL`) y el ajuste experimental `enableChatConnectors` [F]. Un puente propio en Socket Mode (proceso aparte que crea issues con `idempotencyKey chat:<hilo>`) es el camino previsto en E4 [Pr].

## 6. Qué queda sin verificar

Windows/macOS reales, WSL2, Tailscale y HTTPS, segundo equipo, Hermes `v0.21.4 canary` de tu Mac, modelo real (MiMo) moviendo la tarea a `in_review`, reinicio del servidor en mitad de un run (deducido del código), restauración en un equipo limpio (probada aquí entre dos instancias del laboratorio: ver `docs/evidencias/restauracion-lab.md`), Slack real.
