# @mc/bff — backend-for-frontend de Mission Control

Node 24 + Hono. Sirve `/api/mc/*` (contrato en `docs/08-contrato-bff.md`, tipos en `@mc/contracts`) y, si existe `../ui/dist`, la UI compilada en el mismo origen.

Tiene **dos backends intercambiables** con la misma interfaz (`src/backends/types.ts`, `McBackend`):

| Backend | `MC_BACKEND` | Datos |
| --- | --- | --- |
| `paperclip` | `paperclip` | **Reales**: issues, comentarios, actividad, heartbeat runs, agentes, rutinas y costes de tu Paperclip. |
| `demo` | `demo` (por defecto) | **Simulados y siempre etiquetados** (`mode: 'demo'`, procedencia "simulado"): 7 agentes, 4 equipos, 40 misiones con línea de tiempo, informes, rutinas y un ejecutor ficticio que avanza las misiones en curso cada 3 s. Semilla determinista. |

## Arranque

```bash
export PATH=/opt/node24/bin:$PATH   # Node >= 24.11
pnpm install                         # una vez, desde la raíz del monorepo
pnpm --filter @mc/bff build
```

### Modo demo (no necesita Paperclip)

```bash
MC_BACKEND=demo MC_PORT=3300 node apps/bff/dist/main.js
# o en desarrollo:  pnpm --filter @mc/bff dev
```

El banner de arranque muestra `MODO: DEMO` y `DEMO — DATOS SIMULADOS`. Abre `http://127.0.0.1:3300/api/mc/health`.

### Modo paperclip (datos reales)

```bash
export MC_BACKEND=paperclip
export MC_PAPERCLIP_URL=http://127.0.0.1:3100
export MC_PAPERCLIP_COMPANY_ID=<id de la empresa>     # opcional; si falta, la primera
export MC_NODE_AGENT_TOKEN=$(openssl rand -hex 32)    # para aceptar latidos de node-agent
export MC_ELECTIONS_FILE="/ruta/Registro de elecciones.md"
node apps/bff/dist/main.js
```

El banner muestra `MODO: PAPERCLIP`. Si Paperclip no responde, la API devuelve `503 paperclip_unreachable` con `details.baseUrl`.

## Variables de entorno

Ver `.env.example`. Resumen: `MC_BACKEND`, `MC_PORT` (3300), `MC_HOST` (127.0.0.1), `MC_PAPERCLIP_URL`, `MC_PAPERCLIP_TOKEN`, `MC_PAPERCLIP_COMPANY_ID`, `MC_NODE_AGENT_TOKEN`, `MC_DATA_DIR` (`./data`, SQLite `mc.sqlite`), `MC_CATALOG_PATH`, `MC_ELECTIONS_FILE`, `MC_MODEL_PRICES_FILE`, `MC_STATIC_DIR`, `MC_ALLOWED_HOSTS` (hosts del panel además de localhost/IPs/`*.ts.net`), `MC_LOCAL_MACHINE_ID` (equipo de Paperclip; único cuyo Hermes puede ser loopback), y por equipo `MC_HERMES_SECRET_<MACHINEID>`, `MC_HERMES_URL_<MACHINEID>` (manda sobre el latido; obligatoria para equipos remotos), `MC_NODE_AGENT_URL_<MACHINEID>` (el id en mayúsculas con `_`, p. ej. `WIN_LAPTOP_1`). No hay credenciales en el código: todo sale del entorno. Defensas del BFF (tras la revisión independiente): `Host` conocido obligatorio (403), `Origin`/`Sec-Fetch-Site` del propio panel en mutaciones (403), JSON explícito en cuerpos (415), cuerpo ≤ 2 MiB (413) y lista de destinos permitidos para la URL de Hermes de los latidos (400).

## Qué es real y qué es simulado

