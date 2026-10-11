-- User-specific dashboard widget layout for the private Life OS workspace.
CREATE TABLE IF NOT EXISTS lifeos_widgets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES lifeos_user_profile(id) ON DELETE CASCADE,
    widget_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id)
);
