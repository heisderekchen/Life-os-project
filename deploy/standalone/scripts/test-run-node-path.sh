#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/lifeos-run-node-path.XXXXXX")
cleanup() {
  rm -rf "$tmp"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$tmp/bin" "$tmp/caller"
cat >"$tmp/bin/node" <<'EOF'
#!/bin/sh
printf '%s\n' "$NEXT_ROOT" "$1" >"$TEST_CAPTURE_PATH"
EOF
chmod +x "$tmp/bin/node"

(
  cd "$tmp/caller"
  PATH="$tmp/bin:$PATH" \
  TEST_CAPTURE_PATH="$tmp/capture" \
  LIFEOS_DATA_DIR="$tmp/data" \
  LIFEOS_PUBLIC_ORIGIN=https://lifeos.example.invalid \
  TRUSTED_PROXY_IP=127.0.0.1 \
  AUTH_SECRET=test-only-auth-secret \
  PERSONAL_WORKBENCH_ENTRY_KEY=test-only-entry-key \
    sh "$script_dir/run-node.sh"
)

expected_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
expected_server="$script_dir/../server.mjs"
expected_server=$(CDPATH= cd -- "$(dirname -- "$expected_server")" && pwd)/$(basename -- "$expected_server")
expected=$(printf '%s\n%s' "$expected_root" "$expected_server")
actual=$(cat "$tmp/capture")
if [ "$actual" != "$expected" ]; then
  printf 'run-node path mismatch\nExpected:\n%s\nActual:\n%s\n' "$expected" "$actual" >&2
  exit 1
fi

printf 'run-node launcher resolved bundle paths correctly from an unrelated working directory.\n'
