---
tipo: runbook
proyecto: Mission Control
revisado: 2026-10-08
estado: "El flujo invitación → aprobar → reclamar clave, la clave por API y la negativa a HTTP remoto se ensayaron de verdad en Linux (loopback, instancia desechable). Tailscale, HTTPS, modo authenticated y un segundo equipo real NO se probaron."
---

# Unir un segundo equipo (portátil o Mac) como ejecutor `hermes_gateway`

Claves: **[C]** confirmado por ti · **[H]** comprobado en el entorno Cloud (Linux) · **[F]** documentación/código leído · **[I]** inferencia · **[Pr]** propuesta sin aprobar.
**[H-loopback]** = ensayado de verdad, pero con las dos mitades en el mismo equipo (127.0.0.1) y Paperclip en `local_trusted`. Todo lo que cruza la red está sin probar.

## 0. Modelo mental: tres credenciales y dos direcciones

```
 Equipo A (plano de control)                           Equipo B (ejecutor)
 Paperclip  authenticated · private · bind=tailnet      Hermes API server (127.0.0.1:8642, clave propia)
 :3100  ◄───────────────── clave de AGENTE (Hermes→Paperclip, PAPERCLIP_API_KEY) ──────────────
        ───────────────── Bearer API_SERVER_KEY (Paperclip→Hermes) ──►  tailscale serve HTTPS :443 ─► 127.0.0.1:8642
```
1. Clave del proveedor del modelo (OpenRouter, MiMo…): solo en el `.env` de Hermes.
2. `API_SERVER_KEY` de Hermes: la guarda Paperclip como secreto (`secret_ref`) y la envía como `Authorization: Bearer` (**Paperclip → Hermes**) [F].
3. Clave de agente de Paperclip: Hermes la usa como `PAPERCLIP_API_KEY` (**Hermes → Paperclip**). *No reutilices la 2 como 3.* Paperclip **no** le envía esta clave a `hermes_gateway`: solo pone en el prompt la URL (`paperclipApiUrl`) [F, `execute.ts:260,297`]. Si tu Hermes no va a llamar a la API de Paperclip (el piloto lo evita: el humano mueve el estado), la 3 puede no usarse todavía.

Tres reglas de URL: `apiBaseUrl` = la URL de Hermes **que alcanza el servidor de Paperclip**; `paperclipApiUrl` = la URL de Paperclip **que alcanza Hermes**; y un `apiBaseUrl` HTTP que no sea loopback se **deniega** (HTTPS o interruptor inseguro solo de prueba).

> **En el BFF de Mission Control (equipo A):** el node-agent de B anuncia su Hermes como `http://127.0.0.1:8642` (su propio loopback). Desde A eso sería otra máquina, así que el BFF **no** lo usa para crear el agente: exige `MC_HERMES_URL_<MACHINEID>` (p. ej. `MC_HERMES_URL_WIN_LAPTOP_1=https://b.tail1234.ts.net`) y responde 409 si falta. Solo el equipo `MC_LOCAL_MACHINE_ID` (por defecto `win-principal`) puede anunciar loopback. Si abres el panel por un nombre que no sea `localhost`, una IP o `*.ts.net`, añádelo a `MC_ALLOWED_HOSTS`. Detalle: `docs/08-contrato-bff.md`, reglas 8–10.

## A. Plano de control: pasar Paperclip a `authenticated` + tailnet

> Mientras Paperclip esté en `local_trusted` + loopback **ningún otro equipo puede alcanzarlo** (`DEPLOYMENT-MODES.md:65-69`). Este paso es el que abre la puerta; hazlo después de la copia de seguridad completa (`actualizar-y-restaurar.md` §3).

### A.1 Requisitos
- Tailscale en el equipo A y en B, misma tailnet. En el panel de administración de Tailscale: **MagicDNS** y **HTTPS Certificates** activados (necesarios para `tailscale serve --https`) **[I]**.
- Nombre MagicDNS de A (`a.tail1234.ts.net`) y su IP (`tailscale ip -4`).

### A.2 Configuración de la instancia

