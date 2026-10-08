# Contrato de la API del BFF (`/api/mc/*`) — v0 (hito 1)

Tipos en `packages/contracts/src/index.ts`. Todas las respuestas son JSON salvo `GET /api/mc/events` (SSE). Errores con la forma `ApiError`.

El BFF corre en el puerto **3300** por defecto y sirve también la UI compilada (`apps/ui/dist`) para que todo quede en un solo origen. Variables de entorno (todas con prefijo `MC_`):

| Variable | Valor por defecto | Uso |
| --- | --- | --- |
| `MC_BACKEND` | `demo` | `paperclip` para datos reales; `demo` para el backend simulado (etiquetado en la UI) |
| `MC_PORT` | `3300` | Puerto del BFF |
| `MC_PAPERCLIP_URL` | `http://127.0.0.1:3100` | Base de la API de Paperclip |
| `MC_PAPERCLIP_TOKEN` | vacío | Bearer para instancias no locales (vacío en `local_trusted` por loopback) |
| `MC_PAPERCLIP_COMPANY_ID` | vacío | Empresa de Paperclip que MC administra (si falta, usa la primera) |
| `MC_NODE_AGENT_TOKEN` | obligatorio en `paperclip` | Token compartido para los latidos de node-agent |
| `MC_DATA_DIR` | `./data` | SQLite propio (`mc.sqlite`), caché y notas |
| `MC_CATALOG_PATH` | `../../packages/catalog/catalog` | Carpeta YAML del catálogo |
| `MC_ELECTIONS_FILE` | vacío | Ruta del `Registro de elecciones.md` (solo lectura) |
| `MC_MODEL_PRICES_FILE` | vacío | JSON con precios por modelo para estimar consumo |
| `MC_ALLOWED_HOSTS` | vacío | Nombres de host (sin puerto, separados por coma) con los que se abre el panel además de `localhost`, IPs literales y `*.ts.net`; también se admiten como destino de Hermes en los latidos. Cualquier otro `Host` recibe `403 forbidden_host` (defensa frente a DNS rebinding) |
| `MC_LOCAL_MACHINE_ID` | `win-principal` | Equipo donde corren Paperclip y el BFF: es el único cuyo node-agent puede anunciar Hermes en loopback. Para los demás equipos el BFF exige `MC_HERMES_URL_<MACHINEID>` (URL alcanzable desde Paperclip, HTTPS en la tailnet) |
| `MC_HERMES_URL_<MACHINEID>` | vacío | URL del API server de Hermes de un equipo tal como la alcanza Paperclip; **manda sobre la URL del latido**. El id en mayúsculas con `_` (`WIN_LAPTOP_1`, `MAC`) |
| `MC_HERMES_SECRET_<MACHINEID>` | vacío | Id (nunca el valor) del secreto de Paperclip con la clave del API server de ese equipo; alternativa a `PUT /settings` (`hermesSecretIds`) |
| `MC_NODE_AGENT_URL_<MACHINEID>` | vacío | URL del node-agent de un equipo para reenviar comandos permitidos |

## Endpoints

