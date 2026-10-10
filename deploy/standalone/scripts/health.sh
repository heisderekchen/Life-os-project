#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$here"
docker compose ps
docker compose exec -T life-os sh -c \
  'curl -fsS http://127.0.0.1:3000/internal/health >/dev/null'
echo "Private Life OS Node adapter and SQLite runtime are healthy."