Instancia nueva (aún sin `config.json`): `paperclipai onboard --yes --bind tailnet --install-service`. Si no detecta Tailscale guarda loopback con aviso (`onboard.ts:576-577`).
Instancia existente (nuestro caso, venía de `local_trusted`): `~/.paperclip/instances/default/.env` (se carga con `override:false`):
```
PAPERCLIP_DEPLOYMENT_MODE=authenticated
PAPERCLIP_DEPLOYMENT_EXPOSURE=private
PAPERCLIP_BIND=tailnet
PAPERCLIP_TAILNET_BIND_HOST=100.x.y.z                    # OBLIGATORIO en la práctica: si al arrancar no hay IP de Tailscale, el servidor no arranca
PAPERCLIP_ALLOWED_HOSTNAMES=a.tail1234.ts.net,b.tail1234.ts.net
```
```sh
paperclipai allowed-hostname a.tail1234.ts.net           # alternativa persistente en config.json; requiere reinicio
paperclipai service restart                              # macOS/WSL2 gestionado
```
Detalles que importan [F]:
- `bind=tailnet` escucha en la IP de Tailscale (`tailscale ip -4`) o en `PAPERCLIP_TAILNET_BIND_HOST` (`config.ts:105-122`). Con la IP fijada en `.env` evitas que el arranque dependa de Tailscale (`config.ts:305-312`, `network-bind.ts:100`).
- **En WSL2/Linux systemd se rinde tras 5 fallos en 60 s** (`StartLimitBurst=5`): si arrancaste antes que Tailscale, recupera con `systemctl --user reset-failed paperclipai.service && systemctl --user start paperclipai.service`. En macOS `KeepAlive` reintenta sin límite.
- Guardia de Host: en modo privado solo se aceptan `localhost`, `127.0.0.1`, `::1`, la IP de bind y los `allowedHostnames`. **El nombre MagicDNS debe estar en la lista** o verás errores de login/redirección (`private-hostname-guard.ts:34-45`).
- En `authenticated` el loopback **deja de ser abierto**: la API pide credencial. El primer administrador se reclama por navegador (“Claim this instance”) o con `paperclipai auth bootstrap-ceo` (imprime una invitación de un solo uso); si migras desde `local_trusted` verás en el arranque un enlace `/board-claim/<token>?code=…` (`DEPLOYMENT-MODES.md` §7-8). Antes de reclamar, mantén el puerto solo en tu tailnet: el primero que reclama gana.
- Token para el BFF y los scripts: `paperclipai auth login --api-base http://a.tail1234.ts.net:3100` (flujo por navegador) y luego `paperclipai token board create --name mc-bff --ttl-days 90 --json` (comando comprobado **[H-loopback]** en `local_trusted`; en `authenticated` falta ensayarlo). El token va en `MC_PAPERCLIP_TOKEN` del BFF; no lo pegues en el chat ni en el repositorio.
- Los scripts de restauración usan la API sin credencial y por tanto solo funcionan en `local_trusted`; con `authenticated` define `PAPERCLIP_API_KEY` (el `.mjs` de verificación lo envía como Bearer).

### A.3 Qué observar

| # | Comando (desde B, o desde A con la IP) | Esperado | Si no |
|---|---|---|---|
| A1 | `curl http://100.x.y.z:3100/api/health` | `{"status":"ok",…,"deploymentMode":"authenticated",…}` | Puerto/bind: `paperclipai service logs -f`; `tailscale status`; firewall de Windows |
| A2 | `curl http://a.tail1234.ts.net:3100/api/health` | igual | El nombre falta en `allowedHostnames`; reinicia |
| A3 | `tailscale ip -4` en A coincide con `PAPERCLIP_TAILNET_BIND_HOST` | sí | Corrige el `.env` |
| A4 | Reinicia A **sin** arrancar Tailscale y mira el servicio | Con la IP fijada, arranca; sin ella, falla/reintenta | Evidencia V14 |
| A5 | `curl http://127.0.0.1:3100/api/companies` sin token | rechazado (401/403) | Si responde 200 sigues en `local_trusted` |

## B. Equipo B: Tailscale, Hermes y HTTPS

