# @mc/paperclip-client

Cliente HTTP tipado y mínimo de la API de Paperclip (`paperclipai@2026.1005.0`) para el subconjunto que usa Mission Control. Sin dependencias en tiempo de ejecución: solo `fetch` global y Node ≥ 24. ESM, TypeScript estricto.

Lo consume el BFF (`apps/bff`) para el backend `paperclip`. Fuente de rutas y parámetros: el OpenAPI vivo (`GET /api/openapi.json`, 728 rutas) y el código de Paperclip; las formas de respuesta, comprobadas en vivo (ver `docs/09-hechos-tecnicos.md`).

## Uso

```ts
import { createPaperclipClient, PaperclipError } from '@mc/paperclip-client';

const paperclip = createPaperclipClient({
  baseUrl: process.env.MC_PAPERCLIP_URL ?? 'http://127.0.0.1:3100', // admite sufijo /api
  token: process.env.MC_PAPERCLIP_TOKEN || undefined,               // solo instancias no locales
  timeoutMs: 15_000,                                                  // por defecto 15 s
});

try {
  const issue = await paperclip.getIssue('MIS-1');                    // UUID o identificador legible
  const runs  = await paperclip.listHeartbeatRuns(companyId, { agentId, limit: 50 });
} catch (e) {
  if (e instanceof PaperclipError && e.code === 'unreachable') { /* modo degradado: 503 paperclip_unreachable */ }
  else throw e;
}
```

Opciones: `baseUrl` (obligatoria), `token?`, `fetchImpl?` (para pruebas), `timeoutMs?`, `userAgent?` (por defecto `@mc/paperclip-client`).

`client.request(method, path, { query, body, headers, timeoutMs })` es la escotilla de escape: `path` con o sin prefijo `/api`; devuelve el JSON ya parseado (`undefined` en 204). Los valores `undefined`/`null` de `query` se omiten y los arreglos se unen con coma.

## Autenticación

- **`local_trusted` + loopback (127.0.0.1)**: la API no exige autenticación. No pases `token`; el cliente no envía `Authorization`.
- **Instancia remota** (Tailscale, `authenticated`): pasa `token` y el cliente añade `Authorization: Bearer <token>` en cada petición. El token nunca se guarda en el código: viene de `MC_PAPERCLIP_TOKEN`.
- El token se **redacta** (`[redacted]`) en `error.message`, `error.url` y en cualquier cadena de `error.body`. Los secretos de Paperclip nunca devuelven `value`; se referencian como `SecretRef` (`{ type: 'secret_ref', secretId, version }`).

## Errores

Toda respuesta no 2xx (y todo fallo de red) lanza `PaperclipError { status, code, body, url, message }`. `status` es 0 si no hubo respuesta HTTP.

| `code` | Cuándo |
| --- | --- |
| `unreachable` | Sin conexión (ECONNREFUSED, DNS, corte a mitad de respuesta) — `status` 0 |
| `timeout` | Superó `timeoutMs` (se aborta con `AbortController`) — `status` 0 |
| `unauthorized` | 401 o 403 |
| `not_found` | 404 (también "API route not found") |
| `conflict` | 409 |
| `invalid` | 400, 422 y el resto de 4xx (405, 429…). Paperclip devuelve `{ error, details? }` (Zod) en `body` |
| `server` | 5xx, o 2xx cuyo cuerpo no es JSON (p. ej. HTML de un proxy) |

`health()` también lanza (`server`, 503) cuando Paperclip responde `status: "unhealthy"`; el cuerpo queda en `error.body`.

## Tabla método → ruta

Todas las rutas cuelgan de `/api`. `c` = companyId.

