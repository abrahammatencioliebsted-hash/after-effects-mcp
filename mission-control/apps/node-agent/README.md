# @mc/node-agent

Servicio ligero por equipo (Windows / macOS / Linux) de Mission Control. Solo usa módulos integrados de Node (sin dependencias de ejecución):

- Reporta salud (CPU, RAM, disco, GPU NVIDIA si hay `nvidia-smi`, carga, uptime).
- Reporta el estado de Hermes (API server `GET /health`, `hermes --version`, `hermes profile list`). El campo `profiles` es de mejor esfuerzo: **no verificado contra el CLI real** (el formato de `hermes profile list` no es un contrato).
- Ejecuta **solo** comandos de una lista permitida (`execFile`, sin shell, argv fijo, salida truncada a 64 KB).
- Envía un latido (`MachineHeartbeat`) al BFF cada `MC_HEARTBEAT_SEC` segundos con retroceso exponencial (máx. 5 min) y respeta `nextIntervalSec`.

## Uso

```bash
pnpm --filter @mc/node-agent build
MC_MACHINE_ID=win-principal MC_NODE_AGENT_TOKEN=<token> node apps/node-agent/dist/main.js
```

Sin `MC_BFF_URL` corre en modo **solo local** (no envía latidos; el servidor local sigue disponible).
Las variables están documentadas en `.env.example`. Un error de configuración se imprime en español y el proceso sale con código 1.

### Rutas (por defecto `127.0.0.1:3400`)

| Ruta | Auth | Respuesta |
|---|---|---|
| `GET /health` | pública | `{ ok, machineId, version, uptimeSec }` |
| `GET /commands` | Bearer | `AllowedCommand[]` |
| `POST /commands/:id` | Bearer, cuerpo `{"confirm": true}` | `{ ok, stdout, stderr, exitCode, durationMs }` (404 id desconocido, 428 falta confirmar) |
| `GET /snapshot` | Bearer | último `MachineHeartbeat` |

El token se compara en tiempo constante y nunca se escribe en los logs (JSON-lines a stdout: `{t, level, msg, ...}`).
Sin `MC_NODE_AGENT_TOKEN` las rutas protegidas responden 503.

> Por defecto escucha solo en loopback. Para que el BFF (en otro equipo) ejecute comandos, define `MC_NODE_AGENT_HOST` (p. ej. la IP de la LAN) y protege el puerto con el firewall; el token es obligatorio.
> **Equipos remotos (Tailscale):** fija `MC_NODE_AGENT_HOST` a la IP de Tailscale del equipo (100.x). El latido incluirá `nodeAgentUrl` (`http://<ip>:3400`) y el BFF reenviará los comandos a `http://<ip>:3400/commands/:id` con el mismo Bearer. Con el host por defecto (loopback) o un comodín (`0.0.0.0`) el campo se omite y el BFF no reenvía comandos a ese equipo.
> Cada latido envía además `maxHeavyJobs` (de `MC_MAX_HEAVY_JOBS`) y `activeHeavyJobs: 0` (aún no se mide).
> La URL de Hermes del latido (`MC_HERMES_URL`, por defecto `http://127.0.0.1:8642`) sirve para la comprobación local y para el sondeo de salud; el BFF solo acepta destinos loopback/privados/tailnet (`*.ts.net`, `100.64.0.0/10`) y, para crear agentes de un equipo **remoto**, usa su propia `MC_HERMES_URL_<MACHINEID>` (la URL que alcanza Paperclip), no la del latido.
> El latido es saliente (agente -> BFF), así que para solo reportar salud no hace falta abrir ningún puerto.

### Comandos permitidos

Lista integrada (los cinco con `requiresConfirmation: true`; puedes relajarlo en tu propio JSON): `hermes-version`, `hermes-gateway-status`, `hermes-profile-list`, `disk-usage`, `node-agent-version`. En Windows `disk-usage` usa PowerShell (`Get-PSDrive -PSProvider FileSystem`); en macOS/Linux `df -h`.
Para reemplazarla, apunta `MC_ALLOWED_COMMANDS_FILE` a un JSON (ver `allowed-commands.example.json`); cada entrada lleva `argv` fijo (ejecutable + argumentos). Nunca se interpola entrada del usuario en `argv`.

## Instalación como servicio

> **AVISO: nada de lo siguiente se ejecutó ni se probó aquí.** Este entorno es Linux sin Windows ni macOS, y no se instaló ningún servicio. Son ejemplos documentados para que los ejecutes manualmente, ajustando rutas y revisándolos antes. Sustituye `<TOKEN>` por tu token real (no lo guardes en el repositorio).

