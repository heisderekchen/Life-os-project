-- Local Life OS migration pilot. Kept separate from the original workbench
-- foundation so an already-applied migration is never silently rewritten.
-- This table intentionally shares no HappySpa merchant/business records.
CREATE TABLE IF NOT EXISTS personal_workbench_lifeos_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    color TEXT NOT NULL DEFAULT '#6b7280',
    icon TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    priority INTEGER NOT NULL DEFAULT 0,
    start_date TEXT,
    end_date TEXT,
    next_action TEXT NOT NULL DEFAULT '',
    resume_context TEXT NOT NULL DEFAULT '',
    blocker TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_personal_workbench_lifeos_projects_active
ON personal_workbench_lifeos_projects(archived, status, priority DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS personal_workbench_lifeos_tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'medium',
    due_date TEXT,
    start_date TEXT,
    completed_at TEXT,
    estimated_minutes INTEGER,
    actual_minutes INTEGER,
    recurrence TEXT,
    recurrence_config TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    project_id INTEGER REFERENCES personal_workbench_lifeos_projects(id) ON DELETE SET NULL,
    parent_task_id TEXT REFERENCES personal_workbench_lifeos_tasks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_personal_workbench_lifeos_tasks_project
ON personal_workbench_lifeos_tasks(project_id, archived, position, created_at);
CREATE INDEX IF NOT EXISTS idx_personal_workbench_lifeos_tasks_parent
ON personal_workbench_lifeos_tasks(parent_task_id, position);

CREATE TABLE IF NOT EXISTS personal_workbench_lifeos_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    entity_id TEXT,
    detail_json TEXT NOT NULL DEFAULT '{}',
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_personal_workbench_lifeos_audit_created
ON personal_workbench_lifeos_audit_log(created_at DESC, id DESC);
