-- Private Life OS knowledge-base tables (second-brain module).
CREATE TABLE IF NOT EXISTS lifeos_tags (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6b7280',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_tags_name ON lifeos_tags(name);

CREATE TABLE IF NOT EXISTS lifeos_note_folders (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, color TEXT,
    parent_id TEXT REFERENCES lifeos_note_folders(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_note_folders_order ON lifeos_note_folders(sort_order);

CREATE TABLE IF NOT EXISTS lifeos_notes (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'note', icon TEXT, color TEXT,
    is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0,1)),
    is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0,1)),
    word_count INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
    folder_id TEXT REFERENCES lifeos_note_folders(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_notes_folder ON lifeos_notes(folder_id, archived, updated_at);

CREATE TABLE IF NOT EXISTS lifeos_note_tags (
    id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES lifeos_notes(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES lifeos_tags(id) ON DELETE CASCADE, UNIQUE(note_id, tag_id)
);
CREATE TABLE IF NOT EXISTS lifeos_note_links (
    id TEXT PRIMARY KEY, source_note_id TEXT NOT NULL REFERENCES lifeos_notes(id) ON DELETE CASCADE,
    target_note_id TEXT NOT NULL REFERENCES lifeos_notes(id) ON DELETE CASCADE,
    UNIQUE(source_note_id, target_note_id)
);
