-- Bookmark relations surfaced by Life OS note detail and tag counts.
CREATE TABLE IF NOT EXISTS lifeos_bookmarks (
    id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
    favicon TEXT, note_id TEXT REFERENCES lifeos_notes(id) ON DELETE SET NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_bookmarks_note ON lifeos_bookmarks(note_id,created_at DESC);
CREATE TABLE IF NOT EXISTS lifeos_bookmark_tags (
    id TEXT PRIMARY KEY, bookmark_id TEXT NOT NULL REFERENCES lifeos_bookmarks(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES lifeos_tags(id) ON DELETE CASCADE, UNIQUE(bookmark_id,tag_id)
);
