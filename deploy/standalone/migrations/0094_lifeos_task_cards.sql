-- 0094: MVP task-card metadata + Worker routing for the private Life OS
-- workspace (account A / ws_lifeos_legacy only).
--
-- Scope contract: every row carries the immutable platform account id, the
-- exact workspace id and the stable Life OS task id. The API filters every
-- read and write by all three columns, so an identifier guessed from another
-- account or another workspace can never be read, overwritten or deleted.
--
-- These tables are deliberately NOT part of the 40-collection Life OS
-- export/import/reset contract (`LIFEOS_EXPORT_TABLES` in
-- src/personal-workbench.mjs), so export, import and reset are unchanged.
--
-- No foreign keys: task deletion and import use REPLACE-style writes, and a
-- cascading reference here would silently change those code paths. Task
-- existence is re-validated on every API read/write instead; orphan cleanup
-- for deleted tasks is called out as a follow-up in
-- docs/task-card-worker-routing.md.

CREATE TABLE IF NOT EXISTS lifeos_task_cards (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    card_type TEXT NOT NULL,
    goal TEXT NOT NULL,
    expected_artifacts_json TEXT NOT NULL DEFAULT '[]',
    subtask_ids_json TEXT NOT NULL DEFAULT '[]',
    dependency_ids_json TEXT NOT NULL DEFAULT '[]',
    roles_json TEXT NOT NULL DEFAULT '[]',
    verification_evidence_json TEXT NOT NULL DEFAULT '[]',
    next_step TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lifeos_task_cards_scope
    ON lifeos_task_cards(account_id, workspace_id, task_id);
CREATE INDEX IF NOT EXISTS idx_lifeos_task_cards_workspace_task
    ON lifeos_task_cards(workspace_id, task_id);

CREATE TABLE IF NOT EXISTS lifeos_task_worker_routing (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    card_type TEXT NOT NULL,
    role TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lifeos_task_worker_routing_scope
    ON lifeos_task_worker_routing(account_id, workspace_id, card_type, role);
