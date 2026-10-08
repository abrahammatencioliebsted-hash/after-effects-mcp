---
tipo: runbook
proyecto: Mission Control
revisado: 2026-10-08
equipo: Mac (donde viven la bóveda `principal`, Hermes, Codex y MiMo Desktop)
estado: "Nada de este runbook se ejecutó en macOS. Los scripts .sh pasaron `bash -n` y su lógica de archivos/plist se probó en Linux con comandos simulados; ver §7."
---

# Mac: Paperclip (ruta soportada), Hermes, node-agent y bóveda de Obsidian

Claves: **[C]** confirmado por ti · **[H]** comprobado en el entorno Cloud (Linux) · **[F]** documentación/código leído · **[I]** inferencia · **[Pr]** propuesta sin aprobar.

## 0. Para qué sirve este documento

Dos usos, según lo que decidas en `windows.md` §0 [Pr]:

1. **El Mac como ejecutor** (lo previsto): corre Hermes con su API server, el node-agent, y es el equipo donde está tu bóveda. Paperclip vive en la Windows principal. → §2, §3, §4, §5 (y `segundo-equipo.md` para unirlo).
2. **El Mac como plano de control** (Alternativa 1 [Pr]): es la única plataforma de escritorio con instalación y servicio **soportados oficialmente** (LaunchAgent). → §1 completo.

## 1. Paperclip en macOS (ruta soportada)

Requisitos: macOS con Apple Silicon o Intel (`@embedded-postgres/darwin-arm64` y `darwin-x64` existen; `install.sh` acepta `x64`/`arm64`: `install.sh:188-192`), Node ≥ 24.11 y una sesión gráfica iniciada.

```sh
# Script (imprime todo; sin --yes solo muestra el plan)
bash scripts/macos/install-paperclip.sh
bash scripts/macos/install-paperclip.sh --yes
bash scripts/macos/install-paperclip.sh --yes --bind tailnet     # solo en una configuración nueva y con Tailscale ya arriba
```
Equivale a:
```sh
curl -fsSLO https://paperclip.ing/install.sh
curl -fsSLO https://paperclip.ing/install.sh.sha256
shasum -a 256 -c install.sh.sha256                       # esperado: install.sh: OK
bash install.sh --version 2026.1005.0 --no-prompt --no-onboard
export PATH="$HOME/.local/bin:$PATH"                     # si el instalador no editó ~/.zshrc
paperclipai --version                                    # esperado: 2026.1005.0
paperclipai onboard --yes --install-service              # configura (loopback, local_trusted) + LaunchAgent + arranca
paperclipai service status --json
curl -s http://127.0.0.1:3100/api/health                 # el puerto real: ~/.paperclip/instances/default/runtime-info.json
paperclipai service logs -f
```
Esperado en `/api/health` (visto en Linux con el mismo build [H]): `"status":"ok","version":"2026.1005.0","deploymentMode":"local_trusted","authReady":true,"bootstrapStatus":"ready"`.

Qué se instala [F] (`service-manager.ts:123-125,164-171,280-289`): plist `~/Library/LaunchAgents/ing.paperclip.paperclipai.plist`, dominio `gui/<uid>`, `RunAtLoad` + `KeepAlive` + `ThrottleInterval 5` (launchd reintenta cada 5 s **sin límite**, a diferencia del límite de 5 fallos/60 s de systemd), logs `~/.paperclip/instances/default/logs/service.log` y `service.err.log`. El plist solo inyecta `PAPERCLIP_SERVICE_MANAGED`, `PAPERCLIP_INSTANCE_ID` y `PAPERCLIP_HOME`: **cualquier otra variable va en `~/.paperclip/instances/default/.env`** (se carga con `override:false`). Código gestionado en `~/.paperclip/cli/` y shim en `~/.local/bin/paperclipai`; datos en `~/.paperclip/instances/default/`.

Notas del instalador [F]: si falta Node 24.11 instala Homebrew y `brew install node` (`install.sh:286-305`); **aborta si detecta nvm** (`:277-278`). El `.sha256` del mismo origen detecta descargas rotas, no prueba autenticidad; el script ofrece `--source github` (commit `5717523b…` fijado) para un origen independiente.

### Caveats M1–M8 (y qué hacer)

