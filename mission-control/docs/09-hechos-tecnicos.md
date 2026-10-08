# Hechos técnicos comprobados (para quien construye)

Fecha: 2026-10-08, entorno Cloud Linux. Todo lo de aquí se observó en vivo **[H]** salvo lo marcado **[F]** (documentación/código leído). Puertos y rutas del laboratorio local de esta sesión; en los equipos reales cambian según `04-runbooks/`.

## Paperclip (npm `paperclipai@2026.1005.0`)

- Requiere Node ≥ 24.11.0. PostgreSQL embebido (v18.1) no arranca como root (initdb lo prohíbe): en Linux usar un usuario normal; en Windows/macOS el servicio corre con el usuario de sesión.
- Arranque no interactivo: `npx paperclipai@2026.1005.0 onboard --yes -d <dataDir> --no-install-service --run`. Config en `<dataDir>/instances/default/config.json`; DB en `<dataDir>/instances/default/db`; respaldos automáticos cada 60 min en `<dataDir>/instances/default/data/backups` (retención 30 d).
- Modo `local_trusted` + bind loopback: la API **no exige autenticación** desde 127.0.0.1. Base: `http://127.0.0.1:3100/api` (en el laboratorio quedó en 3101 porque 3100 estaba ocupado).
- `GET /api/health` → `{status, version, deploymentMode, authReady, bootstrapStatus}`.
- `GET /api/openapi.json` → OpenAPI 3.0.0 con 728 rutas (copia: `/home/user/mc-lab/paperclip-openapi.json` en esta sesión).
- `GET /api/adapters` → 16 adaptadores integrados. Capacidades relevantes: `hermes_gateway` {supportsSkills: false, supportsInstructionsBundle: false}; `hermes_local`, `claude_local`, `codex_local`, `grok_local`, `kimi_local` (Moonshot Kimi) soportan skills e instrucciones.
- `GET /api/adapters/hermes_gateway/config-schema` → campos: `apiBaseUrl` (req.), `apiKey` (req., secreto), `dangerouslyAllowInsecureRemoteHttp` (false; HTTP remoto bloqueado, loopback permitido), `sessionKeyStrategy` (issue|agent|run|none; def. issue), `timeoutSec` (600), `eventReconnectMs` (2000), `paperclipApiUrl`, `headers` (JSON no secreto), `instructions`.

### Formas de petición usadas (comprobadas)

```jsonc
// POST /api/companies → 201
{ "name": "Mission Control — piloto", "description": "…" }
// → { id, name, issuePrefix: "MIS", budgetMonthlyCents, defaultResponsibleUserId: "local-board", … }

// POST /api/companies/{companyId}/secrets → 201 (la respuesta nunca devuelve value)
{ "name": "HERMES_API_SERVER_KEY_LAB", "provider": "local_encrypted", "managedMode": "paperclip_managed", "value": "<clave>", "description": "…" }
// → { id, key: "hermes_api_server_key_lab", latestVersion: 1, … }

// POST /api/companies/{companyId}/agents → 201
{ "name": "Ejecutor Hermes (lab)", "role": "engineer", "title": "…", "icon": "terminal",
  "adapterType": "hermes_gateway",
  "adapterConfig": { "apiBaseUrl": "http://127.0.0.1:8642",
                     "apiKey": { "type": "secret_ref", "secretId": "<id del secreto>", "version": "latest" },
                     "sessionKeyStrategy": "issue", "timeoutSec": 120, "eventReconnectMs": 2000,
                     "instructions": "…" },
  "capabilities": "…", "budgetMonthlyCents": 500 }
// → { id, status: "idle", runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 20 } }, permissions: { canCreateAgents: true, canCreateSkills: true }, urlKey, avatarUrl, … }
// Nota: una apiKey literal también se convierte en secret_ref al guardarse (test del repo).

// POST /api/companies/{companyId}/issues → 201
{ "title": "…", "description": "…", "status": "todo", "priority": "high",
  "assigneeAgentId": "<agentId>", "reviewPolicy": "human_only" }
// → { id, identifier: "MIS-1", status, workMode: "standard", reviewPolicy, assigneeAgentId, executionRunId, checkoutRunId, … }
// Efecto: Paperclip despierta al agente de inmediato (run con invocationSource "assignment").

// PATCH /api/issues/{id} → 200 (campos: status, priority, assigneeAgentId, reviewPolicy, parentId, comment, executionPolicy, …)
{ "status": "in_review", "comment": "[Operador humano] …" }
{ "status": "done", "comment": "…" }   // → completedAt

// POST /api/issues/{id}/comments → { body (req.), authorType: user|agent|system, attachmentIds, metadata, … }
// POST /api/agents/{agentId}/heartbeat/invoke → 200 { id, status: "queued", invocationSource: "on_demand", triggerDetail: "manual", … }
// GET  /api/companies/{companyId}/heartbeat-runs → [ { id, status: queued|running|succeeded|failed|…, invocationSource: assignment|on_demand|automation, startedAt, finishedAt, error, errorCode, usageJson: { inputTokens, outputTokens, cachedInputTokens, model: "unknown", provider: "hermes_gateway", biller, costStatus: "unpriced", … }, retryOfRunId, scheduledRetryAt, processLossRetryCount, … } ]
// GET  /api/heartbeat-runs/{runId}/events → [ { seq, eventType: lifecycle|adapter.invoke|run.presentation.resolved|…, payload } ]
// GET  /api/issues/{id}/activity → [ { createdAt, action: issue.created|issue.comment_added|issue.disposition_repair_escalated|…, actorType: user|agent|system, details } ]
// GET  /api/issues/{id}/comments → [ { id, body, authorType, authorAgentId, createdAt, … } ]
// GET  /api/companies/{companyId}/dashboard → { agents: {active, running, paused, error}, tasks: {open, inProgress, blocked, done}, costs: {monthSpendCents, monthBudgetCents, monthUtilizationPercent}, pendingApprovals, budgets: {…}, runActivity: [ { date, succeeded, failed, recovered, other, total } ] }
// GET  /api/companies/{companyId}/costs/by-agent → [ { agentId, agentName, agentStatus, costCents, inputTokens, cachedInputTokens, outputTokens, apiRunCount, subscriptionRunCount, avatarUrl } ]
// GET  /api/companies/{companyId}/costs/by-agent-model → [ { agentId, provider, biller, billingType, model, costCents, inputTokens, outputTokens } ]
// Enumeraciones: issue.status = backlog|todo|in_progress|in_review|done|blocked|cancelled; priority = critical|high|medium|low; reviewPolicy = anyone|not_creator|human_only; workMode = standard|ask|planning|skill_test.
// Rutinas: POST /api/companies/{companyId}/routines { title (req.), description, assigneeAgentId, priority, status: active|paused|archived, concurrencyPolicy: coalesce_if_active|always_enqueue|skip_if_active, catchUpPolicy, activityGatePolicy, variables, env }.
// Aprobaciones: GET /api/companies/{companyId}/approvals; POST /api/approvals/{id}/approve { decisionNote }; …/reject; …/request-revision.
```

