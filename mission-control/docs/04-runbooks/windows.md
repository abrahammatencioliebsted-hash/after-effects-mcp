---
tipo: runbook
proyecto: Mission Control
revisado: 2026-10-08
equipo: Windows principal (96 GB RAM / 24 GB VRAM)
estado: "Nada de este runbook se ejecutó en Windows. Los scripts se analizaron (sintaxis) y su lógica se probó en Linux; ver §8. La decisión de la ruta principal está marcada [Pr] y espera tu confirmación."
---

# Windows principal: Paperclip, Hermes, node-agent y Mission Control

Claves: **[C]** confirmado por ti · **[H]** comprobado en el entorno Cloud (Linux) · **[F]** fuente externa/documentación/código leído · **[I]** inferencia · **[Pr]** propuesta sin aprobar.
Toda salida marcada "esperado" es lo que debería verse según el código o las pruebas en Linux: **no es una salida vista en Windows**. Si algo difiere, anótalo en `verificaciones-en-tus-equipos.md`.

## 0. Decisión que debes confirmar [Pr]

**Acción principal [Pr]:** el plano de control (Paperclip) corre en la Windows principal **dentro de WSL2** (Ubuntu con systemd) usando la instalación gestionada soportada y `service install --enable-linger`. Hermes se instala **nativo en Windows** con su API server, y el node-agent también va nativo. Mission Control (BFF + UI) corre nativo en Windows y habla con Paperclip por `http://127.0.0.1:3100`.

Por qué [F]: la documentación de Paperclip solo cubre "macOS, Linux o WSL2" (`doc/INSTALLING.md:10`, `scripts/install.sh:185`); en `win32` `paperclipai service` responde "no soportado" (`service-manager.ts:353`) y el shim gestionado es un script `#!/bin/sh` (`install-store.ts:408`). Además, en Windows nativo el PostgreSQL embebido se detiene con `taskkill /f` (kill forzado), no con un apagado limpio (`embedded-postgres/dist/index.js:215-222`, hallazgo F5 de la verificación).

**Trampa de red de esta decisión [I → comprobar]:** un Paperclip dentro de WSL2 que llama a un Hermes **nativo de Windows** en `http://127.0.0.1:8642` no llega a él en el modo de red por defecto de WSL2 (NAT: el `localhost` de WSL2 y el de Windows son equipos distintos, docs de Hermes `windows-wsl-quickstart.md:196-208`). Y si usas la IP del host de Windows, Paperclip lo trata como **HTTP remoto no loopback → denegado por defecto** (`access.ts:779-792`; el adaptador también lo aplica al ejecutar). Tres salidas, de más a menos segura:

| Salida | Cómo | Estado |
|---|---|---|
| **P-a. Hermes del principal también dentro de WSL2** (loopback con Paperclip) | Instalar Hermes con `install.sh` dentro de Ubuntu, `apiBaseUrl=http://127.0.0.1:8642`. Es exactamente el camino que probamos en Linux [H] | Recomendada si quieres certeza. El Hermes **nativo** de Windows queda para el uso diario y para otros agentes |
| **P-b. HTTPS delante de Hermes** | `tailscale serve --bg --https=443 http://127.0.0.1:8642` en Windows y `apiBaseUrl=https://<pc>.<tailnet>.ts.net` | Sintaxis de `tailscale serve` **[I]**; requiere MagicDNS + HTTPS activados en Tailscale; hay que comprobar que WSL2 resuelve y llega a ese nombre (V8/V15) |
| **P-c. WSL2 en modo "mirrored"** | `%USERPROFILE%\.wslconfig` con `[wsl2]` / `networkingMode=mirrored`, `wsl --shutdown`; entonces `127.0.0.1` es el mismo en ambos lados | Solo Windows 11 22H2+; documentado por Hermes (`windows-wsl-quickstart.md:208,223`), **no comprobado** con Paperclip |

No uses `dangerouslyAllowInsecureRemoteHttp` salvo para una prueba puntual en una red que controlas.

