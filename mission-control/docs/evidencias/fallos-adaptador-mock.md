# Fallos del adaptador `hermes_gateway` contra el mock de Hermes

Generado automáticamente por `tests/lab/fallos.test.mjs` (`pnpm --filter @mc/tests test:lab`) · 2026-10-08T08:55:43.436Z UTC.

> Todo lo de aquí es observado **[H]** en vivo contra el Paperclip real y el adaptador real `hermes_gateway`; el ejecutor remoto es el **mock** (`@mc/hermes-mock`), no un Hermes real.

## Entorno

- Paperclip: `paperclipai@2026.1005.0` (commit 467125fa) en http://127.0.0.1:3101, local_trusted/private
- Adaptador: `@paperclipai/hermes-paperclip-adapter` 2026.1005.0 (tipo `hermes_gateway`)
- Mock de Hermes: `@mc/hermes-mock` 0.1.0 en http://127.0.0.1:18642 (clave generada en tiempo de ejecución, guardada como secreto de Paperclip; nunca escrita aquí)
- Empresa: `b0d4c18c-7069-499f-8879-26cdc29738dc` (objetos con prefijo "[auto-test fallos]")
- Node: v24.21.0
- Fecha de ejecución (UTC): 2026-10-08T08:55:43.436Z
- Agentes creados: 9 (todos pausados al terminar)
- Escenarios registrados: 1, 2, 3, 4, 5, 6, 7, 8

## Resumen por escenario

| # | Escenario | Configuración | Resultado observado | Veredicto | Qué significa para Mission Control |
| --- | --- | --- | --- | --- | --- |
| 1 | Camino feliz | sin fallos; completeDelayMs 1500; timeoutSec 60; reviewPolicy human_only | assignment succeeded en 3.1 s; comentario MC-MOCK-OK; 3 runs (1 assignment + 2 automation); issue blocked → in_review → done; 3 POST /v1/runs (claves = ids de run), tokens in/out 801/18 (== mock); costStatus unpriced | **cubre** | El circuito solicitud → ejecución → resultado → revisión humana funciona de punta a punta contra el adaptador real, y el consumo (tokens) queda registrado por run. Con un ejecutor que no cambia el estado, cada tarea cuesta 2 runs extra y acaba en blocked: MC debe obligar a que el ejecutor registre la disposición. |
| 2 | Corte del SSE | dropSseAfterEvents: 2; completeDelayMs 4000; eventReconnectMs 500 | run succeeded (4.7 s), errorCode -; 2 GET /events (0 con Last-Event-ID), 3 GET /v1/runs/{id} (sondeo), 1 POST /v1/runs; log: "stderr: [hermes-gateway] event stream disconnected: terminated"; tokens 802/18 | **cubre** | Un corte de la conexión de eventos NO pierde el resultado ni duplica el run: el adaptador reconecta solo (y además sondea el estado), por lo que MC no necesita lógica propia para cortes breves de red. No hay Last-Event-ID: la reconexión repite los eventos. |
| 3 | Ejecutor colgado / timeout | hangNextRun: true; timeoutSec 15; eventReconnectMs 500 | run timed_out, errorCode timeout, 16.1 s en Paperclip (16.7 s desde crear la tarea); 1 POST /stop; estado final del run en el mock: cancelled; tras 45 s más: 1 runs ({"assignment":1}), 1 POST /v1/runs; tokens sin usageJson | **cubre** | Un ejecutor colgado no deja el run abierto indefinidamente: a los timeoutSec Paperclip pide stop al ejecutor y cierra el run como timed_out (el build vivo guarda errorCode `timeout`; el código `hermes_gateway_timeout` del adaptador no llega al campo errorCode del run). MC debe fijar un timeoutSec realista por tipo de tarea; no existe otro corte por silencio (umbral del build vivo: 60 min). |
| 4 | Fallo del run | failNextRun: true; ventana de observación 90 s | primer run failed, errorCode hermes_gateway_run_failed; en 90 s: 1 runs {"assignment":1} (sin reintentos); 1 POST /v1/runs; issue blocked, asignada=true | **cubre** | Un fallo del ejecutor queda visible (failed + errorCode) y NO provoca reintento automático ni tormenta: la tarea sigue con su dueño. MC debe vigilar runs failed y decidir (reintentar, reasignar o escalar al humano). |
| 5 | Clave rechazada | unauthorizedNext: true; ventana de observación 60 s | primer run failed, errorCode hermes_gateway_auth_failed; error: "Hermes gateway HTTP 401. Check adapterConfig.apiKey matches the Hermes API_SERVER_KEY for the running gateway."; en 60 s: 1 runs {"assignment":1}; 1 POST /v1/runs (1 con 401); issue blocked | **cubre** | Una clave rechazada se reporta con un código específico (hermes_gateway_auth_failed) y no se reintenta: no hay tormenta de reintentos. MC puede distinguir "clave mala" de "ejecutor caído" por el errorCode y avisar al operador para rotar la clave. |
| 6 | Límite de concurrencia | rateLimitNext: true (429 + Retry-After: 1); ventana de observación 90 s | primer run failed, errorCode hermes_gateway_rate_limited (Hermes gateway HTTP 429); en 90 s: 1 runs {"assignment":1}, reintentos programados: 0 (ninguno); 1 POST /v1/runs (1 con 429); algún run succeeded: false; issue blocked | **parcial** | El 429 deja el run failed sin reintento visible en la ventana: MC debe re-despachar o encolar por su cuenta y respetar Retry-After. |
| 7 | Duplicados | dos POST /heartbeat/invoke {issueId} en <1 s sobre UNA tarea; completeDelayMs 6000; luego duplicateReplayAsNew: true | [ASERCIÓN FALLÓ: con duplicateReplayAsNew el mock crea un run nuevo por petición] | **no cubre** |  |
| 8 | Reinicio del ejecutor | completeDelayMs 8000; close() a los 2 s; reinicio 5 s después (estado nuevo, run desconocido); timeoutSec 45 | mock cerrado 2026-10-08T08:53:43.454Z (run running, 0 eventos) y reiniciado 2026-10-08T08:53:48.455Z; run de Paperclip timed_out, errorCode timeout a los 46 s; error "Hermes gateway run timed out after 45s."; en 75 s más: 1 runs {"assignment":1} (sin runs adicionales); 1 POST /v1/runs en total; issue blocked | **parcial** | Apagar o reiniciar el ejecutor a mitad de tarea NO se recupera por sí solo en el mismo run: el trabajo remoto se pierde (el run cambia de dueño/estado en el mock) y Paperclip lo cierra con el estado/código anotado. Lo que ocurre después depende de la recuperación de Paperclip (ver runs adicionales); MC debe detectar el run fallido, avisar y decidir si re-despacha con una clave nueva (puede duplicar trabajo si el ejecutor original seguía vivo). |

