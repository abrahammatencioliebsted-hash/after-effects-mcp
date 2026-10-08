# @mc/hermes-mock

Doble de pruebas del **API server de Hermes Agent** con inyección de fallos. Sirve para probar la ruta
`hermes_gateway` de Paperclip (y el resto de Mission Control) sin gastar tokens ni depender de un Hermes real.

> **Es una SIMULACIÓN.** No ejecuta ningún modelo ni herramienta, no guarda sesiones ni memoria y no
> persiste nada (todo vive en memoria y se pierde al cerrar). Solo imita el contrato HTTP observado en
> el clon `a28a5d03` de Hermes (`gateway/platforms/api_server.py`, `api_server_runs.py`,
> `api_server_run_idempotency.py`) y el modo en que lo consume el adaptador de Paperclip
> (`packages/adapters/hermes/src/gateway/server/execute.ts`). Solo escucha en loopback.

## Qué imita

- Cabeceras `Authorization: Bearer`, `Idempotency-Key` y `X-Hermes-Session-Key`.
- `POST /v1/runs` → `202 {run_id, status:"started", replayed}`; repetición con la misma clave y el mismo
  contenido → mismo `run_id` con `replayed:true` (y cabecera `Idempotency-Replayed: true`); misma clave con
  contenido distinto (o distinta `X-Hermes-Session-Key`) → `409 idempotency_key_conflict`.
- `GET /v1/runs/{id}` con la forma `hermes.run` (estado, `output`, `usage`, `runtime`, `completed`, `partial`, `interrupted`).
- `GET /v1/runs/{id}/events` en SSE: `: open`, frames `id: n` + `data: {...}` (`reasoning.available`,
  `message.delta`…, `run.completed`), comentarios `: keepalive` y cierre con `: stream closed`.
  Admite `Last-Event-ID` (o `?last_seq=`) para reanudar.
- Errores con el sobre `{error:{message,type,param,code}}`; 401 con `gateway_auth_error` / `gateway_auth_failed`;
  429 con `Retry-After: 1`; 404 `run_not_found`; 405 para `GET /v1/runs`.

## Qué NO imita

- No hay agente, modelo, herramientas, aprobaciones (`/approval`), sesiones (`/api/sessions`), chat completions,
  responses, jobs ni skills. `capabilities` lo refleja (esas banderas van en `false`).
- El texto de salida es fijo: `MC-MOCK-OK: respuesta simulada del mock de Hermes (input_chars=N).`
  Los tokens son una estimación (`ceil(caracteres / 4)`), no tokens reales.
- La idempotencia no es durable (se pierde al reiniciar) y hay un único ámbito (una sola clave de API).
- Los eventos de un run terminado se conservan mientras viva el proceso; el Hermes real los retira tras un tiempo.
- El estado final de un run detenido es `cancelled` (como en Hermes real), no `stopped`; el adaptador de
  Paperclip trata ambos igual.
- No hay `/health/detailed`, mirrors `/p/{profile}/…` ni CORS.

## Rutas

| Método | Ruta | Auth | Respuesta |
| --- | --- | --- | --- |
| GET | `/health` (y `/v1/health`) | no | `{status:"ok", platform:"hermes-agent", version:"mock"}` |
| GET | `/v1/capabilities` | sí | `hermes.api_server.capabilities` con `features` (`runs_idempotency`, `run_events_sse`, `run_stop`, `session_key_header`…) y `endpoints` |
| POST | `/v1/runs` | sí | `202 {run_id, status:"started", replayed}`; `400` JSON/`input` inválido; `409` conflicto; `429` tope |
| GET | `/v1/runs/{id}` | sí | objeto `hermes.run`; `404 run_not_found` |
| GET | `/v1/runs/{id}/events` | sí | SSE (ver arriba); `404 run_not_found` |
| POST | `/v1/runs/{id}/stop` | sí | `{run_id, status:"stopping"}` y después `cancelled`; si ya terminó, devuelve su estado (200) |
| POST | `/v1/runs/{id}/steer` | sí | `{object:"hermes.run.steer", accepted:true}`; `409 run_not_accepting_steer` si no está `running` |
| GET | `/v1/runs` | — | `405` (`Allow: POST`) |
| POST | `/__mock/faults` | sí | fusiona un `Partial<Faults>` (valor `null` borra el fallo) → `{faults}` |
| GET | `/__mock/state` | sí | `{faults, runs, requests}` |
| POST | `/__mock/reset` | sí | borra runs, peticiones y reservas de idempotencia, y restaura los fallos a los de `opts.faults` del arranque |

Estados de un run: `queued` → `running` → `completed` \| `failed` \| `cancelled` (pasando por `stopping`).
Por defecto un run dura `completeDelayMs` = 300 ms y emite 1 `reasoning.available`, 3 `message.delta` y `run.completed`.
Con más de `maxConcurrentRuns` runs activos (por defecto 10, como Hermes; 0 lo desactiva) un run **nuevo** recibe 429
(un replay idempotente se sigue resolviendo, igual que en el servidor real).

