#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$here"
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Usage: $0 /absolute/path/to/backup.db" >&2
  exit 2
fi
source_dir=$(CDPATH= cd -- "$(dirname -- "$1")" && pwd)
name=$(basename -- "$1")
docker compose run --rm -v "$source_dir:/backup:ro" db-tools \
  /scripts/sqlite-tools.py verify "/backup/$name"
