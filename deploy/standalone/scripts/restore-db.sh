#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$here"
if [ "${LIFEOS_RESTORE_CONFIRM:-}" != "YES" ]; then
  echo "Set LIFEOS_RESTORE_CONFIRM=YES to authorize a database restore." >&2
  exit 2
fi
if [ "$#" -ne 2 ] || [ ! -f "$1" ]; then
  echo "Usage: LIFEOS_RESTORE_CONFIRM=YES $0 /absolute/path/backup.db /absolute/path/safety-backups" >&2
  exit 2
fi
source_dir=$(CDPATH= cd -- "$(dirname -- "$1")" && pwd)
name=$(basename -- "$1")
safety_dir=$(mkdir -p "$2" && cd "$2" && pwd)
docker compose stop life-os
restart_app() { docker compose start life-os >/dev/null 2>&1 || true; }
trap restart_app EXIT
docker compose run --rm -v "$source_dir:/restore:ro" -v "$safety_dir:/safety" db-tools \
  /scripts/sqlite-tools.py restore /data/lifeos.db "/restore/$name" /safety
