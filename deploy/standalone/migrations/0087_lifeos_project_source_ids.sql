-- Preserve source-compatible Life OS project IDs at the API boundary while
-- retaining the pilot's internal integer key and existing task foreign keys.
ALTER TABLE personal_workbench_lifeos_projects ADD COLUMN source_id TEXT;
UPDATE personal_workbench_lifeos_projects SET source_id=CAST(id AS TEXT) WHERE source_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lifeos_projects_source_id
ON personal_workbench_lifeos_projects(source_id);
