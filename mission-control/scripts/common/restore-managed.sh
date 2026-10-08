#!/usr/bin/env bash
# Mission Control — restaurar Paperclip desde una copia de backup-full.mjs en una instalación GESTIONADA (macOS launchd, Linux/WSL2 systemd).
#
# Secuencia (cada comando se imprime):
#   1) parar el servicio · 2) restore-files.mjs (claves, .env, storage, workspaces…) · 3) arrancar (levanta el Postgres embebido)
#   4) restore-db.mjs con el volcado (motor JS si no hay psql) · 5) reiniciar · 6) verify-restore.mjs.
# DESTRUCTIVO: sobrescribe las tablas y las claves de la instancia. Sin --yes solo imprime el plan.
# Uso: restore-managed.sh --archive <mc-backup-….tar.gz> [--data-dir ~/.paperclip] [--instance default] [--include-config] [--yes] [--dry-run]
# Estado: sintaxis con `bash -n` y modo plan en Linux. NO ejecutado contra un servicio launchd/systemd real. Los .mjs que invoca SÍ se probaron en Linux (docs/evidencias/restauracion-lab.md).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
DATA_DIR="${PAPERCLIP_HOME:-$HOME/.paperclip}"; INSTANCE="default"; ARCHIVE=""; INCLUDE_CONFIG=0; YES=0; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --archive) ARCHIVE="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --instance) INSTANCE="$2"; shift 2 ;;
    --include-config) INCLUDE_CONFIG=1; shift ;;
    --yes|-y) YES=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,11p "$0"; exit 0 ;;
    *) echo "ERROR: opción desconocida: $1" >&2; exit 1 ;;
  esac
done
[ -n "$ARCHIVE" ] || { echo "ERROR: falta --archive" >&2; exit 1; }
[ -n "$NODE_BIN" ] || { echo "ERROR: falta node (>= 24.11)" >&2; exit 1; }
EXEC=1; if [ "$YES" != 1 ] || [ "$DRY" = 1 ]; then EXEC=0; fi
say() { printf '== %s\n' "$*"; }
run() { printf '+ %s\n' "$*"; if [ "$EXEC" = 1 ]; then "$@"; fi; }
INST="$DATA_DIR/instances/$INSTANCE"
[ "$EXEC" = 0 ] && say "MODO PLAN: no se ejecuta nada (añade --yes para ejecutar)."
say "Mission Control · restaurar Paperclip (instancia $INSTANCE en $DATA_DIR)"

export PATH="$HOME/.local/bin:$PATH"
run paperclipai service stop
FILES=("$NODE_BIN" "$ROOT/scripts/common/restore-files.mjs" --archive "$ARCHIVE" --data-dir "$DATA_DIR" --instance "$INSTANCE" --yes)
[ "$INCLUDE_CONFIG" = 1 ] && FILES+=(--include-config)
run "${FILES[@]}"
run paperclipai service start

detect_pg_port() {
  # 1) proceso postgres embebido: "postgres -D <inst>/db -p PUERTO"  (el puerto real puede ser 54330… si 54329 estaba ocupado)
  local p
  p="$(ps -ax -o command= 2>/dev/null | grep -F "postgres -D $INST/db" | grep -v grep | sed -n 's/.* -p \([0-9][0-9]*\).*/\1/p' | head -1 || true)"
  [ -z "$p" ] && p="$(grep -h -o 'pg:[0-9]*' "$INST/logs/service.log" 2>/dev/null | tail -1 | cut -d: -f2 || true)"
  [ -z "$p" ] && p="$(sed -n 's/.*"embeddedPostgresPort": *\([0-9]*\).*/\1/p' "$INST/config.json" 2>/dev/null | head -1 || true)"
  printf '%s' "${p:-54329}"
}
DUMP=""
if [ "$EXEC" = 1 ]; then
  say "Esperando a que el Postgres embebido esté listo (hasta 90 s)…"
  PORT="54329"
  for _ in $(seq 1 45); do
    sleep 2
    PORT="$(detect_pg_port)"
    if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then break; fi
  done
  DUMP="$(ls -t "$INST"/data/backups/*.sql.gz 2>/dev/null | head -1)"
  say "Puerto PG detectado: $PORT · volcado: $DUMP"
else
  PORT="54329"; DUMP="<volcado en $INST/data/backups/>"
  say "(plan) el puerto real del Postgres se detecta del proceso 'postgres -D $INST/db -p N'"
fi
run "$NODE_BIN" "$ROOT/scripts/common/restore-db.mjs" --dump "$DUMP" --db-url "postgres://paperclip:paperclip@127.0.0.1:${PORT}/paperclip" --yes
run paperclipai service restart
if [ "$EXEC" = 1 ]; then sleep 15; fi
APIPORT="$( [ -f "$INST/runtime-info.json" ] && sed -n 's/.*"port": *\([0-9]*\).*/\1/p' "$INST/runtime-info.json" | head -1 || true )"
run "$NODE_BIN" "$ROOT/scripts/common/verify-restore.mjs" --api "http://127.0.0.1:${APIPORT:-3100}/api" \
  --db-url "postgres://paperclip:paperclip@127.0.0.1:${PORT}/paperclip" --master-key-file "$INST/secrets/master.key"
