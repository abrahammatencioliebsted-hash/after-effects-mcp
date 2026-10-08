# Fallos del adaptador `hermes_gateway` contra el mock de Hermes

Generado automáticamente por `tests/lab/fallos.test.mjs` (`pnpm --filter @mc/tests test:lab`) · 2026-10-08T09:08:55.269Z UTC.

> Todo lo de aquí es observado **[H]** en vivo contra el Paperclip real y el adaptador real `hermes_gateway`; el ejecutor remoto es el **mock** (`@mc/hermes-mock`), no un Hermes real.

## Entorno

- Paperclip: `paperclipai@2026.1005.0` (commit 467125fa) en http://127.0.0.1:3101, local_trusted/private
- Adaptador: `@paperclipai/hermes-paperclip-adapter` 2026.1005.0 (tipo `hermes_gateway`)
- Mock de Hermes: `@mc/hermes-mock` 0.1.0 en http://127.0.0.1:18642 (clave generada en tiempo de ejecución, guardada como secreto de Paperclip; nunca escrita aquí)
- Empresa: `b0d4c18c-7069-499f-8879-26cdc29738dc` (objetos con prefijo "[auto-test fallos]")
- Node: v24.21.0
- Fecha de ejecución (UTC): 2026-10-08T09:08:55.269Z
- Agentes creados: 11 (todos pausados al terminar)
- Escenarios registrados: 1, 2, 3, 4, 5, 6, 7, 8

## Resumen por escenario

| # | Escenario | Configuración | Resultado observado | Veredicto | Qué significa para Mission Control |
| --- | --- | --- | --- | --- | --- |
| 1 | Camino feliz | sin fallos; completeDelayMs 1500; timeoutSec 60; reviewPolicy human_only | assignment succeeded en 3.3 s; comentario MC-MOCK-OK; 3 runs (1 assignment + 2 automation); issue blocked → in_review → done; 3 POST /v1/runs (claves = ids de run), tokens in/out 802/18 (== mock); costStatus unpriced | **cubre** | El circuito solicitud → ejecución → resultado → revisión humana funciona de punta a punta contra el adaptador real, y el consumo (tokens) queda registrado por run. Con un ejecutor que no cambia el estado, cada tarea cuesta 2 runs extra y acaba en blocked: MC debe obligar a que el ejecutor registre la disposición. |
| 2 | Corte del SSE | dropSseAfterEvents: 2; completeDelayMs 4000; eventReconnectMs 500 | run succeeded (4.7 s), errorCode -; 2 GET /events (0 con Last-Event-ID), 3 GET /v1/runs/{id} (sondeo), 1 POST /v1/runs; log: "stderr: [hermes-gateway] event stream disconnected: terminated"; tokens 802/18 | **cubre** | Un corte de la conexión de eventos NO pierde el resultado ni duplica el run: el adaptador reconecta solo (y además sondea el estado), por lo que MC no necesita lógica propia para cortes breves de red. No hay Last-Event-ID: la reconexión repite los eventos. |
| 3 | Ejecutor colgado / timeout | hangNextRun: true; timeoutSec 15; eventReconnectMs 500 | run timed_out, errorCode timeout, 16.1 s en Paperclip (16.9 s desde crear la tarea); 1 POST /stop; estado final del run en el mock: cancelled; tras 45 s más: 1 runs ({"assignment":1}), 1 POST /v1/runs; tokens sin usageJson; issue blocked | **cubre** | Un ejecutor colgado no deja el run abierto indefinidamente: a los timeoutSec Paperclip pide stop al ejecutor y cierra el run como timed_out (el build vivo guarda errorCode `timeout`; el código `hermes_gateway_timeout` del adaptador no llega al campo errorCode del run). MC debe fijar un timeoutSec realista por tipo de tarea; no existe otro corte por silencio (umbral del build vivo: 60 min). |
| 4 | Fallo del run | failNextRun: true; ventana de observación 90 s | primer run failed, errorCode hermes_gateway_run_failed; en 90 s: 1 runs {"assignment":1} (sin reintentos); 1 POST /v1/runs; issue blocked (issue.execution_recovery_settled {"outcome":"blocked","replay":"not_authorized"} +0.5 s), asignada=true; comentarios del agente pese al fallo: 1 | **cubre** | Un fallo del ejecutor queda visible (failed + hermes_gateway_run_failed) y NO provoca reintento automático ni tormenta: Paperclip deja la tarea con su dueño pero en blocked (acción de recuperación a cargo del board, a los pocos segundos). Ojo: el texto parcial que el ejecutor llegó a emitir se publica igualmente como comentario del agente aunque el run falló. MC debe vigilar runs failed/blocked y decidir (reintentar, reasignar o escalar al humano), y no tomar un comentario del agente como prueba de éxito. |
| 5 | Clave rechazada | unauthorizedNext: true; ventana de observación 60 s | primer run failed, errorCode hermes_gateway_auth_failed; error: "Hermes gateway HTTP 401. Check adapterConfig.apiKey matches the Hermes API_SERVER_KEY for the running gateway."; en 60 s: 1 runs {"assignment":1}; 1 POST /v1/runs (1 con 401); issue blocked (issue.execution_recovery_settled {"outcome":"blocked","replay":"not_authorized"} +13.1 s) | **cubre** | Una clave rechazada se reporta con un código específico (hermes_gateway_auth_failed) y no se reintenta: no hay tormenta de reintentos, y la tarea pasa a blocked para el board. MC puede distinguir "clave mala" de "ejecutor caído" por el errorCode y avisar al operador para rotar la clave. |
| 6 | Límite de concurrencia | rateLimitNext: true (429 + Retry-After: 1); ventana de observación 90 s | primer run failed, errorCode hermes_gateway_rate_limited (Hermes gateway HTTP 429); en 90 s: 1 runs {"assignment":1}, reintentos programados: 0 (ninguno); 1 POST /v1/runs (1 con 429); algún run succeeded: false; issue blocked (issue.execution_recovery_settled {"outcome":"blocked","replay":"not_authorized"} +11.6 s) | **parcial** | El 429 se trata como cualquier otro fallo: el run queda failed (hermes_gateway_rate_limited) SIN reintento automático en el build vivo (aunque el adaptador lo marca transient_upstream) y la tarea pasa a blocked para el board. Un tope de concurrencia del ejecutor, que es transitorio, exige que MC encole/re-despache por su cuenta y respete Retry-After. |
| 7 | Duplicados | dos POST /heartbeat/invoke {issueId} en <1 s sobre UNA tarea; completeDelayMs 6000; luego duplicateReplayAsNew: true | (a) tarea asignada con run en vuelo + invoke×2: ids distintos, 5 runs {"assignment":1,"on_demand":2,"automation":2}, 4 POST al mock, claves únicas=true; (b) tarea sin asignar + invoke×2: ids distintos, 2 runs on_demand, 2 POST; (d) invoke×2 con idempotencyKey: ids distintos, 2 run(s) on_demand, 2 POST; issueId en el contexto del run on_demand: NO (el endpoint lo ignora); (c) mock duplicateReplayAsNew: sonda directa con la MISMA clave → run_id DISTINTOS (duplica) vs. sin fallo → mismo run_id (replayed); vía Paperclip con ese fallo: 5 runs, 4 POST, 4 claves distintas | **parcial** | Dos invocaciones simultáneas SIN idempotencyKey NO se coalescen: Paperclip crea 2 runs on_demand, cada uno con su propia Idempotency-Key (= su id de run) y su POST al ejecutor, es decir trabajo duplicado; ni siquiera con idempotencyKey en el cuerpo se reduce a un solo run. Además el endpoint legacy ignora issueId. Como Paperclip nunca repite un POST con la misma clave, la idempotencia del ejecutor solo cubre reintentos de red del mismo run y un ejecutor mal portado (duplicateReplayAsNew) no cambia nada vía Paperclip. MC debe deduplicar por su cuenta (idempotencyKey al crear la tarea y al despertar al agente). |
| 8 | Reinicio del ejecutor | completeDelayMs 8000; close() a los 2 s; reinicio 5 s después (estado nuevo, run desconocido); timeoutSec 45 | mock cerrado 2026-10-08T09:06:54.115Z (run running, 0 eventos) y reiniciado 2026-10-08T09:06:59.117Z; run de Paperclip timed_out, errorCode timeout a los 46.1 s; error "Hermes gateway run timed out after 45s."; en 75 s más: 1 runs {"assignment":1} (sin runs adicionales); 1 POST /v1/runs en total; 117 respuestas 404 del mock (sondeo/eventos del run desconocido) antes del timeout; issue blocked (issue.execution_recovery_settled {"outcome":"blocked","replay":"not_authorized"} +12.5 s) | **parcial** | Apagar o reiniciar el ejecutor a mitad de tarea NO se recupera: el adaptador no distingue "ejecutor reiniciado" de "red caída" (ECONNREFUSED y luego 404 del run desconocido se tratan como errores transitorios, con unas 2 peticiones/s) y no abandona hasta agotar timeoutSec; entonces el run queda timed_out y la tarea pasa a blocked para el board, sin re-despacho automático. Con el timeoutSec por defecto (600 s) una tarea quedaría 10 min colgada. MC debe fijar timeoutSec acorde a la tarea y vigilar blocked/timed_out; el re-despacho (con otra Idempotency-Key) puede duplicar trabajo si el ejecutor original sigue vivo. |

