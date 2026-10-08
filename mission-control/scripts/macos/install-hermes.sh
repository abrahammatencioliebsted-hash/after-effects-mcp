#!/usr/bin/env bash
# Mission Control — instalar/configurar Hermes Agent en macOS con su API server y el gateway como servicio (launchd).
#
# Qué hace (cada comando se imprime):
#   1) si 'hermes' no existe, descarga el instalador oficial y lo ejecuta FIJADO a un commit (--commit) y sin interacción;
#   2) asegura en $HERMES_HOME/.env: API_SERVER_ENABLED, API_SERVER_HOST=127.0.0.1, API_SERVER_PORT y API_SERVER_KEY
#      (la clave se genera con openssl SOLO si no existe y NUNCA se imprime);
#   3) 'hermes gateway install' (LaunchAgent ai.hermes.gateway) y comprobación de GET /health.
# Sin --yes (o con --dry-run) solo imprime el plan. No contiene secretos.
#
# Estado de verificación: sintaxis con `bash -n`; la lógica de .env se probó con HERMES_HOME temporal en Linux (ver README).
# NO ejecutado en macOS. El instalador (hermes-agent.nousresearch.com) no es alcanzable desde el entorno Cloud.
set -euo pipefail

# ---- Versiones fijadas (cambiar aquí) -------------------------------------------------------------------
HERMES_COMMIT="${HERMES_COMMIT:-a28a5d03a9fa60418db5f44f3436fa2aa029c8f2}"   # clon verificado el 2026-10-07
HERMES_INSTALLER_URL="https://hermes-agent.nousresearch.com/install.sh"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
API_HOST="127.0.0.1"; API_PORT="8642"

YES=0; DRY=0; FORCE=0; SKIP_SERVICE=0
usage() {
  cat <<EOF
Uso: $0 [--force-install] [--no-service] [--yes] [--dry-run]
  --force-install   Ejecutar el instalador aunque 'hermes' ya exista (por defecto se respeta la instalación actual).
  --no-service      No ejecutar 'hermes gateway install'.
  --yes / --dry-run Ver arriba. Variables: HERMES_HOME (por defecto ~/.hermes), HERMES_COMMIT.
EOF
}
while [ $# -gt 0 ]; do
  case "$1" in
    --force-install) FORCE=1; shift ;;
    --no-service) SKIP_SERVICE=1; shift ;;
    --yes|-y) YES=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: opción desconocida: $1" >&2; usage; exit 1 ;;
  esac
done
EXEC=1; if [ "$YES" != 1 ] || [ "$DRY" = 1 ]; then EXEC=0; fi
say() { printf '== %s\n' "$*"; }
run() { printf '+ %s\n' "$*"; if [ "$EXEC" = 1 ]; then "$@"; fi; }

# Añade KEY=VALUE a un .env solo si la clave no existe (idempotente). Si value es '@gen', genera 32 bytes hex y no los imprime.
ensure_env() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then printf '  (ya existe %s en %s; no se toca)\n' "$key" "$file"; return 0; fi
  if [ "$value" = "@gen" ]; then
    printf '+ añadir %s=<generada con openssl rand -hex 32, no se imprime> a %s\n' "$key" "$file"
    if [ "$EXEC" = 1 ]; then printf '%s=%s\n' "$key" "$(openssl rand -hex 32)" >> "$file"; fi
  else
    printf '+ añadir %s=%s a %s\n' "$key" "$value" "$file"
    if [ "$EXEC" = 1 ]; then printf '%s=%s\n' "$key" "$value" >> "$file"; fi
  fi
}

say "Mission Control · Hermes en macOS (HERMES_HOME=$HERMES_HOME)"
if [ "$(uname -s)" != "Darwin" ]; then echo "AVISO: no es macOS (uname=$(uname -s))." >&2; fi
if [ "$EXEC" = 0 ]; then say "MODO PLAN: no se ejecuta nada (añade --yes para ejecutar)."; fi
# El Mac del usuario tiene una instalación previa (v0.21.4 canary) con '.hermes-update-in-progress.lock' pendiente [documentos de estado].
if [ -e "$HERMES_HOME/.hermes-update-in-progress.lock" ]; then
  echo "AVISO: existe $HERMES_HOME/.hermes-update-in-progress.lock (actualización a medias). Resuélvelo ('hermes update' o 'hermes doctor') antes de seguir." >&2
fi

if command -v hermes >/dev/null 2>&1 && [ "$FORCE" = 0 ]; then
  say "hermes ya instalado: $(command -v hermes) — $(hermes --version 2>/dev/null | head -1 || true) (usa --force-install para reinstalar)"
else
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/mc-hermes-install.XXXXXX")"; trap 'rm -rf "$WORK"' EXIT
  run curl -fsSL -o "$WORK/install.sh" "$HERMES_INSTALLER_URL"
  if [ "$EXEC" = 1 ]; then printf 'sha256 de install.sh (anótalo; Hermes no publica un hash independiente): '; shasum -a 256 "$WORK/install.sh" | cut -d' ' -f1; fi
  say "Revisa $WORK/install.sh antes de continuar si es la primera vez."
  run bash "$WORK/install.sh" --commit "$HERMES_COMMIT" --non-interactive
  export PATH="$HOME/.local/bin:$PATH"
fi

say "Configurar el API server en $HERMES_HOME/.env"
if [ "$EXEC" = 1 ]; then mkdir -p "$HERMES_HOME"; touch "$HERMES_HOME/.env"; chmod 600 "$HERMES_HOME/.env"; else printf '+ mkdir -p %s && touch %s/.env && chmod 600 %s/.env\n' "$HERMES_HOME" "$HERMES_HOME" "$HERMES_HOME"; fi
ENVF="$HERMES_HOME/.env"
ensure_env "$ENVF" API_SERVER_ENABLED true
ensure_env "$ENVF" API_SERVER_HOST "$API_HOST"
ensure_env "$ENVF" API_SERVER_PORT "$API_PORT"
ensure_env "$ENVF" API_SERVER_KEY "@gen"

cat <<EOF

Proveedor del modelo (NO lo escribe este script: son secretos y hay una decisión pendiente, P06):
  - MiMo: añade a $ENVF las líneas XIAOMI_API_KEY=<tu clave> y XIAOMI_BASE_URL=<URL de tu plan>, y en config.yaml
    model.provider: xiaomi / model.default: <modelo>. RIESGO [F]: el Token Plan de MiMo prohíbe scripts automatizados;
    un ejecutor de Mission Control o un cron de Hermes con ese plan podría contar como tal. Decisión del usuario pendiente.
  - Alternativa: hermes model  (asistente interactivo).
EOF

if [ "$SKIP_SERVICE" = 0 ]; then
  run hermes gateway install
  run hermes gateway status
  if [ "$EXEC" = 1 ]; then
    sleep 5
    printf '+ curl -s http://%s:%s/health\n' "$API_HOST" "$API_PORT"; curl -s "http://${API_HOST}:${API_PORT}/health" || true; echo
    echo "Para validar la clave (sin imprimirla):  KEY=\$(grep '^API_SERVER_KEY=' \"$ENVF\" | cut -d= -f2-); curl -s -o /dev/null -w '%{http_code}\\n' -H \"Authorization: Bearer \$KEY\" http://${API_HOST}:${API_PORT}/v1/capabilities"
  fi
  echo "Nota: launchd guarda el PATH al instalar; si instalas herramientas después, repite 'hermes gateway install' (docs de Hermes)."
fi