| # | Caveat | Acción |
|---|---|---|
| M1 | El LaunchAgent arranca al **iniciar sesión gráfica**, no al encender el Mac | Mac sin pantalla: activa el inicio de sesión automático (Ajustes → Usuarios y grupos). Con FileVault activo macOS no ofrece inicio automático **[I]**. Alternativa: mantener la sesión abierta. Comprobar tras reiniciar: V2 |
| M2 | El PATH del servicio es mínimo: los CLIs `claude`, `codex`… en `/opt/homebrew/bin`, `~/.local/bin` o nvm **pueden no verse** desde un agente local lanzado por el servicio | Fija el `command` absoluto en el adaptador, o un `PATH` completo en `~/.paperclip/instances/default/.env`. Comprobar: V3 |
| M3 | El shim guarda la ruta absoluta de `node`; tras `brew upgrade node` puede apuntar a un binario inexistente | Reinstalar el shim con el Node nuevo: `npx paperclipai@latest install --yes` (documentado; no uses el shim viejo). Probar: V4 |
| M4 | `install.sh` instala Homebrew + Node si faltan y aborta con nvm | Instala Node 24 con Homebrew antes, o desactiva nvm en esa sesión |
| M5 | Permisos TCC (Escritorio, Documentos, automatización) para procesos lanzados por launchd | No documentado en el repo. Si un agente falla leyendo `~/Documents`, concede el acceso al ejecutable de `node` en Ajustes → Privacidad. Ver §5 para la bóveda |
| M6 | Los logs del servicio son archivos, no `journalctl` | `paperclipai service logs -f` hace `tail -F` |
| M7 | Apple Silicon e Intel soportados por el PostgreSQL embebido | — |
| M8 | La suspensión del Mac detiene los latidos | `caffeinate -s` o Ajustes de batería/energía; prueba V19 |

### Modo tailnet en el Mac (solo si el Mac es el plano de control)

Ver `segundo-equipo.md` §A. En el Mac, `KeepAlive` reintenta sin límite, pero aun así fija `PAPERCLIP_TAILNET_BIND_HOST=100.x.y.z` en el `.env` para no depender de que Tailscale esté arriba al arrancar (`config.ts:305-312`: si falta la IP, el servidor no arranca).

## 2. Hermes en el Mac

Ya tienes Hermes instalado (app de escritorio + CLI v0.21.4 canary, modelo `mimo-v2.6-pro` por Token Plan, perfil `default`, sin mensajería ni cron) y un `.hermes-update-in-progress.lock` pendiente [H local, otra sesión]. **No se tocó nada desde aquí.** Antes de convertirlo en ejecutor:

1. Resuelve el bloqueo de actualización (`hermes doctor` / `hermes update`) y comprueba `hermes --version`.
2. Decide el proveedor (P06). **Riesgo de términos [F]:** el Token Plan de MiMo prohíbe scripts automatizados y backends de apps propias; un ejecutor de MC con ese plan podría contar como tal **[I]**. Hasta decidir, usa Hermes del Mac solo de forma interactiva o con otra clave.

Instalar/actualizar fijado (el script respeta una instalación existente y no la reinstala sin `--force-install`):
```sh
bash scripts/macos/install-hermes.sh          # plan
bash scripts/macos/install-hermes.sh --yes
```
Equivale a (opciones de `install.sh` de Hermes verificadas en el clon @ `a28a5d03`):
```sh
curl -fsSL -o install.sh https://hermes-agent.nousresearch.com/install.sh && shasum -a 256 install.sh
bash install.sh --commit a28a5d03a9fa60418db5f44f3436fa2aa029c8f2 --non-interactive
```
- El instalador de macOS (Hermes Desktop/`Hermes-Setup`) es solo **Apple Silicon**; en Intel usa el bundle `darwin-x64` o la CLI (`platform-support.md`).
- Datos: `~/.hermes` (`HERMES_HOME`).

API server, en `~/.hermes/.env` (el script lo añade solo si falta y **no imprime la clave**; archivo modo 600):
```
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
API_SERVER_KEY=<64 hex generados en tu Mac>
```
El API server **no arranca sin `API_SERVER_KEY`** (≥16 caracteres, ni en loopback) [F]. Para que otros equipos lo vean, no abras el puerto: publica con `tailscale serve` (HTTPS) como en `segundo-equipo.md` §B.

Gateway como servicio de launchd:
```sh
hermes gateway install      # LaunchAgent ai.hermes.gateway (RunAtLoad); 'gateway install --no-start-now' lo escribe sin arrancar
hermes gateway status
curl -s http://127.0.0.1:8642/health                                   # {"status":"ok","platform":"hermes-agent"}  (esperado, visto en Linux [H])
KEY=$(grep '^API_SERVER_KEY=' ~/.hermes/.env | cut -d= -f2-); curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $KEY" http://127.0.0.1:8642/v1/capabilities; unset KEY      # 200
```
Detalles de la documentación de Hermes [F] (`messaging/index.md:660-693`): el plist **fija el PATH del momento de instalar**; si instalas herramientas después (nvm, ffmpeg), repite `hermes gateway install`. Para evitar el bloqueo de "Local Network Privacy" de macOS, el plist ejecuta el gateway a través de `/usr/bin/osascript` (verás `osascript → stderr_timestamp → gateway run` en `ps`).

## 3. node-agent como LaunchAgent