## Detalle por escenario

### 1. Camino feliz

- Inicio (UTC): `2026-10-08T08:58:55.984Z` · Fin (UTC): `2026-10-08T09:00:10.569Z` · Duración del escenario: 74.6 s
- Configuración: sin fallos; completeDelayMs 1500; timeoutSec 60; reviewPolicy human_only
- Resultado: assignment succeeded en 3.3 s; comentario MC-MOCK-OK; 3 runs (1 assignment + 2 automation); issue blocked → in_review → done; 3 POST /v1/runs (claves = ids de run), tokens in/out 802/18 (== mock); costStatus unpriced
- Veredicto: **cubre** — El circuito solicitud → ejecución → resultado → revisión humana funciona de punta a punta contra el adaptador real, y el consumo (tokens) queda registrado por run. Con un ejecutor que no cambia el estado, cada tarea cuesta 2 runs extra y acaba en blocked: MC debe obligar a que el ejecutor registre la disposición.

<details><summary>JSON bruto (extractos)</summary>

```json
{
  "agentId": "ec2622e6-a6eb-459e-b148-8e44994602cc",
  "issue": {
    "id": "1afbb2ae-d88e-40c9-9963-285ae794e33d",
    "identifier": "MIS-22",
    "finalStatus": "done"
  },
  "runs": [
    {
      "id": "197f7df8-ef3d-49a7-b40f-6e0af630e72d",
      "source": "assignment",
      "status": "succeeded",
      "errorCode": null,
      "error": null,
      "createdAt": "2026-10-08T08:58:56.121Z",
      "startedAt": "2026-10-08T08:58:56.342Z",
      "finishedAt": "2026-10-08T08:58:58.644Z",
      "seconds": 2.3,
      "exitCode": 0,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "needs_followup",
      "contextIssueId": "1afbb2ae-d88e-40c9-9963-285ae794e33d",
      "usage": {
        "inputTokens": 802,
        "outputTokens": 18,
        "costStatus": "unpriced",
        "model": "unknown"
      }
    },
    {
      "id": "93150e09-b7d6-4cb2-a625-ec1668ce7f0c",
      "source": "automation",
      "status": "succeeded",
      "errorCode": null,
      "error": null,
      "createdAt": "2026-10-08T08:58:58.941Z",
      "startedAt": "2026-10-08T08:58:59.015Z",
      "finishedAt": "2026-10-08T08:59:01.342Z",
      "seconds": 2.3,
      "exitCode": 0,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "needs_followup",
      "contextIssueId": "1afbb2ae-d88e-40c9-9963-285ae794e33d",
      "usage": {
        "inputTokens": 989,
        "outputTokens": 0,
        "costStatus": "unpriced",
        "model": "unknown"
      }
    },
    {
      "id": "27c399a7-84c9-49d2-b053-3259842b4ded",
      "source": "automation",
      "status": "succeeded",
      "errorCode": null,
      "error": null,
      "createdAt": "2026-10-08T08:59:01.651Z",
      "startedAt": "2026-10-08T09:00:06.121Z",
      "finishedAt": "2026-10-08T09:00:08.347Z",
      "seconds": 2.2,
      "exitCode": 0,
      "retryOfRunId": "93150e09-b7d6-4cb2-a625-ec1668ce7f0c",
      "scheduledRetryReason": "issue_disposition_repair",
      "scheduledRetryAttempt": 2,
      "scheduledRetryAt": "2026-10-08T09:00:01.833Z",
      "livenessState": "needs_followup",
      "contextIssueId": "1afbb2ae-d88e-40c9-9963-285ae794e33d",
      "usage": {
        "inputTokens": 91,
        "outputTokens": 0,
        "costStatus": "unpriced",
        "model": "unknown"
      }
    }
  ],
  "assignmentRunDetail": {
    "info": {
      "id": "197f7df8-ef3d-49a7-b40f-6e0af630e72d",
      "source": "assignment",
      "status": "succeeded",
      "errorCode": null,
      "error": null,
      "createdAt": "2026-10-08T08:58:56.121Z",
      "startedAt": "2026-10-08T08:58:56.342Z",
      "finishedAt": "2026-10-08T08:58:58.644Z",
      "seconds": 2.3,
      "exitCode": 0,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "needs_followup",
      "contextIssueId": "1afbb2ae-d88e-40c9-9963-285ae794e33d",
      "usage": {
        "inputTokens": 802,
        "outputTokens": 18,
        "costStatus": "unpriced",
        "model": "unknown"
      }
    },
    "events": [
      {
        "seq": 1,
        "type": "lifecycle",
        "message": "run started"
      },
      {
        "seq": 2,
        "type": "adapter.invoke",
        "message": "adapter invocation"
      },
      {
        "seq": 3,
        "type": "lifecycle",
        "message": "run succeeded"
      },
      {
        "seq": 4,
        "type": "run.presentation.resolved",
        "message": "run presentation resolved"
      },
      {
        "seq": 5,
        "type": "lifecycle",
        "message": "run scratch cleaned"
      }
    ],
    "log": [
      "stdout: [hermes-gateway] creating run at http://127.0.0.1:18642/v1/runs (timeout=60s, session=issue)",
      "stdout: [hermes-gateway] request headers (redacted): {\"Authorization\":\"***REDACTED***\",\"Accept\":\"application/json\",\"Content-Type\":\"application/json\",\"Idempotency-Key\":\"197f7df8-ef3d-49a7-b40f-6e0af630e72d\",\"X-Hermes-Session-Key\":\"[redacted-session-key]\"}",
      "stdout: [hermes-gateway] run created: run_051a86ab990e4cdf9a6b3aaec7e0e8e7",
      "stdout: [hermes-gateway:event] run=run_051a86ab990e4cdf9a6b3aaec7e0e8e7 event=reasoning.available data={\"event\":\"reasoning.available\",\"run_id\":\"run_051a86ab990e4cdf9a6b3aaec7e0e8e7\",\"timestamp\":1791449937.407,\"text\":\"Razonamiento simulado (mock).\",\"seq\":0}",
      "stdout: [hermes-gateway:event] run=run_051a86ab990e4cdf9a6b3aaec7e0e8e7 event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_051a86ab990e4cdf9a6b3aaec7e0e8e7\",\"timestamp\":1791449937.708,\"delta\":\"MC-MOCK-OK: respuesta s\",\"seq\":1}",
      "stdout: [hermes-gateway:event] run=run_051a86ab990e4cdf9a6b3aaec7e0e8e7 event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_051a86ab990e4cdf9a6b3aaec7e0e8e7\",\"timestamp\":1791449938.01,\"delta\":\"imulada del mock de Her\",\"seq\":2}",
      "stdout: [hermes-gateway:event] run=run_051a86ab990e4cdf9a6b3aaec7e0e8e7 event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_051a86ab990e4cdf9a6b3aaec7e0e8e7\",\"timestamp\":1791449938.31,\"delta\":\"mes (input_chars=3205).\",\"seq\":3}",
      "stdout: [hermes-gateway:event] run=run_051a86ab990e4cdf9a6b3aaec7e0e8e7 event=run.completed data={\"event\":\"run.completed\",\"run_id\":\"run_051a86ab990e4cdf9a6b3aaec7e0e8e7\",\"timestamp\":1791449938.612,\"output\":\"MC-MOCK-OK: respuesta simulada del mock de Hermes (input_chars=3205).\",\"usage\":{\"input_tokens"
    ]
  },
  "mockPost": {
    "headers": {
      "host": "127.0.0.1:18642",
      "connection": "keep-alive",
      "authorization": "Bearer ***",
      "accept": "application/json",
      "content-type": "application/json",
      "idempotency-key": "197f7df8-ef3d-49a7-b40f-6e0af630e72d",
      "x-hermes-session-key
… (2560 caracteres omitidos; ver JSON completo en tests/lab/.runtime/)
```

</details>

### 2. Corte del SSE