## Detalle por escenario

### 1. Camino feliz

- Inicio (UTC): `2026-10-08T08:45:56.048Z` · Fin (UTC): `2026-10-08T08:47:40.659Z` · Duración del escenario: 104.6 s
- Configuración: sin fallos; completeDelayMs 1500; timeoutSec 60; reviewPolicy human_only
- Resultado: assignment succeeded en 3.1 s; comentario MC-MOCK-OK; 3 runs (1 assignment + 2 automation); issue blocked → in_review → done; 3 POST /v1/runs (claves = ids de run), tokens in/out 801/18 (== mock); costStatus unpriced
- Veredicto: **cubre** — El circuito solicitud → ejecución → resultado → revisión humana funciona de punta a punta contra el adaptador real, y el consumo (tokens) queda registrado por run. Con un ejecutor que no cambia el estado, cada tarea cuesta 2 runs extra y acaba en blocked: MC debe obligar a que el ejecutor registre la disposición.

<details><summary>JSON bruto (extractos)</summary>

```json
{
  "agentId": "f5856dc2-d877-4f4d-b976-981dec5a718a",
  "issue": {
    "id": "d792d118-3307-4264-bdab-007a3736bcc7",
    "identifier": "MIS-8",
    "finalStatus": "done"
  },
  "runs": [
    {
      "id": "42663fe2-7584-4643-85a2-41e593284f63",
      "source": "assignment",
      "status": "succeeded",
      "errorCode": null,
      "error": null,
      "createdAt": "2026-10-08T08:45:56.264Z",
      "startedAt": "2026-10-08T08:45:56.379Z",
      "finishedAt": "2026-10-08T08:45:58.551Z",
      "seconds": 2.2,
      "exitCode": 0,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "needs_followup",
      "usage": {
        "inputTokens": 801,
        "outputTokens": 18,
        "costStatus": "unpriced",
        "model": "unknown"
      }
    },
    {
      "id": "17c48c1e-8209-4c11-b950-c1d383036430",
      "source": "automation",
      "status": "succeeded",
      "errorCode": null,
      "error": null,
      "createdAt": "2026-10-08T08:45:58.838Z",
      "startedAt": "2026-10-08T08:45:58.914Z",
      "finishedAt": "2026-10-08T08:46:01.176Z",
      "seconds": 2.3,
      "exitCode": 0,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "needs_followup",
      "usage": {
        "inputTokens": 989,
        "outputTokens": 0,
        "costStatus": "unpriced",
        "model": "unknown"
      }
    },
    {
      "id": "60772fe1-c906-44fa-b8d9-a63c318af449",
      "source": "automation",
      "status": "succeeded",
      "errorCode": null,
      "error": null,
      "createdAt": "2026-10-08T08:46:01.364Z",
      "startedAt": "2026-10-08T08:47:36.027Z",
      "finishedAt": "2026-10-08T08:47:38.670Z",
      "seconds": 2.6,
      "exitCode": 0,
      "retryOfRunId": "17c48c1e-8209-4c11-b950-c1d383036430",
      "scheduledRetryReason": "issue_disposition_repair",
      "scheduledRetryAttempt": 2,
      "scheduledRetryAt": "2026-10-08T08:47:06.865Z",
      "livenessState": "needs_followup",
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
      "id": "42663fe2-7584-4643-85a2-41e593284f63",
      "source": "assignment",
      "status": "succeeded",
      "errorCode": null,
      "error": null,
      "createdAt": "2026-10-08T08:45:56.264Z",
      "startedAt": "2026-10-08T08:45:56.379Z",
      "finishedAt": "2026-10-08T08:45:58.551Z",
      "seconds": 2.2,
      "exitCode": 0,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "needs_followup",
      "usage": {
        "inputTokens": 801,
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
      "stdout: [hermes-gateway] request headers (redacted): {\"Authorization\":\"***REDACTED***\",\"Accept\":\"application/json\",\"Content-Type\":\"application/json\",\"Idempotency-Key\":\"42663fe2-7584-4643-85a2-41e593284f63\",\"X-Hermes-Session-Key\":\"[redacted-session-key]\"}",
      "stdout: [hermes-gateway] run created: run_2e9fcebee8494c8b8aea4f04d7ef2bef",
      "stdout: [hermes-gateway:event] run=run_2e9fcebee8494c8b8aea4f04d7ef2bef event=reasoning.available data={\"event\":\"reasoning.available\",\"run_id\":\"run_2e9fcebee8494c8b8aea4f04d7ef2bef\",\"timestamp\":1791449157.312,\"text\":\"Razonamiento simulado (mock).\",\"seq\":0}",
      "stdout: [hermes-gateway:event] run=run_2e9fcebee8494c8b8aea4f04d7ef2bef event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_2e9fcebee8494c8b8aea4f04d7ef2bef\",\"timestamp\":1791449157.612,\"delta\":\"MC-MOCK-OK: respuesta s\",\"seq\":1}",
      "stdout: [hermes-gateway:event] run=run_2e9fcebee8494c8b8aea4f04d7ef2bef event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_2e9fcebee8494c8b8aea4f04d7ef2bef\",\"timestamp\":1791449157.912,\"delta\":\"imulada del mock de Her\",\"seq\":2}",
      "stdout: [hermes-gateway:event] run=run_2e9fcebee8494c8b8aea4f04d7ef2bef event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_2e9fcebee8494c8b8aea4f04d7ef2bef\",\"timestamp\":1791449158.212,\"delta\":\"mes (input_chars=3203).\",\"seq\":3}",
      "stdout: [hermes-gateway:event] run=run_2e9fcebee8494c8b8aea4f04d7ef2bef event=run.completed data={\"event\":\"run.completed\",\"run_id\":\"run_2e9fcebee8494c8b8aea4f04d7ef2bef\",\"timestamp\":1791449158.513,\"output\":\"MC-MOCK-OK: respuesta simulada del mock de Hermes (input_chars=3203).\",\"usage\":{\"input_tokens"
    ]
  },
  "mockPost": {
    "headers": {
      "host": "127.0.0.1:18642",
      "connection": "keep-alive",
      "authorization": "Bearer ***",
      "accept": "application/json",
      "content-type": "application/json",
      "idempotency-key": "42663fe2-7584-4643-85a2-41e593284f63",
      "x-hermes-session-key": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:f5856dc2-d877-4f4d-b976-981dec5a718a:issue:d792d118-3307-4264-bdab-007a3736bcc7",
      "accept-language": "*",
      "sec-fetch-mode": "cors",
      "user-agent": "node",
      "accept-enco
… (2332 caracteres omitidos; ver JSON completo en tests/lab/.runtime/)
```

