#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$here"
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Usage: $0 /absolute/path/to/private-lifeos-export.json" >&2
  exit 2
fi
source_dir=$(CDPATH= cd -- "$(dirname -- "$1")" && pwd)
name=$(basename -- "$1")
docker compose stop life-os
restart_app() { docker compose start life-os >/dev/null 2>&1 || true; }
trap restart_app EXIT
docker compose run --rm -v "$source_dir:/migration:ro" db-tools \
  /scripts/import-current-export.py /data/lifeos.db "/migration/$name"