- Inicio (UTC): `2026-10-08T09:00:10.571Z` · Fin (UTC): `2026-10-08T09:00:16.367Z` · Duración del escenario: 5.8 s
- Configuración: dropSseAfterEvents: 2; completeDelayMs 4000; eventReconnectMs 500
- Resultado: run succeeded (4.7 s), errorCode -; 2 GET /events (0 con Last-Event-ID), 3 GET /v1/runs/{id} (sondeo), 1 POST /v1/runs; log: "stderr: [hermes-gateway] event stream disconnected: terminated"; tokens 802/18
- Veredicto: **cubre** — Un corte de la conexión de eventos NO pierde el resultado ni duplica el run: el adaptador reconecta solo (y además sondea el estado), por lo que MC no necesita lógica propia para cortes breves de red. No hay Last-Event-ID: la reconexión repite los eventos.
- Notas:
  - Peticiones de eventos: [{"at":"2026-10-08T09:00:11.539Z","method":"GET","path":"/v1/runs/run_08b932af1c064946bfc4c0e07649a75e/events","status":null,"idempotencyKey":"f177ea2e-7422-4846-8742-03363fd511d2","sessionKey":"paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:ba2798ff-2631-4726-81c8-c6f0e2febd68:issue:db9054f7-7489-4284-baab-d4261480a35a"},{"at":"2026-10-08T09:00:13.645Z","method":"GET","path":"/v1/runs/run_08b932af1c064946bfc4c0e07649a75e/events","status":200,"idempotencyKey":"f177ea2e-7422-4846-8742-03363fd511d2","sessionKey":"paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:ba2798ff-2631-4726-81c8-c6f0e2febd68:issue:db9054f7-7489-4284-baab-d4261480a35a"}]

<details><summary>JSON bruto (extractos)</summary>

```json
{
  "run": {
    "info": {
      "id": "f177ea2e-7422-4846-8742-03363fd511d2",
      "source": "assignment",
      "status": "succeeded",
      "errorCode": null,
      "error": null,
      "createdAt": "2026-10-08T09:00:10.761Z",
      "startedAt": "2026-10-08T09:00:10.889Z",
      "finishedAt": "2026-10-08T09:00:15.570Z",
      "seconds": 4.7,
      "exitCode": 0,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "needs_followup",
      "contextIssueId": "db9054f7-7489-4284-baab-d4261480a35a",
      "usage": {
        "inputTokens": 802,
        "outputTokens": 18,
        "costStatus": "unpriced",
        "model": "unknown"
      }
    },
    "events": [
      {
        "seq": 1,
        "type": "lifecycle",
        "message": "run started"
      },
      {
        "seq": 2,
        "type": "adapter.invoke",
        "message": "adapter invocation"
      },
      {
        "seq": 3,
        "type": "lifecycle",
        "message": "run succeeded"
      },
      {
        "seq": 4,
        "type": "run.presentation.resolved",
        "message": "run presentation resolved"
      }
    ],
    "log": [
      "stdout: [hermes-gateway] creating run at http://127.0.0.1:18642/v1/runs (timeout=60s, session=issue)",
      "stdout: [hermes-gateway] request headers (redacted): {\"Authorization\":\"***REDACTED***\",\"Accept\":\"application/json\",\"Content-Type\":\"application/json\",\"Idempotency-Key\":\"f177ea2e-7422-4846-8742-03363fd511d2\",\"X-Hermes-Session-Key\":\"[redacted-session-key]\"}",
      "stdout: [hermes-gateway] run created: run_08b932af1c064946bfc4c0e07649a75e",
      "stdout: [hermes-gateway:event] run=run_08b932af1c064946bfc4c0e07649a75e event=reasoning.available data={\"event\":\"reasoning.available\",\"run_id\":\"run_08b932af1c064946bfc4c0e07649a75e\",\"timestamp\":1791450012.337,\"text\":\"Razonamiento simulado (mock).\",\"seq\":0}",
      "stdout: [hermes-gateway:event] run=run_08b932af1c064946bfc4c0e07649a75e event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_08b932af1c064946bfc4c0e07649a75e\",\"timestamp\":1791450013.137,\"delta\":\"MC-MOCK-OK: respuesta s\",\"seq\":1}",
      "stderr: [hermes-gateway] event stream disconnected: terminated",
      "stdout: [hermes-gateway:event] run=run_08b932af1c064946bfc4c0e07649a75e event=reasoning.available data={\"event\":\"reasoning.available\",\"run_id\":\"run_08b932af1c064946bfc4c0e07649a75e\",\"timestamp\":1791450012.337,\"text\":\"Razonamiento simulado (mock).\",\"seq\":0}",
      "stdout: [hermes-gateway:event] run=run_08b932af1c064946bfc4c0e07649a75e event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_08b932af1c064946bfc4c0e07649a75e\",\"timestamp\":1791450013.137,\"delta\":\"MC-MOCK-OK: respuesta s\",\"seq\":1}",
      "stdout: [hermes-gateway:event] run=run_08b932af1c064946bfc4c0e07649a75e event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_08b932af1c064946bfc4c0e07649a75e\",\"timestamp\":1791450013.938,\"delta\":\"imulada del mock de Her\",\"seq\":2}",
      "stdout: [hermes-gateway:event] run=run_08b932af1c064946bfc4c0e07649a75e event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_08b932af1c064946bfc4c0e07649a75e\",\"timestamp\":1791450014.738,\"delta\":\"mes (input_chars=3205).\",\"seq\":3}",
      "stdout: [hermes-gateway:event] run=run_08b932af1c064946bfc4c0e07649a75e event=run.completed data={\"event\":\"run.completed\",\"run_id\":\"run_08b932af1c064946bfc4c0e07649a75e\",\"timestamp\":1791450015.539,\"output\":\"MC-MOCK-OK: respuesta simulada del mock de Hermes (input_chars=3205).\",\"usage\":{\"input_tokens"
    ]
  },
  "mockHistogram": {
    "POST /v1/runs → 202": 1,
    "GET /v1/runs/:runId/events": 1,
    "GET /v1/runs/:runId → 200": 3,
    "GET /v1/runs/:runId/events → 200": 1
  },
  "mockRequests": [
    {
      "at": "2026-10-08T09:00:11.536Z",
      "method": "POST",
      "path": "/v1/runs",
      "status": 202,
      "idempotencyKey": "f177ea2e-7422-4846-8742-03363fd511d2",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:ba2798ff-2631-4726-81c8-c6f0e2febd68:issue:db9054f7-7489-4284-baab-d4261480a35a"
    },
    {
      "at": "2026-10-08T09:00:11.539Z",
      "method": "GET",
      "path": "/v1/runs/run_08b932af1c064946bfc4c0e07649a75e/events",
      "status": null,
      "idempotencyKey": "f177ea2e-7422-4846-8742-03363fd511d2",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:ba2798ff-2631-4726-81c8-c6f0e2febd68:issue:db9054f7-7489-4284-baab-d4261480a35a"
    },
    {
      "at": "2026-10-08T09:00:12.540Z",
      "method": "GET",
      "path": "/v1/runs/run_08b932af1c064946bfc4c0e07649a75e",
      "status": 200,
      "idempotencyKey": "f177ea2e-7422-4846-8742-03363fd511d2",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:ba2798ff-2631-4726-81c8-c6f0e2febd68:issue:db9054f7-7489-4284-baab-d4261480a35a"
    },
    {
      "at": "2026-10-08T09:00:13.544Z",
      "method": "GET",
      "path": "/v1/runs/run_08b932af1c064946bfc4c0e07649a75e",
      "status": 200,
      "idempotencyKey": "f177ea2e-7422-4846-8742-03363fd511d2",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:ba2798ff-2631-4726-81c8-c6f0e2febd68:issue:db9054f7-7489-4284-baab-d4261480a35a"
    },
    {
      "at": "2026-10-08T09:00:13.645Z",
      "method": "GET",
      "path": "/v1/runs/run_08b932af1c064946bfc4c0e07649a75e/events",
      "status": 200,
      "idempotencyKey": "f177ea2e-7422-4846-8742-03363fd511d2",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:ba2798ff-2631-4726-81c8-c6f0e2febd68:issue:db9054f7-7489-4284-baab-d4261480a35a"
    },
    {
      "at": "2026-10-08T09:00:14.547Z",
      "method": "GET",
      "path": "/v1/runs/run_08b932af1c064946bfc4c0e07649a75e",
      "status": 200,
      "idem
… (331 caracteres omitidos; ver JSON completo en tests/lab/.runtime/)
```

</details>

### 3. Ejecutor colgado / timeout

- Inicio (UTC): `2026-10-08T09:00:16.368Z` · Fin (UTC): `2026-10-08T09:01:18.765Z` · Duración del escenario: 62.4 s
- Configuración: hangNextRun: true; timeoutSec 15; eventReconnectMs 500
- Resultado: run timed_out, errorCode timeout, 16.1 s en Paperclip (16.9 s desde crear la tarea); 1 POST /stop; estado final del run en el mock: cancelled; tras 45 s más: 1 runs ({"assignment":1}), 1 POST /v1/runs; tokens sin usageJson; issue blocked
- Veredicto: **cubre** — Un ejecutor colgado no deja el run abierto indefinidamente: a los timeoutSec Paperclip pide stop al ejecutor y cierra el run como timed_out (el build vivo guarda errorCode `timeout`; el código `hermes_gateway_timeout` del adaptador no llega al campo errorCode del run). MC debe fijar un timeoutSec realista por tipo de tarea; no existe otro corte por silencio (umbral del build vivo: 60 min).