### Comportamiento observado del vigilante

Cuando el agente respondió sin cambiar el estado de la tarea, Paperclip lanzó dos runs `automation` ("reparación de disposición"), y a los 2/2 intentos escaló: actividad `issue.disposition_repair_escalated` {maxAttempts: 2, routingPolicy: "board_escalation_no_takeover_v1"}, tarea a `blocked`, comentario de sistema "unchanged_source_state_exhausted - Recovery owner: board".

## Hermes Agent (clon a28a5d03, 2026-10-07)

- Python ≥ 3.11 pero el entorno gestionado por `uv` fija 3.14 (`uv sync --python 3.14`). El API server necesita `aiohttp` (extra de gateway).
- API server = plataforma `api_server` del gateway (`gateway/platforms/api_server.py`). Config en `config.yaml`: `platforms.api_server.enabled: true`, `extra.host`, `extra.port` (def. 8642), `extra.key` (o `API_SERVER_KEY` en `.env`; mínimo 16 caracteres). Arranque: `hermes gateway run` (primer plano) o `hermes gateway install|start` (servicio).
- `HERMES_HOME` (variable de entorno) aísla config, estado y claves.
- Proveedor OpenAI-compatible: `model.provider: "custom"`, `model.base_url`, `model.default`; clave en `OPENAI_API_KEY`. Xiaomi MiMo tiene proveedor propio: `XIAOMI_API_KEY`, `XIAOMI_BASE_URL` (`.env.example`).
- Endpoints comprobados (Bearer = API_SERVER_KEY): `GET /health` (sin auth) → `{status: ok, platform: hermes-agent}`; `GET /v1/capabilities`; `POST /v1/runs` {input} con cabeceras `Idempotency-Key` y `X-Hermes-Session-Key` → 202 `{run_id, status: started, replayed}`; `GET /v1/runs/{id}` → `{status: completed, output, usage: {input_tokens, output_tokens, total_tokens, cache_read_tokens, cache_write_tokens}, runtime: {provider, model}}`; `GET /v1/runs/{id}/events` (SSE: `message.delta`, `reasoning.available`, `run.completed`; termina con ": stream closed"); `GET /v1/runs` → 405. Replay con la misma Idempotency-Key y distinto contenido → 409 `idempotency_key_conflict`.
- Coste: un turno trivial envió ≈13 400 tokens de entrada (sistema + herramientas). Recortar toolsets/instrucciones en el perfil que use MC.

## Laboratorio de esta sesión (puertos)

| Servicio | URL | Estado |
| --- | --- | --- |
| Paperclip | http://127.0.0.1:3101 | real |
| Hermes API server | http://127.0.0.1:8642 | real (HERMES_HOME `/home/user/mc-lab/hermes-home`) |
| Modelo simulado | http://127.0.0.1:8700/v1 | simulado |
| Empresa piloto | id `b0d4c18c-7069-499f-8879-26cdc29738dc`, prefijo MIS | real |
| Agente ejecutor | id `5bdd4ae7-fe3c-40a2-a34e-fdd37c623926` (hermes_gateway) | real |
| Issue MIS-1 | id `00eb23cc-70df-46a9-ac3d-8919f03df99a`, `done` | real |