**Alternativa 1 [Pr]: el Mac como plano de control** (LaunchAgent soportado oficialmente) y las Windows como ejecutores Hermes. Quita toda la fricción de WSL2 pero el Mac tiene que estar encendido y con sesión iniciada (ver `macos.md`, caveat M1) y la UI/BFF vivirían en el Mac.
**Alternativa 2 [Pr]: Windows nativo** con `npm i -g paperclipai@2026.1005.0` y Task Scheduler (§6). **Sin soporte oficial y sin verificar**; solo si WSL2 te estorba. §6 lista exactamente qué comprobar.

**Qué NO está verificado aquí (todo lo de Windows):** instalación de WSL2/systemd, `service install` dentro de WSL2, que sobreviva a `wsl --shutdown` y a un reinicio, el reenvío de `localhost`, Hermes nativo, `hermes gateway install`, las tareas programadas, Defender, ACL de `master.key`, y cualquier script `.ps1` (solo se analizó su sintaxis con PowerShell 7.5.3 en Linux).

## 1. Requisitos previos

| Requisito | Comando (PowerShell) | Comprobación |
|---|---|---|
| Windows 10/11 con WSL2 | `wsl --install -d Ubuntu` (como administrador; reinicia) | `wsl -l -v` muestra `Ubuntu` con `VERSION 2` |
| Node 24 LTS (para el BFF, la UI y el node-agent en Windows) | `winget install OpenJS.NodeJS.LTS` **[I]** (o el instalador de nodejs.org) | `node -v` ≥ `v24.11.0` (lo exige Paperclip) |
| Tailscale | `winget install Tailscale.Tailscale` **[I]** → iniciar sesión en tu tailnet | `tailscale ip -4` devuelve `100.x.y.z` (tailscale.exe debe estar en el PATH del proceso que lo use: caveat W10) |
| pnpm 10 (solo para compilar Mission Control) | `corepack enable` y `corepack prepare pnpm@10.28.0 --activate` **[I]** | `pnpm -v` = `10.28.0` |
| Política de scripts | `Set-ExecutionPolicy -Scope Process Bypass` (solo esa ventana) | permite `.\scripts\windows\*.ps1` |
| Windows Terminal / PowerShell 7 (recomendado, no obligatorio) | `winget install Microsoft.PowerShell` **[I]** | `pwsh -v` |

Antes de empezar, fija en tu cabeza dos versiones: **Paperclip `2026.1005.0`** (es la probada [H]; existen `beta/nightly/canary` posteriores que no evaluamos) y **Hermes en el commit `a28a5d03a9fa60418db5f44f3436fa2aa029c8f2`** (el clon probado [H]). Están en variables al inicio de cada script.

## 2. Ruta principal: Paperclip en WSL2

### 2.1 Activar systemd en Ubuntu (una vez)

`paperclipai service install` necesita un "user manager" de systemd; sin él responde "No usable systemd user manager was detected (common in containers and WSL1)" (`service-manager.ts:358`) **y `onboard --yes` arrancaría el servidor en primer plano en vez de fallar** (hallazgo F6).

```powershell
# En Ubuntu (wsl -d Ubuntu): ¿ya está systemd?
wsl -d Ubuntu -- ps -p 1 -o comm=
```
Esperado: `systemd`. Si imprime `init`:
```bash
# dentro de Ubuntu
sudo sh -c 'printf "[boot]\nsystemd=true\n" > /etc/wsl.conf'
```
```powershell
wsl --shutdown          # luego reabre Ubuntu
wsl -d Ubuntu -- ps -p 1 -o comm=      # debe decir: systemd
```

### 2.2 Instalar Paperclip (script o a mano)

**Con el script** (imprime todo; sin `-Yes` solo muestra el plan):
```powershell
cd <repo>\mission-control
.\scripts\windows\install-paperclip-wsl2.ps1              # plan
.\scripts\windows\install-paperclip-wsl2.ps1 -Yes         # ejecuta el lado WSL (wsl -d Ubuntu -- bash -lc …)
```

