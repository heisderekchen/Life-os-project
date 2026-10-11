-- Unified platform login + platform-admin workbench identity metadata.
--
-- These tables are identity/authority metadata, NOT Life OS data. They are
-- intentionally excluded from the 40-collection Life OS export/import/reset
-- contract. Account ids and workspace ids are immutable security principals;
-- usernames and slugs are mutable human-facing handles and are never used as
-- owners.
--
-- The file is rerunnable: every statement is IF NOT EXISTS / INSERT OR IGNORE.

CREATE TABLE IF NOT EXISTS platform_accounts (
    account_id TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('platform_admin', 'member')),
    legacy_owner INTEGER NOT NULL DEFAULT 0 CHECK (legacy_owner IN (0, 1)),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version >= 1),
    password_hash TEXT,
    password_salt TEXT,
    password_scheme TEXT,
    password_iterations INTEGER,
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    attempt_window_started_at TEXT,
    locked_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (username = lower(username)),
    CHECK (length(username) BETWEEN 3 AND 64),
    CHECK (length(account_id) BETWEEN 1 AND 64),
    CHECK (
        (password_hash IS NULL AND password_salt IS NULL AND password_scheme IS NULL AND password_iterations IS NULL)
        OR
        (password_hash IS NOT NULL AND length(password_hash) = 64
            AND password_salt IS NOT NULL AND length(password_salt) = 32
            AND password_scheme = 'pbkdf2-sha256-v1' AND password_iterations = 100000)
    )
);

CREATE TABLE IF NOT EXISTS platform_workspaces (
    workspace_id TEXT PRIMARY KEY,
    slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'internal' CHECK (kind IN ('lifeos', 'internal')),
    configured INTEGER NOT NULL DEFAULT 0 CHECK (configured IN (0, 1)),
    application_target TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (length(workspace_id) BETWEEN 1 AND 64),
    CHECK (length(slug) BETWEEN 1 AND 64),
    CHECK (slug = lower(slug)),
    CHECK ((configured = 1 AND application_target IS NOT NULL AND length(application_target) > 0)
        OR (configured = 0 AND application_target IS NULL))
);

CREATE TABLE IF NOT EXISTS platform_account_workspaces (
    account_id TEXT NOT NULL REFERENCES platform_accounts(account_id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES platform_workspaces(workspace_id) ON DELETE RESTRICT,
    granted_at TEXT NOT NULL,
    granted_by TEXT,
    PRIMARY KEY (account_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS platform_account_workspaces_workspace_idx
    ON platform_account_workspaces(workspace_id);

CREATE TABLE IF NOT EXISTS platform_auth_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    actor_account_id TEXT,
    actor_type TEXT NOT NULL,
    action TEXT NOT NULL,
    target_account_id TEXT,
    workspace_id TEXT,
    detail_json TEXT
);

CREATE INDEX IF NOT EXISTS platform_auth_audit_created_idx ON platform_auth_audit(created_at);

CREATE TRIGGER IF NOT EXISTS platform_auth_audit_no_update
BEFORE UPDATE ON platform_auth_audit
BEGIN
    SELECT RAISE(ABORT, 'platform_auth_audit is append-only');
END;

CREATE TRIGGER IF NOT EXISTS platform_auth_audit_no_delete
BEFORE DELETE ON platform_auth_audit
BEGIN
    SELECT RAISE(ABORT, 'platform_auth_audit is append-only');
END;

-- Deterministic metadata mapping the configured legacy owner to the existing
-- Life OS application. The account row itself is bound to
-- PERSONAL_WORKBENCH_OWNER at startup, because the handle is runtime config.
INSERT OR IGNORE INTO platform_workspaces
    (workspace_id, slug, display_name, kind, configured, application_target, created_at, updated_at)
VALUES
    ('ws_lifeos_legacy', 'lifeos', 'Life OS', 'lifeos', 1, '/workbench/', '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z');