| Elemento | `paperclip` | `demo` |
| --- | --- | --- |
| Misiones, estados, comentarios, runs, tokens | Real (Paperclip) | Simulado |
| Mensajes entre agentes | Comentarios reales del agente | Plantillas de texto |
| Plan de la misión y su aprobación | **Del BFF** (SQLite): regla del catálogo | Simulado en memoria |
| Equipos y salud | Real **si** el node-agent envía latidos; si no, `unknown` | Simulado |
| Catálogo de capacidades | Real (YAML validado con `@mc/catalog`) | Real |
| Ideas (Registro de elecciones) | Real, solo lectura | Real, solo lectura |
| Coste | `unpriced` salvo modelo conocido en Ajustes | Inventado |

Cada `MissionDetail` trae `provenance` con esa información y `GET /api/mc/health` trae `notes`.

## Cómo se proyecta Paperclip

- Estados: `backlog`/`todo` → `briefing`, `in_progress` → `ongoing`, `in_review` → `review`, `done` → `delivered`, `blocked` → `blocked`, `cancelled` → `cancelled`.
- **Línea de tiempo** = actividad de la issue + comentarios + runs (+ plan del BFF), ordenados por `at`. Mapeo: `issue.created` → `created`; run de asignación → `assigned`; comentarios de agente/usuario → `message`; runs → `run_started` / `run_finished` / `run_failed`; `issue.disposition_repair_escalated` → `escalated`; cambios de estado → `status_changed` (`review_requested` al pasar a `in_review`, `accepted` al cerrar el operador). El `replay` incluye además los eventos de ruido y `raw`.
- **Reintentos**: `retryCount` cuenta los runs con `retryOfRunId`, `scheduledRetryAttempt > 0` o `invocationSource = automation` de la issue (reparaciones del vigilante), más los reintentos manuales hechos desde MC; cada uno genera un evento `retry`.
- Estados de run: `scheduled_retry` → `queued`; `interrupted` → `failed` (`errorCode: interrupted`).
- **Crear misión**: `createIssue` con `idempotencyKey` (UUID de la misión), título único (`… · a1b2c3`, el sufijo se oculta en la UI), `reviewPolicy: human_only` si `finish = review_first`, y un bloque en español (límites, entrega, ámbito, idea) en la descripción. Metadatos propios (equipo, límites, ámbito, idea) en SQLite `missions_meta`. Equipo `manual` → primer agente en la issue padre y subtareas (`parentId`) para el resto; `rules` → `matchCapabilities` del catálogo, issue en `backlog` con plan pendiente hasta aprobar; `boss` → el agente jefe. La cabecera `Idempotency-Key` del BFF se guarda 24 h en SQLite (misma clave y cuerpo → misma misión; otro cuerpo → 409).
- **Agentes**: `hermes` y `mimo` → `hermes_gateway` (URL del API server desde el último latido del node-agent del equipo; clave como `secret_ref` con el id guardado en SQLite o en `MC_HERMES_SECRET_<EQUIPO>`; MiMo no tiene adaptador propio: se anota en las instrucciones que el modelo es MiMo y se configura en el perfil de Hermes); `claude` → `claude_local`; `codex` → `codex_local`; `grok` → `grok_local`. Todo agente creado por MC lleva `permissions: { canCreateAgents: false, canCreateSkills: false }` y `runtimeConfig.heartbeat = { enabled: false, maxConcurrentRuns: 1, maxDailyRuns: 40, maxDailyCostCents: 500 }` (ajustables en Ajustes → `agentDefaults`, que también fija `timeoutSec` de los `hermes_gateway`: 300 s por defecto en vez de los 600 s del adaptador, para que un ejecutor reiniciado no deje la tarea colgada 10 minutos), porque `hermes_gateway` informa el coste como `unpriced` y el presupuesto en centavos nunca se dispara; los topes diarios de runs sí. `DELETE` pausa el agente (conserva el historial) y lo oculta.
- **Ajustes**: `GET/PUT /api/mc/settings` (además del contrato acepta `hermesSecretIds` por equipo y `agentDefaults`; solo ids, nunca claves).