| Método y ruta | Entrada | Salida | Notas |
| --- | --- | --- | --- |
| `GET /api/mc/health` | — | `HealthReport` | Siempre incluye `mode` y `notes` de procedencia (real/simulado/pendiente) |
| `GET /api/mc/overview` | `?days=14` | `Overview` | Clúster del cockpit: éxito, misiones, duración media, agentes, máquinas, consumo, mapa de calor |
| `GET /api/mc/missions` | `?status=&scope=&q=&limit=&cursor=` | `{ items: MissionSummary[], nextCursor? }` | `status` admite varios separados por coma |
| `POST /api/mc/missions` | `MissionCreateRequest` | `MissionDetail` | Crea la issue (y subtareas en modo manual). `finish=review_first` ⇒ `reviewPolicy=human_only`. En modo `rules` propone plan y queda en `briefing` hasta aprobar |
| `GET /api/mc/missions/:id` | — | `MissionDetail` | Línea de tiempo fusionada (actividad + comentarios + runs) ordenada por `at` |
| `POST /api/mc/missions/:id/plan/approve` | `{ note? }` | `MissionDetail` | Aprueba el plan (aprobación de Paperclip o marca del BFF) y arranca la ejecución |
| `POST /api/mc/missions/:id/plan/reject` | `{ note }` | `MissionDetail` | Rechaza y deja en `briefing` |
| `POST /api/mc/missions/:id/accept` | `{ note? }` | `MissionDetail` | Revisión humana aceptada ⇒ `done` |
| `POST /api/mc/missions/:id/request-changes` | `{ note }` | `MissionDetail` | Vuelve a `in_progress` con comentario para el agente |
| `POST /api/mc/missions/:id/rerun` | `{ note? }` | `MissionDetail` | Nuevo run bajo demanda (cuenta en `retryCount`) |
| `POST /api/mc/missions/:id/stop` | `{ note? }` | `MissionDetail` | Cancela runs activos y marca `cancelled` |
| `GET /api/mc/missions/:id/replay` | — | `{ events: TimelineEvent[] }` | Misma línea de tiempo con `raw` incluido para reproducir paso a paso |
| `GET /api/mc/agents` | `?days=14` | `AgentSummary[]` | Estado `working` cuando hay run activo |
| `POST /api/mc/agents` | `AgentCreateRequest` | `AgentSummary` | Crea el agente en Paperclip con el adaptador según plataforma y equipo; la clave del gateway del equipo debe existir como secreto antes |
| `DELETE /api/mc/agents/:id` | — | `{ ok: true }` | Pausa y archiva en Paperclip (no borra el historial) |
| `GET /api/mc/agents/:id/runs` | `?limit=` | `RunSummary[]` | |
| `GET /api/mc/machines` | — | `MachineSummary[]` | `status` = online (<90 s), stale (<10 min), offline |
| `POST /api/mc/machines/:id/heartbeat` | `MachineHeartbeat` + `Authorization: Bearer` | `{ ok: true, nextIntervalSec }` | Solo node-agent |
| `GET /api/mc/machines/:id/commands` | — | `AllowedCommand[]` | Lista permitida declarada por el node-agent |
| `POST /api/mc/machines/:id/commands/:commandId` | `{ confirm: true }` | `{ ok, stdout, stderr, exitCode, durationMs }` | El BFF reenvía al node-agent; sin entrada libre |
| `GET /api/mc/catalog` | `?tipo=&equipo=&ejecutor=&estado=` | `Capability[]` | |
| `GET /api/mc/catalog/validate` | — | `{ ok, issues: CatalogValidationIssue[] }` | Valida el YAML contra el esquema |
| `GET /api/mc/catalog/match` | `?capabilities=a,b&scope=` | `{ candidates: Array<{ agentId, machineId, score, reasons[] }> }` | Regla de asignación del hito 1 |
| `GET /api/mc/ideas` | — | `Idea[]` | Lee el Registro de elecciones; nunca escribe |
| `GET /api/mc/docs` | `?missionId=&q=` | `DocumentSummary[]` | |
| `GET /api/mc/docs/:id` | — | `{ summary: DocumentSummary, markdown: string }` | |
| `POST /api/mc/docs` | `{ title, markdown, missionId? }` | `DocumentSummary` | Nota propia (`mc-note`) |
| `GET /api/mc/schedule` | — | `RoutineSummary[]` | Rutinas de Paperclip (+ cron de Hermes como solo lectura cuando el node-agent lo informe) |
| `POST /api/mc/schedule/:id/run-now` | — | `{ ok: true }` | Solo `source=paperclip` |
| `GET /api/mc/activity` | `?limit=&cursor=` | `{ items: ActivityItem[], nextCursor? }` | |
| `GET /api/mc/settings` | — | `SharedSettings` | |
| `PUT /api/mc/settings` | `SharedSettings` | `SharedSettings` | |
| `GET /api/mc/events` | SSE | `McEvent` por evento (`event: <type>`, `data: json`) | Latido cada 25 s |

