#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$here"
docker compose ps
docker compose exec -T life-os node -e \
  'fetch("http://127.0.0.1:3000/internal/health").then(async r => { const body = await r.json(); if (!r.ok || body.ok !== true) process.exitCode = 1; console.log(JSON.stringify(body)); }).catch(() => { console.error("Private Life OS health check failed."); process.exitCode = 1; })'