<details><summary>JSON bruto (extractos)</summary>

```json
{
  "run": {
    "info": {
      "id": "9bc0d1bb-9527-439d-8316-513fc28d18c9",
      "source": "assignment",
      "status": "timed_out",
      "errorCode": "timeout",
      "error": "Hermes gateway run timed out after 15s.",
      "createdAt": "2026-10-08T09:00:16.567Z",
      "startedAt": "2026-10-08T09:00:16.670Z",
      "finishedAt": "2026-10-08T09:00:32.809Z",
      "seconds": 16.1,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
      "contextIssueId": "98498f9c-3b97-4a7f-998f-f6d929573d50",
      "usage": null
    },
    "events": [
      {
        "seq": 1,
        "type": "lifecycle",
        "message": "run started"
      },
      {
        "seq": 2,
        "type": "adapter.invoke",
        "message": "adapter invocation"
      },
      {
        "seq": 3,
        "type": "lifecycle",
        "message": "run timed_out"
      },
      {
        "seq": 4,
        "type": "run.presentation.resolved",
        "message": "run presentation resolved"
      },
      {
        "seq": 5,
        "type": "lifecycle",
        "message": "run scratch cleaned"
      }
    ],
    "log": [
      "stdout: [hermes-gateway] creating run at http://127.0.0.1:18642/v1/runs (timeout=15s, session=issue)",
      "stdout: [hermes-gateway] request headers (redacted): {\"Authorization\":\"***REDACTED***\",\"Accept\":\"application/json\",\"Content-Type\":\"application/json\",\"Idempotency-Key\":\"9bc0d1bb-9527-439d-8316-513fc28d18c9\",\"X-Hermes-Session-Key\":\"[redacted-session-key]\"}",
      "stdout: [hermes-gateway] run created: run_c6a65dfd35664a2081b1528b295d7d8c",
      "stdout: [hermes-gateway:event] run=run_c6a65dfd35664a2081b1528b295d7d8c event=reasoning.available data={\"event\":\"reasoning.available\",\"run_id\":\"run_c6a65dfd35664a2081b1528b295d7d8c\",\"timestamp\":1791450017.662,\"text\":\"Razonamiento simulado (mock).\",\"seq\":0}",
      "stdout: [hermes-gateway] stop requested for run run_c6a65dfd35664a2081b1528b295d7d8c"
    ]
  },
  "afterTimeoutRuns": [
    {
      "id": "9bc0d1bb-9527-439d-8316-513fc28d18c9",
      "source": "assignment",
      "status": "timed_out",
      "errorCode": "timeout",
      "error": "Hermes gateway run timed out after 15s.",
      "createdAt": "2026-10-08T09:00:16.567Z",
      "startedAt": "2026-10-08T09:00:16.670Z",
      "finishedAt": "2026-10-08T09:00:32.809Z",
      "seconds": 16.1,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
      "contextIssueId": "98498f9c-3b97-4a7f-998f-f6d929573d50",
      "usage": null
    }
  ],
  "issueTrail": {
    "status": "blocked",
    "assigneeAgentId": "2e48fbf1-9200-4f29-acbe-74eafabf0baf",
    "activity": [
      {
        "at": "2026-10-08T09:00:16.511Z",
        "action": "issue.created",
        "actor": "user",
        "details": {
          "status": "todo"
        }
      },
      {
        "at": "2026-10-08T09:00:35.365Z",
        "action": "issue.execution_recovery_settled",
        "actor": "system",
        "details": {
          "outcome": "blocked",
          "replay": "not_authorized"
        }
      }
    ],
    "comments": []
  },
  "resultJson": null,
  "mockRunState": {
    "status": "cancelled",
    "lastEvent": "run.cancelled",
    "events": 2
  },
  "mockHistogram": {
    "POST /v1/runs → 202": 1,
    "GET /v1/runs/:runId/events": 1,
    "GET /v1/runs/:runId → 200": 16,
    "POST /v1/runs/:runId/stop → 200": 1,
    "GET /health → 200": 1
  },
  "mockRequests": [
    {
      "at": "2026-10-08T09:00:17.261Z",
      "method": "POST",
      "path": "/v1/runs",
      "status": 202,
      "idempotencyKey": "9bc0d1bb-9527-439d-8316-513fc28d18c9",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:2e48fbf1-9200-4f29-acbe-74eafabf0baf:issue:98498f9c-3b97-4a7f-998f-f6d929573d50"
    },
    {
      "at": "2026-10-08T09:00:17.264Z",
      "method": "GET",
      "path": "/v1/runs/run_c6a65dfd35664a2081b1528b295d7d8c/events",
      "status": null,
      "idempotencyKey": "9bc0d1bb-9527-439d-8316-513fc28d18c9",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:2e48fbf1-9200-4f29-acbe-74eafabf0baf:issue:98498f9c-3b97-4a7f-998f-f6d929573d50"
    },
    {
      "at": "2026-10-08T09:00:18.266Z",
      "method": "GET",
      "path": "/v1/runs/run_c6a65dfd35664a2081b1528b295d7d8c",
      "status": 200,
      "idempotencyKey": "9bc0d1bb-9527-439d-8316-513fc28d18c9",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:2e48fbf1-9200-4f29-acbe-74eafabf0baf:issue:98498f9c-3b97-4a7f-998f-f6d929573d50"
    },
    {
      "at": "2026-10-08T09:00:19.268Z",
      "method": "GET",
      "path": "/v1/runs/run_c6a65dfd35664a2081b1528b295d7d8c",
      "status": 200,
      "idempotencyKey": "9bc0d1bb-9527-439d-8316-513fc28d18c9",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:2e48fbf1-9200-4f29-acbe-74eafabf0baf:issue:98498f9c-3b97-4a7f-998f-f6d929573d50"
    },
    {
      "at": "2026-10-08T09:00:20.271Z",
      "method": "GET",
      "path": "/v1/runs/run_c6a65dfd35664a2081b1528b295d7d8c",
      "status": 200,
      "idempotencyKey": "9bc0d1bb-9527-439d-8316-513fc28d18c9",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:2e48fbf1-9200-4f29-acbe-74eafabf0baf:issue:98498f9c-3b97-4a7f-998f-f6d929573d50"
    },
    {
      "at": "2026-10-08T09:00:21.274Z",
      "method": "GET",
      "path": "/v1/runs/run_c6a65dfd35664a2081b1528b295d7d8c",
      "status": 200,
      "idempotencyKey": "9bc0d1bb-9527-439d-8316-513fc28d18c9",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:2e48fbf1-9200-4f29-acbe-74eafabf0baf:issue:98498f9c-3b97-4a7f-998f-f6d929573d50"
    },
    {
      "at":
… (5145 caracteres omitidos; ver JSON completo en tests/lab/.runtime/)
```

</details>

### 4. Fallo del run

- Inicio (UTC): `2026-10-08T09:01:18.766Z` · Fin (UTC): `2026-10-08T09:02:51.364Z` · Duración del escenario: 92.6 s
- Configuración: failNextRun: true; ventana de observación 90 s
- Resultado: primer run failed, errorCode hermes_gateway_run_failed; en 90 s: 1 runs {"assignment":1} (sin reintentos); 1 POST /v1/runs; issue blocked (issue.execution_recovery_settled {"outcome":"blocked","replay":"not_authorized"} +0.5 s), asignada=true; comentarios del agente pese al fallo: 1
- Veredicto: **cubre** — Un fallo del ejecutor queda visible (failed + hermes_gateway_run_failed) y NO provoca reintento automático ni tormenta: Paperclip deja la tarea con su dueño pero en blocked (acción de recuperación a cargo del board, a los pocos segundos). Ojo: el texto parcial que el ejecutor llegó a emitir se publica igualmente como comentario del agente aunque el run falló. MC debe vigilar runs failed/blocked y decidir (reintentar, reasignar o escalar al humano), y no tomar un comentario del agente como prueba de éxito.

<details><summary>JSON bruto (extractos)</summary>

