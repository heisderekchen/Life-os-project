-- Idempotency ledger for recurring task instances. A given completion event
-- can generate at most one next task even if scheduled invocations overlap.
CREATE TABLE IF NOT EXISTS lifeos_task_recurrence_runs (
    id TEXT PRIMARY KEY,
    source_task_id TEXT NOT NULL REFERENCES personal_workbench_lifeos_tasks(id) ON DELETE CASCADE,
    completion_key TEXT NOT NULL,
    generated_task_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    UNIQUE(source_task_id, completion_key)
);
CREATE INDEX IF NOT EXISTS idx_lifeos_recurrence_source ON lifeos_task_recurrence_runs(source_task_id,created_at DESC);
