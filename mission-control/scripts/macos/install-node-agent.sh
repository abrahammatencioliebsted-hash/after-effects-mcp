#!/usr/bin/env bash
# Mission Control — instalar el node-agent como LaunchAgent de usuario en macOS.
#
# El token NO va en el plist ni en este script: se lee de un archivo (modo 600) que tú creas; un lanzador mínimo
# (~/.mc/node-agent/run.sh) lo exporta y hace exec de node. Cada comando se imprime antes de ejecutarse.
# Sin --yes (o con --dry-run) solo imprime el plan.
#
# Prerrequisitos: haber compilado el agente (pnpm --filter @mc/node-agent build → apps/node-agent/dist/main.js) y crear el token:
#   mkdir -p ~/.mc/node-agent && umask 077 && node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > ~/.mc/node-agent/token
#
# Estado de verificación: sintaxis con `bash -n`; el plist generado se validó con xmllint/python (plistlib) en Linux. NO ejecutado en macOS.
set -euo pipefail

LABEL="com.mc.node-agent"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MC_HOME="${MC_HOME:-$HOME/.mc/node-agent}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
MACHINE_ID=""; BFF_URL=""; TOKEN_FILE="$MC_HOME/token"; HERMES_URL="http://127.0.0.1:8642"; YES=0; DRY=0; UNINSTALL=0
usage() {
  cat <<EOT
Uso: $0 --machine-id <id> [--bff-url http://IP:3100] [--token-file <archivo>] [--hermes-url <url>] [--node <ruta a node>] [--yes] [--dry-run] [--uninstall]
  --machine-id   Id del equipo (p. ej. mac). Obligatorio salvo --uninstall.
  --bff-url      URL del BFF de Mission Control. Sin ella el agente corre en modo "solo local" (sin latidos).
  --token-file   Archivo con el token compartido BFF<->node-agent (modo 600). Por defecto $TOKEN_FILE.
  --uninstall    Descarga el LaunchAgent y borra el plist.
EOT
}
while [ $# -gt 0 ]; do
  case "$1" in
    --machine-id) MACHINE_ID="$2"; shift 2 ;;
    --bff-url) BFF_URL="$2"; shift 2 ;;
    --token-file) TOKEN_FILE="$2"; shift 2 ;;
    --hermes-url) HERMES_URL="$2"; shift 2 ;;
    --node) NODE_BIN="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    --yes|-y) YES=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: opción desconocida: $1" >&2; usage; exit 1 ;;
  esac
done
EXEC=1; if [ "$YES" != 1 ] || [ "$DRY" = 1 ]; then EXEC=0; fi
say() { printf '== %s\n' "$*"; }
run() { printf '+ %s\n' "$*"; if [ "$EXEC" = 1 ]; then "$@"; fi; }
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
UIDN="$(id -u)"

if [ "$UNINSTALL" = 1 ]; then
  say "Desinstalar $LABEL"
  if [ "$EXEC" = 1 ]; then launchctl bootout "gui/${UIDN}/${LABEL}" 2>/dev/null || true; printf '+ launchctl bootout gui/%s/%s (si estaba cargado)\n' "$UIDN" "$LABEL"; else printf '+ launchctl bootout gui/%s/%s\n' "$UIDN" "$LABEL"; fi
  run rm -f "$PLIST"
  exit 0
fi

[ -n "$MACHINE_ID" ] || { echo "ERROR: falta --machine-id" >&2; usage; exit 1; }
[ -n "$NODE_BIN" ] || { echo "ERROR: no se encontró node (instala Node 24 LTS o pasa --node)" >&2; exit 1; }
MAIN="$ROOT/apps/node-agent/dist/main.js"
say "Mission Control · node-agent como LaunchAgent (machine-id=$MACHINE_ID)"
[ "$EXEC" = 0 ] && say "MODO PLAN: no se ejecuta nada (añade --yes para ejecutar)."
[ -f "$MAIN" ] || echo "AVISO: no existe $MAIN; compila antes con: pnpm --filter @mc/node-agent build" >&2
if [ -n "$BFF_URL" ] && [ ! -s "$TOKEN_FILE" ]; then echo "AVISO: con --bff-url hace falta el token en $TOKEN_FILE (ver cabecera del script)." >&2; [ "$EXEC" = 1 ] && exit 1; fi

LAUNCHER="$MC_HOME/run.sh"
run mkdir -p "$MC_HOME" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
printf '+ escribir %s (lanzador: exporta variables y hace exec de node; el token se lee del archivo)\n' "$LAUNCHER"
if [ "$EXEC" = 1 ]; then
  {
    echo '#!/bin/sh'
    echo "export MC_MACHINE_ID='${MACHINE_ID}'"
    echo "export MC_HERMES_URL='${HERMES_URL}'"
    [ -n "$BFF_URL" ] && echo "export MC_BFF_URL='${BFF_URL}'"
    echo "[ -r '${TOKEN_FILE}' ] && export MC_NODE_AGENT_TOKEN=\"\$(cat '${TOKEN_FILE}')\""
    echo "exec '${NODE_BIN}' '${MAIN}'"
  } > "$LAUNCHER"
  chmod 700 "$LAUNCHER"
fi

printf '+ escribir %s\n' "$PLIST"
if [ "$EXEC" = 1 ]; then
  cat > "$PLIST" <<EOP
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>${LAUNCHER}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${HOME}/Library/Logs/mc-node-agent.log</string>
  <key>StandardErrorPath</key><string>${HOME}/Library/Logs/mc-node-agent.err.log</string>
</dict>
</plist>
EOP
  chmod 644 "$PLIST"
fi

# Idempotente: si ya estaba cargado, se descarga antes de volver a cargarlo.
printf '+ launchctl bootout gui/%s/%s   (ignora el error si no estaba cargado)\n' "$UIDN" "$LABEL"
if [ "$EXEC" = 1 ]; then launchctl bootout "gui/${UIDN}/${LABEL}" 2>/dev/null || true; fi
run launchctl bootstrap "gui/${UIDN}" "$PLIST"
run launchctl kickstart -k "gui/${UIDN}/${LABEL}"
if [ "$EXEC" = 1 ]; then
  sleep 3
  printf '+ curl -s http://127.0.0.1:3400/health\n'; curl -s http://127.0.0.1:3400/health || true; echo
fi
echo "Logs: ~/Library/Logs/mc-node-agent.log y mc-node-agent.err.log · Quitar: $0 --uninstall --yes"