```json
{
  "firstRun": {
    "info": {
      "id": "da0b2c69-ac93-488a-baa4-3833cc494b03",
      "source": "assignment",
      "status": "failed",
      "errorCode": "hermes_gateway_run_failed",
      "error": "Fallo simulado por el mock de Hermes (failNextRun)",
      "createdAt": "2026-10-08T09:01:18.869Z",
      "startedAt": "2026-10-08T09:01:18.962Z",
      "finishedAt": "2026-10-08T09:01:20.536Z",
      "seconds": 1.6,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
      "contextIssueId": "e4c7eaab-462a-4d73-9571-9b67b50e81d6",
      "usage": null
    },
    "events": [
      {
        "seq": 1,
        "type": "lifecycle",
        "message": "run started"
      },
      {
        "seq": 2,
        "type": "adapter.invoke",
        "message": "adapter invocation"
      },
      {
        "seq": 3,
        "type": "lifecycle",
        "message": "run failed"
      },
      {
        "seq": 4,
        "type": "run.presentation.resolved",
        "message": "run presentation resolved"
      },
      {
        "seq": 5,
        "type": "lifecycle",
        "message": "run scratch cleaned"
      },
      {
        "seq": 6,
        "type": "lifecycle",
        "message": "Automatic recovery stopped. Recorded work is preserved; actions with unverified outcomes will not be repeated."
      }
    ],
    "log": [
      "stdout: [hermes-gateway] creating run at http://127.0.0.1:18642/v1/runs (timeout=60s, session=issue)",
      "stdout: [hermes-gateway] request headers (redacted): {\"Authorization\":\"***REDACTED***\",\"Accept\":\"application/json\",\"Content-Type\":\"application/json\",\"Idempotency-Key\":\"da0b2c69-ac93-488a-baa4-3833cc494b03\",\"X-Hermes-Session-Key\":\"[redacted-session-key]\"}",
      "stdout: [hermes-gateway] run created: run_b44b0dfb2c2c4606a3e2d10ccef12a60",
      "stdout: [hermes-gateway:event] run=run_b44b0dfb2c2c4606a3e2d10ccef12a60 event=reasoning.available data={\"event\":\"reasoning.available\",\"run_id\":\"run_b44b0dfb2c2c4606a3e2d10ccef12a60\",\"timestamp\":1791450079.852,\"text\":\"Razonamiento simulado (mock).\",\"seq\":0}",
      "stdout: [hermes-gateway:event] run=run_b44b0dfb2c2c4606a3e2d10ccef12a60 event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_b44b0dfb2c2c4606a3e2d10ccef12a60\",\"timestamp\":1791450080.013,\"delta\":\"MC-MOCK-OK: respuesta s\",\"seq\":1}",
      "stdout: [hermes-gateway:event] run=run_b44b0dfb2c2c4606a3e2d10ccef12a60 event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_b44b0dfb2c2c4606a3e2d10ccef12a60\",\"timestamp\":1791450080.174,\"delta\":\"imulada del mock de Her\",\"seq\":2}",
      "stdout: [hermes-gateway:event] run=run_b44b0dfb2c2c4606a3e2d10ccef12a60 event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_b44b0dfb2c2c4606a3e2d10ccef12a60\",\"timestamp\":1791450080.335,\"delta\":\"mes (input_chars=3205).\",\"seq\":3}",
      "stdout: [hermes-gateway:event] run=run_b44b0dfb2c2c4606a3e2d10ccef12a60 event=run.failed data={\"event\":\"run.failed\",\"run_id\":\"run_b44b0dfb2c2c4606a3e2d10ccef12a60\",\"timestamp\":1791450080.495,\"error\":\"Fallo simulado por el mock de Hermes (failNextRun)\",\"completed\":false,\"partial\":false,\"interrupted\":"
    ]
  },
  "runsIn90s": [
    {
      "id": "da0b2c69-ac93-488a-baa4-3833cc494b03",
      "source": "assignment",
      "status": "failed",
      "errorCode": "hermes_gateway_run_failed",
      "error": "Fallo simulado por el mock de Hermes (failNextRun)",
      "createdAt": "2026-10-08T09:01:18.869Z",
      "startedAt": "2026-10-08T09:01:18.962Z",
      "finishedAt": "2026-10-08T09:01:20.536Z",
      "seconds": 1.6,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
      "contextIssueId": "e4c7eaab-462a-4d73-9571-9b67b50e81d6",
      "usage": null
    }
  ],
  "issueTrail": {
    "status": "blocked",
    "assigneeAgentId": "3ae16416-6d9b-4ab5-a180-290ce025cb6e",
    "activity": [
      {
        "at": "2026-10-08T09:01:18.846Z",
        "action": "issue.created",
        "actor": "user",
        "details": {
          "status": "todo"
        }
      },
      {
        "at": "2026-10-08T09:01:20.678Z",
        "action": "issue.comment_added",
        "actor": "agent"
      },
      {
        "at": "2026-10-08T09:01:21.079Z",
        "action": "issue.execution_recovery_settled",
        "actor": "system",
        "details": {
          "outcome": "blocked",
          "replay": "not_authorized"
        }
      }
    ],
    "comments": [
      {
        "at": "2026-10-08T09:01:20.665Z",
        "authorType": "agent",
        "body": "MC-MOCK-OK: respuesta simulada del mock de Hermes (input_chars=3205)."
      }
    ]
  },
  "mockRunError": "Fallo simulado por el mock de Hermes (failNextRun)",
  "mockHistogram": {
    "POST /v1/runs → 202": 1,
    "GET /v1/runs/:runId/events → 200": 1,
    "GET /health → 200": 4
  },
  "mockRequests": [
    {
      "at": "2026-10-08T09:01:19.691Z",
      "method": "POST",
      "path": "/v1/runs",
      "status": 202,
      "idempotencyKey": "da0b2c69-ac93-488a-baa4-3833cc494b03",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:3ae16416-6d9b-4ab5-a180-290ce025cb6e:issue:e4c7eaab-462a-4d73-9571-9b67b50e81d6"
    },
    {
      "at": "2026-10-08T09:01:19.695Z",
      "method": "GET",
      "path": "/v1/runs/run_b44b0dfb2c2c4606a3e2d10ccef12a60/events",
      "status": 200,
      "idempotencyKey": "da0b2c69-ac93-488a-baa4-3833cc494b03",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:3ae16416-6d9b-4ab5-a180-290ce025cb6e:issue:e4c7eaab-462a-4d73-9571-9b67b50e81d6"
    },
    {
      "at": "2026-10-08T09:01:37.334Z",
      "method": "GET",
      "path": "/health",
      "status": 20
… (376 caracteres omitidos; ver JSON completo en tests/lab/.runtime/)
```

</details>

### 5. Clave rechazada

- Inicio (UTC): `2026-10-08T09:02:51.365Z` · Fin (UTC): `2026-10-08T09:03:52.894Z` · Duración del escenario: 61.5 s
- Configuración: unauthorizedNext: true; ventana de observación 60 s
- Resultado: primer run failed, errorCode hermes_gateway_auth_failed; error: "Hermes gateway HTTP 401. Check adapterConfig.apiKey matches the Hermes API_SERVER_KEY for the running gateway."; en 60 s: 1 runs {"assignment":1}; 1 POST /v1/runs (1 con 401); issue blocked (issue.execution_recovery_settled {"outcome":"blocked","replay":"not_authorized"} +13.1 s)
- Veredicto: **cubre** — Una clave rechazada se reporta con un código específico (hermes_gateway_auth_failed) y no se reintenta: no hay tormenta de reintentos, y la tarea pasa a blocked para el board. MC puede distinguir "clave mala" de "ejecutor caído" por el errorCode y avisar al operador para rotar la clave.

<details><summary>JSON bruto (extractos)</summary>

