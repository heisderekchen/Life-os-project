#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$here"
if [ "${LIFEOS_AGENT_RESTORE_CONFIRM:-}" != "YES" ]; then echo "Set LIFEOS_AGENT_RESTORE_CONFIRM=YES to authorize restore." >&2; exit 2; fi
if [ "$#" -ne 1 ] || [ ! -f "$1" ] || [ ! -f "$1.sha256" ]; then echo "Usage: LIFEOS_AGENT_RESTORE_CONFIRM=YES $0 /absolute/path/backup.dump (with .sha256)" >&2; exit 2; fi
backup=$(CDPATH= cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")
(cd "$(dirname -- "$backup")" && sha256sum -c "$(basename -- "$backup").sha256")
docker compose --profile ai stop agent-service agent-worker
restart() { docker compose --profile ai start agent-service agent-worker >/dev/null 2>&1 || true; }
trap restart EXIT
docker compose --profile ai exec -T agent-db pg_restore --clean --if-exists -U lifeos_agent -d lifeos_agent < "$backup"