**A mano** (los mismos pasos, dentro de Ubuntu). En el primer uso hazlo en una terminal interactiva porque `install.sh` puede pedir `sudo` para instalar Node 24 (`install.sh:239-246`):
```bash
curl -fsSLO https://paperclip.ing/install.sh
curl -fsSLO https://paperclip.ing/install.sh.sha256
sha256sum -c install.sh.sha256                    # esperado: install.sh: OK
bash install.sh --version 2026.1005.0 --no-prompt --no-onboard
export PATH="$HOME/.local/bin:$PATH"              # si el instalador no editó ~/.bashrc
paperclipai --version                              # esperado: 2026.1005.0
paperclipai onboard --yes --install-service       # configura (loopback, local_trusted) e instala la unidad systemd de usuario
paperclipai service install --enable-linger       # sigue vivo tras cerrar sesión (loginctl enable-linger); puede pedir autorización
paperclipai service status --json                 # esperado: instalado y activo (formato exacto no visto)
curl -s http://127.0.0.1:3100/api/health          # el puerto real queda en ~/.paperclip/instances/default/runtime-info.json
```
Notas:
- El `.sha256` se sirve desde el mismo origen que el script: detecta descargas rotas, **no prueba autenticidad** (`INSTALLING.md:33-36`). Para un origen independiente, descarga `install.sh` de GitHub fijado al commit `5717523b9ea7a2d76efbd6eb73414de9c06c6f96`, léelo y ejecútalo local.
- Esperado en `/api/health` (visto en Linux [H], mismo build): `{"status":"ok","version":"2026.1005.0",…,"deploymentMode":"local_trusted","authReady":true,"bootstrapStatus":"ready",…}`.
- Archivos: código en `~/.paperclip/cli/` (symlink `current`), datos en `~/.paperclip/instances/default/`, unidad en `~/.config/systemd/user/paperclipai.service` (`Type=notify`, `Restart=always`, `StartLimitBurst=5` en 60 s: **si falla 5 veces en un minuto, systemd se rinde**; recuperar con `systemctl --user reset-failed paperclipai.service && systemctl --user start paperclipai.service`).
- Puerto: si 3100 está ocupado Paperclip usa el siguiente libre (en el laboratorio quedó en 3101 [H]). Lee el real de `runtime-info.json`.
- Más variables (`.env` de la instancia): `~/.paperclip/instances/default/.env`. El servicio solo define `PAPERCLIP_SERVICE_MANAGED`, `PAPERCLIP_INSTANCE_ID`, `PAPERCLIP_HOME`; todo lo demás va en ese `.env`. Recomendado para el piloto (`reliability.md` §8): `PAPERCLIP_SECRETS_STRICT_MODE=true`, `PAPERCLIP_UPDATE_CHECK=0` y `PAPERCLIP_TELEMETRY_DISABLED=1` si decides no enviar telemetría (V20).

### 2.3 Alcanzarlo desde Windows y mantenerlo vivo

- **Windows → WSL2:** el reenvío por defecto de `localhost` suele publicar un puerto abierto en `127.0.0.1` de Linux como `http://localhost:3100` en Windows (docs de Hermes `windows-wsl-quickstart.md:225`). Prueba en PowerShell: `curl.exe -s http://127.0.0.1:3100/api/health`. Si no responde, modo mirrored (P-c) o `netsh interface portproxy` (documentado en el mismo archivo, no probado).
- **Mantener WSL2 encendido:** una distro sin procesos se apaga. El servicio systemd de usuario con linger ayuda, pero WSL2 también se detiene con `wsl --shutdown`, actualizaciones de Windows o tras inactividad según versión. Comprueba (V8): `wsl --shutdown`, espera, `curl.exe http://127.0.0.1:3100/api/health`; reinicia Windows y repite **sin abrir Ubuntu**. Si no arranca solo, crea una tarea al iniciar sesión: `wsl.exe -d Ubuntu -- sleep infinity` **[I]** (la técnica `sleep infinity` está en `windows-wsl-quickstart.md:309`).
- **Desde otros equipos (tailnet):** instala Tailscale **dentro de WSL2** o publica el puerto desde Windows; no está documentado en el repo **[I]**. Es el tema de `segundo-equipo.md` §A.

