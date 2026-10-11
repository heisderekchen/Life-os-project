-- Life OS habit tracking and daily progress logs.
CREATE TABLE IF NOT EXISTS lifeos_habits (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, icon TEXT,
    color TEXT NOT NULL DEFAULT '#6b7280', frequency TEXT NOT NULL DEFAULT 'daily',
    frequency_config TEXT, target_count INTEGER NOT NULL DEFAULT 1, unit TEXT,
    reminder_enabled INTEGER NOT NULL DEFAULT 0 CHECK (reminder_enabled IN (0,1)),
    reminder_time TEXT, gap_forgiveness INTEGER NOT NULL DEFAULT 0 CHECK (gap_forgiveness >= 0),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_habits_archived ON lifeos_habits(archived, created_at DESC);
CREATE TABLE IF NOT EXISTS lifeos_habit_logs (
    id TEXT PRIMARY KEY, habit_id TEXT NOT NULL REFERENCES lifeos_habits(id) ON DELETE CASCADE,
    date TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1, note TEXT, created_at TEXT NOT NULL, UNIQUE(habit_id,date)
);
CREATE INDEX IF NOT EXISTS idx_lifeos_habit_logs_date ON lifeos_habit_logs(date DESC);
CREATE TABLE IF NOT EXISTS lifeos_habit_tags (
    id TEXT PRIMARY KEY, habit_id TEXT NOT NULL REFERENCES lifeos_habits(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES lifeos_tags(id) ON DELETE CASCADE, UNIQUE(habit_id,tag_id)
);