</details>

### 2. Corte del SSE

- Inicio (UTC): `2026-10-08T08:47:40.661Z` · Fin (UTC): `2026-10-08T08:47:46.335Z` · Duración del escenario: 5.7 s
- Configuración: dropSseAfterEvents: 2; completeDelayMs 4000; eventReconnectMs 500
- Resultado: run succeeded (4.7 s), errorCode -; 2 GET /events (0 con Last-Event-ID), 3 GET /v1/runs/{id} (sondeo), 1 POST /v1/runs; log: "stderr: [hermes-gateway] event stream disconnected: terminated"; tokens 802/18
- Veredicto: **cubre** — Un corte de la conexión de eventos NO pierde el resultado ni duplica el run: el adaptador reconecta solo (y además sondea el estado), por lo que MC no necesita lógica propia para cortes breves de red. No hay Last-Event-ID: la reconexión repite los eventos.
- Notas:
  - Peticiones de eventos: [{"at":"2026-10-08T08:47:41.595Z","method":"GET","path":"/v1/runs/run_089131efb26549dabc968eac544910e7/events","status":null,"idempotencyKey":"126ff3e7-be97-4a23-9fd2-00305883ee72","sessionKey":"paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:1f7de538-caad-41dd-9ddd-71314ec586ed:issue:c7c44b60-ca8d-4964-8498-55e4228ad8f0"},{"at":"2026-10-08T08:47:43.734Z","method":"GET","path":"/v1/runs/run_089131efb26549dabc968eac544910e7/events","status":200,"idempotencyKey":"126ff3e7-be97-4a23-9fd2-00305883ee72","sessionKey":"paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:1f7de538-caad-41dd-9ddd-71314ec586ed:issue:c7c44b60-ca8d-4964-8498-55e4228ad8f0"}]

<details><summary>JSON bruto (extractos)</summary>

