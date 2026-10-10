#!/usr/bin/env python3
"""Strict import of /api/personal-workbench/lifeos/data/export into D1-shaped SQLite."""
import json
import sqlite3
import sys
from pathlib import Path

TABLES = {
    "profile":"lifeos_user_profile", "settings":"lifeos_settings", "workspace":"lifeos_workspaces",
    "widgets":"lifeos_dashboard_widgets", "dashboardLayout":"lifeos_widgets", "tags":"lifeos_tags",
    "projects":"personal_workbench_lifeos_projects", "tasks":"personal_workbench_lifeos_tasks",
    "taskTags":"lifeos_task_tags", "taskDependencies":"lifeos_task_dependencies",
    "noteFolders":"lifeos_note_folders", "notes":"lifeos_notes", "noteTags":"lifeos_note_tags",
    "noteLinks":"lifeos_note_links", "bookmarks":"lifeos_bookmarks", "bookmarkTags":"lifeos_bookmark_tags",
    "habits":"lifeos_habits", "habitTags":"lifeos_habit_tags", "habitLogs":"lifeos_habit_logs",
    "goals":"lifeos_goals", "goalTags":"lifeos_goal_tags", "milestones":"lifeos_milestones",
    "goalProjects":"lifeos_goal_projects", "journalEntries":"lifeos_journal_entries",
    "journalTags":"lifeos_journal_tags", "financeAccounts":"lifeos_finance_accounts",
    "transactionCategories":"lifeos_transaction_categories", "transactions":"lifeos_transactions",
    "budgets":"lifeos_budgets", "budgetItems":"lifeos_budget_items", "courses":"lifeos_courses",
    "courseResources":"lifeos_course_resources", "calendarEvents":"lifeos_calendar_events",
    "timeEntries":"lifeos_time_entries", "pomodoroSessions":"lifeos_pomodoro_sessions",
}

def snake(value):
    return "".join("_" + c.lower() if c.isupper() else c for c in value)

def main():
    if len(sys.argv) != 3:
        raise ValueError("Usage: import-current-export.py /data/lifeos.db /migration/export.json")
    db_path, export_path = map(Path, sys.argv[1:])
    payload = json.loads(export_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("version") != "1.0.0" or not isinstance(payload.get("data"), dict):
        raise ValueError("Expected authenticated current Life OS export version 1.0.0")
    data = payload["data"]
    if set(data) != set(TABLES):
        raise ValueError(f"Export contract mismatch; missing={sorted(set(TABLES)-set(data))}, extra={sorted(set(data)-set(TABLES))}")
    for key, rows in data.items():
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ValueError(f"{key} must be an array of objects")

    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    counts = {}
    try:
        for table in TABLES.values():
            if db.execute(f'SELECT 1 FROM "{table}" LIMIT 1').fetchone():
                raise ValueError(f"Target table {table} is not empty")
        db.execute("PRAGMA defer_foreign_keys=ON")
        existing = {int(row[0]) for row in db.execute("SELECT id FROM personal_workbench_lifeos_projects")}
        next_id = max(existing, default=0) + 1
        project_map = {}
        for row in data["projects"]:
            source_id = str(row.get("id", ""))
            if not source_id or source_id in project_map:
                raise ValueError("Project export has a missing or duplicate source id")
            candidate = int(source_id) if source_id.isdigit() else None
            if candidate is None or candidate in existing:
                candidate = next_id
                next_id += 1
            existing.add(candidate)
            project_map[source_id] = candidate

        schema = {table: {column[1] for column in db.execute(f'PRAGMA table_info("{table}")')} for table in TABLES.values()}
        for key, table in TABLES.items():
            inserted = 0
            for original in data[key]:
                row = dict(original)
                if key == "projects":
                    source_id = str(row["id"])
                    row["sourceId"] = source_id
                    row["id"] = project_map[source_id]
                    row["title"] = row.pop("name", row.get("title"))
                if key == "tasks" and row.get("projectId") is not None:
                    source_id = str(row["projectId"])
                    if source_id not in project_map:
                        raise ValueError(f"Task refers to absent source project {source_id}")
                    row["projectId"] = project_map[source_id]

                values = {}
                for field, value in row.items():
                    column = snake(field)
                    if column == "order":
                        column = "sort_order"
                    if column not in schema[table]:
                        raise ValueError(f"Unsupported {key} field {field!r} for {table}")
                    # Keep ISO date/text values as text; only JSON booleans need
                    # conversion to SQLite's integer representation.
                    values[column] = int(value) if isinstance(value, bool) else value
                if not values:
                    raise ValueError(f"Empty row in {key}")
                columns = list(values)
                sql = f'INSERT INTO "{table}" ({",".join(chr(34)+c+chr(34) for c in columns)}) VALUES ({",".join("?" for _ in columns)})'
                db.execute(sql, [values[c] for c in columns])
                inserted += 1
            target_count = db.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            if inserted != len(data[key]) or target_count != len(data[key]):
                raise ValueError(f"{key} count mismatch: source {len(data[key])}, inserted {inserted}, target {target_count}")
            counts[key] = target_count

        # Older releases kept widget order in lifeos_widgets. Preserve it only
        # when the canonical Workspace.layout does not already define order.
        layouts = data.get("dashboardLayout", [])
        if len(layouts) > 1:
            raise ValueError("Expected at most one legacy dashboard layout row")
        if layouts:
            workspaces = db.execute("SELECT id,layout FROM lifeos_workspaces WHERE is_default=1").fetchall()
            if len(workspaces) > 1:
                raise ValueError("Multiple default workspaces require manual layout reconciliation")
            if workspaces:
                workspace = workspaces[0]
                try:
                    layout = json.loads(workspace["layout"] or "{}")
                    legacy = layouts[0].get("widgetIds") or "[]"
                    legacy = json.loads(legacy) if isinstance(legacy, str) else legacy
                except (TypeError, json.JSONDecodeError) as exc:
                    raise ValueError("Workspace or legacy widget layout is invalid JSON") from exc
                if not isinstance(layout, dict) or not isinstance(legacy, list) or any(not isinstance(v, str) for v in legacy):
                    raise ValueError("Workspace layout and legacy widget order must be JSON objects/strings")
                if layout.get("widgets") and legacy and layout["widgets"] != legacy:
                    raise ValueError("Workspace and legacy widget orders conflict")
                if legacy and not layout.get("widgets"):
                    layout["widgets"] = legacy
                    db.execute("UPDATE lifeos_workspaces SET layout=? WHERE id=?", (json.dumps(layout), workspace["id"]))
        violations = db.execute("PRAGMA foreign_key_check").fetchmany(10)
        if violations:
            raise ValueError(f"Foreign-key violations: {[tuple(row) for row in violations]}")
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    print(json.dumps({"importedRows": counts, "excluded": ["personal_workbench_owner_credentials", "personal_workbench_audit_log", "personal_workbench_lifeos_audit_log", "lifeos_task_recurrence_runs"]}, sort_keys=True))

if __name__ == "__main__":
    try:
        main()
    except (OSError, sqlite3.Error, ValueError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