```json
{
  "firstRun": {
    "info": {
      "id": "33d04aa0-03ad-4930-9eca-04176b6c4421",
      "source": "assignment",
      "status": "failed",
      "errorCode": "hermes_gateway_auth_failed",
      "error": "Hermes gateway HTTP 401. Check adapterConfig.apiKey matches the Hermes API_SERVER_KEY for the running gateway.",
      "createdAt": "2026-10-08T09:02:51.482Z",
      "startedAt": "2026-10-08T09:02:51.590Z",
      "finishedAt": "2026-10-08T09:02:52.257Z",
      "seconds": 0.7,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
      "contextIssueId": "6ff4d3b9-1d43-4b68-a61b-2c854eaf2210",
      "usage": null
    },
    "events": [
      {
        "seq": 1,
        "type": "lifecycle",
        "message": "run started"
      },
      {
        "seq": 2,
        "type": "adapter.invoke",
        "message": "adapter invocation"
      },
      {
        "seq": 3,
        "type": "lifecycle",
        "message": "run failed"
      },
      {
        "seq": 4,
        "type": "run.presentation.resolved",
        "message": "run presentation resolved"
      },
      {
        "seq": 5,
        "type": "lifecycle",
        "message": "run scratch cleaned"
      },
      {
        "seq": 6,
        "type": "lifecycle",
        "message": "Automatic recovery stopped. Recorded work is preserved; actions with unverified outcomes will not be repeated."
      }
    ],
    "log": [
      "stdout: [hermes-gateway] creating run at http://127.0.0.1:18642/v1/runs (timeout=60s, session=issue)",
      "stdout: [hermes-gateway] request headers (redacted): {\"Authorization\":\"***REDACTED***\",\"Accept\":\"application/json\",\"Content-Type\":\"application/json\",\"Idempotency-Key\":\"33d04aa0-03ad-4930-9eca-04176b6c4421\",\"X-Hermes-Session-Key\":\"[redacted-session-key]\"}"
    ]
  },
  "runsIn60s": [
    {
      "id": "33d04aa0-03ad-4930-9eca-04176b6c4421",
      "source": "assignment",
      "status": "failed",
      "errorCode": "hermes_gateway_auth_failed",
      "error": "Hermes gateway HTTP 401. Check adapterConfig.apiKey matches the Hermes API_SERVER_KEY for the running gateway.",
      "createdAt": "2026-10-08T09:02:51.482Z",
      "startedAt": "2026-10-08T09:02:51.590Z",
      "finishedAt": "2026-10-08T09:02:52.257Z",
      "seconds": 0.7,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
      "contextIssueId": "6ff4d3b9-1d43-4b68-a61b-2c854eaf2210",
      "usage": null
    }
  ],
  "issueTrail": {
    "status": "blocked",
    "assigneeAgentId": "aec4023c-148d-4d4d-82fa-2cfa695e1174",
    "activity": [
      {
        "at": "2026-10-08T09:02:51.453Z",
        "action": "issue.created",
        "actor": "user",
        "details": {
          "status": "todo"
        }
      },
      {
        "at": "2026-10-08T09:03:05.368Z",
        "action": "issue.execution_recovery_settled",
        "actor": "system",
        "details": {
          "outcome": "blocked",
          "replay": "not_authorized"
        }
      }
    ],
    "comments": []
  },
  "mockHistogram": {
    "POST /v1/runs → 401": 1,
    "GET /health → 200": 3
  },
  "mockRequests": [
    {
      "at": "2026-10-08T09:02:52.228Z",
      "method": "POST",
      "path": "/v1/runs",
      "status": 401,
      "idempotencyKey": "33d04aa0-03ad-4930-9eca-04176b6c4421",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:aec4023c-148d-4d4d-82fa-2cfa695e1174:issue:6ff4d3b9-1d43-4b68-a61b-2c854eaf2210"
    },
    {
      "at": "2026-10-08T09:02:57.273Z",
      "method": "GET",
      "path": "/health",
      "status": 200
    },
    {
      "at": "2026-10-08T09:03:17.297Z",
      "method": "GET",
      "path": "/health",
      "status": 200
    },
    {
      "at": "2026-10-08T09:03:37.228Z",
      "method": "GET",
      "path": "/health",
      "status": 200
    }
  ]
}
```

</details>

### 6. Límite de concurrencia

- Inicio (UTC): `2026-10-08T09:03:52.895Z` · Fin (UTC): `2026-10-08T09:05:24.510Z` · Duración del escenario: 91.6 s
- Configuración: rateLimitNext: true (429 + Retry-After: 1); ventana de observación 90 s
- Resultado: primer run failed, errorCode hermes_gateway_rate_limited (Hermes gateway HTTP 429); en 90 s: 1 runs {"assignment":1}, reintentos programados: 0 (ninguno); 1 POST /v1/runs (1 con 429); algún run succeeded: false; issue blocked (issue.execution_recovery_settled {"outcome":"blocked","replay":"not_authorized"} +11.6 s)
- Veredicto: **parcial** — El 429 se trata como cualquier otro fallo: el run queda failed (hermes_gateway_rate_limited) SIN reintento automático en el build vivo (aunque el adaptador lo marca transient_upstream) y la tarea pasa a blocked para el board. Un tope de concurrencia del ejecutor, que es transitorio, exige que MC encole/re-despache por su cuenta y respete Retry-After.

<details><summary>JSON bruto (extractos)</summary>

```json
{
  "firstRun": {
    "info": {
      "id": "6b7ed001-1021-45b7-a0cd-e1b933fa9df0",
      "source": "assignment",
      "status": "failed",
      "errorCode": "hermes_gateway_rate_limited",
      "error": "Hermes gateway HTTP 429",
      "createdAt": "2026-10-08T09:03:53.023Z",
      "startedAt": "2026-10-08T09:03:53.160Z",
      "finishedAt": "2026-10-08T09:03:53.779Z",
      "seconds": 0.6,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
      "contextIssueId": "c1ee5ca7-7771-41fb-a423-e901c351ecd3",
      "usage": null
    },
    "events": [
      {
        "seq": 1,
        "type": "lifecycle",
        "message": "run started"
      },
      {
        "seq": 2,
        "type": "adapter.invoke",
        "message": "adapter invocation"
      },
      {
        "seq": 3,
        "type": "lifecycle",
        "message": "run failed"
      },
      {
        "seq": 4,
        "type": "run.presentation.resolved",
        "message": "run presentation resolved"
      },
      {
        "seq": 5,
        "type": "lifecycle",
        "message": "run scratch cleaned"
      },
      {
        "seq": 6,
        "type": "lifecycle",
        "message": "Automatic recovery stopped. Recorded work is preserved; actions with unverified outcomes will not be repeated."
      }
    ],
    "log": [
      "stdout: [hermes-gateway] creating run at http://127.0.0.1:18642/v1/runs (timeout=60s, session=issue)",
      "stdout: [hermes-gateway] request headers (redacted): {\"Authorization\":\"***REDACTED***\",\"Accept\":\"application/json\",\"Content-Type\":\"application/json\",\"Idempotency-Key\":\"6b7ed001-1021-45b7-a0cd-e1b933fa9df0\",\"X-Hermes-Session-Key\":\"[redacted-session-key]\"}"
    ]
  },
  "runsIn90s": [
    {
      "id": "6b7ed001-1021-45b7-a0cd-e1b933fa9df0",
      "source": "assignment",
      "status": "failed",
      "errorCode": "hermes_gateway_rate_limited",
      "error": "Hermes gateway HTTP 429",
      "createdAt": "2026-10-08T09:03:53.023Z",
      "startedAt": "2026-10-08T09:03:53.160Z",
      "finishedAt": "2026-10-08T09:03:53.779Z",
      "seconds": 0.6,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
      "contextIssueId": "c1ee5ca7-7771-41fb-a423-e901c351ecd3",
      "usage": null
    }
  ],
  "otherRuns": 0,
  "issueTrail": {
    "status": "blocked",
    "assigneeAgentId": "ee50ebcc-f8c0-43a9-9338-0d1b8cc01364",
    "activity": [
      {
        "at": "2026-10-08T09:03:52.998Z",
        "action": "issue.created",
        "actor": "user",
        "details": {
          "status": "todo"
        }
      },
      {
        "at": "2026-10-08T09:04:05.368Z",
        "action": "issue.execution_recovery_settled",
        "actor": "system",
        "details": {
          "outcome": "blocked",
          "replay": "not_authorized"
        }
      }
    ],
    "comments": []
  },
  "mockHistogram": {
    "POST /v1/runs → 429": 1,
    "GET /health → 200": 2
  },
  "mockRequests": [
    {
      "at": "2026-10-08T09:03:53.756Z",
      "method": "POST",
      "path": "/v1/runs",
      "status": 429,
      "idempotencyKey": "6b7ed001-1021-45b7-a0cd-e1b933fa9df0",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:ee50ebcc-f8c0-43a9-9338-0d1b8cc01364:issue:c1ee5ca7-7771-41fb-a423-e901c351ecd3"
    },
    {
      "at": "2026-10-08T09:03:57.251Z",
      "method": "GET",
      "path": "/health",
      "status": 200
    },
    {
      "at": "2026-10-08T09:04:17.247Z",
      "method": "GET",
      "path": "/health",
      "status": 200
    }
  ]
}
```

</details>

### 7. Duplicados

- Inicio (UTC): `2026-10-08T09:05:24.511Z` · Fin (UTC): `2026-10-08T09:06:52.016Z` · Duración del escenario: 87.5 s
- Configuración: dos POST /heartbeat/invoke {issueId} en <1 s sobre UNA tarea; completeDelayMs 6000; luego duplicateReplayAsNew: true
- Resultado: (a) tarea asignada con run en vuelo + invoke×2: ids distintos, 5 runs {"assignment":1,"on_demand":2,"automation":2}, 4 POST al mock, claves únicas=true; (b) tarea sin asignar + invoke×2: ids distintos, 2 runs on_demand, 2 POST; (d) invoke×2 con idempotencyKey: ids distintos, 2 run(s) on_demand, 2 POST; issueId en el contexto del run on_demand: NO (el endpoint lo ignora); (c) mock duplicateReplayAsNew: sonda directa con la MISMA clave → run_id DISTINTOS (duplica) vs. sin fallo → mismo run_id (replayed); vía Paperclip con ese fallo: 5 runs, 4 POST, 4 claves distintas
- Veredicto: **parcial** — Dos invocaciones simultáneas SIN idempotencyKey NO se coalescen: Paperclip crea 2 runs on_demand, cada uno con su propia Idempotency-Key (= su id de run) y su POST al ejecutor, es decir trabajo duplicado; ni siquiera con idempotencyKey en el cuerpo se reduce a un solo run. Además el endpoint legacy ignora issueId. Como Paperclip nunca repite un POST con la misma clave, la idempotencia del ejecutor solo cubre reintentos de red del mismo run y un ejecutor mal portado (duplicateReplayAsNew) no cambia nada vía Paperclip. MC debe deduplicar por su cuenta (idempotencyKey al crear la tarea y al despertar al agente).