```json
{
  "run": {
    "info": {
      "id": "126ff3e7-be97-4a23-9fd2-00305883ee72",
      "source": "assignment",
      "status": "succeeded",
      "errorCode": null,
      "error": null,
      "createdAt": "2026-10-08T08:47:40.863Z",
      "startedAt": "2026-10-08T08:47:40.969Z",
      "finishedAt": "2026-10-08T08:47:45.624Z",
      "seconds": 4.7,
      "exitCode": 0,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "needs_followup",
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
      "stdout: [hermes-gateway] request headers (redacted): {\"Authorization\":\"***REDACTED***\",\"Accept\":\"application/json\",\"Content-Type\":\"application/json\",\"Idempotency-Key\":\"126ff3e7-be97-4a23-9fd2-00305883ee72\",\"X-Hermes-Session-Key\":\"[redacted-session-key]\"}",
      "stdout: [hermes-gateway] run created: run_089131efb26549dabc968eac544910e7",
      "stdout: [hermes-gateway:event] run=run_089131efb26549dabc968eac544910e7 event=reasoning.available data={\"event\":\"reasoning.available\",\"run_id\":\"run_089131efb26549dabc968eac544910e7\",\"timestamp\":1791449262.392,\"text\":\"Razonamiento simulado (mock).\",\"seq\":0}",
      "stdout: [hermes-gateway:event] run=run_089131efb26549dabc968eac544910e7 event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_089131efb26549dabc968eac544910e7\",\"timestamp\":1791449263.193,\"delta\":\"MC-MOCK-OK: respuesta s\",\"seq\":1}",
      "stderr: [hermes-gateway] event stream disconnected: terminated",
      "stdout: [hermes-gateway:event] run=run_089131efb26549dabc968eac544910e7 event=reasoning.available data={\"event\":\"reasoning.available\",\"run_id\":\"run_089131efb26549dabc968eac544910e7\",\"timestamp\":1791449262.392,\"text\":\"Razonamiento simulado (mock).\",\"seq\":0}",
      "stdout: [hermes-gateway:event] run=run_089131efb26549dabc968eac544910e7 event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_089131efb26549dabc968eac544910e7\",\"timestamp\":1791449263.193,\"delta\":\"MC-MOCK-OK: respuesta s\",\"seq\":1}",
      "stdout: [hermes-gateway:event] run=run_089131efb26549dabc968eac544910e7 event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_089131efb26549dabc968eac544910e7\",\"timestamp\":1791449263.993,\"delta\":\"imulada del mock de Her\",\"seq\":2}",
      "stdout: [hermes-gateway:event] run=run_089131efb26549dabc968eac544910e7 event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_089131efb26549dabc968eac544910e7\",\"timestamp\":1791449264.795,\"delta\":\"mes (input_chars=3205).\",\"seq\":3}",
      "stdout: [hermes-gateway:event] run=run_089131efb26549dabc968eac544910e7 event=run.completed data={\"event\":\"run.completed\",\"run_id\":\"run_089131efb26549dabc968eac544910e7\",\"timestamp\":1791449265.595,\"output\":\"MC-MOCK-OK: respuesta simulada del mock de Hermes (input_chars=3205).\",\"usage\":{\"input_tokens"
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
      "at": "2026-10-08T08:47:41.590Z",
      "method": "POST",
      "path": "/v1/runs",
      "status": 202,
      "idempotencyKey": "126ff3e7-be97-4a23-9fd2-00305883ee72",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:1f7de538-caad-41dd-9ddd-71314ec586ed:issue:c7c44b60-ca8d-4964-8498-55e4228ad8f0"
    },
    {
      "at": "2026-10-08T08:47:41.595Z",
      "method": "GET",
      "path": "/v1/runs/run_089131efb26549dabc968eac544910e7/events",
      "status": null,
      "idempotencyKey": "126ff3e7-be97-4a23-9fd2-00305883ee72",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:1f7de538-caad-41dd-9ddd-71314ec586ed:issue:c7c44b60-ca8d-4964-8498-55e4228ad8f0"
    },
    {
      "at": "2026-10-08T08:47:42.596Z",
      "method": "GET",
      "path": "/v1/runs/run_089131efb26549dabc968eac544910e7",
      "status": 200,
      "idempotencyKey": "126ff3e7-be97-4a23-9fd2-00305883ee72",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:1f7de538-caad-41dd-9ddd-71314ec586ed:issue:c7c44b60-ca8d-4964-8498-55e4228ad8f0"
    },
    {
      "at": "2026-10-08T08:47:43.599Z",
      "method": "GET",
      "path": "/v1/runs/run_089131efb26549dabc968eac544910e7",
      "status": 200,
      "idempotencyKey": "126ff3e7-be97-4a23-9fd2-00305883ee72",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:1f7de538-caad-41dd-9ddd-71314ec586ed:issue:c7c44b60-ca8d-4964-8498-55e4228ad8f0"
    },
    {
      "at": "2026-10-08T08:47:43.734Z",
      "method": "GET",
      "path": "/v1/runs/run_089131efb26549dabc968eac544910e7/events",
      "status": 200,
      "idempotencyKey": "126ff3e7-be97-4a23-9fd2-00305883ee72",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:1f7de538-caad-41dd-9ddd-71314ec586ed:issue:c7c44b60-ca8d-4964-8498-55e4228ad8f0"
    },
    {
      "at": "2026-10-08T08:47:44.602Z",
      "method": "GET",
      "path": "/v1/runs/run_089131efb26549dabc968eac544910e7",
      "status": 200,
      "idempotencyKey": "126ff3e7-be97-4a23-9fd2-00305883ee72",
      "sess
… (267 caracteres omitidos; ver JSON completo en tests/lab/.runtime/)
```

</details>

### 3. Ejecutor colgado / timeout

- Inicio (UTC): `2026-10-08T08:47:46.336Z` · Fin (UTC): `2026-10-08T08:48:48.351Z` · Duración del escenario: 62 s
- Configuración: hangNextRun: true; timeoutSec 15; eventReconnectMs 500
- Resultado: run timed_out, errorCode timeout, 16.1 s en Paperclip (16.7 s desde crear la tarea); 1 POST /stop; estado final del run en el mock: cancelled; tras 45 s más: 1 runs ({"assignment":1}), 1 POST /v1/runs; tokens sin usageJson
- Veredicto: **cubre** — Un ejecutor colgado no deja el run abierto indefinidamente: a los timeoutSec Paperclip pide stop al ejecutor y cierra el run como timed_out (el build vivo guarda errorCode `timeout`; el código `hermes_gateway_timeout` del adaptador no llega al campo errorCode del run). MC debe fijar un timeoutSec realista por tipo de tarea; no existe otro corte por silencio (umbral del build vivo: 60 min).

<details><summary>JSON bruto (extractos)</summary>

