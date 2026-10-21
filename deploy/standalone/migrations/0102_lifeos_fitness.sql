-- Native MyOS training plans and workout history, isolated by authenticated username.
CREATE TABLE IF NOT EXISTS lifeos_fitness_plans (
  id TEXT PRIMARY KEY, owner_username TEXT NOT NULL, name TEXT NOT NULL,
  description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_fitness_plans_owner ON lifeos_fitness_plans(owner_username, updated_at DESC);
CREATE TABLE IF NOT EXISTS lifeos_fitness_plan_exercises (
  id TEXT PRIMARY KEY, owner_username TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES lifeos_fitness_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_fitness_plan_exercises_owner ON lifeos_fitness_plan_exercises(owner_username, plan_id, position);
CREATE TABLE IF NOT EXISTS lifeos_fitness_sessions (
  id TEXT PRIMARY KEY, owner_username TEXT NOT NULL, plan_id TEXT,
  title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','completed','cancelled')),
  started_at TEXT NOT NULL, ended_at TEXT, notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_fitness_sessions_owner ON lifeos_fitness_sessions(owner_username, started_at DESC);
CREATE TABLE IF NOT EXISTS lifeos_fitness_session_exercises (
  id TEXT PRIMARY KEY, owner_username TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES lifeos_fitness_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_fitness_session_exercises_owner ON lifeos_fitness_session_exercises(owner_username, session_id, position);
CREATE TABLE IF NOT EXISTS lifeos_fitness_sets (
  id TEXT PRIMARY KEY, owner_username TEXT NOT NULL,
  exercise_id TEXT NOT NULL REFERENCES lifeos_fitness_session_exercises(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL, reps INTEGER NOT NULL CHECK(reps BETWEEN 1 AND 1000),
  weight_kg REAL NOT NULL CHECK(weight_kg BETWEEN 0 AND 2000),
  created_at TEXT NOT NULL, UNIQUE(exercise_id, set_number)
);
CREATE INDEX IF NOT EXISTS idx_lifeos_fitness_sets_owner ON lifeos_fitness_sets(owner_username, exercise_id, set_number);
