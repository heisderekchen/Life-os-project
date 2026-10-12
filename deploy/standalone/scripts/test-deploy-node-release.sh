#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fake_bin="$tmp/bin"
mkdir -p "$fake_bin"

cat > "$fake_bin/systemctl" <<'EOF'
#!/bin/sh
if [ "$1" = show ]; then echo "$TEST_ROOT/etc/lifeos/run-node.sh"; exit 0; fi
printf '%s\n' "$*" >> "$TEST_ROOT/systemctl.log"
EOF
cat > "$fake_bin/curl" <<'EOF'
#!/bin/sh
current=$(readlink -f "$TEST_ROOT/opt/lifeos/current")
if [ "${FAIL_NEW_HEALTH:-}" = yes ] && [ "$current" = "$TEST_ROOT/opt/lifeos/releases/$TEST_NEW_COMMIT" ]; then exit 22; fi
exit 0
EOF
cat > "$fake_bin/sleep" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$fake_bin"/*

make_state() {
  local root=$1
  mkdir -p "$root/opt/lifeos/releases/7cb2c14" "$root/var/lib/lifeos" "$root/etc/lifeos" "$root/run/lock"
  printf 'previous release\n' > "$root/opt/lifeos/releases/7cb2c14/VERSION"
  ln -s "$root/opt/lifeos/releases/7cb2c14" "$root/opt/lifeos/current"
  printf 'persistent user data\n' > "$root/var/lib/lifeos/lifeos.db"
  printf '# existing launcher; preserved\n' > "$root/etc/lifeos/run-node.sh"
  chmod +x "$root/etc/lifeos/run-node.sh"
}

make_bundle() {
  local commit=$1
  local bundle_dir="$tmp/package-$commit"
  mkdir -p "$bundle_dir/deploy/standalone/scripts" "$bundle_dir/.next/static" "$bundle_dir/public"
  printf 'source_commit=%s\nnode_version=v24.0.0\ncreated_utc=2026-01-01T00:00:00Z\n' "$commit" > "$bundle_dir/VERSION"
  printf 'synthetic app\n' > "$bundle_dir/server.js"
  printf '#!/bin/sh\n' > "$bundle_dir/deploy/standalone/scripts/run-node.sh"
  printf 'static asset\n' > "$bundle_dir/.next/static/test.js"
  printf 'public asset\n' > "$bundle_dir/public/test.txt"
  (cd "$bundle_dir" && find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 sha256sum > MANIFEST.sha256)
  tar -C "$bundle_dir" -czf "$tmp/$commit.tar.gz" .
  sha256sum "$tmp/$commit.tar.gz" | cut -d' ' -f1
}

run_deploy() {
  local root=$1 commit=$2 checksum=$3 archive=$4
  TEST_ROOT="$root" TEST_NEW_COMMIT="$commit" LIFEOS_TEST_ROOT="$root" PATH="$fake_bin:$PATH" \
    bash -c 'cat "$1" | "$2" "$3" "$4" example.service http://127.0.0.1:3000/internal/health' \
    _ "$archive" "$repo_root/deploy/standalone/scripts/deploy-node-release.sh" "$commit" "$checksum"
}

good_root="$tmp/good"
make_state "$good_root"
db_before=$(sha256sum "$good_root/var/lib/lifeos/lifeos.db" | cut -d' ' -f1)
config_before=$(sha256sum "$good_root/etc/lifeos/run-node.sh" | cut -d' ' -f1)
good_commit=1111111111111111111111111111111111111111
good_hash=$(make_bundle "$good_commit")
run_deploy "$good_root" "$good_commit" "$good_hash" "$tmp/$good_commit.tar.gz"
[[ $(readlink -f "$good_root/opt/lifeos/current") == "$good_root/opt/lifeos/releases/$good_commit" ]]
[[ -d "$good_root/opt/lifeos/releases/7cb2c14" ]]
[[ $(sha256sum "$good_root/var/lib/lifeos/lifeos.db" | cut -d' ' -f1) == "$db_before" ]]
[[ $(sha256sum "$good_root/etc/lifeos/run-node.sh" | cut -d' ' -f1) == "$config_before" ]]

rollback_root="$tmp/rollback"
make_state "$rollback_root"
rollback_commit=2222222222222222222222222222222222222222
rollback_hash=$(make_bundle "$rollback_commit")
if env TEST_ROOT="$rollback_root" TEST_NEW_COMMIT="$rollback_commit" FAIL_NEW_HEALTH=yes LIFEOS_TEST_ROOT="$rollback_root" PATH="$fake_bin:$PATH" \
  bash -c 'cat "$1" | "$2" "$3" "$4" example.service http://127.0.0.1:3000/internal/health' \
  _ "$tmp/$rollback_commit.tar.gz" "$repo_root/deploy/standalone/scripts/deploy-node-release.sh" "$rollback_commit" "$rollback_hash"; then
  echo 'expected the unhealthy release to fail and roll back' >&2
  exit 1
fi
[[ $(readlink -f "$rollback_root/opt/lifeos/current") == "$rollback_root/opt/lifeos/releases/7cb2c14" ]]
[[ -d "$rollback_root/opt/lifeos/releases/$rollback_commit" ]]
[[ $(grep -c '^restart example.service$' "$rollback_root/systemctl.log") == 2 ]]

bad_hash_root="$tmp/bad-hash"
make_state "$bad_hash_root"
if run_deploy "$bad_hash_root" "$good_commit" "$(printf '0%.0s' {1..64})" "$tmp/$good_commit.tar.gz"; then
  echo 'expected a package checksum mismatch to be rejected' >&2
  exit 1
fi
[[ $(readlink -f "$bad_hash_root/opt/lifeos/current") == "$bad_hash_root/opt/lifeos/releases/7cb2c14" ]]

echo 'deploy release checks passed: commit/hash validation, data/config preservation, atomic activation, and health-failure rollback'
