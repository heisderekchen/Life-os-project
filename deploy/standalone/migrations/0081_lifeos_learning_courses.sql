-- Learning models from the Life OS Prisma schema.
CREATE TABLE IF NOT EXISTS lifeos_courses (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    provider TEXT,
    url TEXT,
    status TEXT NOT NULL DEFAULT 'not-started',
    progress INTEGER NOT NULL DEFAULT 0,
    start_date TEXT,
    end_date TEXT,
    rating INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_courses_status ON lifeos_courses(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lifeos_courses_provider ON lifeos_courses(provider);

CREATE TABLE IF NOT EXISTS lifeos_course_resources (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES lifeos_courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'video',
    url TEXT,
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)),
    notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_course_resources_course ON lifeos_course_resources(course_id,sort_order);
