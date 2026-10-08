#!/usr/bin/env bash
# Mission Control — actualizar / revertir Paperclip en macOS: delega en scripts/common/update-managed.sh (mismos argumentos).
# Uso: update.sh --check | --to <versión exacta> --yes | --rollback --yes   [--dry-run]
# Estado: sintaxis con `bash -n`. NO ejecutado en macOS.
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../common/update-managed.sh" "$@"