Compila: `pnpm install && pnpm --filter @mc/node-agent build`. Crea el token (no lo guardes en el repositorio) y registra:
```sh
mkdir -p ~/.mc/node-agent && (umask 077; node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > ~/.mc/node-agent/token)
bash scripts/macos/install-node-agent.sh --machine-id mac --bff-url http://<IP-tailnet-del-BFF>:3300              # plan
bash scripts/macos/install-node-agent.sh --machine-id mac --bff-url http://<IP-tailnet-del-BFF>:3300 --yes
```
- El BFF de MC escucha por defecto en **3300** (no en 3100, que es Paperclip); el README del node-agent ya usa `http://100.x.y.z:3300`.
- El script escribe un lanzador `~/.mc/node-agent/run.sh` (modo 700) que **lee el token del archivo** y hace `exec node …/main.js`, y el plist `~/Library/LaunchAgents/com.mc.node-agent.plist` **sin el token**. PATH del plist: `~/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` (para encontrar `hermes`).
- Idempotente: hace `launchctl bootout` (si estaba cargado) y vuelve a `bootstrap` + `kickstart -k`.
- Comprobar: `curl -s http://127.0.0.1:3400/health` → `{"ok":true,"machineId":"mac",…}` (esperado); logs en `~/Library/Logs/mc-node-agent.log` y `.err.log`. Quitar: `bash scripts/macos/install-node-agent.sh --uninstall --yes`.

## 4. Copias, actualización y restauración en el Mac

```sh
bash scripts/macos/backup.sh                       # ~/mc-backups/mc-backup-default-<UTC>.tar.gz (servidor arriba)
bash scripts/macos/update.sh --check
bash scripts/macos/update.sh --to 2026.1006.0 --stopped --yes   # copia completa + update con el servicio parado (ver F2)
bash scripts/macos/restore.sh --archive ~/mc-backups/<copia>.tar.gz --yes
```
Detalle y justificación en `actualizar-y-restaurar.md`. La restauración **se ensayó de verdad en Linux** con los `.mjs`; los envoltorios de macOS no se ejecutaron.

## 5. Bóveda de Obsidian

- Ruta: `/Users/matenc10/Documents/principal` (la bóveda viva está en este Mac [H local]). Mission Control **solo la lee** y **nunca escribe en `Privado/`** ni la copia **[C]**; los documentos de MC excluyen `.obsidian`, `Privado/` y la biblioteca completa.
- La lectura prevista es del archivo `Registro de elecciones.md` (el BFF lo lee con `MC_ELECTIONS_FILE`; las ideas "sin decisión tuya" se muestran, nunca se convierten en misión solas). Si el BFF corre en la Windows principal necesita una **copia sincronizada** de ese archivo (Obsidian Sync, Syncthing o la copia de la PC Windows que ya mencionan tus notas); no hay cambio de esquema de carpetas ni escritura de vuelta.
- Si algún día un proceso lanzado por launchd (node-agent, BFF) lee `~/Documents`, macOS puede pedir o negar el acceso (M5): prueba con `bash -c 'ls ~/Documents/principal | head'` ejecutado desde ese proceso o concede el permiso al `node` correspondiente.
- La automatización de Codex "Explorador de Obsidian e ideas" (viernes 10:00) **sigue siendo de Codex**: no la dupliques desde MC **[C]**.

## 6. Lista de verificación del Mac

- [ ] `paperclipai --version` = `2026.1005.0` y `/api/health` ok (solo si el Mac es plano de control).
- [ ] Reinicio + inicio de sesión: el LaunchAgent revive solo (V2); con `caffeinate`/energía ajustada, los latidos continúan (V19).
- [ ] `hermes --version`; sin `.hermes-update-in-progress.lock`; `hermes gateway status` activo; `/health` 200; `/v1/capabilities` 200 con clave.
- [ ] Un agente `claude_local`/`codex_local` lanzado desde el servicio encuentra su CLI (V3), si Paperclip corre aquí.
- [ ] node-agent: `launchctl print gui/$(id -u)/com.mc.node-agent` muestra estado `running`; `/health` 200; el equipo aparece en el panel.
- [ ] Lectura de `Registro de elecciones.md` por el BFF sin permisos extra; `Privado/` no se toca.
- [ ] Copia completa + restauración ensayada (V10).

## 7. Qué se verificó y qué no

| Elemento | Estado |
|---|---|
| `install.sh`/`paperclipai install`/`onboard`/`service` en macOS | **Leído** en el código; **no ejecutado** (no hay Mac en el entorno Cloud) |
| Scripts `.sh` | `bash -n` OK; `install-node-agent.sh` genera un plist válido (comprobado con `plistlib`) y el lanzador con `launchctl` simulado; `install-hermes.sh` aplica el `.env` de forma idempotente (probado con `hermes` simulado). **Nada en macOS** |
| Restauración de la base y de las claves | **Verificado en Linux** con los `.mjs` (`docs/evidencias/restauracion-lab.md`) |
| `hermes gateway install` en launchd | Leído en la documentación de Hermes; no ejecutado |
| Lock de actualización de Hermes, Token Plan | Estado leído por otra sesión; sin cambios desde aquí |
