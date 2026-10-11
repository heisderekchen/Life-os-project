#!/usr/bin/env python3
"""Offline, transactional SQLite tools for the standalone Life OS volume."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


def connect(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        raise ValueError(f"Database file not found: {path}")
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def quick_check(path: Path) -> None:
    with connect(path) as db:
        rows = db.execute("PRAGMA quick_check").fetchall()
        if len(rows) != 1 or rows[0][0] != "ok":
            raise ValueError(f"SQLite integrity check failed: {[r[0] for r in rows[:10]]}")
        violations = db.execute("PRAGMA foreign_key_check").fetchmany(10)
        if violations:
            raise ValueError(f"Foreign-key violations found: {[tuple(r) for r in violations]}")


def backup(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise ValueError(f"Refusing to overwrite existing backup: {destination}")
    with connect(source) as src, sqlite3.connect(destination) as dst:
        src.backup(dst)
    quick_check(destination)
    print(f"Backup verified: {destination.name} ({destination.stat().st_size} bytes)")


def restore_database(current: Path, backup_file: Path, backup_dir: Path) -> None:
    if not backup_file.is_file():
        raise ValueError(f"Backup file not found: {backup_file}")
    quick_check(backup_file)
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safety = backup_dir / f"pre-restore-{stamp}.db"
    backup(current, safety)
    candidate = current.with_name("restore-candidate.db")
    if candidate.exists():
        candidate.unlink()
    with sqlite3.connect(backup_file) as src, sqlite3.connect(candidate) as dst:
        src.backup(dst)
    quick_check(candidate)
    os.replace(candidate, current)
    quick_check(current)
    print(f"Restore verified. Previous database retained at: {safety.name}")


def main() -> int:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    p_backup = commands.add_parser("backup")
    p_backup.add_argument("database", type=Path)
    p_backup.add_argument("destination", type=Path)
    p_verify = commands.add_parser("verify")
    p_verify.add_argument("database", type=Path)
    p_restore = commands.add_parser("restore")
    p_restore.add_argument("database", type=Path)
    p_restore.add_argument("backup", type=Path)
    p_restore.add_argument("backup_dir", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "backup":
            backup(args.database, args.destination)
        elif args.command == "verify":
            quick_check(args.database)
            print(f"SQLite integrity and foreign keys verified: {args.database.name}")
        else:
            restore_database(args.database, args.backup, args.backup_dir)
    except (OSError, sqlite3.Error, ValueError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
