#!/usr/bin/env bash
# Mission Control — copia de seguridad completa de Paperclip en macOS (envuelve scripts/common/backup-full.mjs).
# El servidor de Paperclip debe estar ARRIBA (el Postgres embebido solo existe entonces).
# Uso: backup.sh [--data-dir ~/.paperclip] [--instance default] [--out ~/mc-backups] [--skip-db] [--dry-run]
# Estado: sintaxis con `bash -n`. NO ejecutado en macOS; backup-full.mjs sí se ejecutó en Linux.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
[ -n "$NODE_BIN" ] || { echo "ERROR: falta node (>= 24.11)" >&2; exit 1; }
ARGS=("$@")
case " $* " in *" --out "*) ;; *) ARGS+=(--out "$HOME/mc-backups") ;; esac
printf '+ %s %s %s\n' "$NODE_BIN" "$ROOT/scripts/common/backup-full.mjs" "${ARGS[*]}"
exec "$NODE_BIN" "$ROOT/scripts/common/backup-full.mjs" "${ARGS[@]}"
