-- CalendarEvent model from Life OS. Deleting a task detaches its calendar events.
CREATE TABLE IF NOT EXISTS lifeos_calendar_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0,1)),
    color TEXT NOT NULL DEFAULT '#6b7280',
    location TEXT,
    recurrence TEXT,
    recurrence_config TEXT,
    task_id TEXT REFERENCES personal_workbench_lifeos_tasks(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_calendar_events_start ON lifeos_calendar_events(start_date);
CREATE INDEX IF NOT EXISTS idx_lifeos_calendar_events_task ON lifeos_calendar_events(task_id);
