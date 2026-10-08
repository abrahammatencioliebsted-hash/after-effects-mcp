#!/usr/bin/env bash
# Mission Control — restaurar Paperclip en macOS: delega en scripts/common/restore-managed.sh (mismos argumentos).
# Uso: restore.sh --archive <mc-backup-….tar.gz> [--data-dir ~/.paperclip] [--instance default] [--include-config] [--yes] [--dry-run]
# Estado: sintaxis con `bash -n`. NO ejecutado en macOS.
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../common/restore-managed.sh" "$@"