### 2.4 Copias de seguridad de esta instalación

Los datos viven en el disco virtual de WSL2 (`\\wsl.localhost\Ubuntu\home\<tú>\.paperclip`). Usa `scripts\windows\backup.ps1` (por defecto `-Target wsl`) y guarda el archivo **fuera** del disco virtual. Detalle en `actualizar-y-restaurar.md`.

## 3. Hermes nativo en Windows

### 3.1 Instalar fijado a un commit

```powershell
.\scripts\windows\install-hermes.ps1           # plan
.\scripts\windows\install-hermes.ps1 -Yes
```
Equivale a (instalador oficial, opciones de `windows-native.md`):
```powershell
iwr https://hermes-agent.nousresearch.com/install.ps1 -OutFile $env:TEMP\hermes-install.ps1
Get-FileHash $env:TEMP\hermes-install.ps1 -Algorithm SHA256       # anótalo; Hermes no publica un hash independiente
& ([scriptblock]::Create((Get-Content -Raw $env:TEMP\hermes-install.ps1))) -NonInteractive -Commit a28a5d03a9fa60418db5f44f3436fa2aa029c8f2
```
- Sin administrador. Instala en `%LOCALAPPDATA%\hermes\` y añade `%LOCALAPPDATA%\hermes\bin` al PATH **de usuario**: abre una ventana nueva (`windows-native.md:26,278`). `-ShowResolvedPaths` imprime las rutas que usará sin tocar nada.
- Soporte: Windows 10/11 x86_64 y aarch64 es **Tier 1** de Hermes [F] (`platform-support.md`). Hermes trae su propio Python/Node vía PM; no necesitas Python aparte.
- El commit fijado debe ser ancestro de `main` (el instalador lo comprueba: `install.ps1:992`). Si algún día falla con "commit … is not on branch", elige otro commit o `-Branch`.
- Hermes tiene además app de escritorio (MSIX, solo Windows 11 22H2+). Para ser ejecutor de MC basta la CLI.
- **Dónde quedan los datos:** `HERMES_HOME` = `%LOCALAPPDATA%\hermes` según `installation.md`. La documentación del servicio menciona `%USERPROFILE%\.hermes\gateway-service\` para el lanzador (`windows-native.md:705`): son dos rutas distintas en la misma documentación **[F, incoherencia]**; confirma con `hermes gateway status` y `-ShowResolvedPaths` dónde quedó cada cosa (V16).

### 3.2 Configurar el API server

Mínimo, en `%LOCALAPPDATA%\hermes\.env` (el script lo hace de forma idempotente y **no imprime la clave**):
```
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
API_SERVER_KEY=<64 hex generados en tu equipo>
```
- El API server **se niega a arrancar sin `API_SERVER_KEY`** (mínimo 16 caracteres, ni siquiera en loopback) y escucha por defecto en `127.0.0.1:8642` (`gateway/platforms/api_server.py:215-216,4415-4450`) **[F]**.
- Alternativa equivalente, la que se usó en el laboratorio [H], en `config.yaml`:
  ```yaml
  platforms:
    api_server:
      enabled: true
      extra:
        host: "127.0.0.1"
        port: 8642      # la clave se toma de API_SERVER_KEY en .env
  ```
- Seguridad [F]: las sesiones del API server son "no atendidas": con `unattended_mode: deny` (por defecto) un comando peligroso se **deniega** en vez de pedir aprobación (`security.md:51`). Tenlo presente al diseñar tareas de MC; no lo cambies a `approve` sin pensarlo.
- Un endpoint accesible por red con `terminal.backend: local` ejecuta con tu usuario: por eso se deja en loopback y, para la tailnet, se publica con `tailscale serve` (ver `segundo-equipo.md`).

### 3.3 Proveedor de modelo: MiMo

En el mismo `.env`:
```
XIAOMI_API_KEY=<tu clave>             # nunca en el repositorio
XIAOMI_BASE_URL=<URL de tu plan>      # el .env.example de Hermes usa https://api.xiaomimimo.com/v1 [F]; tu Token Plan en el Mac usa token-plan-sgp.xiaomimimo.com/v1 [H local, otra sesión]
```
y en `config.yaml`: `model.provider: xiaomi` (alias `mimo`, `xiaomi-mimo`) y `model.default: <modelo>` (en tu Mac: `mimo-v2.6-pro`). También sirve `hermes model` (asistente).

**Riesgo de términos [F, decisión pendiente P06]:** según la documentación leída, la cuota del *Token Plan* de MiMo es para herramientas de programación y **prohíbe scripts automatizados y backends de apps propias**, con riesgo de suspensión. Un ejecutor de Mission Control (o un cron de Hermes) con ese plan podría caer en esa categoría **[I]**. No lo usaremos para trabajos programados hasta que decidas: (a) mantener el Token Plan solo para uso interactivo, (b) una clave de pago por uso (`sk-…`), u (c) otro proveedor. Mientras tanto, el laboratorio usa un modelo simulado [H].

Aviso de coste [H]: un turno trivial envió ~13 400 tokens de entrada (sistema + herramientas). Recorta `toolsets` e instrucciones del perfil que use MC antes de abrir el grifo.

### 3.4 Gateway como servicio de inicio de sesión

```powershell
hermes gateway install      # registra la tarea programada Hermes_Gateway (ONLOGON, sin administrador)
hermes gateway status       # vista fusionada: tarea + carpeta Inicio + PID
```
Comportamiento documentado [F]: si `schtasks` está bloqueado por directiva, cae a un `Hermes_Gateway.vbs` en la carpeta Inicio; el gateway arranca con `pythonw.exe` (sin consola). **Task Scheduler solo ve el lanzador**: si el gateway muere después, no se reinicia solo; se reinicia con `hermes gateway restart`, `hermes gateway start` o `schtasks /Run /TN Hermes_Gateway` (`windows-native.md:705-710`). `hermes update` y `hermes gateway start` refrescan la tarea si cambió la plantilla.

Comprobaciones (esperado según pruebas en Linux [H]):
```powershell
curl.exe -s http://127.0.0.1:8642/health
# {"status":"ok","platform":"hermes-agent"}
$key = (Select-String -Path "$env:LOCALAPPDATA\hermes\.env" -Pattern '^API_SERVER_KEY=(.*)$').Matches[0].Groups[1].Value
curl.exe -s -o NUL -w "%{http_code}`n" -H "Authorization: Bearer $key" http://127.0.0.1:8642/v1/capabilities      # 200
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:8642/v1/capabilities                                       # sin clave: debe ser 401 o 403 (código exacto no visto)
Remove-Variable key
```
(`/v1/capabilities` con Bearer devolvió `runs_idempotency`, `run_events_sse`, `run_stop`, `tool_execution: server` en Linux [H].)

### 3.5 Registrar a Hermes en Paperclip (agente `hermes_gateway`)

El camino probado [H] (loopback, `local_trusted`): secreto + agente por API. Con tu clave en una variable de entorno `HERMES_API_KEY` (desde el `.env`, sin pegarla en el chat):
```bash
# dentro de WSL2 (o con curl.exe en Windows si Paperclip es alcanzable en localhost)
BASE=http://127.0.0.1:3100/api
CID=$(curl -s -X POST $BASE/companies -H 'content-type: application/json' -d '{"name":"Mission Control — piloto"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
SID=$(curl -s -X POST $BASE/companies/$CID/secrets -H 'content-type: application/json' \
  -d "{\"name\":\"HERMES_API_SERVER_KEY_PC\",\"provider\":\"local_encrypted\",\"managedMode\":\"paperclip_managed\",\"value\":\"$HERMES_API_KEY\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -s -X POST $BASE/companies/$CID/agents -H 'content-type: application/json' -d "{\"name\":\"Ejecutor Hermes (PC)\",\"role\":\"engineer\",\"adapterType\":\"hermes_gateway\",\"adapterConfig\":{\"apiBaseUrl\":\"http://127.0.0.1:8642\",\"apiKey\":{\"type\":\"secret_ref\",\"secretId\":\"$SID\",\"version\":\"latest\"},\"sessionKeyStrategy\":\"issue\",\"timeoutSec\":600}}"
```
Esto es solo válido si Paperclip y Hermes comparten loopback (P-a, o P-c si funciona). Con P-b, `apiBaseUrl` es la URL HTTPS de `tailscale serve`. Para el piloto de varios equipos usa el flujo de `segundo-equipo.md`. El script de recorrido completo es `lab/e2e.mjs` (adaptar `PAPERCLIP_URL`).

## 4. node-agent como tarea programada

Compila una vez: `pnpm install` y `pnpm --filter @mc/node-agent build` (`apps\node-agent\dist\main.js`). Crea el token (no lo guardes en el repo):
```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.mc\node-agent" | Out-Null
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | Set-Content -NoNewline "$env:USERPROFILE\.mc\node-agent\token"
.\scripts\windows\install-node-agent.ps1 -MachineId win-principal -BffUrl http://127.0.0.1:3300                       # plan
.\scripts\windows\install-node-agent.ps1 -MachineId win-principal -BffUrl http://127.0.0.1:3300 -Yes
```
- El BFF de MC escucha por defecto en **3300** (`MC_PORT`, `apps/bff/src/server.ts`), no en 3100 (ese es Paperclip). Si el BFF corre en otro equipo, usa su IP de tailnet (`http://100.x.y.z:3300`, como en el README del node-agent).
- Crea la tarea `MC Node Agent` (al iniciar sesión, nivel limitado, reinicio ante fallos) con un lanzador `run.ps1` que lee el token del archivo, exporta `MC_*` y relanza `node` si cae. Equivalentes: `schtasks /Query /TN "MC Node Agent" /V /FO LIST`, `schtasks /Run /TN "MC Node Agent"`, `schtasks /Delete /TN "MC Node Agent" /F` (`apps/node-agent/README.md`).
- Si `hermes` es un `.cmd`, `execFile` no lo ejecuta: el script fija `MC_HERMES_BIN` a un `.exe` si lo encuentra.
- Comprobar (esperado según las pruebas del paquete en Linux): `curl.exe -s http://127.0.0.1:3400/health` → `{"ok":true,"machineId":"win-principal",…}`.
- Alternativa NSSM (servicio real), en el README del agente. `ONLOGON` no es un servicio de sistema: sin iniciar sesión no corre.

## 5. Mission Control: BFF + UI

```powershell
cd <repo>\mission-control
pnpm install
pnpm -r build
$env:MC_BACKEND = 'paperclip'
$env:MC_PAPERCLIP_URL = 'http://127.0.0.1:3100'       # puerto real de Paperclip
$env:MC_PAPERCLIP_COMPANY_ID = '<id de la empresa>'
$env:MC_NODE_AGENT_TOKEN = Get-Content -Raw "$env:USERPROFILE\.mc\node-agent\token"
$env:MC_LOCAL_MACHINE_ID = 'win-principal'           # equipo donde corren Paperclip y el BFF (su Hermes puede ser loopback)
# $env:MC_HERMES_URL_WIN_LAPTOP_1 = 'https://b.tail1234.ts.net'   # obligatoria por cada equipo remoto (ver segundo-equipo.md)
# $env:MC_ALLOWED_HOSTS = 'mi-pc.lan'                 # solo si abres el panel por un nombre que no sea localhost / IP / *.ts.net
node apps\bff\dist\main.js                             # sirve /api/mc y la UI compilada (apps\ui\dist) en http://127.0.0.1:3300
```
- Sin `MC_BACKEND=paperclip` el BFF arranca en modo **demo** (datos simulados y etiquetados en pantalla).
- En modo `authenticated` (segundo equipo) Paperclip pide un token de board: `MC_PAPERCLIP_TOKEN`. Ver `segundo-equipo.md`.
- Para dejarlo fijo: otra tarea programada igual que §4 (lanzador `.ps1` con las variables; el token no va en la línea de comandos).
- Desarrollo: `pnpm dev:bff` y `pnpm dev:ui` (Vite hace proxy de `/api` al 3300).
- El script exacto de arranque lo fija quien construye el BFF; si cambia el nombre de las variables, manda su README.

## 6. Alternativa 2: Paperclip nativo en Windows (sin soporte oficial) [Pr]

Solo si decides no usar WSL2. Cada fila W# viene de la verificación de código (`ops.md` §7.1). **Nada se ejecutó.**

```powershell
npm install --global --registry https://registry.npmjs.org paperclipai@2026.1005.0
paperclipai --version
$env:PAPERCLIP_NO_BROWSER = '1'
paperclipai onboard --yes --no-install-service --run     # ¡--no-install-service explícito! (hallazgo F6)
```
Con `--install-service` en win32 **no falla**: avisa y, con `--yes`, arranca el servidor en primer plano y se queda ahí. Para dejarlo fijo, una tarea al iniciar sesión (diseño propio, **[INFERENCIA, no verificado]**):
```powershell
$node = (Get-Command node).Source
$cli  = Join-Path (npm root -g) "paperclipai\dist\index.js"
$act  = New-ScheduledTaskAction -Execute $node -Argument "`"$cli`" run --instance default" -WorkingDirectory $env:USERPROFILE
$trg  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$set  = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
Register-ScheduledTask -TaskName "PaperclipAI" -Action $act -Trigger $trg -Settings $set -RunLevel Limited
```
Variables extra en `%USERPROFILE%\.paperclip\instances\default\.env`. Sin `PAPERCLIP_SERVICE_MANAGED`, un `paperclipai run` manual en paralelo **no** se bloquea: garantiza una sola instancia (`INSTALLING.md:207-209`).

| # | Caveat | Qué comprobar en tu equipo (id en `verificaciones-en-tus-equipos.md`) |
|---|---|---|
| W1 | Windows nativo no figura en la documentación (solo macOS, Linux, WSL2) | Todo lo de esta sección es "sin garantía". |
| W2 | `paperclipai service *` no existe en win32 (solo imprime la guía de `run`) | Usar la tarea programada de arriba; no probar `service install`. |
| W3 | El shim gestionado es `#!/bin/sh`; `install --ref` usa `bash` y `tar` | No usar `paperclipai install` (modo gestionado); solo `npm -g`. |
| W4 | `current` es un symlink de directorio (`fs.symlinkSync(…,"dir")`); en Windows exige modo desarrollador o administrador | Irrelevante en `global-npm`; relevante si pruebas el modo gestionado. |
| W5 | `resolveInstallStorePaths` usa `HOME`, que no suele existir en Windows | Solo modo gestionado. |
| W6 | Hay ramas `win32` sueltas (abrir navegador, hot-restart con PowerShell, `fsync` tolerante, sin permisos 0600): intención parcial, no soporte | V5: arranque completo y `/api/health`. |
| W7 | Existe `@embedded-postgres/windows-x64`; **no hay arm64** (la librería lanza `Unsupported arch`) | Windows on ARM: usar WSL2 o `DATABASE_URL` externo. V5. |
| W8 | Los workspaces y los CLIs de agentes (claude/codex) asumen shell POSIX en varias rutas (`sh`) | Hacer un run real con cada adaptador local (V3 análogo). |
| W9 | No se aplican permisos `0600/0700`: `master.key` queda con las ACL heredadas del perfil | `icacls "%USERPROFILE%\.paperclip\instances\default\secrets"` y dejar solo tu usuario; BitLocker. V7. |
| W10 | `tailscale ip -4` se invoca con `execFileSync("tailscale")`: `tailscale.exe` debe estar en el PATH del proceso que arranca el servidor | Fijar `PAPERCLIP_TAILNET_BIND_HOST` en el `.env`. V14. |
| W11 | Defender/antivirus puede bloquear o retrasar `postgres.exe`/`initdb` y `node_modules` | V7: sin EPERM/EBUSY; excluir la carpeta de datos con criterio. |
| W12 | PostgreSQL no debe correr elevado | Tarea con `-RunLevel Limited` (no "Run with highest privileges"). |
| F5 | Cada parada del servidor mata PostgreSQL con `taskkill /f` | Frecuencia alta de `db:backup`; evitar apagados bruscos. V6/V9. |

Actualizar en este modo (`global-npm`): `update` no hace backup, no reinicia ni valida (F3). Usa `scripts\windows\update.ps1 -Target native`.

## 7. Lista de verificación de esta máquina

Marca al terminar cada bloque y registra la evidencia como indica `verificaciones-en-tus-equipos.md`.

- [ ] `wsl -l -v` → Ubuntu, `VERSION 2`; `ps -p 1 -o comm=` → `systemd`.
- [ ] `paperclipai --version` en Ubuntu → `2026.1005.0`; `curl http://127.0.0.1:<puerto>/api/health` → `status ok`, `version 2026.1005.0`, `authReady true`.
- [ ] `curl.exe http://127.0.0.1:3100/api/health` **desde Windows** responde (reenvío de localhost).
- [ ] Tras `wsl --shutdown` y tras reiniciar Windows **sin abrir Ubuntu**, Paperclip vuelve a responder (V8). Si no: crea la tarea `sleep infinity` y repite.
- [ ] `hermes --version` y `hermes gateway status`; `GET /health` 200; `/v1/capabilities` 200 con clave y rechazo (401/403) sin ella.
- [ ] La salida elegida para llegar a Hermes (P-a / P-b / P-c) funciona: el agente `hermes_gateway` pasa la prueba de entorno y un run de prueba termina `succeeded`.
- [ ] `MC Node Agent`: `schtasks /Query` OK, `/health` del agente 200, aparece el equipo en el panel.
- [ ] BFF+UI en `http://127.0.0.1:3300`, modo `paperclip`, salud del equipo visible.
- [ ] Copia completa (`backup.ps1`) y **restauración ensayada** en un directorio de prueba (`actualizar-y-restaurar.md`, V10).
- [ ] Decisión P06 (proveedor de MiMo) anotada antes de programar nada con el Token Plan.

## 8. Qué se verificó y qué no (de este documento)

| Elemento | Estado |
|---|---|
| Paperclip `2026.1005.0` instalado con npx, arrancado como usuario normal, API, backup y **restauración completa** | **Verificado en Linux** (`docs/evidencias/restauracion-lab.md`) |
| Scripts `.ps1` | Sintaxis analizada con PowerShell 7.5.3; la lógica de `.env` de `install-hermes.ps1` se ejecutó con `pwsh` en Linux. **Ninguno se ejecutó en Windows** |
| `install.ps1` de Hermes, `-Commit`, `hermes gateway install` (schtasks) | **Leídos** en el clon de Hermes @ `a28a5d03` y su documentación; no ejecutados |
| WSL2, systemd en WSL2, reenvío de localhost, mirrored, Tailscale | **No verificado** |
| Tailscale/HTTPS (`tailscale serve`) | **No verificado**; sintaxis **[I]** |
| Token Plan de MiMo | Términos **[F]** de las notas del usuario; decisión pendiente |