```json
{
  "run": {
    "info": {
      "id": "08132922-12ea-42b1-aead-331c0ecef57f",
      "source": "assignment",
      "status": "timed_out",
      "errorCode": "timeout",
      "error": "Hermes gateway run timed out after 15s.",
      "createdAt": "2026-10-08T08:47:46.463Z",
      "startedAt": "2026-10-08T08:47:46.573Z",
      "finishedAt": "2026-10-08T08:48:02.675Z",
      "seconds": 16.1,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
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
      "stdout: [hermes-gateway] request headers (redacted): {\"Authorization\":\"***REDACTED***\",\"Accept\":\"application/json\",\"Content-Type\":\"application/json\",\"Idempotency-Key\":\"08132922-12ea-42b1-aead-331c0ecef57f\",\"X-Hermes-Session-Key\":\"[redacted-session-key]\"}",
      "stdout: [hermes-gateway] run created: run_6ae207e820034d12abecd4ee3de07294",
      "stdout: [hermes-gateway:event] run=run_6ae207e820034d12abecd4ee3de07294 event=reasoning.available data={\"event\":\"reasoning.available\",\"run_id\":\"run_6ae207e820034d12abecd4ee3de07294\",\"timestamp\":1791449267.538,\"text\":\"Razonamiento simulado (mock).\",\"seq\":0}",
      "stdout: [hermes-gateway] stop requested for run run_6ae207e820034d12abecd4ee3de07294"
    ]
  },
  "afterTimeoutRuns": [
    {
      "id": "08132922-12ea-42b1-aead-331c0ecef57f",
      "source": "assignment",
      "status": "timed_out",
      "errorCode": "timeout",
      "error": "Hermes gateway run timed out after 15s.",
      "createdAt": "2026-10-08T08:47:46.463Z",
      "startedAt": "2026-10-08T08:47:46.573Z",
      "finishedAt": "2026-10-08T08:48:02.675Z",
      "seconds": 16.1,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
      "usage": null
    }
  ],
  "mockRunState": {
    "status": "cancelled",
    "lastEvent": "run.cancelled",
    "events": 2
  },
  "mockHistogram": {
    "POST /v1/runs → 202": 1,
    "GET /v1/runs/:runId/events": 1,
    "GET /v1/runs/:runId → 200": 16,
    "POST /v1/runs/:runId/stop → 200": 1
  },
  "mockRequests": [
    {
      "at": "2026-10-08T08:47:47.136Z",
      "method": "POST",
      "path": "/v1/runs",
      "status": 202,
      "idempotencyKey": "08132922-12ea-42b1-aead-331c0ecef57f",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:023414d5-63db-4e81-9070-f406d045c295:issue:0064b591-9c82-463f-a3b2-d4cb628acf69"
    },
    {
      "at": "2026-10-08T08:47:47.139Z",
      "method": "GET",
      "path": "/v1/runs/run_6ae207e820034d12abecd4ee3de07294/events",
      "status": null,
      "idempotencyKey": "08132922-12ea-42b1-aead-331c0ecef57f",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:023414d5-63db-4e81-9070-f406d045c295:issue:0064b591-9c82-463f-a3b2-d4cb628acf69"
    },
    {
      "at": "2026-10-08T08:47:48.140Z",
      "method": "GET",
      "path": "/v1/runs/run_6ae207e820034d12abecd4ee3de07294",
      "status": 200,
      "idempotencyKey": "08132922-12ea-42b1-aead-331c0ecef57f",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:023414d5-63db-4e81-9070-f406d045c295:issue:0064b591-9c82-463f-a3b2-d4cb628acf69"
    },
    {
      "at": "2026-10-08T08:47:49.141Z",
      "method": "GET",
      "path": "/v1/runs/run_6ae207e820034d12abecd4ee3de07294",
      "status": 200,
      "idempotencyKey": "08132922-12ea-42b1-aead-331c0ecef57f",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:023414d5-63db-4e81-9070-f406d045c295:issue:0064b591-9c82-463f-a3b2-d4cb628acf69"
    },
    {
      "at": "2026-10-08T08:47:50.144Z",
      "method": "GET",
      "path": "/v1/runs/run_6ae207e820034d12abecd4ee3de07294",
      "status": 200,
      "idempotencyKey": "08132922-12ea-42b1-aead-331c0ecef57f",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:023414d5-63db-4e81-9070-f406d045c295:issue:0064b591-9c82-463f-a3b2-d4cb628acf69"
    },
    {
      "at": "2026-10-08T08:47:51.146Z",
      "method": "GET",
      "path": "/v1/runs/run_6ae207e820034d12abecd4ee3de07294",
      "status": 200,
      "idempotencyKey": "08132922-12ea-42b1-aead-331c0ecef57f",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:023414d5-63db-4e81-9070-f406d045c295:issue:0064b591-9c82-463f-a3b2-d4cb628acf69"
    },
    {
      "at": "2026-10-08T08:47:52.149Z",
      "method": "GET",
      "path": "/v1/runs/run_6ae207e820034d12abecd4ee3de07294",
      "status": 200,
      "idempotencyKey": "08132922-12ea-42b1-aead-331c0ecef57f",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:023414d5-63db-4e81-9070-f406d045c295:issue:0064b591-9c82-463f-a3b2-d4cb628acf69"
    },
    {
      "at": "2026-10-08T08:47:53.152Z",
      "method": "GET",
      "path": "/v1/runs/run_6ae207e820034d12abecd4ee3de07294",
      "status": 200,
      "idempotencyKey": "08132922-12ea-42b1-aead-331c0ecef57f",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:023414d5-63db-4e81-9070-f406d045c295:issue:0064b591-9c82-463f-a3b2-d4cb628acf69"
… (4275 caracteres omitidos; ver JSON completo en tests/lab/.runtime/)
```

