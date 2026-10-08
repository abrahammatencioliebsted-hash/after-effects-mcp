#!/usr/bin/env bash
# Mission Control — comprobar / aplicar / revertir la versión de Paperclip (instalación GESTIONADA: macOS, Linux, WSL2).
#
# Antes de actualizar hace SIEMPRE una copia completa (backup-full.mjs): 'paperclipai update' ya hace backup de BD en modo
# gestionado, pero NO guarda master.key/.env/storage. 'update --rollback' vuelve el CÓDIGO; no revierte migraciones de la base.
# Uso:
#   update-managed.sh --check                       # solo informa (exit 10 de paperclipai = hay actualización)
#   update-managed.sh --to 2026.1006.0 --yes        # copia completa + update a esa versión exacta (queda FIJADA)
#   update-managed.sh --rollback --yes              # vuelve al payload anterior (si la BD ya migró hacia delante: restaura la copia)
#   --stopped       actualiza con el servicio PARADO (hallazgo F2: 'update' valida la salud solo 60 s y, si el arranque con migraciones
#                   tarda más, revierte el código dejando la BD ya migrada). Orden: copia completa → service stop → update --no-backup
#                   → service start → esperar /api/health y comprobar la versión a mano.
#   [--dry-run]  imprime el plan sin ejecutar
# Estado: sintaxis con `bash -n` y modo plan. NO ejecutado: ni update ni rollback se probaron en ningún sistema aquí.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
TO=""; CHECK=0; ROLLBACK=0; STOPPED=0; YES=0; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --to) TO="$2"; shift 2 ;;
    --check) CHECK=1; shift ;;
    --rollback) ROLLBACK=1; shift ;;
    --stopped) STOPPED=1; shift ;;
    --yes|-y) YES=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,12p "$0"; exit 0 ;;
    *) echo "ERROR: opción desconocida: $1" >&2; exit 1 ;;
  esac
done
EXEC=1; if [ "$YES" != 1 ] || [ "$DRY" = 1 ]; then EXEC=0; fi
say() { printf '== %s\n' "$*"; }
run() { printf '+ %s\n' "$*"; if [ "$EXEC" = 1 ]; then "$@"; fi; }
export PATH="$HOME/.local/bin:$PATH"

say "Versión actual y modo de instalación"
printf '+ paperclipai --version\n'; paperclipai --version || true
if [ "$CHECK" = 1 ] || { [ -z "$TO" ] && [ "$ROLLBACK" = 0 ]; }; then
  printf '+ paperclipai update --check --json\n'; paperclipai update --check --json || echo "(código $? — 10 significa 'hay actualización')"
  exit 0
fi
[ -n "$NODE_BIN" ] || { echo "ERROR: falta node" >&2; exit 1; }
[ "$EXEC" = 0 ] && say "MODO PLAN: no se ejecuta nada (añade --yes para ejecutar)."

if [ "$ROLLBACK" = 1 ]; then
  say "Rollback de CÓDIGO (no revierte migraciones)"
  run paperclipai update --rollback
else
  [[ "$TO" =~ ^[0-9]{4}\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]] || { echo "ERROR: --to debe ser una versión exacta como 2026.1006.0" >&2; exit 1; }
  run "$NODE_BIN" "$ROOT/scripts/common/backup-full.mjs" --out "$HOME/mc-backups"
  run paperclipai update --dry-run
  if [ "$STOPPED" = 1 ]; then
    run paperclipai service stop
    run paperclipai update --version "$TO" --no-backup
    run paperclipai service start
    if [ "$EXEC" = 1 ]; then
      say "Vigila el arranque (las migraciones se aplican solas sin TTY): paperclipai service logs -f"
      sleep 30
    fi
  else
    run paperclipai update --version "$TO"
  fi
fi
run paperclipai --version
run paperclipai service status --json
echo "Verifica /api/health y, si algo falla, restaura la copia con scripts/common/restore-managed.sh (docs/04-runbooks/actualizar-y-restaurar.md)."
