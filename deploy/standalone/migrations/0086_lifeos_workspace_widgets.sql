-- Source-aligned Workspace and Widget models. The widget-order endpoint uses
-- Workspace.layout; individual Widget rows remain available for full parity.
CREATE TABLE IF NOT EXISTS lifeos_workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    color TEXT,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
    layout TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lifeos_workspaces_default ON lifeos_workspaces(is_default) WHERE is_default=1;

CREATE TABLE IF NOT EXISTS lifeos_dashboard_widgets (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES lifeos_workspaces(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    config TEXT,
    position_x INTEGER NOT NULL DEFAULT 0,
    position_y INTEGER NOT NULL DEFAULT 0,
    width INTEGER NOT NULL DEFAULT 4,
    height INTEGER NOT NULL DEFAULT 3,
    visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0,1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifeos_dashboard_widgets_workspace ON lifeos_dashboard_widgets(workspace_id,sort_order);
