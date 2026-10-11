-- Life OS profile and preferences. Namespaced to keep the personal data
-- separate from every HappySpa merchant/customer table in the same D1.
CREATE TABLE IF NOT EXISTS lifeos_user_profile (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    avatar TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    locale TEXT NOT NULL DEFAULT 'en',
    theme TEXT NOT NULL DEFAULT 'system',
    setup_complete INTEGER NOT NULL DEFAULT 0 CHECK (setup_complete IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lifeos_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES lifeos_user_profile(id) ON DELETE CASCADE,
    sidebar_collapsed INTEGER NOT NULL DEFAULT 0 CHECK (sidebar_collapsed IN (0, 1)),
    default_view TEXT NOT NULL DEFAULT 'dashboard',
    week_starts_on INTEGER NOT NULL DEFAULT 1,
    date_format TEXT NOT NULL DEFAULT 'yyyy-MM-dd',
    time_format TEXT NOT NULL DEFAULT '24h',
    currency TEXT NOT NULL DEFAULT 'USD',
    notifications_enabled INTEGER NOT NULL DEFAULT 1 CHECK (notifications_enabled IN (0, 1)),
    backup_enabled INTEGER NOT NULL DEFAULT 0 CHECK (backup_enabled IN (0, 1)),
    backup_frequency TEXT NOT NULL DEFAULT 'weekly',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
