-- TaskTag relation from Life OS. Tags remain shared with other private Life OS
-- domains, while task links cascade with either side.
CREATE TABLE IF NOT EXISTS lifeos_task_tags (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES personal_workbench_lifeos_tasks(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES lifeos_tags(id) ON DELETE CASCADE,
    UNIQUE(task_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_lifeos_task_tags_tag ON lifeos_task_tags(tag_id);
