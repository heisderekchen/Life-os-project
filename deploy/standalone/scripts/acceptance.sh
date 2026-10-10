#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$here"
"$here/scripts/health.sh"
runtime_health=$(docker compose exec -T life-os node -e \
  'fetch("http://127.0.0.1:3000/internal/health").then(r => r.json()).then(body => console.log(JSON.stringify(body)))')
case "$runtime_health" in
  *'"recurrenceEnabled":false'*) ;;
  *) echo "Keep LIFEOS_RECURRENCE_ENABLED=false until initial data acceptance is complete." >&2; exit 1 ;;
esac
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
workbench_status=$(curl -sS -o /dev/null -w '%{http_code}' "https://$domain/workbench/")
if [ "$workbench_status" != "200" ]; then
  echo "Expected the private login page at /workbench/ (200), received $workbench_status" >&2
  exit 1
fi
api_status=$(curl -sS -o /dev/null -w '%{http_code}' "https://$domain/workbench/api/app-state")
if [ "$api_status" != "404" ]; then
  echo "Expected unauthenticated private API to return 404, received $api_status" >&2
  exit 1
fi
echo "Private login shell is reachable; recurrence is off; unauthenticated Life OS API returns 404."
echo "Manual acceptance: sign in with the existing private-workbench entry key, create a project/task, refresh, and confirm persistence before migration cutover."