1. **Unir a la tailnet:** instala Tailscale e inicia sesión (Windows: `winget install Tailscale.Tailscale` **[I]**; macOS: app o `brew install --cask tailscale` **[I]**). `tailscale status` debe listar a A y a B.
2. **Instalar Hermes con API server** (mismo commit fijado): Windows `scripts\windows\install-hermes.ps1 -Yes`; Mac `scripts/macos/install-hermes.sh --yes`. Resultado: `http://127.0.0.1:8642`, `API_SERVER_KEY` propia **distinta por equipo** (generada en B, nunca copiada de A), gateway como servicio de inicio de sesión. Guía: `windows.md` §3 / `macos.md` §2.
3. **Proveedor del modelo en B:** una clave propia del equipo. Si usas el Token Plan de MiMo, recuerda el riesgo de términos con automatización [F] y la decisión P06.
4. **HTTPS delante de Hermes con `tailscale serve`** (el adaptador **no** acepta HTTP remoto):
   ```sh
   tailscale serve --bg --https=443 http://127.0.0.1:8642      # sintaxis [I]; confirma con: tailscale serve --help
   tailscale serve status                                       # debe mostrar https://b.tail1234.ts.net → http://127.0.0.1:8642
   ```
   Hermes sigue en loopback; solo la tailnet llega al 443. **No uses Funnel** (lo expondría a Internet). `packages/tailscale-https-broker` del repo de Paperclip **no sirve** para esto: es un demonio solo-Linux para *previews* de ramas, no toca el puerto de Hermes ni el 3100 [F].
   El certificado es de una CA pública (Let's Encrypt vía Tailscale) **[I]**, de modo que Node lo acepta sin configuración.

### B.1 Qué observar (todo **sin verificar**: son los V15–V16)

| # | Comando | Esperado | Si no |
|---|---|---|---|
| B1 | En B: `curl -s http://127.0.0.1:8642/health` | `{"status":"ok","platform":"hermes-agent"}` [H en Linux] | Gateway parado: `hermes gateway status` / `start` |
| B2 | En B: `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $KEY" http://127.0.0.1:8642/v1/capabilities` | `200` | Clave mal copiada; revisa `.env` |
| B3 | Desde A: `curl -s https://b.tail1234.ts.net/health` | `{"status":"ok","platform":"hermes-agent"}` | `tailscale serve status`; HTTPS/MagicDNS sin activar; DNS de A |
| B4 | Desde A: `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $KEY" https://b.tail1234.ts.net/v1/capabilities` | `200` | Hermes rechaza el `Host` del proxy (anótalo) |
| B5 | Desde A: prueba SSE `curl -N -H "Authorization: Bearer $KEY" https://b.tail1234.ts.net/v1/runs/<id>/events` sobre un run real | eventos `message.delta`… y `: stream closed` | El proxy bufferiza: anótalo, afecta a la latencia |

## C. Registrar a B en Paperclip: dos caminos

**Camino 1 (recomendado por Paperclip): invitación → solicitud → aprobar → reclamar clave.** Ensayado de verdad en loopback (instancia desechable `paperclipai@2026.1005.0`, 08:54–08:56 UTC; salida literal en `docs/evidencias/restauracion-lab.md` §Extra). Hallazgos del ensayo:
- **Prerrequisito oculto:** `join approve` falla con `409 Join request cannot be approved because this company has no active CEO` si la empresa no tiene un agente con `role: "ceo"`. El agente nuevo se crea con `reportsTo` ese CEO (`routes/access.js:1749,3336`). Nuestra empresa piloto (solo un `engineer`) **no lo cumple**: crea antes un agente `role: "ceo"` (el "agente jefe" de la arquitectura) o usa el Camino 2.
- **El payload de la documentación upstream no funciona como dice:** `invite create --payload-json '{"requestType":"agent"}'` se ignora y crea una invitación `allowedJoinTypes: "both"` con rol humano `operator`. Usa **`{"allowedJoinTypes":"agent"}`** (esquema del OpenAPI vivo).
- La `apiKey` del payload de `invite accept` se convierte de inmediato en un secreto cifrado (`secret_ref`); no queda en claro en la solicitud.
- La `claimSecret` se muestra **una vez** al aceptar; el `claim-key` funciona una vez (el segundo intento → `409 Claim secret already used`).

```sh
# En A (con credencial de board en authenticated; en local_trusted loopback no hace falta):
paperclipai invite create -C <companyId> --payload-json '{"allowedJoinTypes":"agent"}' --json      # devuelve token pcp_invite_… (caduca en 3 días)
paperclipai invite onboarding:text <token>                    # texto para el runtime de Hermes (HERMES_GATEWAY_ONBOARDING.md)
# En B (o desde donde tengas la invitación): la solicitud
paperclipai invite accept <token> --api-base http://a.tail1234.ts.net:3100 --payload-json '{
  "requestType":"agent","agentName":"Hermes laptop 1","adapterType":"hermes_gateway",
  "capabilities":"Ejecutor Hermes en laptop 1",
  "agentDefaultsPayload":{"apiBaseUrl":"https://b.tail1234.ts.net","apiKey":"<API_SERVER_KEY de B>",
                          "paperclipApiUrl":"http://a.tail1234.ts.net:3100","sessionKeyStrategy":"issue","timeoutSec":600}}'
#   → status pending_approval + claimSecret (guárdalo; se muestra una vez)
# En A: aprobar
paperclipai join list --company-id <companyId> --status pending_approval
paperclipai join approve <requestId> --company-id <companyId>
# En B (o en A): reclamar la clave de AGENTE una vez
paperclipai join claim-key <requestId> --claim-secret <secreto>     # → { keyId, token, agentId }  (el token es PAPERCLIP_API_KEY de Hermes)
```
Guarda el `token` en el `.env` de Hermes en B (`PAPERCLIP_API_KEY=…`, modo 600). **No lo imprimas ni lo pegues en el chat.**

**Camino 2 (alternativa, sin CEO): crear el agente y emitir la clave por API** (board). Ensayado **[H-loopback]**:
```sh
SID=$(curl -s -X POST $A/api/companies/$CID/secrets -H 'content-type: application/json' \
  -d "{\"name\":\"HERMES_API_SERVER_KEY_LAPTOP1\",\"provider\":\"local_encrypted\",\"managedMode\":\"paperclip_managed\",\"value\":\"$KEY_B\"}" | jq -r .id)
AID=$(curl -s -X POST $A/api/companies/$CID/agents -H 'content-type: application/json' -d "{
  \"name\":\"Hermes laptop 1\",\"role\":\"engineer\",\"adapterType\":\"hermes_gateway\",
  \"adapterConfig\":{\"apiBaseUrl\":\"https://b.tail1234.ts.net\",\"apiKey\":{\"type\":\"secret_ref\",\"secretId\":\"$SID\",\"version\":\"latest\"},
                     \"paperclipApiUrl\":\"http://a.tail1234.ts.net:3100\",\"sessionKeyStrategy\":\"issue\",\"timeoutSec\":600},
  \"budgetMonthlyCents\":500}" | jq -r .id)
curl -s -X POST $A/api/agents/$AID/keys -H 'content-type: application/json' -d '{"name":"hermes-laptop-1","scope":{"kind":"standard"}}'   # → {id,name,scope,token}; el token solo se muestra ahora
#   equivalente CLI: paperclipai token agent create -C $CID --agent $AID --name hermes-laptop-1
```
`A=http://a.tail1234.ts.net:3100` (sin `/api`; las rutas ya lo llevan) y en authenticated añade `-H "Authorization: Bearer $MC_PAPERCLIP_TOKEN"`. Mismo patrón que la empresa piloto (`HERMES_API_SERVER_KEY_LAB`, `Ejecutor Hermes (lab)`).

### C.1 Qué observar

| # | Comprobación | Esperado | Evidencia |
|---|---|---|---|
| C1 | `POST /api/companies/<cid>/adapters/hermes_gateway/test-environment` con `{"adapterConfig":{"apiBaseUrl":"https://b…","apiKey":"…"}}` (o `{"agentId":"<id>"}`) | `status` ok, sin `hermes_gateway_plain_http_remote_denied` | Salida JSON |
| C1b | Mismo POST con `apiBaseUrl: http://100.x.y.z:8642` | **`fail`** con `hermes_gateway_plain_http_remote_denied` (ensayado **[H-loopback]**: `…uses remote plain HTTP for "100.64.0.9". Use HTTPS or set dangerouslyAllowInsecureRemoteHttp=true…`) | Confirma que la IP CGNAT de Tailscale cuenta como HTTP remoto |
| C2 | `GET /api/companies/<cid>/agents` | el agente con `adapterType: hermes_gateway`, `adapterConfig.apiKey.type == "secret_ref"`, `status: idle` | JSON (sin valores) |
| C3 | `GET /api/agents/<id>/keys` | lista de claves sin el valor (`initial-join-key` si vino del Camino 1) | JSON |
| C4 | Reutilizar el `claimSecret` | `409 Claim secret already used` | Mensaje |
| C5 | `GET /api/companies/<cid>/secrets` | el secreto de B listado (sin valor) | JSON |

## D. Prueba: asignar una misión al agente nuevo

1. Crea la tarea asignada al agente de B (la UI de MC, o la API):
   ```sh
   curl -s -X POST $A/api/companies/$CID/issues -H 'content-type: application/json' -d "{
     \"title\":\"Prueba de equipo B: responde con el nombre del equipo\",\"description\":\"Responde en una frase indicando el nombre del equipo y la fecha.\",
     \"status\":\"todo\",\"priority\":\"low\",\"assigneeAgentId\":\"$AID\",\"reviewPolicy\":\"human_only\",\"idempotencyKey\":\"prueba-b-001\"}"
   ```
2. Observa (Paperclip despierta al agente al asignar, sin invocación manual [H] 08:10):

| # | Qué mirar | Comando | Esperado | Si no |
|---|---|---|---|---|
| D1 | Run creado por asignación | `GET /api/companies/$CID/heartbeat-runs` | un run `invocationSource: assignment`, `queued → running → succeeded` | Agente pausado o `wakeOnDemand` desactivado; presupuesto agotado |
| D2 | Llamada al ejecutor | `GET /api/heartbeat-runs/<runId>/events` | `adapter.invoke {command:"POST /v1/runs", timeoutSec, hasSessionKey:true}` | `hermes_gateway_*` en `errorCode` (ver §F) |
| D3 | Respuesta | `GET /api/issues/<id>/comments` | comentario `authorType: agent` | Modelo/clave de B |
| D4 | Consumo | `GET /api/companies/$CID/costs/by-agent` | tokens > 0, `costCents` 0 (`unpriced`) | Normal para `hermes_gateway` |
| D5 | Del lado de B | `curl -H "Authorization: Bearer $KEY" https://b…/v1/runs/<hermesRunId>` | `status: completed` | — |
| D6 | Que no vuelva a caer en el bucle de reparación | `GET /api/issues/<id>/activity` | Si el agente **no cambia el estado** (modelo sin herramientas) verás hasta 2 runs `automation` y `issue.disposition_repair_escalated` → `blocked` [H, MIS-1] | Esperado con el modelo simulado; con un modelo real las instrucciones del agente deben registrar la disposición |
| D7 | Cierre humano | `PATCH /api/issues/<id>` `{"status":"in_review","comment":"[Operador] …"}` y luego `done` | `completedAt` | — |

Registra: `runId`, `hermesRunId`, tokens, minutos, el nombre de B en el comentario.

## E. Prueba de recuperación: parar Hermes (o Paperclip) a mitad de un run

Necesitas un run **largo**: con el modelo simulado dura ~3 s y no hay ventana. Usa una tarea que obligue a trabajar ~60–120 s con el modelo real, o ensáyalo sin coste con `packages/hermes-mock` y su inyección de fallos (corte de SSE, timeout), cuando esté disponible. Pon `timeoutSec` bajo (p. ej. 120) en el agente de prueba para no esperar 600 s.

### E.1 Variante 1: muere el EJECUTOR (Hermes en B)
Parada educada (drena el run): `hermes gateway stop`. Parada brusca (la que simula un fallo): en Windows, `Stop-Process -Id <PID del gateway> -Force` (PID de `hermes gateway status`); en Mac, `kill -9 <PID>`.

| # | Qué observar | Esperado según el código [F] (no probado) | Confianza |
|---|---|---|---|
| E1 | El run en Paperclip | Sigue `running`: el adaptador registra "event stream disconnected" y **reintenta el SSE cada `eventReconnectMs`** (2 s por defecto) y sondea `GET /v1/runs/{id}`; no hay tope de reintentos de reconexión, solo `timeoutSec` | media |
| E2 | Al vencer `timeoutSec` | El adaptador intenta `POST /v1/runs/{id}/stop` (fallará si B sigue caído) y devuelve `timedOut`/`errorCode: hermes_gateway_timeout`; el run queda **`timed_out`** | media |
| E3 | Si B vuelve antes del timeout | Depende de si Hermes recuerda el run (su almacén de idempotencia es duradero: 86 400 s); puede terminar bien o dar `hermes_gateway_run_failed`/`protocol_error`. **Anota qué ocurre** | baja |
| E4 | El issue | Si sigue `in_progress` sin run vivo → “stranded”: **una** continuación automática; si también termina y sigue varado → `blocked` + acción de recuperación asignada al board (“Recovery owner: board”), sin cambiar de responsable (`execution-semantics.md` §9-10) | media |
| E5 | Reintento automático | El reintento por `process_lost` (1 vez) **solo** existe para adaptadores locales rastreados (`claude_local`, `codex_local`, `hermes_local`…): **`hermes_gateway` no se reintenta por esa vía** | media |
| E6 | En B tras reiniciar Hermes | El run original queda huérfano/terminado; un reintento usa **otro** `runId` = otra `Idempotency-Key` ⇒ posible trabajo duplicado en B | baja |

### E.2 Variante 2: reinicio del PLANO DE CONTROL (Paperclip en A) a mitad de run
`paperclipai service restart` (o matar el servidor) con el run `running`.

| # | Qué observar | Esperado [F] | Confianza |
|---|---|---|---|
| E7 | Al arrancar | Log `startup reap of orphaned heartbeat runs complete {"reaped":1,"runIds":[…]}` (hoy visto con `reaped:0` [H]) | alta |
| E8 | El run | Pasa a **`failed` con `errorCode: process_lost`** y mensaje “Process lost -- server may have restarted” | media |
| E9 | Reintento | **No hay reintento automático** para `hermes_gateway` (no está en la lista de adaptadores locales rastreados) ⇒ el issue queda varado → continuación única → `blocked` (E4) | media |
| E10 | El run remoto en B | Puede seguir ejecutándose huérfano: Paperclip no llama a `/stop` tras el reinicio | baja |

### E.3 Acción de recuperación: **reintento desde MC**
Como Paperclip no relanza solo a `hermes_gateway`, **MC debe hacerlo** (botón *Reintentar* de la UI / supervisor del BFF). A mano: `POST /api/agents/<id>/heartbeat/invoke` (probado **[H]** 08:12:05: `queued → succeeded` en 0,8 s) o reasignar/comentar el issue para despertarlo. Antes de reintentar, mira en B si el run anterior sigue vivo (`GET /v1/runs/<id>`) y páralo (`POST /v1/runs/<id>/stop`) para no duplicar.

Registra en `verificaciones-en-tus-equipos.md` (V17) la tabla E.1/E.2 con lo **realmente observado** (estado del run, `errorCode`, tiempos, y si el issue acabó `blocked`).

## F. Códigos de error que verás (adaptador `hermes_gateway`) [F]
`hermes_gateway_api_base_url_missing|invalid` · `hermes_gateway_api_key_missing` · `hermes_gateway_plain_http_remote_denied` · `hermes_gateway_health_unreachable` (en test-environment) · `hermes_gateway_run_failed` · `hermes_gateway_cancelled` · `hermes_gateway_protocol_error` · `hermes_gateway_timeout`. En un run: `GET /api/heartbeat-runs/<id>` → `errorCode`, `error`.

## G. Qué se verificó y qué no

| Elemento | Estado |
|---|---|
| Invitación, aceptación, aprobación (con CEO), `claim-key` de un solo uso, `POST /agents/{id}/keys`, `token agent\|board create`, `test-environment` y la denegación de HTTP remoto | **Ensayado en Linux, loopback, instancia desechable** (`evidencias/restauracion-lab.md`) |
| `authenticated` + `bind tailnet`, allowed-hostname, board-claim, token de board | **Leído**; sin ensayar |
| Tailscale, `tailscale serve` HTTPS, SSE por la tailnet, un segundo equipo | **No verificado** |
| Recuperación E.1/E.2 | **Deducido del código** (`reliability.md` §3, §4); ninguna parada real se ejecutó |
