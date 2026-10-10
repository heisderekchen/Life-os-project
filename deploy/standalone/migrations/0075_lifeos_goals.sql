-- Life OS goals, cascading subgoals, milestones and tag/project relations.
CREATE TABLE IF NOT EXISTS lifeos_goals (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
    category TEXT NOT NULL DEFAULT 'personal', status TEXT NOT NULL DEFAULT 'not-started',
    progress INTEGER NOT NULL DEFAULT 0,
    start_date TEXT, target_date TEXT, completed_at TEXT,
    archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
    parent_goal_id TEXT REFERENCES lifeos_goals(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_goals_status ON lifeos_goals(archived,status,created_at DESC);
CREATE TABLE IF NOT EXISTS lifeos_milestones (
    id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES lifeos_goals(id) ON DELETE CASCADE,
    title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
    completed_at TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_milestones_goal ON lifeos_milestones(goal_id,sort_order);
CREATE TABLE IF NOT EXISTS lifeos_goal_tags (
    id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES lifeos_goals(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES lifeos_tags(id) ON DELETE CASCADE, UNIQUE(goal_id,tag_id)
);
CREATE TABLE IF NOT EXISTS lifeos_goal_projects (
    id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES lifeos_goals(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL, UNIQUE(goal_id,project_id)
);
