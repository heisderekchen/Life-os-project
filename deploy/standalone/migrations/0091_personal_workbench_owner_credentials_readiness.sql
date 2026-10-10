SELECT CASE WHEN EXISTS (
    SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'personal_workbench_owner_credentials'
) AND (
    SELECT COUNT(*) FROM pragma_table_info('personal_workbench_owner_credentials')
    WHERE name IN (
        'owner_id', 'owner_username', 'password_hash', 'password_salt', 'password_scheme',
        'password_iterations', 'failed_attempts', 'attempt_window_started_at', 'locked_until',
        'setup_grant_consumed_at', 'setup_grant_revoked_at', 'credential_created_at'
    )
) = 12 AND (
    SELECT COUNT(*) FROM personal_workbench_owner_credentials WHERE owner_id = 1
) = 1 AND (
    SELECT COUNT(*) FROM personal_workbench_owner_credentials WHERE owner_id = 1 AND (
        (owner_username IS NULL AND password_hash IS NULL AND password_salt IS NULL
            AND password_scheme IS NULL AND password_iterations IS NULL AND credential_created_at IS NULL)
        OR
        (owner_username IS NOT NULL AND password_hash IS NOT NULL AND password_salt IS NOT NULL
            AND password_scheme = 'pbkdf2-sha256-v1' AND password_iterations = 100000
            AND credential_created_at IS NOT NULL AND length(owner_username) > 0
            AND length(password_hash) = 64 AND length(password_salt) = 32)
    )
) = 1 THEN 1 ELSE json_extract('not json', '$') END;
