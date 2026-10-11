-- Life OS journal entries and their normalized tag links.
CREATE TABLE IF NOT EXISTS lifeos_journal_entries (
    id TEXT PRIMARY KEY, title TEXT, content TEXT NOT NULL DEFAULT '', mood TEXT,
    mood_score INTEGER, energy INTEGER, stress INTEGER, gratitude TEXT, tags TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0 CHECK(is_favorite IN (0,1)),
    date TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_journal_date ON lifeos_journal_entries(date DESC);
CREATE INDEX IF NOT EXISTS idx_lifeos_journal_mood ON lifeos_journal_entries(mood,date DESC);
CREATE TABLE IF NOT EXISTS lifeos_journal_tags (
    id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES lifeos_journal_entries(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES lifeos_tags(id) ON DELETE CASCADE, UNIQUE(entry_id,tag_id)
);
