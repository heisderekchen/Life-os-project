#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$here"
"$here/scripts/health.sh"
domain=${LIFEOS_DOMAIN:-$(sed -n 's/^LIFEOS_DOMAIN=//p' .env | head -n 1)}
if [ -z "$domain" ]; then
  echo "Set LIFEOS_DOMAIN in .env before running gateway acceptance." >&2
  exit 2
fi
status=$(curl -sS -o /dev/null -w '%{http_code}' "https://$domain/")
if [ "$status" != "200" ]; then
  echo "Expected private login shell (200), received $status" >&2
  exit 1
fi
api_status=$(curl -sS -o /dev/null -w '%{http_code}' "https://$domain/workbench/api/app-state")
if [ "$api_status" != "404" ]; then
  echo "Expected unauthenticated private API to return 404, received $api_status" >&2
  exit 1
fi
echo "Private login shell is reachable; unauthenticated Life OS API returns 404."
echo "Manual acceptance: sign in with the existing private-workbench entry key, create a project/task, refresh, and confirm persistence before migration cutover."
