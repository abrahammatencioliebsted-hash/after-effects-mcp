#!/usr/bin/env bash
# Mission Control — instalar Paperclip en macOS (ruta SOPORTADA: instalador gestionado + LaunchAgent).
#
# Qué hace (cada comando se imprime antes de ejecutarse):
#   1) descarga install.sh y su .sha256, verifica el hash, 2) instala la versión FIJADA sin onboarding,
#   3) onboard --yes --install-service (LaunchAgent ing.paperclip.paperclipai), 4) comprueba servicio y /api/health.
# Sin --yes (o con --dry-run) solo IMPRIME el plan. No contiene secretos.
#
# Estado de verificación: sintaxis con `bash -n`. NO ejecutado en macOS (no hay Mac en el entorno Cloud). Ver docs/04-runbooks/macos.md.
set -euo pipefail

# ---- Versiones fijadas (cambiar aquí) -------------------------------------------------------------------
PAPERCLIP_VERSION="${PAPERCLIP_VERSION:-2026.1005.0}"
# Origen independiente del instalador (commit del clon de referencia, 2026-10-07); se usa con --source github
PAPERCLIP_INSTALLER_COMMIT="5717523b9ea7a2d76efbd6eb73414de9c06c6f96"
PAPERCLIP_INSTALLER_URL="https://paperclip.ing/install.sh"
PAPERCLIP_INSTALLER_GH="https://raw.githubusercontent.com/paperclipai/paperclip/${PAPERCLIP_INSTALLER_COMMIT}/scripts/install.sh"

YES=0; DRY=0; SERVICE=1; BIND=""; SOURCE="paperclip.ing"
usage() {
  cat <<EOF
Uso: $0 [--version X] [--bind tailnet] [--no-service] [--source paperclip.ing|github] [--yes] [--dry-run]
  --version X       Versión exacta de paperclipai (por defecto ${PAPERCLIP_VERSION}).
  --bind tailnet    Primera configuración con bind a la IP de Tailscale (requiere Tailscale arriba y config inexistente).
  --no-service      No instalar el LaunchAgent (arranque manual con 'paperclipai run').
  --source github   Descargar install.sh de GitHub fijado al commit ${PAPERCLIP_INSTALLER_COMMIT:0:8} (sin .sha256 del mismo origen).
  --yes             Ejecutar de verdad. Sin --yes solo se imprime el plan.
  --dry-run         Imprimir el plan aunque se pase --yes.
EOF
}
while [ $# -gt 0 ]; do
  case "$1" in
    --version) PAPERCLIP_VERSION="$2"; shift 2 ;;
    --bind) BIND="$2"; shift 2 ;;
    --no-service) SERVICE=0; shift ;;
    --source) SOURCE="$2"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: opción desconocida: $1" >&2; usage; exit 1 ;;
  esac
done
EXEC=1; if [ "$YES" != 1 ] || [ "$DRY" = 1 ]; then EXEC=0; fi

say() { printf '== %s\n' "$*"; }
run() { printf '+ %s\n' "$*"; if [ "$EXEC" = 1 ]; then "$@"; fi; }

say "Mission Control · instalar Paperclip ${PAPERCLIP_VERSION} en macOS"
if [ "$(uname -s)" != "Darwin" ]; then echo "AVISO: no es macOS (uname=$(uname -s)); este script está pensado para macOS." >&2; fi
if [ "$EXEC" = 0 ]; then say "MODO PLAN: no se ejecuta nada (añade --yes para ejecutar)."; fi

# Comprobaciones previas (solo lectura)
if command -v node >/dev/null 2>&1; then
  say "Node actual: $(node -v)  (se exige >= 24.11.0; si falta, install.sh instala Homebrew+Node; si hay nvm, ABORTA: caveat M4)"
else
  say "Node no encontrado: install.sh intentará instalarlo con Homebrew (pedirá permisos; caveat M4)."
fi
if [ -n "${NVM_DIR:-}" ] && [ -d "${NVM_DIR:-/nonexistent}" ]; then
  echo "AVISO: se detecta nvm; install.sh aborta si lo encuentra. Usa Node de Homebrew o desactiva nvm en esta sesión." >&2
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/mc-paperclip-install.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

if [ "$SOURCE" = "github" ]; then
  run curl -fsSL -o install.sh "$PAPERCLIP_INSTALLER_GH"
  say "Revisa install.sh antes de seguir (origen: GitHub, commit fijado; no hay .sha256 independiente)."
else
  run curl -fsSLO "$PAPERCLIP_INSTALLER_URL"
  run curl -fsSLO "${PAPERCLIP_INSTALLER_URL}.sha256"
  run shasum -a 256 -c install.sh.sha256
  say "El .sha256 viene del mismo origen: detecta errores de descarga, NO prueba autenticidad (doc/INSTALLING.md)."
fi
run bash install.sh --version "$PAPERCLIP_VERSION" --no-prompt --no-onboard

# PATH: el instalador no edita ~/.zshrc en modo no interactivo
export PATH="$HOME/.local/bin:$PATH"
say "Si 'paperclipai' no se encuentra en una terminal nueva: echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
run paperclipai --version

ONBOARD=(paperclipai onboard --yes)
if [ -n "$BIND" ]; then ONBOARD+=(--bind "$BIND"); fi
if [ "$SERVICE" = 1 ]; then ONBOARD+=(--install-service); fi
run "${ONBOARD[@]}"

if [ "$SERVICE" = 1 ]; then
  run paperclipai service status --json
  if [ "$EXEC" = 1 ]; then
    RI="$HOME/.paperclip/instances/default/runtime-info.json"
    sleep 5
    if [ -f "$RI" ]; then
      PORT="$(sed -n 's/.*"port": *\([0-9]*\).*/\1/p' "$RI" | head -1)"
      printf '+ curl -s http://127.0.0.1:%s/api/health\n' "${PORT:-3100}"
      curl -s "http://127.0.0.1:${PORT:-3100}/api/health" || true; echo
    else
      echo "AVISO: aún no existe $RI; espera unos segundos y consulta 'paperclipai service logs -f'." >&2
    fi
  fi
fi

cat <<'EOF'

Recordatorios (docs/04-runbooks/macos.md):
  M1  El LaunchAgent arranca al INICIAR SESIÓN gráfica, no al encender el Mac: en un Mac sin pantalla activa el inicio de sesión automático.
  M2  El servicio solo define PATH mínimo: si un agente local no encuentra su CLI, fija la ruta absoluta o PATH en ~/.paperclip/instances/default/.env.
  M3  Tras 'brew upgrade node' el shim puede apuntar a un Node inexistente: reinstala con 'npx paperclipai@latest install --yes' usando el Node nuevo.
  M8  La suspensión del Mac detiene los latidos: usa 'caffeinate' o ajustes de energía.
EOF
