-- Preserve first-class source project and task type metadata for explicit Dot
-- imports, including repair of records imported before this migration.
ALTER TABLE lifeos_task_import_sources ADD COLUMN source_project TEXT;
ALTER TABLE lifeos_task_import_sources ADD COLUMN source_type TEXT;