Antes de cualquiera: compila (`pnpm --filter @mc/node-agent build`) y copia/ubica `apps/node-agent/dist` en una ruta fija.

### Windows: Programador de tareas (ejemplo, ejecutar manualmente)

Las variables de entorno deben existir para la tarea; lo más simple es definirlas a nivel de usuario antes de crear la tarea:

```bat
setx MC_MACHINE_ID "win-principal"
setx MC_BFF_URL "http://100.x.y.z:3300"
setx MC_NODE_AGENT_TOKEN "<TOKEN>"

schtasks /Create /SC ONLOGON /TN "MC Node Agent" /TR "\"C:\Program Files\nodejs\node.exe\" C:\mc\apps\node-agent\dist\main.js"
```

Comprobar / ejecutar / quitar: `schtasks /Query /TN "MC Node Agent"`, `schtasks /Run /TN "MC Node Agent"`, `schtasks /Delete /TN "MC Node Agent" /F`.
Nota: `ONLOGON` arranca al iniciar sesión el usuario, no como servicio de sistema.

### Windows: alternativa con NSSM (ejemplo, ejecutar manualmente)

[NSSM](https://nssm.cc) debe instalarse aparte. Corre como servicio real y se reinicia solo:

```bat
nssm install MCNodeAgent "C:\Program Files\nodejs\node.exe" "C:\mc\apps\node-agent\dist\main.js"
nssm set MCNodeAgent AppDirectory C:\mc\apps\node-agent
nssm set MCNodeAgent AppEnvironmentExtra MC_MACHINE_ID=win-principal MC_BFF_URL=http://100.x.y.z:3300 MC_NODE_AGENT_TOKEN=<TOKEN>
nssm set MCNodeAgent AppStdout C:\mc\logs\node-agent.log
nssm set MCNodeAgent AppStderr C:\mc\logs\node-agent.err.log
nssm start MCNodeAgent
```

Si `hermes` es un `.cmd`/`.bat` (instalación con npm/pipx shims), indica la ruta completa de un `.exe` en `MC_HERMES_BIN`: `execFile` no ejecuta scripts `.cmd` sin shell.

### macOS: launchd (ejemplo, ejecutar manualmente)

Archivo `~/Library/LaunchAgents/com.mc.node-agent.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.mc.node-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/TU_USUARIO/mc/apps/node-agent/dist/main.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MC_MACHINE_ID</key><string>mac</string>
    <key>MC_BFF_URL</key><string>http://100.x.y.z:3300</string>
    <key>MC_NODE_AGENT_TOKEN</key><string>&lt;TOKEN&gt;</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/TU_USUARIO/Library/Logs/mc-node-agent.log</string>
  <key>StandardErrorPath</key><string>/Users/TU_USUARIO/Library/Logs/mc-node-agent.err.log</string>
</dict>
</plist>
```

```bash
chmod 600 ~/Library/LaunchAgents/com.mc.node-agent.plist   # contiene el token
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mc.node-agent.plist
launchctl bootout gui/$(id -u)/com.mc.node-agent            # para quitarlo
```

### Linux: systemd de usuario (ejemplo, ejecutar manualmente)

Archivo `~/.config/systemd/user/mc-node-agent.service` (el token va en un `EnvironmentFile` con permisos 600):

```ini
[Unit]
Description=Mission Control node-agent
After=network-online.target

[Service]
ExecStart=/usr/bin/node %h/mc/apps/node-agent/dist/main.js
EnvironmentFile=%h/.config/mc-node-agent.env
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
install -m 600 /dev/null ~/.config/mc-node-agent.env   # luego edita con MC_MACHINE_ID, MC_NODE_AGENT_TOKEN, ...
systemctl --user daemon-reload
systemctl --user enable --now mc-node-agent
loginctl enable-linger "$USER"   # opcional: que siga activo sin sesión abierta
```

## Desarrollo

```bash
pnpm --filter @mc/node-agent build       # tsc -> dist/
pnpm --filter @mc/node-agent typecheck
pnpm --filter @mc/node-agent test        # pretest compila; node:test contra dist/
pnpm --filter @mc/node-agent dev         # tsx watch src/main.ts
```

Las pruebas cubren configuración, salud, Hermes (servidor falso y puerto cerrado), comandos, servidor HTTP (401/200) y el latido contra un BFF falso (payload y retroceso ante 500). Las partes específicas de Windows/macOS (PowerShell, rutas `C:\`, `schtasks`, `nssm`, `launchd`) **no se han ejecutado** en este entorno Linux.