## Fallos inyectables (`Faults`)

| Fallo | Efecto | Duración |
| --- | --- | --- |
| `dropSseAfterEvents: N` | Cierra el socket SSE tras escribir N frames de evento; la reconexión funciona normal | una vez |
| `failNextRun: true` | El próximo run acaba `failed` con `error` (evento `run.failed`) | un run |
| `hangNextRun: true` | El próximo run no termina hasta recibir `stop` (emite solo el primer evento) | un run |
| `unauthorizedNext: true` | La próxima petición autenticada (no `/health`, no `/__mock`) responde 401 aunque la clave sea correcta | una vez |
| `rateLimitNext: true` | El próximo `POST /v1/runs` responde 429 + `Retry-After: 1` | una vez |
| `latencyMs: N` | Retardo añadido a cada respuesta (no a `/__mock`) | persistente |
| `duplicateReplayAsNew: true` | Mal comportamiento: ignora la idempotencia y crea un run nuevo siempre (sin 409) | persistente |

Los fallos "una vez" se consumen al usarse. `setFaults({clave: undefined})` o `{"clave": null}` por HTTP los borra.

## Uso desde pruebas

```js
import { startHermesMock } from '@mc/hermes-mock';

const mock = await startHermesMock({ apiKey: 'clave-de-prueba-1234', port: 0, completeDelayMs: 100 });
mock.setFaults({ dropSseAfterEvents: 2 });          // corta el SSE una vez

const r = await fetch(`${mock.url}/v1/runs`, {
  method: 'POST',
  headers: { Authorization: 'Bearer clave-de-prueba-1234', 'Content-Type': 'application/json',
             'Idempotency-Key': 'tarea-1', 'X-Hermes-Session-Key': 'issue-42' },
  body: JSON.stringify({ input: 'hola', instructions: 'sé breve' }),
});
// ...
mock.runs;      // Map<run_id, MockRun> (estado interno, solo lectura)
mock.requests;  // registro de peticiones: at, method, path, headers (Authorization enmascarada), body, status
await mock.close();
```

Opciones: `port` (0 = efímero), `host` (solo loopback), `apiKey` (obligatoria), `faults`, `outputText`
(admite `{inputChars}`), `maxConcurrentRuns`, `completeDelayMs`, `keepaliveMs` (def. 10000).

Para comprobar que un cliente **detecta duplicados**, arranca con `duplicateReplayAsNew: true` y verifica
en `mock.runs` / `mock.requests` que dos `POST /v1/runs` con la misma `Idempotency-Key` crearon dos runs.

## Uso desde la línea de órdenes

```bash
pnpm --filter @mc/hermes-mock build
node packages/hermes-mock/dist/cli.js --port 18642 --key clave-de-prueba-1234 --complete-delay-ms 300
# Mock de Hermes (SIMULACION) escuchando en http://127.0.0.1:18642    (Ctrl+C para cerrar)

# fallo en caliente:
curl -X POST -H "Authorization: Bearer clave-de-prueba-1234" -H "Content-Type: application/json" \
     -d '{"hangNextRun": true}' http://127.0.0.1:18642/__mock/faults
curl -H "Authorization: Bearer clave-de-prueba-1234" http://127.0.0.1:18642/__mock/state
```

Otras opciones: `--max-concurrent-runs N`, `--output-text "..."`; la clave también puede venir de `HERMES_MOCK_KEY`.

## Uso desde Paperclip

Crea un agente `hermes_gateway` apuntando al mock (no uses los puertos 8642 del Hermes real):

```json
{
  "adapterType": "hermes_gateway",
  "adapterConfig": {
    "apiBaseUrl": "http://127.0.0.1:18642",
    "apiKey": "clave-de-prueba-1234",
    "sessionKeyStrategy": "issue",
    "timeoutSec": 30,
    "eventReconnectMs": 500
  }
}
```

El adaptador usa `Idempotency-Key = id del run de Paperclip`, así que reintentos y duplicados quedan visibles en
`/__mock/state`. Escenarios útiles: `dropSseAfterEvents` (el adaptador reconecta tras `eventReconnectMs` y, como
no envía `Last-Event-ID`, recibe el relato completo), `hangNextRun` + `timeoutSec` bajo (comprueba `stop` y
`hermes_gateway_timeout`), `failNextRun` (`hermes_gateway_run_failed`), `rateLimitNext` (`hermes_gateway_rate_limited`
con `Retry-After`), `unauthorizedNext` (`hermes_gateway_auth_failed`).

## Desarrollo

```bash
pnpm --filter @mc/hermes-mock build
pnpm --filter @mc/hermes-mock typecheck
pnpm --filter @mc/hermes-mock test      # node:test, ejecuta build antes (pretest)
```

Solo usa módulos integrados de Node (`node:http`, `node:crypto`).
