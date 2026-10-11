-- Private personal-workbench records remain wholly separate from HappySpa's
-- customers, orders, staff and partner identities.
CREATE TABLE IF NOT EXISTS personal_workbench_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'review', 'archived')),
    priority INTEGER NOT NULL DEFAULT 0,
    next_action TEXT NOT NULL DEFAULT '',
    resume_context TEXT NOT NULL DEFAULT '',
    blocker TEXT NOT NULL DEFAULT '',
    last_progress_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_personal_workbench_projects_active
ON personal_workbench_projects(status, priority DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS personal_workbench_checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES personal_workbench_projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('progress', 'blocker', 'review', 'capture')),
    content TEXT NOT NULL,
    next_action TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_personal_workbench_checkpoints_project
ON personal_workbench_checkpoints(project_id, id DESC);

CREATE TABLE IF NOT EXISTS personal_workbench_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    project_id INTEGER REFERENCES personal_workbench_projects(id) ON DELETE SET NULL,
    detail_json TEXT NOT NULL DEFAULT '{}',
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_personal_workbench_audit_created
ON personal_workbench_audit_log(created_at DESC, id DESC);