<details><summary>JSON bruto (extractos)</summary>

```json
{
  "asignada": {
    "invokeResponses": [
      {
        "id": "8e4e0131-fe89-41c2-944c-98914fe97d47",
        "status": "queued",
        "source": "on_demand"
      },
      {
        "id": "92190870-5368-4f8f-a63c-28b68f4f380d",
        "status": "queued",
        "source": "on_demand"
      }
    ],
    "sameInvokeRunId": false,
    "runs": [
      {
        "id": "5b06a866-8858-4d30-8d1e-f420348cf741",
        "source": "assignment",
        "status": "succeeded",
        "errorCode": null,
        "error": null,
        "createdAt": "2026-10-08T09:05:24.697Z",
        "startedAt": "2026-10-08T09:05:24.826Z",
        "finishedAt": "2026-10-08T09:05:31.657Z",
        "seconds": 6.8,
        "exitCode": 0,
        "retryOfRunId": null,
        "scheduledRetryReason": null,
        "scheduledRetryAttempt": 0,
        "scheduledRetryAt": null,
        "livenessState": "needs_followup",
        "contextIssueId": "6291ca37-274d-4138-bffe-dc06123084a5",
        "usage": {
          "inputTokens": 652,
          "outputTokens": 1,
          "costStatus": "unpriced",
          "model": "unknown"
        }
      },
      {
        "id": "8e4e0131-fe89-41c2-944c-98914fe97d47",
        "source": "on_demand",
        "status": "succeeded",
        "errorCode": null,
        "error": null,
        "createdAt": "2026-10-08T09:05:25.048Z",
        "startedAt": "2026-10-08T09:05:25.101Z",
        "finishedAt": "2026-10-08T09:05:31.542Z",
        "seconds": 6.4,
        "exitCode": 0,
        "retryOfRunId": null,
        "scheduledRetryReason": null,
        "scheduledRetryAttempt": 0,
        "scheduledRetryAt": null,
        "livenessState": "advanced",
        "contextIssueId": null,
        "usage": {
          "inputTokens": 151,
          "outputTokens": 17,
          "costStatus": "unpriced",
          "model": "unknown"
        }
      },
      {
        "id": "92190870-5368-4f8f-a63c-28b68f4f380d",
        "source": "on_demand",
        "status": "succeeded",
        "errorCode": null,
        "error": null,
        "createdAt": "2026-10-08T09:05:25.048Z",
        "startedAt": "2026-10-08T09:05:25.073Z",
        "finishedAt": "2026-10-08T09:05:31.554Z",
        "seconds": 6.5,
        "exitCode": 0,
        "retryOfRunId": null,
        "scheduledRetryReason": null,
        "scheduledRetryAttempt": 0,
        "scheduledRetryAt": null,
        "livenessState": "advanced",
        "contextIssueId": null,
        "usage": {
          "inputTokens": 151,
          "outputTokens": 17,
          "costStatus": "unpriced",
          "model": "unknown"
        }
      },
      {
        "id": "9c791241-ecab-43f9-b089-15de2e69c359",
        "source": "automation",
        "status": "succeeded",
        "errorCode": null,
        "error": null,
        "createdAt": "2026-10-08T09:05:32.310Z",
        "startedAt": "2026-10-08T09:05:32.414Z",
        "finishedAt": "2026-10-08T09:05:39.015Z",
        "seconds": 6.6,
        "exitCode": 0,
        "retryOfRunId": null,
        "scheduledRetryReason": null,
        "scheduledRetryAttempt": 0,
        "scheduledRetryAt": null,
        "livenessState": "needs_followup",
        "contextIssueId": "6291ca37-274d-4138-bffe-dc06123084a5",
        "usage": {
          "inputTokens": 1643,
          "outputTokens": 1,
          "costStatus": "unpriced",
          "model": "unknown"
        }
      },
      {
        "id": "766dc308-9314-4fa8-be0f-eb033254c82e",
        "source": "automation",
        "status": "scheduled_retry",
        "errorCode": null,
        "error": null,
        "createdAt": "2026-10-08T09:05:39.252Z",
        "startedAt": null,
        "finishedAt": null,
        "seconds": 0,
        "exitCode": null,
        "retryOfRunId": "9c791241-ecab-43f9-b089-15de2e69c359",
        "scheduledRetryReason": "issue_disposition_repair",
        "scheduledRetryAttempt": 2,
        "scheduledRetryAt": "2026-10-08T09:06:39.288Z",
        "livenessState": null,
        "contextIssueId": "6291ca37-274d-4138-bffe-dc06123084a5",
        "usage": null
      }
    ],
    "postsToMock": 4,
    "keys": [
      "8e4e0131-fe89-41c2-944c-98914fe97d47",
      "92190870-5368-4f8f-a63c-28b68f4f380d",
      "5b06a866-8858-4d30-8d1e-f420348cf741",
      "9c791241-ecab-43f9-b089-15de2e69c359"
    ]
  },
  "sinAsignar": {
    "invokeResponses": [
      {
        "id": "cc70f6ab-6a2d-4edb-9027-b3c25a963247",
        "status": "queued"
      },
      {
        "id": "9c3bd491-78e0-4be3-a24c-33905197f7d9",
        "status": "queued"
      }
    ],
    "sameInvokeRunId": false,
    "runs": [
      {
        "id": "9c3bd491-78e0-4be3-a24c-33905197f7d9",
        "source": "on_demand",
        "status": "succeeded",
        "errorCode": null,
        "error": null,
        "createdAt": "2026-10-08T09:05:50.466Z",
        "startedAt": "2026-10-08T09:05:50.516Z",
        "finishedAt": "2026-10-08T09:05:56.953Z",
        "seconds": 6.4,
        "exitCode": 0,
        "retryOfRunId": null,
        "scheduledRetryReason": null,
        "scheduledRetryAttempt": 0,
        "scheduledRetryAt": null,
        "livenessState": "advanced",
        "contextIssueId": null,
        "usage": {
          "inputTokens": 151,
          "outputTokens": 17,
          "costStatus": "unpriced",
          "model": "unknown"
        }
      },
      {
        "id": "cc70f6ab-6a2d-4edb-9027-b3c25a963247",
        "source": "on_demand",
        "status": "succeeded",
        "errorCode": null,
        "error": null,
        "createdAt": "2026-10-08T09:05:50.466Z",
        "startedAt": "2026-10-08T09:05:50.488Z",
        "finishedAt": "2026-10-08T09:05:56.991Z",
        "seconds": 6.5,
        "exitCode": 0,
        "retryOfRunId": null,
        "scheduledRetryReason": null,
        "scheduledRetryAttempt": 0,
        "scheduledRetryAt": null,
        "livenessState": "advanced",
        "contextIssueId": null,
        "usage": {
          "inputTokens": 0,
          "outputTokens": 0,
          "costStat
… (6668 caracteres omitidos; ver JSON completo en tests/lab/.runtime/)
```

</details>

### 8. Reinicio del ejecutor

- Inicio (UTC): `2026-10-08T09:06:52.017Z` · Fin (UTC): `2026-10-08T09:08:53.728Z` · Duración del escenario: 121.7 s
- Configuración: completeDelayMs 8000; close() a los 2 s; reinicio 5 s después (estado nuevo, run desconocido); timeoutSec 45
- Resultado: mock cerrado 2026-10-08T09:06:54.115Z (run running, 0 eventos) y reiniciado 2026-10-08T09:06:59.117Z; run de Paperclip timed_out, errorCode timeout a los 46.1 s; error "Hermes gateway run timed out after 45s."; en 75 s más: 1 runs {"assignment":1} (sin runs adicionales); 1 POST /v1/runs en total; 117 respuestas 404 del mock (sondeo/eventos del run desconocido) antes del timeout; issue blocked (issue.execution_recovery_settled {"outcome":"blocked","replay":"not_authorized"} +12.5 s)
- Veredicto: **parcial** — Apagar o reiniciar el ejecutor a mitad de tarea NO se recupera: el adaptador no distingue "ejecutor reiniciado" de "red caída" (ECONNREFUSED y luego 404 del run desconocido se tratan como errores transitorios, con unas 2 peticiones/s) y no abandona hasta agotar timeoutSec; entonces el run queda timed_out y la tarea pasa a blocked para el board, sin re-despacho automático. Con el timeoutSec por defecto (600 s) una tarea quedaría 10 min colgada. MC debe fijar timeoutSec acorde a la tarea y vigilar blocked/timed_out; el re-despacho (con otra Idempotency-Key) puede duplicar trabajo si el ejecutor original sigue vivo.

