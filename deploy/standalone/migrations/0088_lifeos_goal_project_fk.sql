-- GoalProject.projectId references the source-compatible project identifier.
-- Rebuild the link table so imported and API-created rows are protected by the
-- same delete cascade as the source Prisma relation.
CREATE TABLE lifeos_goal_projects_next (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES lifeos_goals(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES personal_workbench_lifeos_projects(source_id) ON DELETE CASCADE,
    UNIQUE(goal_id, project_id)
);

INSERT INTO lifeos_goal_projects_next (id, goal_id, project_id)
SELECT id, goal_id, project_id FROM lifeos_goal_projects;

DROP TABLE lifeos_goal_projects;
ALTER TABLE lifeos_goal_projects_next RENAME TO lifeos_goal_projects;