## Reglas de implementación

1. **Misma forma en ambos backends.** `demo` y `paperclip` implementan la interfaz `McBackend` (en `apps/bff/src/backends/types.ts`). La UI no distingue salvo por `mode` y las notas de procedencia.
2. **Nunca ocultar lo simulado.** Toda respuesta del backend `demo` lleva `mode: 'demo'` y la UI muestra una banda permanente "DATOS SIMULADOS".
3. **Sin credenciales en respuestas.** Los secretos de Paperclip solo se referencian por id; el token de node-agent nunca se devuelve.
4. **Idempotencia.** `POST /api/mc/missions` acepta cabecera `Idempotency-Key`; con la misma clave devuelve la misma misión (tabla `idempotency` en SQLite, 24 h; cabecera `Idempotent-Replayed: true`). Además, las claves que viajan a Paperclip (`idempotencyKey` de la issue padre y de cada hija, y el sufijo del título) se **derivan de esa cabecera** (`mc:` + SHA-256), de modo que si la creación falla a medias (padre creada, hija no) el reintento con la misma cabecera recibe de Paperclip la misma padre en vez de crear otra. Sin cabecera se usan UUID aleatorios.
5. **Tiempos.** Toda fecha en ISO 8601 UTC; la UI convierte a la zona del navegador y muestra la zona.
6. **Paginación.** Cursor opaco; `limit` máximo 200.
7. **Errores de dependencia.** Si Paperclip no responde: `503 paperclip_unreachable` con `details.baseUrl`; la UI pasa a modo degradado y lo dice. Las acciones que deciden sobre runs (detener, despertar tras aprobar) **no** tragan ese error: si `/issues/{id}/runs` falla se consulta la lista de runs de la empresa y, si también falla, la acción responde 503 sin marcar nada.
8. **Orden de escritura en acciones.** Primero Paperclip, después SQLite: el plan solo pasa a `approved` si el `PATCH` de la issue tuvo éxito; un reintento (`rerun`) cuyo *wakeup* falla devuelve la issue a su estado anterior y libera el candado de 60 s; detener una misión cierra su plan pendiente para que no cuente como aprobación pendiente.
9. **Defensa frente a navegadores ajenos (CSRF / DNS rebinding / SSRF).** Todas las rutas `/api/mc/*` exigen un `Host` conocido (loopback, IP literal, `*.ts.net` o `MC_ALLOWED_HOSTS`; si no, `403 forbidden_host`). Las mutaciones (`POST/PUT/PATCH/DELETE`) rechazan `Origin` distinto del propio panel y `Sec-Fetch-Site` cross-site (`403 forbidden_origin`), y un cuerpo no vacío debe llegar con `Content-Type: application/json` (`415 unsupported_media_type`), por lo que una petición "simple" sin preflight no puede ejecutar comandos ni crear misiones. El cuerpo se limita a 2 MiB (`413 payload_too_large`). Los latidos autenticados con `MC_NODE_AGENT_TOKEN` quedan exentos de las comprobaciones de navegador. `hermes.apiServer.baseUrl` de un latido solo se acepta si apunta a loopback, una red privada, la tailnet (`100.64.0.0/10`, `*.ts.net`) o `MC_ALLOWED_HOSTS`, sin credenciales ni query; así un latido manipulado no convierte al BFF en sondeador de otros destinos ni envía la clave de Hermes de un equipo a un servidor ajeno. Al crear un agente Hermes, la URL configurada por el operador (`MC_HERMES_URL_<MACHINEID>`) manda sobre la del latido, y un loopback anunciado por un equipo distinto de `MC_LOCAL_MACHINE_ID` se rechaza con 409.
10. **Costes mensuales.** `GET /agents` toma `spentMonthlyCents` del propio agente de Paperclip; el agregado `costs/by-agent` se pide con `from`/`to` del mes UTC en curso (Paperclip ignora cualquier parámetro `period`).
