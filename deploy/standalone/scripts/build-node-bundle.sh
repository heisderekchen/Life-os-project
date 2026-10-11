#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then
  echo "Usage: build-node-bundle.sh /path/to/lifeos-node-bundle.tar.gz" >&2
  exit 2
fi
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
archive=$1
archive_dir=$(dirname -- "$archive")
mkdir -p "$archive_dir"
if [ -e "$archive" ] || [ -e "$archive.sha256" ]; then
  echo "Refusing to overwrite an existing bundle or checksum: $archive" >&2
  exit 1
fi
if [ ! -f "$repo/.next/standalone/server.js" ] || [ ! -d "$repo/.next/static" ]; then
  echo "Build Next.js first; expected .next/standalone/server.js and .next/static." >&2
  exit 1
fi
staging=$(mktemp -d "$archive_dir/.lifeos-node-bundle.XXXXXX")
tmp_archive="$archive.tmp.$$"
cleanup() { rm -rf "$staging" "$tmp_archive"; }
trap cleanup EXIT HUP INT TERM
cp -a "$repo/.next/standalone/." "$staging/"
mkdir -p "$staging/.next/static" "$staging/public" "$staging/deploy/standalone"
cp -a "$repo/.next/static/." "$staging/.next/static/"
cp -a "$repo/public/." "$staging/public/"
cp -a "$repo/deploy/standalone/." "$staging/deploy/standalone/"
cat > "$staging/VERSION" <<EOF
source_commit=$(git -C "$repo" rev-parse HEAD)
node_version=$(node --version)
created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
cat > "$staging/README-NODE.md" <<'EOF'
# Life OS Node 24 bundle

This archive contains the Next.js standalone build and isolated Node/SQLite
API runtime. It excludes user data, secrets, D1 exports, Docker, and the
optional AI service. Keep `LIFEOS_RECURRENCE_ENABLED=false` during first
acceptance. For a synthetic local check, run
`sh deploy/standalone/scripts/loopback-acceptance.sh` after extraction. For
service operation behind an already trusted HTTPS reverse proxy, set the
required environment variables and run
`sh deploy/standalone/scripts/run-node.sh`; its default listener binds only to
127.0.0.1.

Verify `MANIFEST.sha256` with `sha256sum -c MANIFEST.sha256` before running.
EOF
(
  cd "$staging"
  find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 sha256sum > MANIFEST.sha256
)
tar -C "$staging" -czf "$tmp_archive" .
mv "$tmp_archive" "$archive"
(
  cd "$archive_dir"
  sha256sum "$(basename -- "$archive")" > "$(basename -- "$archive").sha256"
)
echo "Built $archive"
cat "$archive.sha256"
