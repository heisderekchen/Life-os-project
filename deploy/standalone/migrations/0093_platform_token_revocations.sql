-- Durable per-token session revocation.
--
-- Logout must actually invalidate the presented signed token instead of only
-- clearing the browser cookie. This table stores exactly one row per revoked
-- signed token, keyed by the SHA-256 digest of the full raw token. The raw
-- token, its signature, and any credential material are never persisted.
--
-- These rows are identity/authority metadata, NOT Life OS data. They are
-- intentionally excluded from the 40-collection Life OS export/import/reset
-- contract. `token_type`/`account_id` are recorded only when the signed claims
-- make them known: pre-migration legacy tokens carry no `type` claim, so their
-- type may be inferred or left null.
--
-- `expires_at` always equals (or exceeds) the signed token's own expiry, so
-- pruning an expired row can never remove the revocation of a still-valid
-- token. The file is rerunnable: every statement is IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS platform_token_revocations (
    token_hash TEXT PRIMARY KEY,
    token_type TEXT CHECK (token_type IS NULL OR token_type IN ('account', 'legacy-entry')),
    account_id TEXT,
    revoked_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    CHECK (length(token_hash) = 64),
    CHECK (token_hash = lower(token_hash))
);

CREATE INDEX IF NOT EXISTS platform_token_revocations_expires_idx
    ON platform_token_revocations(expires_at);