</details>

### 4. Fallo del run

- Inicio (UTC): `2026-10-08T08:48:48.352Z` · Fin (UTC): `2026-10-08T08:50:20.935Z` · Duración del escenario: 92.6 s
- Configuración: failNextRun: true; ventana de observación 90 s
- Resultado: primer run failed, errorCode hermes_gateway_run_failed; en 90 s: 1 runs {"assignment":1} (sin reintentos); 1 POST /v1/runs; issue blocked, asignada=true
- Veredicto: **cubre** — Un fallo del ejecutor queda visible (failed + errorCode) y NO provoca reintento automático ni tormenta: la tarea sigue con su dueño. MC debe vigilar runs failed y decidir (reintentar, reasignar o escalar al humano).

<details><summary>JSON bruto (extractos)</summary>

```json
{
  "firstRun": {
    "info": {
      "id": "356128b8-3ec7-4c60-8dc8-d2c55141bb05",
      "source": "assignment",
      "status": "failed",
      "errorCode": "hermes_gateway_run_failed",
      "error": "Fallo simulado por el mock de Hermes (failNextRun)",
      "createdAt": "2026-10-08T08:48:48.492Z",
      "startedAt": "2026-10-08T08:48:48.640Z",
      "finishedAt": "2026-10-08T08:48:50.222Z",
      "seconds": 1.6,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
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
      "stdout: [hermes-gateway] request headers (redacted): {\"Authorization\":\"***REDACTED***\",\"Accept\":\"application/json\",\"Content-Type\":\"application/json\",\"Idempotency-Key\":\"356128b8-3ec7-4c60-8dc8-d2c55141bb05\",\"X-Hermes-Session-Key\":\"[redacted-session-key]\"}",
      "stdout: [hermes-gateway] run created: run_c23fa110d66f40e3962c3e25607e4cee",
      "stdout: [hermes-gateway:event] run=run_c23fa110d66f40e3962c3e25607e4cee event=reasoning.available data={\"event\":\"reasoning.available\",\"run_id\":\"run_c23fa110d66f40e3962c3e25607e4cee\",\"timestamp\":1791449329.547,\"text\":\"Razonamiento simulado (mock).\",\"seq\":0}",
      "stdout: [hermes-gateway:event] run=run_c23fa110d66f40e3962c3e25607e4cee event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_c23fa110d66f40e3962c3e25607e4cee\",\"timestamp\":1791449329.708,\"delta\":\"MC-MOCK-OK: respuesta s\",\"seq\":1}",
      "stdout: [hermes-gateway:event] run=run_c23fa110d66f40e3962c3e25607e4cee event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_c23fa110d66f40e3962c3e25607e4cee\",\"timestamp\":1791449329.868,\"delta\":\"imulada del mock de Her\",\"seq\":2}",
      "stdout: [hermes-gateway:event] run=run_c23fa110d66f40e3962c3e25607e4cee event=message.delta data={\"event\":\"message.delta\",\"run_id\":\"run_c23fa110d66f40e3962c3e25607e4cee\",\"timestamp\":1791449330.028,\"delta\":\"mes (input_chars=3205).\",\"seq\":3}",
      "stdout: [hermes-gateway:event] run=run_c23fa110d66f40e3962c3e25607e4cee event=run.failed data={\"event\":\"run.failed\",\"run_id\":\"run_c23fa110d66f40e3962c3e25607e4cee\",\"timestamp\":1791449330.189,\"error\":\"Fallo simulado por el mock de Hermes (failNextRun)\",\"completed\":false,\"partial\":false,\"interrupted\":"
    ]
  },
  "runsIn90s": [
    {
      "id": "356128b8-3ec7-4c60-8dc8-d2c55141bb05",
      "source": "assignment",
      "status": "failed",
      "errorCode": "hermes_gateway_run_failed",
      "error": "Fallo simulado por el mock de Hermes (failNextRun)",
      "createdAt": "2026-10-08T08:48:48.492Z",
      "startedAt": "2026-10-08T08:48:48.640Z",
      "finishedAt": "2026-10-08T08:48:50.222Z",
      "seconds": 1.6,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
      "usage": null
    }
  ],
  "issueStatusAfter": "blocked",
  "mockRunError": "Fallo simulado por el mock de Hermes (failNextRun)",
  "mockHistogram": {
    "POST /v1/runs → 202": 1,
    "GET /v1/runs/:runId/events → 200": 1
  },
  "mockRequests": [
    {
      "at": "2026-10-08T08:48:49.386Z",
      "method": "POST",
      "path": "/v1/runs",
      "status": 202,
      "idempotencyKey": "356128b8-3ec7-4c60-8dc8-d2c55141bb05",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:9ecdbb34-8cd8-4613-adc8-62df8ad6b10d:issue:722d359c-b322-45cb-a591-032bffe3e9cb"
    },
    {
      "at": "2026-10-08T08:48:49.390Z",
      "method": "GET",
      "path": "/v1/runs/run_c23fa110d66f40e3962c3e25607e4cee/events",
      "status": 200,
      "idempotencyKey": "356128b8-3ec7-4c60-8dc8-d2c55141bb05",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:9ecdbb34-8cd8-4613-adc8-62df8ad6b10d:issue:722d359c-b322-45cb-a591-032bffe3e9cb"
    }
  ]
}
```

</details>

### 5. Clave rechazada

