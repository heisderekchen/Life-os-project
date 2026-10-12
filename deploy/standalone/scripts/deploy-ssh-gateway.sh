#!/usr/bin/env bash
set -Eeuo pipefail

# Install as a root-owned forced-command target for the dedicated deploy key.
# SSH_ORIGINAL_COMMAND is intentionally limited to the exact workflow command
# shape; stdin remains the verified release archive.
command=${SSH_ORIGINAL_COMMAND:-}
pattern='^sudo -n /usr/local/sbin/lifeos-deploy-release ([a-f0-9]{40}) ([a-f0-9]{64}) ([A-Za-z0-9_.@-]+) (http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?/[A-Za-z0-9._~/-]*)$'
[[ $command =~ $pattern ]] || { printf 'Life OS SSH gateway: command rejected\n' >&2; exit 1; }

exec /usr/bin/sudo -n /usr/local/sbin/lifeos-deploy-release \
  "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[4]}"
