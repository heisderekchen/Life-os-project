-- Stable provenance for explicit, user-confirmed task imports.
-- Source IDs survive deletion of an imported task so a repeat import does not
-- silently recreate work the user intentionally removed. Imported task fields
-- are never rewritten after creation; edits in myOS remain authoritative.
CREATE TABLE IF NOT EXISTS lifeos_task_import_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT NOT NULL,
    source_task_id TEXT NOT NULL,
    task_id TEXT REFERENCES personal_workbench_lifeos_tasks(id) ON DELETE SET NULL,
    imported_at TEXT NOT NULL,
    source_updated_at TEXT,
    UNIQUE (source_key, source_task_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lifeos_task_import_sources_task
ON lifeos_task_import_sources(task_id) WHERE task_id IS NOT NULL;
