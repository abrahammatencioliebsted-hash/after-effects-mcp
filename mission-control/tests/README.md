# @mc/tests — pruebas de integración y de fallos

Paquete del workspace (`@mc/tests`, privado) con dos niveles de prueba:

| Nivel | Qué hace | Necesita el laboratorio | Orden |
| --- | --- | --- | --- |
| Ayudantes | Pruebas `node:test` de `lib/*.mjs` (prefijos, redacción de claves, clasificación del registro del mock, generación del informe, mock en puerto efímero, cliente con `fetch` simulado) | No | `pnpm --filter @mc/tests test` |
| Fallos en vivo | 8 escenarios contra el **Paperclip real** (adaptador real `hermes_gateway`) con el **mock de Hermes** (`@mc/hermes-mock`) como ejecutor remoto | Sí (Paperclip en marcha) | `pnpm --filter @mc/tests test:lab` |

`test:lab` se **omite limpiamente** si falta `MC_PAPERCLIP_URL` (o `MC_PAPERCLIP_COMPANY_ID`).

## Cómo correrlo

```bash
export PATH=/opt/node24/bin:$PATH
pnpm --filter @mc/hermes-mock build          # el mock debe estar compilado (dist/)

# Sin laboratorio:
pnpm --filter @mc/tests test

# Con el laboratorio (≈10 min; los escenarios son secuenciales):
MC_PAPERCLIP_URL=http://127.0.0.1:3101 \
MC_PAPERCLIP_COMPANY_ID=b0d4c18c-7069-499f-8879-26cdc29738dc \
pnpm --filter @mc/tests test:lab
```

Variables: `MC_PAPERCLIP_URL`, `MC_PAPERCLIP_COMPANY_ID` (obligatorias), `MC_PAPERCLIP_TOKEN` (opcional; en `local_trusted` por loopback no hace falta), `MC_MOCK_PORT` (def. 18642), `MC_FALLOS_ONLY` (p. ej. `2,3` para correr solo esos escenarios), `MC_FALLOS_REPORT` (ruta del informe; def. `docs/evidencias/fallos-adaptador-mock.md`).

Al terminar escribe el informe Markdown (tabla + JSON bruto plegado por escenario + "Qué NO demuestra") y una copia JSON en `tests/lab/.runtime/` (ignorada por git).

## Reglas de seguridad de la prueba

- El mock escucha solo en `127.0.0.1:18642`; **no** toca el Hermes real (8642), el modelo simulado (8700) ni cierra Paperclip.
- Todo objeto creado en Paperclip lleva el prefijo `[auto-test fallos]` (secreto, agentes, tareas). No se tocan MIS-1/MIS-2 ni los agentes o secretos existentes.
- La clave del mock se genera en cada ejecución (`randomBytes`), se guarda como secreto de Paperclip (el agente la referencia con `secret_ref`) y se redacta de cualquier texto del informe. No hay credenciales en el código.
- Al terminar (y tras cada escenario) los agentes creados se **pausan** (`PATCH /api/agents/{id} {status:"paused"}`) para que el vigilante deje de despertarlos, y las tareas abiertas se cancelan. El secreto creado queda (con prefijo) en la empresa.

## Qué prueba cada escenario

1. **Camino feliz.** Tarea asignada → run `succeeded` por `assignment`; comentario con `MC-MOCK-OK`; el mock recibe `POST /v1/runs` con `Idempotency-Key` = id del run de Paperclip y `X-Hermes-Session-Key`; los tokens de `usageJson` coinciden con los del mock; después la reparación de disposición lanza 2 runs `automation` y la tarea acaba `blocked` (`issue.disposition_repair_escalated` con `maxAttempts: 2`); cierre como operador (`in_review` → `done`).
2. **Corte del SSE.** `dropSseAfterEvents: 2`: el adaptador reconecta (≥2 `GET /events`) y el run termina `succeeded`.
3. **Ejecutor colgado.** `hangNextRun` con `timeoutSec: 15`: el run acaba `timed_out`, el mock recibe `POST /stop`; se mide el tiempo y se vigila 45 s más.
4. **Fallo del run.** `failNextRun`: run `failed`; se cuentan los runs en 90 s y se mira qué hace Paperclip con la tarea.
5. **Clave rechazada.** `unauthorizedNext`: run `failed` con código de autenticación; se cuentan los runs en 60 s.
6. **Límite de concurrencia.** `rateLimitNext` (429 + `Retry-After`): código y reintentos en 90 s.
7. **Duplicados.** Dos `POST /heartbeat/invoke {issueId}` simultáneos (con run en vuelo, sin asignar y con `idempotencyKey`); recuento de runs de Paperclip frente a `POST /v1/runs` en el mock; sonda directa y vía Paperclip con `duplicateReplayAsNew`.
8. **Reinicio del ejecutor.** `close()` del mock a los 2 s de empezar, reinicio 5 s después con estado limpio (el run es desconocido): qué hace el run y qué hace la tarea.

Cada escenario registra una fila con marcas de tiempo UTC, estado/`errorCode`, nº de runs, nº de peticiones al mock, segundos y el consumo (`inputTokens`/`outputTokens`) del run.

## Qué NO demuestra

- **Mock ≠ Hermes real**: imita el contrato HTTP, no un modelo, sesiones persistentes ni herramientas. Los tokens son una estimación (`ceil(caracteres/4)`).
- **Un solo equipo, sin HTTPS**: todo por loopback; no hay red real, latencia ni particiones.
- **Un solo build** de Paperclip (`2026.1005.0`); el código del clon más reciente se comporta distinto en varios umbrales.
- **No reinicia Paperclip**: el reinicio simulado es el del ejecutor.
- **No mide coste en dinero** (`costStatus: unpriced`, 0 centavos).
- Ventanas de observación cortas (60–90 s): no cubren reintentos tardíos ni carga concurrente real.

## Estructura

```
tests/
  package.json
  lib/paperclip.mjs   cliente fino de la API de Paperclip (fetch) + ayudantes (prefijo, espera de runs, pausa)
  lib/mock.mjs        carga del mock y análisis de su registro de peticiones
  lib/report.mjs      generación del informe Markdown (pura)
  test/*.test.mjs     pruebas sin laboratorio
  lab/fallos.test.mjs escenarios en vivo (los gobierna MC_PAPERCLIP_URL)
```

El paquete no declara dependencias: carga `@mc/hermes-mock` si está enlazado y, si no, su `dist/` por ruta relativa, así que no obliga a modificar el lockfile.
