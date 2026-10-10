#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$here"
if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /absolute/path/to/backup-directory" >&2
  exit 2
fi
backup_dir=$(mkdir -p "$1" && cd "$1" && pwd)
name="lifeos-$(date -u +%Y%m%dT%H%M%SZ).db"
docker compose stop life-os
restart_app() { docker compose start life-os >/dev/null 2>&1 || true; }
trap restart_app EXIT
docker compose run --rm -v "$backup_dir:/out" db-tools \
  /scripts/sqlite-tools.py backup /data/lifeos.db "/out/$name"
