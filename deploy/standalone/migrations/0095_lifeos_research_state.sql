-- 0095: research state machine + Obsidian sync outbox (additive, idempotent)
-- for the private Life OS workspace (account A / ws_lifeos_legacy only).
--
-- Scope contract: every row carries the immutable platform account id, the
-- exact workspace id and the stable Life OS task id. The API filters every read
-- and write by all three columns, so an identifier guessed from another
-- account, another workspace or another task can never be read, overwritten or
-- deleted. Task existence is re-validated against
-- personal_workbench_lifeos_tasks on every request because Life OS tasks carry
-- no account column (the private workbench module is owner-only).
--
-- These tables are deliberately NOT part of the 40-collection Life OS
-- export/import/reset contract (`LIFEOS_EXPORT_TABLES` in
-- src/personal-workbench.mjs), so export, import and reset are unchanged.
--
-- No foreign keys: task deletion and import use REPLACE-style writes and a
-- cascading reference here would silently change those code paths.
--
-- This migration adds storage only. It does not schedule anything, does not
-- call a model provider, and does not touch the filesystem. The Obsidian
-- outbox is staged as `pending_sync` and is never written to a vault until an
-- explicit filesystem permission is granted in a later, separately reviewed
-- step.
--
-- History is append-only from the API's point of view: rounds and evidence are
-- never deleted or overwritten by the research endpoints, and there is no
-- plan-delete endpoint. A task that already has rounds/evidence cannot be
-- re-planned; start a new task instead.

CREATE TABLE IF NOT EXISTS lifeos_research_sessions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'once',
    goal TEXT NOT NULL,
    target TEXT,
    source_allowlist_json TEXT NOT NULL DEFAULT '[]',
    action_allowlist_json TEXT NOT NULL DEFAULT '[]',
    unresolved_questions_json TEXT NOT NULL DEFAULT '[]',
    next_question TEXT,
    checkpoint_json TEXT NOT NULL DEFAULT '{}',
    -- Finite positive budget only ($1 Agent Service default cap). 0 is never
    -- stored and never means "unlimited".
    cost_limit_usd REAL NOT NULL DEFAULT 1,
    cost_spent_usd REAL NOT NULL DEFAULT 0,
    frequency_minutes INTEGER NOT NULL DEFAULT 60,
    next_check_at TEXT,
    subtask_cap INTEGER NOT NULL DEFAULT 1,
    max_concurrency INTEGER NOT NULL DEFAULT 1,
    max_rounds INTEGER NOT NULL DEFAULT 1,
    round_count INTEGER NOT NULL DEFAULT 0,
    no_new_evidence_streak INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    terminal_reason TEXT,
    executor_status TEXT NOT NULL DEFAULT 'not_connected',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lifeos_research_sessions_scope
    ON lifeos_research_sessions(account_id, workspace_id, task_id);
CREATE INDEX IF NOT EXISTS idx_lifeos_research_sessions_status
    ON lifeos_research_sessions(account_id, workspace_id, status);

CREATE TABLE IF NOT EXISTS lifeos_research_rounds (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    round_index INTEGER NOT NULL,
    status TEXT NOT NULL,
    new_evidence_count INTEGER NOT NULL DEFAULT 0,
    duplicate_evidence_count INTEGER NOT NULL DEFAULT 0,
    no_new_evidence_streak INTEGER NOT NULL DEFAULT 0,
    next_check_at TEXT,
    terminal_reason TEXT,
    summary TEXT,
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lifeos_research_rounds_scope
    ON lifeos_research_rounds(account_id, workspace_id, task_id, round_index);
CREATE INDEX IF NOT EXISTS idx_lifeos_research_rounds_session
    ON lifeos_research_rounds(session_id, round_index);

CREATE TABLE IF NOT EXISTS lifeos_research_evidence (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    round_index INTEGER,
    dedupe_key TEXT NOT NULL,
    source TEXT NOT NULL,
    source_ref TEXT,
    summary TEXT,
    observed_date TEXT,
    confidence TEXT NOT NULL DEFAULT 'medium',
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lifeos_research_evidence_dedupe
    ON lifeos_research_evidence(account_id, workspace_id, task_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_lifeos_research_evidence_session
    ON lifeos_research_evidence(session_id, created_at);

CREATE TABLE IF NOT EXISTS lifeos_obsidian_sync_outbox (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    session_id TEXT,
    relative_path TEXT NOT NULL,
    expected_base_hash TEXT,
    observed_base_hash TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    citations_json TEXT NOT NULL DEFAULT '[]',
    block_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_sync',
    conflict_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lifeos_obsidian_sync_outbox_scope
    ON lifeos_obsidian_sync_outbox(account_id, workspace_id, task_id, relative_path, block_hash);
CREATE INDEX IF NOT EXISTS idx_lifeos_obsidian_sync_outbox_status
    ON lifeos_obsidian_sync_outbox(account_id, workspace_id, task_id, status);