| Método del cliente | HTTP | Notas |
| --- | --- | --- |
| `health()` | `GET /health` | |
| `openapi()` | `GET /openapi.json` | |
| `listAdapters()` | `GET /adapters` | |
| `getAdapterConfigSchema(type)` | `GET /adapters/{type}/config-schema` | |
| `listCompanies()` | `GET /companies` | |
| `createCompany(body)` | `POST /companies` | 201 |
| `getCompany(id)` | `GET /companies/{id}` | |
| `listAgents(c)` | `GET /companies/{c}/agents` | |
| `getAgent(id)` | `GET /agents/{id}` | |
| `createAgent(c, body)` | `POST /companies/{c}/agents` | 201 |
| `updateAgent(id, body)` | `PATCH /agents/{id}` | `status`, `adapterConfig` (`replaceAdapterConfig`), `budgetMonthlyCents`… |
| `pauseAgent(id)` / `resumeAgent(id)` / `terminateAgent(id)` | `POST /agents/{id}/pause` · `/resume` · `/terminate` | Extras para `DELETE /api/mc/agents/:id` ("pausa y archiva"); no probadas en vivo |
| `listIssues(c, params?)` | `GET /companies/{c}/issues` | Ver parámetros abajo |
| `getIssue(id)` | `GET /issues/{id}` | Acepta UUID o `MIS-1` (comprobado) |
| `createIssue(c, body)` | `POST /companies/{c}/issues` | 201; con `assigneeAgentId` y estado activo despierta al agente |
| `updateIssue(id, body)` | `PATCH /issues/{id}` | `comment` opcional atómico con el cambio |
| `listIssueComments(id)` | `GET /issues/{id}/comments` | |
| `addIssueComment(id, body)` | `POST /issues/{id}/comments` | 201 |
| `listIssueActivity(id)` | `GET /issues/{id}/activity` | |
| `listCompanyActivity(c, params?)` | `GET /companies/{c}/activity` | `agentId`, `entityType`, `entityId`, `limit` |
| `listHeartbeatRuns(c, params?)` | `GET /companies/{c}/heartbeat-runs` | `agentId`, `limit` (1..1000), `summary` |
| `listLiveRuns(c, params?)` | `GET /companies/{c}/live-runs` | `minCount` (def. 0), `limit`, `distinctTasks` |
| `getRun(runId)` | `GET /heartbeat-runs/{runId}` | `runId` debe ser UUID (si no, 400 `invalid`) |
| `listRunEvents(runId, params?)` | `GET /heartbeat-runs/{runId}/events` | `afterSeq`, `limit` (def. 200) |
| `cancelRun(runId)` | `POST /heartbeat-runs/{runId}/cancel` | No probada en vivo |
| `invokeHeartbeat(agentId, body?)` | `POST /agents/{id}/heartbeat/invoke` | Cuerpo `{}` por defecto; `invocationSource: on_demand` |
| `listApprovals(c, params?)` | `GET /companies/{c}/approvals` | `status` opcional |
| `getApproval(id)` | `GET /approvals/{id}` | |
| `approve(id, body?)` / `reject(id, body?)` / `requestRevision(id, body?)` | `POST /approvals/{id}/approve` · `/reject` · `/request-revision` | `{ decisionNote }`; no probadas en vivo (no hay aprobaciones en el piloto) |
| `listRoutines(c)` | `GET /companies/{c}/routines` | |
| `createRoutine(c, body)` | `POST /companies/{c}/routines` | 201 |
| `getRoutine(id)` | `GET /routines/{id}` | |
| `updateRoutine(id, body)` | `PATCH /routines/{id}` | Comprobada (también `status: archived`) |
| `runRoutine(id, body?)` | `POST /routines/{id}/run` | "Ejecutar ahora". Sin agente asignado responde 422 `Default agent required` (comprobado) |
| `listRoutineRuns(id)` | `GET /routines/{id}/runs` | |
| `getDashboard(c)` | `GET /companies/{c}/dashboard` | |
| `costsByAgent(c, params?)` | `GET /companies/{c}/costs/by-agent` | `from`, `to` (ISO) o `period=all\|month` |
| `costsByAgentModel(c, params?)` | `GET /companies/{c}/costs/by-agent-model` | ídem |
| `listBudgets(c)` | `GET /companies/{c}/budgets/overview` | No existe `GET /budgets` plano; esta es la vista de presupuestos |
| `listSecrets(c)` | `GET /companies/{c}/secrets` | Nunca incluye `value` |
| `createSecret(c, body)` | `POST /companies/{c}/secrets` | 201; `value` solo viaja en la creación |

### Parámetros de `listIssues`

La ruta devuelve un **arreglo plano** (sin `nextCursor`). Parámetros soportados por la ruta y expuestos: `status` (uno o varios; se envían separados por coma — comprobado con `done,todo`), `assigneeAgentId`, `parentId`, `q` (texto), `limit` (1..1000, def. 500; 0 → 400), `offset`, `updatedSince`, `sortField` (`updated|id`), `sortDir`, `projectId`, `includeRoutineExecutions`, `excludeRoutineExecutions`. **`cursor` no existe en Paperclip**: el cliente lo traduce a `offset` si es numérico (`cursor: '40'` → `offset=40`), para que el BFF pueda exponer un cursor opaco basado en desplazamiento.

## Rutas sin esquema de respuesta en OpenAPI (tipado "observado")

El OpenAPI vivo solo describe la respuesta de `GET /health`. En todas las demás, el esquema es `{}`; los tipos de `src/types.ts` salen de respuestas reales y del código fuente de Paperclip, con firma de índice `[k: string]: unknown` para el resto de campos:

- Comprobadas en vivo contra la instancia piloto: `health`, `openapi`, `listAdapters`, `getAdapterConfigSchema`, `listCompanies`/`getCompany`, `listAgents`/`getAgent`, `listIssues`/`getIssue`, comentarios, actividad (issue y empresa), `listHeartbeatRuns`, `getRun`, `listRunEvents`, `listLiveRuns` (vacía), `getDashboard`, `costsByAgent`, `costsByAgentModel`, `listBudgets`, `listSecrets`, `listApprovals` (vacía), `listRoutines`, y en escritura (con objetos `[auto-test]`): `createIssue`, `updateIssue`, `addIssueComment`, `createRoutine`/`getRoutine`/`updateRoutine`, `createSecret`.
- **Tipadas solo por el código fuente, sin comprobar en vivo**: `PaperclipApproval` (columnas de la tabla `approvals`), respuesta de `approve/reject/requestRevision`, `cancelRun`, `invokeHeartbeat` (el doc 09 la describe: `{ id, status: "queued", invocationSource: "on_demand", … }`), `pauseAgent/resumeAgent/terminateAgent`, la respuesta de `runRoutine` (se devuelve como `Record<string, unknown>`) y `listRoutineRuns` (lista vacía vista).
- `reviewPolicy` puede ser `null` en issues creadas sin política (observado); con `human_only` explícito viaja el valor.
- El clon de código en `/home/user/paperclipai/paperclip` es más reciente que la versión publicada: los parámetros se contrastaron con la instancia viva (`limit`, `offset`, `status` por coma, `parentId`, `q`, `agentId`, `summary`, `afterSeq`, `period`/`from`).

## Pruebas

```bash
pnpm --filter @mc/paperclip-client test        # unitarias (servidor falso node:http); compila antes (pretest)
PAPERCLIP_URL=http://127.0.0.1:3101 pnpm --filter @mc/paperclip-client test:live   # en vivo, solo lectura
```

Las pruebas en vivo (`test/live.test.mjs`) se omiten sin `PAPERCLIP_URL`. Variables opcionales: `PAPERCLIP_TOKEN`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_AGENT_ID` (por defecto, los ids del piloto del laboratorio).
