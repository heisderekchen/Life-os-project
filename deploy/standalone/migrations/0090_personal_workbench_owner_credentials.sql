-- Life OS has a dedicated owner credential, separate from HappySpa admin and
-- front-desk authentication. The singleton row stores password-login
-- rate-limit state before the owner chooses a password.
CREATE TABLE IF NOT EXISTS personal_workbench_owner_credentials (
    owner_id INTEGER PRIMARY KEY CHECK (owner_id = 1),
    owner_username TEXT,
    password_hash TEXT,
    password_salt TEXT,
    password_scheme TEXT,
    password_iterations INTEGER,
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    attempt_window_started_at TEXT,
    locked_until TEXT,
    setup_grant_consumed_at TEXT,
    setup_grant_revoked_at TEXT,
    credential_created_at TEXT,
    CHECK (
        (owner_username IS NULL AND password_hash IS NULL AND password_salt IS NULL
            AND password_scheme IS NULL AND password_iterations IS NULL AND credential_created_at IS NULL)
        OR
        (owner_username IS NOT NULL AND password_hash IS NOT NULL AND password_salt IS NOT NULL
            AND password_scheme IS NOT NULL AND password_iterations IS NOT NULL AND credential_created_at IS NOT NULL
            AND length(owner_username) > 0 AND length(password_hash) = 64 AND length(password_salt) = 32
            AND password_scheme = 'pbkdf2-sha256-v1' AND password_iterations = 100000
        )
    )
);

INSERT OR IGNORE INTO personal_workbench_owner_credentials (owner_id) VALUES (1);
