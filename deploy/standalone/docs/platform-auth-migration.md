# Unified login and platform-admin migration

This note covers the first-version unified login at the HappySpa domain plus the
platform-admin workbench. It is an incremental, additive change on top of the
existing private Life OS deployment. No production secret is included here, and
no account, key, or grant is created by this document.

## What changes

- A unified account login shell replaces the single entry-key form as the
  primary sign-in (`username` + `password`, mobile responsive, no self-signup).
- New identity/authority tables: `platform_accounts`, `platform_workspaces`,
  `platform_account_workspaces`, `platform_auth_audit` (migration `0092`) and
  `platform_token_revocations` (migration `0093`).
- Independent immutable security principals: `platform_accounts.account_id`
  (`acct_...`) and `platform_workspaces.workspace_id` (`ws_...`). Usernames and
  slugs are mutable handles and are never used as owners.
- The legacy entry key still works, but only as account A's legacy Life OS owner
  access. It carries no platform-admin, account-management, or grant authority.

## Auth boundary versus the data export

The 40-collection Life OS export/import/reset contract is unchanged and contains
only private-workbench/Life OS tables. Account, workspace, grant, session and
audit/revocation metadata live in `platform_*` tables and are deliberately
excluded:

- `GET /api/personal-workbench/lifeos/data/export` returns exactly 40 arrays and
  never includes `platform_*` metadata.
- `POST .../data/import` and `DELETE .../data/reset` do not create, overwrite, or
  remove account/grant/audit rows.

## Applying the migration

1. Back up the database first: `scripts/backup.sh` (and `verify-backup.sh`).
2. Deploy the new build and start the service. On startup the Node adapter
   applies `0092_platform_accounts_and_workspaces.sql` and
   `0093_platform_token_revocations.sql` once (recorded in
   `lifeos_schema_migrations`) and then runs the deterministic bootstrap and a
   best-effort prune of already-expired revocation rows.
3. The migration is additive and rerunnable: every statement is
   `CREATE ... IF NOT EXISTS`, `CREATE TRIGGER IF NOT EXISTS`, or
   `INSERT OR IGNORE`. Re-running the file on an existing DB is a no-op.
4. Do not reset or re-import Life OS data for this change. No data reset is
   required or supported.

## Legacy owner mapping (account A)

The migration seeds exactly one deterministic workspace row,
`ws_lifeos_legacy` (slug `lifeos`, application target `/workbench/`). The account
row is bound at startup from configuration:

- `PERSONAL_WORKBENCH_OWNER` (default `lifeos-owner`) becomes account A's
  username, mapped to the immutable account id `acct_legacy_owner`, role
  `platform_admin`, `legacy_owner = 1`, granted `ws_lifeos_legacy`.
- Bootstrap is idempotent and password-free: it never creates a password and
  never creates account B. Keep the owner handle unique and stable.
- All existing Life OS data maps to the legacy owner only. The 40 tables are not
  retrofitted with a `workspace_id` in this version.

## Credential initialization

- Test fixtures only: automated tests initialize passwords for fixture accounts
  in test code. No fixture credential is shipped in the runtime.
- Secure formal production entry for A: the existing setup-grant flow
  (`PERSONAL_WORKBENCH_OWNER_SETUP_ENABLED` + `PERSONAL_WORKBENCH_OWNER_SETUP_GRANT`,
  `v2.<env>.<expiry>.<key>`) initializes A's password over trusted HTTPS. The
  grant is single-use and expires.
- Regular accounts: platform admin A creates a regular (non-admin) account and
  sets a password through the explicit admin endpoint, then hands off the
  credential out of band. There is no network path that creates, promotes, or
  demotes an admin.

## Workspace catalog

`ws_lifeos_legacy` is seeded by migration. Additional internal workspaces are
configurable operator metadata via `PLATFORM_WORKSPACES_JSON`, a JSON array of
`{ "id", "slug", "displayName", "configured", "applicationTarget" }`:

- `configured` defaults to `false`; an unconfigured granted workspace returns a
  safe not-configured screen/API result and no invented application.
- A configured workspace must point at an explicit local `applicationTarget`.
- Grants are managed only by platform admin A, only for regular accounts, and
  never for `ws_lifeos_legacy`.
- Ungranted workspaces return a generic denied/not-found result and do not leak
  other workspace metadata.

## Sessions and revocation

- Cookie stays `Secure; HttpOnly; SameSite=Strict` with `no-store` and an eight
  hour lifetime. Both session types have logout.
- Account sessions carry only the account id, the session version, and an
  expiry. Role, enabled state, and grants are re-read from SQLite on every
  protected request, so disabling an account, revoking a grant, or changing a
  password (which bumps `session_version`) invalidates immediately.
- Logout is durable, not just a cookie clear. `POST /api/platform/logout`,
  `DELETE /api/platform/session` and the legacy
  `DELETE /api/personal-workbench/session` persist a per-token revocation row
  (`0093`) keyed by the SHA-256 digest of the exact presented signed token
  before returning the clearing cookie. The raw token and its signature are
  never stored. Revocations are checked in `resolvePrincipal` for both the
  account and legacy token paths, so a revoked token is rejected even while it
  would otherwise still be within its expiry, and old-shape legacy tokens
  (signed claims with no `type`) are covered too. Malformed or forged cookies
  create no rows. If a revocation cannot be persisted the request fails closed
  with `503` instead of reporting a successful logout.
- Logout revokes only the presented token. Two sessions for the same account
  stay independent, and logout never bumps `session_version`; disable/re-enable,
  password reset and workspace-grant revoke keep their `session_version`
  invalidation. Rows past the token's own expiry are pruned opportunistically
  (and on startup); because the stored expiry is never earlier than the token's
  real expiry, pruning can never restore an unexpired token.
- Login/auth/admin mutations require the trusted HTTPS proxy, exact same Origin,
  and JSON content type. Host/X-Forwarded spoofing is rejected by the existing
  trusted-proxy logic, and `returnTo` accepts only known local workspace paths.

## Rollback

- Application rollback: redeploy the previous build. The `platform_*` tables and
  A's legacy owner row are additive; the previous build ignores them, and legacy
  entry-key access keeps working.
- Schema rollback is limited: dropping the `platform_*` tables is possible while
  the app is stopped, but it discards account, grant, and audit history. A
  database restore from the pre-migration backup removes them cleanly. Schema may
  remain in place across an app rollback.
- Never roll back by running a Life OS data reset or import for this change.

## Future work (not implemented here)

- Agent runs do not yet carry `workspace_id`/`task_id`. AI/agent functionality is
  shown and forwarded only for legacy owner A; account B is denied at the
  gateway. Per-workspace AI, task, and data isolation is future work.
- The second business workspace is intentionally undefined: only configurable
  metadata/grants and a not-configured result exist until an implementation
  target is explicitly configured.