## Latidos de node-agent

`POST /api/mc/machines/:id/heartbeat` exige `Authorization: Bearer $MC_NODE_AGENT_TOKEN` (comparación en tiempo constante). En modo `paperclip` sin token se rechazan todos (401). En modo `demo` sin token solo se aceptan desde loopback y `health` lo dice. Estado del equipo: `online` < 90 s, `stale` < 10 min, después `offline`; `unknown` si nunca envió latido. Los cambios de estado salen por SSE (`machine.changed`).

## SSE

`GET /api/mc/events`: `event: <type>` + `data: <json>` (`McEvent`), latido cada 25 s. En `paperclip` se alimenta de un sondeo cada 5 s (cambios de estado/actualización de issues, estado de runs, estado de agentes, actividad nueva y comentarios nuevos); en `demo`, del ejecutor simulado.

## Límites del hito 1

- **Las aprobaciones del plan viven en el BFF (SQLite), no en las `approvals` de Paperclip.** Aprobar solo cambia la issue a `todo` y, si Paperclip no despertó al agente, lo despierta con `invokeHeartbeat`.
- **No hay chat con agentes** (`agent chat` no está incluido).
- **Estimación de coste solo cuando se conoce el modelo**: si el run no informa modelo (`unknown`) y el agente no tiene `modelLabel` con precio en Ajustes, `estimatedCents` es `null` y `costStatus: 'unpriced'`. La tabla incluye `mimo-v2.6-pro` con números de **ejemplo, ajustar**.
- Ante un `429` del proveedor, Paperclip deja la tarea en `blocked`; el operador la relanza desde el panel (Reintentar). La política de encolado automático queda para E2.
- **Reintentar** usa `POST /agents/{id}/wakeup` con `idempotencyKey: mc:rerun:<misión>:<n>` e `issueId` (liga el run a la issue); si el build no tiene la ruta cae a `heartbeat/invoke`. Un candado de 60 s por misión evita que dos clics seguidos creen dos runs.
- `MissionDetail.result` solo sale de un run `succeeded`; el comentario de un run fallido o con timeout aparece en la línea de tiempo como mensaje `[run fallido]`.
- `limits.maxMinutes/maxSteps` se guardan y se escriben en la descripción, pero el BFF aún no los hace cumplir (no vigila ni corta runs).
- Documentos: comentarios de agente con ≥ 120 palabras + notas propias (`mc-note`, en SQLite; no se escriben en Paperclip todavía).
- El `run-now` de rutinas usa `POST /routines/{id}/run` de Paperclip (422 si la rutina no tiene agente asignado → `409`). Los cron de Hermes se listarán cuando el node-agent los informe.
- El mapa de calor y la serie diaria se calculan en UTC.
- Comandos de equipo: el BFF reenvía al node-agent solo si hay `MC_NODE_AGENT_URL_<EQUIPO>`; en demo se simulan.

## Desarrollo y pruebas

```bash
pnpm --filter @mc/bff build        # tsc → dist/
pnpm --filter @mc/bff typecheck
pnpm --filter @mc/bff test         # compila y corre node:test (demo, cliente falso de Paperclip, servidor real)

# pruebas EN VIVO (gated): crean como máximo UNA issue "[auto-test] …" y esperan hasta ~2.5 min
MC_PAPERCLIP_URL=http://127.0.0.1:3101 MC_PAPERCLIP_COMPANY_ID=<id> pnpm --filter @mc/bff test
```

Estructura: `src/app.ts` (fábrica `createApp({ backend, services, … })`), `src/server.ts` + `src/main.ts` (entorno → backend, banner, estáticos con respaldo SPA), `src/backends/{types,demo,paperclip}.ts`, `src/machines.ts` (registro SQLite), `src/ideas.ts`, `src/catalog.ts`, `src/settings.ts`, `src/sse.ts`, `src/timeline.ts`, `src/aggregate.ts`.
