# Life OS

Life OS is a private, local-first personal workspace for tasks, projects,
notes, habits, journal, finance, goals, learning, calendar, and time tracking.
The HappySpa-hosted version has additional project continuity, cross-device
preferences, Chinese localization, safer rich-text handling, recurring task
processing, and a private API/data model. This repository carries that current
frontend and its private-workbench API adapter without HappySpa store services.

## Standalone runtime

The isolated runtime keeps the current `/workbench` URL and API contract. Caddy
terminates HTTPS; a Node 24-compatible adapter verifies the existing
`happyspa_personal_workbench` session cookie, maps `/workbench/api/*` to the
private Life OS handler, and serves Next.js assets only after authentication.
The API/adapter stores data in a dedicated SQLite database. It does not call
the HappySpa Worker or D1 database.

```text
Browser ─HTTPS─> Caddy ─> Node private-session/API adapter ─> Next.js UI
                                             └────────────> SQLite
```

The SQLite runtime applies the isolated Life OS schema from migrations 0070 to
0091. It does not apply HappySpa store migrations or read customer, order,
payment, member, staff, or store configuration tables. A small SQLite adapter
preserves the current Worker's `prepare/bind/first/all/run/batch` API semantics
so current app handlers and data shape remain intact. Projects use the current
compatibility route, analytics maps to insights, and the recurrence ledger is
retained for idempotent recurring-task generation.

## Build and run

Build the `linux/amd64` image on a machine with Docker Buildx and enough memory
for the Next.js build. The 2 GiB ECS should run the prebuilt image. Do not run
Rust/Next compilation on the ECS. The runtime uses Node 22's SQLite module and
the system SQLite library; no Rust process or PostgreSQL service is required
for the Life OS modules in this deployment.

1. Copy `deploy/standalone/.env.example` to `.env` on the server.
2. Set `LIFEOS_DOMAIN` to the chosen dedicated hostname.
3. Set `AUTH_SECRET` and `PERSONAL_WORKBENCH_ENTRY_KEY` using the approved
   private-workbench secret source. These values must not be committed or sent
   in chat. The server refuses to start if either is missing.
4. Build outside the ECS and transfer the image plus this directory through the
   approved deployment path. Then load the image and run `docker compose up -d`
   in `deploy/standalone/`.

Caddy publishes ports 80 and 443 for HTTPS certificate provisioning. The
standalone app and database have no host-published ports. The private login
accepts the existing workbench entry key and issues the existing cookie name,
scope, key-version check, Secure/HttpOnly/SameSite=Strict attributes, and
eight-hour lifetime. Keep the secrets in server-side configuration only.

## Migrate current private Life OS data

Sign in to the current private workbench and download the authenticated
`/api/personal-workbench/lifeos/data/export` JSON to a private local directory.
Do not commit or upload the export to a public repository. Start the standalone
stack once to apply migrations, then stop the app and run:

```sh
./scripts/import-happyspa-export.sh /absolute/path/private-lifeos-export.json
```

The importer requires exactly the 35 current export collections. It validates
fields against the target schema, preserves ISO date strings, maps stable
project IDs and task/project relations, compares per-collection row counts,
checks foreign keys, and rolls back on failure. It refuses a non-empty target.
It imports user Life OS data only. Owner credentials, auth/session state, audit
history, recurrence execution ledger, generic workbench checkpoints, and all
HappySpa store/business tables are deliberately excluded and must be recreated
under the isolated service boundary.

Use the scripts for separate encrypted backups and explicit-confirmation
restore. Do not delete or modify the source D1 data until the target rows,
relationships, browser flows, and backup/restore have been checked.

## Validation and scope

The offline runtime test covers the 0070–0091 migrations, authenticated-session
signature/expiry/key rotation rules, app-state optimistic concurrency, project
and task create/read persistence, private export/import row counts, and foreign
keys. Deployment acceptance still requires an image build, end-to-end HTTPS
browser checks, real export counts, and restore rehearsal on the prepared ECS.

The separate `agent-service` is not yet integrated by this standalone adapter.
It requires its PostgreSQL schema, provider secrets/pricing, authenticated
Life OS bridge, and an explicitly configured approved-run trigger. Until those
are supplied and tested, the UI must not imply AI execution is available.
