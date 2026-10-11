-- Prisma permits multiple Workspace rows to have isDefault=true; do not add
-- a stricter D1-only uniqueness rule that changes source behavior.
DROP INDEX IF EXISTS idx_lifeos_workspaces_default;
