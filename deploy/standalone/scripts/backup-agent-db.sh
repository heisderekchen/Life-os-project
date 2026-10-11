#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$here"
if [ "$#" -ne 1 ]; then echo "Usage: $0 /absolute/path/to/backup-directory" >&2; exit 2; fi
backup_dir=$(mkdir -p "$1" && cd "$1" && pwd)
name="lifeos-agent-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose --profile ai exec -T agent-db pg_dump -U lifeos_agent -d lifeos_agent -Fc > "$backup_dir/$name"
test -s "$backup_dir/$name"
sha256sum "$backup_dir/$name" > "$backup_dir/$name.sha256"
echo "Created and checksummed $backup_dir/$name"