<details><summary>JSON bruto (extractos)</summary>

```json
{
  "mockBeforeClose": {
    "mockRunId": "run_abe3c7ea22c949c4b11bb4652cfc68e1",
    "status": "running",
    "events": 0
  },
  "closeAtUtc": "2026-10-08T09:06:54.115Z",
  "restartAtUtc": "2026-10-08T09:06:59.117Z",
  "terminalRun": {
    "info": {
      "id": "fb4b7188-8143-4609-9e4a-d174e2f77b95",
      "source": "assignment",
      "status": "timed_out",
      "errorCode": "timeout",
      "error": "Hermes gateway run timed out after 45s.",
      "createdAt": "2026-10-08T09:06:52.125Z",
      "startedAt": "2026-10-08T09:06:52.270Z",
      "finishedAt": "2026-10-08T09:07:37.827Z",
      "seconds": 45.6,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
      "contextIssueId": "5b91e6b4-bb02-4e32-96e7-a8851e34c074",
      "usage": null
    },
    "events": [
      {
        "seq": 1,
        "type": "lifecycle",
        "message": "run started"
      },
      {
        "seq": 2,
        "type": "adapter.invoke",
        "message": "adapter invocation"
      },
      {
        "seq": 3,
        "type": "lifecycle",
        "message": "run timed_out"
      },
      {
        "seq": 4,
        "type": "run.presentation.resolved",
        "message": "run presentation resolved"
      },
      {
        "seq": 5,
        "type": "lifecycle",
        "message": "run scratch cleaned"
      }
    ],
    "log": [
      "stdout: [hermes-gateway] creating run at http://127.0.0.1:18642/v1/runs (timeout=45s, session=issue)",
      "stdout: [hermes-gateway] request headers (redacted): {\"Authorization\":\"***REDACTED***\",\"Accept\":\"application/json\",\"Content-Type\":\"application/json\",\"Idempotency-Key\":\"fb4b7188-8143-4609-9e4a-d174e2f77b95\",\"X-Hermes-Session-Key\":\"[redacted-session-key]\"}",
      "stdout: [hermes-gateway] run created: run_abe3c7ea22c949c4b11bb4652cfc68e1",
      "stderr: [hermes-gateway] event stream disconnected: terminated",
      "stderr: [hermes-gateway] event stream disconnected: fetch failed",
      "stderr: [hermes-gateway] status poll failed: Hermes gateway request failed: fetch failed (ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:18642)",
      "stderr: [hermes-gateway] event stream disconnected: fetch failed",
      "stderr: [hermes-gateway] event stream disconnected: fetch failed",
      "stderr: [hermes-gateway] status poll failed: Hermes gateway request failed: fetch failed (ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:18642)",
      "stderr: [hermes-gateway] event stream disconnected: fetch failed",
      "stderr: [hermes-gateway] event stream disconnected: fetch failed",
      "stderr: [hermes-gateway] status poll failed: Hermes gateway request failed: fetch failed (ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:18642)",
      "stderr: [hermes-gateway] event stream disconnected: fetch failed",
      "stderr: [hermes-gateway] event stream disconnected: fetch failed",
      "stderr: [hermes-gateway] status poll failed: Hermes gateway request failed: fetch failed (ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:18642)",
      "stderr: [hermes-gateway] event stream disconnected: fetch failed",
      "stderr: [hermes-gateway] event stream disconnected: fetch failed",
      "stderr: [hermes-gateway] status poll failed: Hermes gateway request failed: fetch failed (ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:18642)",
      "stderr: [hermes-gateway] event stream HTTP 404; falling back to polling",
      "stderr: [hermes-gateway] event stream HTTP 404; falling back to polling",
      "stderr: [hermes-gateway] status poll failed: Hermes gateway HTTP 404",
      "stderr: [hermes-gateway] event stream HTTP 404; falling back to polling",
      "stderr: [hermes-gateway] event stream HTTP 404; falling back to polling",
      "stderr: [hermes-gateway] status poll failed: Hermes gateway HTTP 404",
      "stderr: [hermes-gateway] event stream HTTP 404; falling back to polling",
      "stderr: [hermes-gateway] event stream HTTP 404; falling back to polling",
      "stderr: [hermes-gateway] status poll failed: Hermes gateway HTTP 404",
      "stderr: [hermes-gateway] event stream HTTP 404; falling back to polling",
      "stderr: [hermes-gateway] event stream HTTP 404; falling back to polling",
      "stderr: [hermes-gateway] status poll failed: Hermes gateway HTTP 404"
    ]
  },
  "runsAfter75s": [
    {
      "id": "fb4b7188-8143-4609-9e4a-d174e2f77b95",
      "source": "assignment",
      "status": "timed_out",
      "errorCode": "timeout",
      "error": "Hermes gateway run timed out after 45s.",
      "createdAt": "2026-10-08T09:06:52.125Z",
      "startedAt": "2026-10-08T09:06:52.270Z",
      "finishedAt": "2026-10-08T09:07:37.827Z",
      "seconds": 45.6,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
      "contextIssueId": "5b91e6b4-bb02-4e32-96e7-a8851e34c074",
      "usage": null
    }
  ],
  "issueStatusAfter": "blocked",
  "issueTrail": {
    "status": "blocked",
    "assigneeAgentId": "8a165e29-f7d1-4f17-a3b2-bd8543d38260",
    "activity": [
      {
        "at": "2026-10-08T09:06:52.104Z",
        "action": "issue.created",
        "actor": "user",
        "details": {
          "status": "todo"
        }
      },
      {
        "at": "2026-10-08T09:07:50.373Z",
        "action": "issue.execution_recovery_settled",
        "actor": "system",
        "details": {
          "outcome": "blocked",
          "replay": "not_authorized"
        }
      }
    ],
    "comments": []
  },
  "mockHistogram": {
    "POST /v1/runs → 202": 1,
    "GET /v1/runs/:runId/events": 1,
    "GET /v1/runs/:runId → 200": 1,
    "GET /v1/runs/:runId/events → 404": 77,
    "GET /v1/runs/:runId → 404": 39,
    "POST /v1/runs/:runId/stop → 404": 1
  },
  "mockRequests": [
    {
      "at": "2026-10-08T09:06:52.789Z",
      "
… (15612 caracteres omitidos; ver JSON completo en tests/lab/.runtime/)
```

</details>

## Qué NO demuestra

- **Mock ≠ Hermes real.** El mock imita el contrato HTTP (cabeceras, SSE, idempotencia, códigos de error) leído del clon `a28a5d03`; no ejecuta modelo ni herramientas, no persiste sesiones y su "tokens" es `ceil(caracteres/4)`. Un Hermes real puede fallar de maneras que el mock no modela (reinicio con sesiones SQLite, eventos retirados tras un tiempo, límites propios del modelo, SSE con proxys intermedios).
- **Un solo equipo.** Paperclip, el mock y las pruebas corren en el mismo contenedor por loopback; no hay latencia real, pérdida de paquetes ni particiones de red entre PCs (Tailscale). El corte del SSE se simula cerrando el socket, no con una red inestable.
- **Sin HTTPS.** Todo va por HTTP en 127.0.0.1 (el adaptador lo permite en loopback). El camino HTTPS/certificados hacia un Hermes remoto no se ha ejercitado.
- **Un solo build.** Resultados válidos para `paperclipai@2026.1005.0`; el código de recuperación del clon (HEAD 2026-10-07) difiere (umbrales de silencio, política de presupuesto sin precio) y no se ha probado.
- **Agente que sí ejecuta herramientas.** El mock nunca llama a la API de Paperclip para cambiar el estado de la tarea, por lo que la "reparación de disposición" (2 runs extra y bloqueo) aparece siempre tras un éxito; un Hermes real con instrucciones correctas debería evitarla, pero eso no se ha comprobado aquí.
- **Escala y duración.** Pocas tareas, ventanas de observación de 60–90 s: no se prueba la deriva a largo plazo, reintentos tras horas ni cargas concurrentes reales; los umbrales de 30 s/60 s de Paperclip se observaron solo dentro de esas ventanas.
- **Reinicio de Paperclip.** Se simuló el reinicio del *ejecutor* (mock), no el del servidor Paperclip (no se toca el Paperclip vivo); el comportamiento `process_lost` del reaper sigue siendo una inferencia del código.
- **Coste.** Los tokens del mock se registran en `usageJson`, pero `costStatus` queda `unpriced` y el coste en centavos es 0: la contabilidad en dinero no se demuestra.
