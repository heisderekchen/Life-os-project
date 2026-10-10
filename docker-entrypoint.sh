#!/bin/sh
set -eu
mkdir -p /app/data
echo "Starting the isolated Life OS Node/SQLite runtime"
exec node /app/deploy/standalone/server.mjs
