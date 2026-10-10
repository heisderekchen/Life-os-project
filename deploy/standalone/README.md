# Private standalone deployment

This deployment packages the current HappySpa Life OS frontend and the
personal-workbench API module in this folder. It does not proxy page/API traffic
through the HappySpa Worker and does not connect to D1. Only the authenticated
35-collection Life OS export can be imported.

## Runtime and boundaries

- Caddy owns HTTPS ports 80/443 and forwards traffic to the app container.
- The Node adapter verifies the existing `happyspa_personal_workbench` signed
  cookie and keeps the existing `/workbench` route, entry-key exchange, eight
  hour expiry, key-version invalidation and `Secure; HttpOnly; SameSite=Strict`
  cookie properties.
- `/workbench/api/*` maps to the extracted current private Life OS handlers;
  `/projects` uses the compatibility endpoint and `/analytics` maps to
  `/insights`. The handlers run against an SQLite adapter implementing D1's
  `prepare/bind/first/all/run/batch` calls.
- SQLite migrations 0070–0091 contain only private-workbench/Life OS tables,
  including source project IDs, workspace layout, owner credential state,
  audit tables and the recurring-task idempotency ledger. No store schema or
  `config` table is created.
- The app container publishes no host port. Caddy is the only public container.
  The application refuses to start without `AUTH_SECRET` and
  `PERSONAL_WORKBENCH_ENTRY_KEY`.

## Build

Build the `linux/amd64` image on GitHub Actions or a sufficiently large build
host. The 2 GiB ECS should run the prebuilt image only.

```sh
docker buildx build --platform linux/amd64 --load \
  -f Dockerfile --build-arg LIFEOS_BASE_PATH=/workbench \
  -t lifeos-standalone:local .
```

Copy `.env.example` to `.env` on the server and supply `LIFEOS_DOMAIN`,
`AUTH_SECRET`, and `PERSONAL_WORKBENCH_ENTRY_KEY` from the approved private
secret source. Keep these values and any data exports outside the public repo.
Set DNS and allow ports 80/443 through the normal deployment process. Then run
`docker compose up -d` in this directory. Caddy provisions HTTPS; the app and
SQLite database remain private to the compose network.

## Data migration and recovery

Export from the authenticated current endpoint
`/api/personal-workbench/lifeos/data/export` to a private encrypted location.
After first startup applies the isolated schema, run
`./scripts/import-happyspa-export.sh /absolute/path/export.json`.

The importer requires all 35 export arrays and no unknown fields, preserves
ISO date strings and source project IDs, remaps task/project references,
checks per-table counts and foreign keys, and commits atomically. It excludes
owner credentials, sessions, audit logs, recurrence execution history, and
generic checkpoint data; these are intentionally outside the current export
contract. It also excludes all HappySpa store data. A non-empty target is
refused. The importer prints per-collection counts for comparison with the
source export.

Use `scripts/backup.sh`, `scripts/verify-backup.sh` and the guarded
`scripts/restore-db.sh` for separate private backups and recovery. The restore
requires `LIFEOS_RESTORE_CONFIRM=YES`, validates its source, saves a verified
pre-restore copy, and atomically replaces the SQLite file while the app is
stopped.

## Offline verification

```sh
node scripts/test-runtime.mjs
python3 scripts/test-sqlite-tools.py
```

These verify schema migration, session signature/expiry/key-version checks,
app-state optimistic concurrency, project/task persistence, current export
import/count/FK checks, and backup/restore behavior. A container build, real
HTTPS browser run, real export comparison, and ECS memory measurement remain
deployment acceptance gates.

The separate AI agent service still needs PostgreSQL, provider secrets/pricing,
an authenticated HMAC bridge, and an approved task trigger. It is not wired by
this runtime and must not be presented as available until those steps are
completed.