- Inicio (UTC): `2026-10-08T08:50:20.935Z` · Fin (UTC): `2026-10-08T08:51:22.569Z` · Duración del escenario: 61.6 s
- Configuración: unauthorizedNext: true; ventana de observación 60 s
- Resultado: primer run failed, errorCode hermes_gateway_auth_failed; error: "Hermes gateway HTTP 401. Check adapterConfig.apiKey matches the Hermes API_SERVER_KEY for the running gateway."; en 60 s: 1 runs {"assignment":1}; 1 POST /v1/runs (1 con 401); issue blocked
- Veredicto: **cubre** — Una clave rechazada se reporta con un código específico (hermes_gateway_auth_failed) y no se reintenta: no hay tormenta de reintentos. MC puede distinguir "clave mala" de "ejecutor caído" por el errorCode y avisar al operador para rotar la clave.

<details><summary>JSON bruto (extractos)</summary>

```json
{
  "firstRun": {
    "info": {
      "id": "3807e2b6-5d6b-44ab-a963-de2608a33c04",
      "source": "assignment",
      "status": "failed",
      "errorCode": "hermes_gateway_auth_failed",
      "error": "Hermes gateway HTTP 401. Check adapterConfig.apiKey matches the Hermes API_SERVER_KEY for the running gateway.",
      "createdAt": "2026-10-08T08:50:21.085Z",
      "startedAt": "2026-10-08T08:50:21.219Z",
      "finishedAt": "2026-10-08T08:50:21.882Z",
      "seconds": 0.7,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
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
      "stdout: [hermes-gateway] request headers (redacted): {\"Authorization\":\"***REDACTED***\",\"Accept\":\"application/json\",\"Content-Type\":\"application/json\",\"Idempotency-Key\":\"3807e2b6-5d6b-44ab-a963-de2608a33c04\",\"X-Hermes-Session-Key\":\"[redacted-session-key]\"}"
    ]
  },
  "runsIn60s": [
    {
      "id": "3807e2b6-5d6b-44ab-a963-de2608a33c04",
      "source": "assignment",
      "status": "failed",
      "errorCode": "hermes_gateway_auth_failed",
      "error": "Hermes gateway HTTP 401. Check adapterConfig.apiKey matches the Hermes API_SERVER_KEY for the running gateway.",
      "createdAt": "2026-10-08T08:50:21.085Z",
      "startedAt": "2026-10-08T08:50:21.219Z",
      "finishedAt": "2026-10-08T08:50:21.882Z",
      "seconds": 0.7,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
      "usage": null
    }
  ],
  "mockHistogram": {
    "POST /v1/runs → 401": 1
  },
  "mockRequests": [
    {
      "at": "2026-10-08T08:50:21.849Z",
      "method": "POST",
      "path": "/v1/runs",
      "status": 401,
      "idempotencyKey": "3807e2b6-5d6b-44ab-a963-de2608a33c04",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:f1b01207-7662-41a5-a0dc-d91954ccf601:issue:c80e6f9c-0a13-4cc1-9922-716737789be3"
    }
  ]
}
```

</details>

### 6. Límite de concurrencia

- Inicio (UTC): `2026-10-08T08:51:22.570Z` · Fin (UTC): `2026-10-08T08:52:54.306Z` · Duración del escenario: 91.7 s
- Configuración: rateLimitNext: true (429 + Retry-After: 1); ventana de observación 90 s
- Resultado: primer run failed, errorCode hermes_gateway_rate_limited (Hermes gateway HTTP 429); en 90 s: 1 runs {"assignment":1}, reintentos programados: 0 (ninguno); 1 POST /v1/runs (1 con 429); algún run succeeded: false; issue blocked
- Veredicto: **parcial** — El 429 deja el run failed sin reintento visible en la ventana: MC debe re-despachar o encolar por su cuenta y respetar Retry-After.

<details><summary>JSON bruto (extractos)</summary>

```json
{
  "firstRun": {
    "info": {
      "id": "9d83f635-fce6-4954-9fef-9c76e78f8ef5",
      "source": "assignment",
      "status": "failed",
      "errorCode": "hermes_gateway_rate_limited",
      "error": "Hermes gateway HTTP 429",
      "createdAt": "2026-10-08T08:51:22.742Z",
      "startedAt": "2026-10-08T08:51:22.868Z",
      "finishedAt": "2026-10-08T08:51:23.631Z",
      "seconds": 0.8,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
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
      "stdout: [hermes-gateway] request headers (redacted): {\"Authorization\":\"***REDACTED***\",\"Accept\":\"application/json\",\"Content-Type\":\"application/json\",\"Idempotency-Key\":\"9d83f635-fce6-4954-9fef-9c76e78f8ef5\",\"X-Hermes-Session-Key\":\"[redacted-session-key]\"}"
    ]
  },
  "runsIn90s": [
    {
      "id": "9d83f635-fce6-4954-9fef-9c76e78f8ef5",
      "source": "assignment",
      "status": "failed",
      "errorCode": "hermes_gateway_rate_limited",
      "error": "Hermes gateway HTTP 429",
      "createdAt": "2026-10-08T08:51:22.742Z",
      "startedAt": "2026-10-08T08:51:22.868Z",
      "finishedAt": "2026-10-08T08:51:23.631Z",
      "seconds": 0.8,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
      "usage": null
    }
  ],
  "otherRuns": 0,
  "issueStatusAfter": "blocked",
  "mockHistogram": {
    "POST /v1/runs → 429": 1
  },
  "mockRequests": [
    {
      "at": "2026-10-08T08:51:23.591Z",
      "method": "POST",
      "path": "/v1/runs",
      "status": 429,
      "idempotencyKey": "9d83f635-fce6-4954-9fef-9c76e78f8ef5",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:2c0e9287-7fb9-432a-bd89-caa380035f48:issue:9a23f019-5106-48e2-b6c9-7abee7ec13d3"
    }
  ]
}
```

