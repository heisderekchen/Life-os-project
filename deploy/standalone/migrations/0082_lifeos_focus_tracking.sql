-- TimeEntry and PomodoroSession models from the Life OS Prisma schema.
CREATE TABLE IF NOT EXISTS lifeos_time_entries (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    duration INTEGER,
    billable INTEGER NOT NULL DEFAULT 0 CHECK (billable IN (0,1)),
    task_id TEXT REFERENCES personal_workbench_lifeos_tasks(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_time_entries_start ON lifeos_time_entries(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_lifeos_time_entries_task ON lifeos_time_entries(task_id,end_time);

CREATE TABLE IF NOT EXISTS lifeos_pomodoro_sessions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'focus',
    duration INTEGER NOT NULL CHECK (duration > 0),
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)),
    task_id TEXT REFERENCES personal_workbench_lifeos_tasks(id) ON DELETE SET NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_pomodoro_started ON lifeos_pomodoro_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_lifeos_pomodoro_task ON lifeos_pomodoro_sessions(task_id);
