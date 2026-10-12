#!/usr/bin/env bash
set -Eeuo pipefail

die() { printf 'Life OS deploy: %s\n' "$*" >&2; exit 1; }

if [[ $# != 4 ]]; then
  die 'usage: deploy-node-release.sh COMMIT_SHA PACKAGE_SHA256 SYSTEMD_UNIT HEALTH_URL (bundle on stdin)'
fi
commit=$1
package_sha=$2
unit=$3
health_url=$4
[[ $commit =~ ^[a-f0-9]{40}$ ]] || die 'invalid commit SHA'
[[ $package_sha =~ ^[a-f0-9]{64}$ ]] || die 'invalid package SHA-256'
[[ $unit =~ ^[A-Za-z0-9_.@-]+$ ]] || die 'invalid systemd unit'
[[ $health_url =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?/[A-Za-z0-9._~/-]*$ ]] || die 'invalid health URL'

if [[ -n ${LIFEOS_TEST_ROOT:-} ]]; then
  [[ $EUID != 0 ]] || die 'test root is only allowed for non-root tests'
  test_root=$(cd "$LIFEOS_TEST_ROOT" && pwd)
  lifeos_root="$test_root/opt/lifeos"
  data_root="$test_root/var/lib/lifeos"
  config_root="$test_root/etc/lifeos"
  lock_root="$test_root/run/lock"
else
  [[ $EUID == 0 ]] || die 'run through the preinstalled root-owned deployment helper'
  lifeos_root=/opt/lifeos
  data_root=/var/lib/lifeos
  config_root=/etc/lifeos
  lock_root=/run/lock
fi
release_root="$lifeos_root/releases"
current_link="$lifeos_root/current"

[[ -d $release_root && ! -L $release_root ]] || die 'release directory is missing or is a symlink'
[[ -L $current_link ]] || die 'current must be the existing release symlink'
previous_release=$(readlink -f "$current_link")
[[ -d $previous_release && $previous_release == "$release_root"/* ]] || die 'current does not point to a release directory'
[[ -f $data_root/lifeos.db ]] || die 'persistent database is missing; refusing first-run initialization'
[[ -d $config_root && -x $config_root/run-node.sh ]] || die 'existing /etc/lifeos/run-node.sh configuration is missing'

exec 9>"$lock_root/lifeos-deploy.lock"
flock -n 9 || die 'another release operation is already running'
exec_start=$(systemctl show "$unit" --property=ExecStart --value) || die 'could not inspect the configured systemd unit'
[[ $exec_start == *"$config_root/run-node.sh"* ]] || die 'systemd unit does not use the existing /etc/lifeos/run-node.sh launcher'

staging=''
switch_dir=''
activated=0
rollback_attempted=0
atomic_switch() {
  local target=$1
  switch_dir=$(mktemp -d "$lifeos_root/.current-switch.XXXXXX")
  ln -s "$target" "$switch_dir/current"
  mv -Tf "$switch_dir/current" "$current_link"
  rmdir "$switch_dir"
  switch_dir=''
}
wait_for_health() {
  local try
  for try in {1..30}; do
    if curl --fail --silent --show-error --max-time 5 "$health_url" >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}
rollback() {
  rollback_attempted=1
  atomic_switch "$previous_release" || { printf 'Rollback could not restore current symlink.\n' >&2; return 1; }
  if ! systemctl restart "$unit"; then
    printf 'Rollback restored the symlink, but systemd restart failed.\n' >&2
    return 1
  fi
  if ! wait_for_health; then
    printf 'Rollback restored the symlink, but the old release did not pass health.\n' >&2
    return 1
  fi
  activated=0
  printf 'Rolled back to %s\n' "$previous_release" >&2
}
cleanup() {
  local status=$?
  trap - EXIT
  if (( activated && ! rollback_attempted )); then rollback || true; fi
  [[ -z $staging ]] || rm -rf -- "$staging"
  [[ -z $switch_dir ]] || rm -rf -- "$switch_dir"
  exit "$status"
}
trap cleanup EXIT

staging=$(mktemp -d "$release_root/.incoming-${commit}.XXXXXX")
archive="$staging/bundle.tar.gz"
cat > "$archive"
actual_sha=$(sha256sum "$archive" | cut -d' ' -f1)
[[ $actual_sha == "$package_sha" ]] || die 'bundle hash does not match the verified workflow package'
archive_listing=$(tar -tzf "$archive") || die 'bundle is not a readable tar archive'
while IFS= read -r member; do
  case "$member" in
    /*|..|../*|*/../*|*/..) die 'bundle contains a path outside the release directory' ;;
  esac
done <<< "$archive_listing"
mkdir "$staging/unpacked"
tar -xzf "$archive" -C "$staging/unpacked" --no-same-owner --no-same-permissions
bundle_root="$staging/unpacked"
[[ -f $bundle_root/VERSION && -f $bundle_root/MANIFEST.sha256 ]] || die 'bundle is missing its commit or file manifest'
grep -qx "source_commit=$commit" "$bundle_root/VERSION" || die 'bundle source commit does not match the deployment commit'
(cd "$bundle_root" && sha256sum -c MANIFEST.sha256)

release="$release_root/$commit"
if [[ -e $release ]]; then
  [[ -d $release && ! -L $release && -f $release/MANIFEST.sha256 ]] || die 'release path already exists with an unexpected type'
  cmp -s "$bundle_root/MANIFEST.sha256" "$release/MANIFEST.sha256" || die 'existing release content differs for this commit'
else
  mv "$bundle_root" "$release"
fi
rm -f "$archive"
activated=1
atomic_switch "$release"
systemctl restart "$unit" || die 'new release failed to restart; reverting current symlink'
wait_for_health || die 'new release failed health check; reverting current symlink'
activated=0

# Keep five full-SHA releases and the previous target; the legacy short-SHA release is never pruned.
mapfile -t releases < <(find "$release_root" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended -regex '.*/[a-f0-9]{40}' -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
kept=0
for old_release in "${releases[@]}"; do
  if [[ $old_release == "$release" || $old_release == "$previous_release" ]]; then continue; fi
  kept=$((kept + 1))
  if (( kept > 4 )) && [[ $old_release == "$release_root"/* && $(basename "$old_release") =~ ^[a-f0-9]{40}$ ]]; then
    rm -rf -- "$old_release" || printf 'Could not prune old release %s\n' "$old_release" >&2
  fi
done
printf 'Activated %s; previous release retained at %s\n' "$commit" "$previous_release"
