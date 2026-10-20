CREATE TABLE lifeos_task_notes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  images_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (task_id) REFERENCES personal_workbench_lifeos_tasks(id) ON DELETE CASCADE
);
CREATE INDEX idx_lifeos_task_notes_task_created ON lifeos_task_notes(task_id, created_at DESC, id DESC);
