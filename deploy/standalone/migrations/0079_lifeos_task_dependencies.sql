-- TaskDependency relation from the Life OS Prisma schema.
CREATE TABLE IF NOT EXISTS lifeos_task_dependencies (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES personal_workbench_lifeos_tasks(id) ON DELETE CASCADE,
    depends_on_id TEXT NOT NULL REFERENCES personal_workbench_lifeos_tasks(id) ON DELETE CASCADE,
    UNIQUE(task_id, depends_on_id)
);
CREATE INDEX IF NOT EXISTS idx_lifeos_task_dependencies_depends_on ON lifeos_task_dependencies(depends_on_id);
