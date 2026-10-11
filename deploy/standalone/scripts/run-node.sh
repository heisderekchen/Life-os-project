#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
bundle_root=$(CDPATH= cd -- "$here/../.." && pwd)
: "${LIFEOS_DATA_DIR:?Set LIFEOS_DATA_DIR to a private persistent directory}"
: "${LIFEOS_PUBLIC_ORIGIN:?Set LIFEOS_PUBLIC_ORIGIN to the HTTPS origin used by the trusted reverse proxy}"
: "${TRUSTED_PROXY_IP:?Set TRUSTED_PROXY_IP to the exact private address of the trusted reverse proxy}"
: "${AUTH_SECRET:?Supply the existing private session signing secret}"
: "${PERSONAL_WORKBENCH_ENTRY_KEY:?Supply the existing private-workbench entry key}"
mkdir -p "$LIFEOS_DATA_DIR"
export DATABASE_URL="file:$LIFEOS_DATA_DIR/lifeos.db"
export NEXT_ROOT="${NEXT_ROOT:-$bundle_root}"
export LIFEOS_LISTEN_HOST="${LIFEOS_LISTEN_HOST:-127.0.0.1}"
export LIFEOS_RECURRENCE_ENABLED="${LIFEOS_RECURRENCE_ENABLED:-false}"
exec node "$here/server.mjs"