</details>

### 7. Duplicados

- Inicio (UTC): `2026-10-08T08:52:54.307Z` · Fin (UTC): `2026-10-08T08:53:41.184Z` · Duración del escenario: 46.9 s
- Configuración: dos POST /heartbeat/invoke {issueId} en <1 s sobre UNA tarea; completeDelayMs 6000; luego duplicateReplayAsNew: true
- Resultado: [ASERCIÓN FALLÓ: con duplicateReplayAsNew el mock crea un run nuevo por petición]
- Veredicto: **no cubre** — 

<details><summary>JSON bruto (extractos)</summary>

```json
{}
```

</details>

### 8. Reinicio del ejecutor

- Inicio (UTC): `2026-10-08T08:53:41.185Z` · Fin (UTC): `2026-10-08T08:55:42.741Z` · Duración del escenario: 121.6 s
- Configuración: completeDelayMs 8000; close() a los 2 s; reinicio 5 s después (estado nuevo, run desconocido); timeoutSec 45
- Resultado: mock cerrado 2026-10-08T08:53:43.454Z (run running, 0 eventos) y reiniciado 2026-10-08T08:53:48.455Z; run de Paperclip timed_out, errorCode timeout a los 46 s; error "Hermes gateway run timed out after 45s."; en 75 s más: 1 runs {"assignment":1} (sin runs adicionales); 1 POST /v1/runs en total; issue blocked
- Veredicto: **parcial** — Apagar o reiniciar el ejecutor a mitad de tarea NO se recupera por sí solo en el mismo run: el trabajo remoto se pierde (el run cambia de dueño/estado en el mock) y Paperclip lo cierra con el estado/código anotado. Lo que ocurre después depende de la recuperación de Paperclip (ver runs adicionales); MC debe detectar el run fallido, avisar y decidir si re-despacha con una clave nueva (puede duplicar trabajo si el ejecutor original seguía vivo).

<details><summary>JSON bruto (extractos)</summary>

```json
{
  "mockBeforeClose": {
    "mockRunId": "run_3ae7af2df7fe4fc4bcbdd10a7759edd9",
    "status": "running",
    "events": 0
  },
  "closeAtUtc": "2026-10-08T08:53:43.454Z",
  "restartAtUtc": "2026-10-08T08:53:48.455Z",
  "terminalRun": {
    "info": {
      "id": "d9891da5-ad1c-4580-a841-b6c0ccd9dd9e",
      "source": "assignment",
      "status": "timed_out",
      "errorCode": "timeout",
      "error": "Hermes gateway run timed out after 45s.",
      "createdAt": "2026-10-08T08:53:41.497Z",
      "startedAt": "2026-10-08T08:53:41.571Z",
      "finishedAt": "2026-10-08T08:54:27.193Z",
      "seconds": 45.6,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
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
      }
    ],
    "log": [
      "stdout: [hermes-gateway] creating run at http://127.0.0.1:18642/v1/runs (timeout=45s, session=issue)",
      "stdout: [hermes-gateway] request headers (redacted): {\"Authorization\":\"***REDACTED***\",\"Accept\":\"application/json\",\"Content-Type\":\"application/json\",\"Idempotency-Key\":\"d9891da5-ad1c-4580-a841-b6c0ccd9dd9e\",\"X-Hermes-Session-Key\":\"[redacted-session-key]\"}",
      "stdout: [hermes-gateway] run created: run_3ae7af2df7fe4fc4bcbdd10a7759edd9",
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
      "id": "d9891da5-ad1c-4580-a841-b6c0ccd9dd9e",
      "source": "assignment",
      "status": "timed_out",
      "errorCode": "timeout",
      "error": "Hermes gateway run timed out after 45s.",
      "createdAt": "2026-10-08T08:53:41.497Z",
      "startedAt": "2026-10-08T08:53:41.571Z",
      "finishedAt": "2026-10-08T08:54:27.193Z",
      "seconds": 45.6,
      "exitCode": 1,
      "retryOfRunId": null,
      "scheduledRetryReason": null,
      "scheduledRetryAttempt": 0,
      "scheduledRetryAt": null,
      "livenessState": "failed",
      "usage": null
    }
  ],
  "issueStatusAfter": "blocked",
  "activity": [
    {
      "at": "2026-10-08T08:54:35.344Z",
      "action": "issue.execution_recovery_settled",
      "actor": "system",
      "details": {
        "replay": "not_authorized",
        "outcome": "blocked",
        "recoveryActionId": "25f2f8c2-c3aa-47f7-b021-4eb13db198a4"
      }
    },
    {
      "at": "2026-10-08T08:53:41.436Z",
      "action": "issue.created",
      "actor": "user"
    }
  ],
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
      "at": "2026-10-08T08:53:42.151Z",
      "method": "POST",
      "path": "/v1/runs",
      "status": 202,
      "idempotencyKey": "d9891da5-ad1c-4580-a841-b6c0ccd9dd9e",
      "sessionKey": "paperclip:company:b0d4c18c-7069-499f-8879-26cdc29738dc:agent:5b9ebab0-60cb-42a0-a6f3-db654801e499:issue:a0492fc4-54e3-4dc0-822f-7547350160cd"
    },
    {
      "at": "2026-10-08T08:53:42.156Z",
      "method": "GET",
      "path": "/v1/
… (46522 caracteres omitidos; ver JSON completo en tests/lab/.runtime/)
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
