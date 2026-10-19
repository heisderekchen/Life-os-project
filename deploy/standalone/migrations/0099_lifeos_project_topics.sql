-- Add an explicit organizational layer without reclassifying existing records.
CREATE TABLE lifeos_project_topics (
    id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES personal_workbench_lifeos_projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_lifeos_topic_project_name ON lifeos_project_topics(project_id, name COLLATE NOCASE);
ALTER TABLE personal_workbench_lifeos_tasks ADD COLUMN topic_id TEXT REFERENCES lifeos_project_topics(id) ON DELETE SET NULL;
ALTER TABLE personal_workbench_lifeos_tasks ADD COLUMN task_type TEXT;
CREATE INDEX idx_lifeos_tasks_topic ON personal_workbench_lifeos_tasks(topic_id);
-- Legacy reconciliation also writes project_id directly. Keep its topic
-- association valid while retaining same-project assignments and task data.
CREATE TRIGGER lifeos_task_topic_project_reassignment
AFTER UPDATE OF project_id ON personal_workbench_lifeos_tasks
WHEN NEW.topic_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM lifeos_project_topics WHERE id=NEW.topic_id AND project_id=NEW.project_id
)
BEGIN
    UPDATE personal_workbench_lifeos_tasks SET topic_id=NULL WHERE id=NEW.id;
END;
