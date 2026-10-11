#!/usr/bin/env python3
"""Offline backup, integrity-check and explicit restore tests."""
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

TOOLS = Path(__file__).with_name("sqlite-tools.py")

def run(*args, ok=True):
    result = subprocess.run([sys.executable, str(TOOLS), *map(str, args)], capture_output=True, text=True)
    if ok and result.returncode:
        raise AssertionError(result.stderr or result.stdout)
    if not ok and result.returncode == 0:
        raise AssertionError("Expected the SQLite utility to reject this operation")
    return result

with tempfile.TemporaryDirectory(prefix="lifeos-sqlite-tools-") as tmp:
    root = Path(tmp)
    current = root / "lifeos.db"
    backup = root / "backup.db"
    safety_dir = root / "safety"
    with sqlite3.connect(current) as db:
        db.execute("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
        db.execute("INSERT INTO sample VALUES (1, 'before')")
    run("backup", current, backup)
    run("verify", backup)
    with sqlite3.connect(current) as db:
        db.execute("UPDATE sample SET value='after' WHERE id=1")
    run("restore", current, backup, safety_dir)
    with sqlite3.connect(current) as db:
        assert db.execute("SELECT value FROM sample WHERE id=1").fetchone()[0] == "before"
    assert list(safety_dir.glob("pre-restore-*.db"))
    run("backup", current, backup, ok=False)  # never overwrite a backup
print("SQLite backup integrity, restore safety copy, and overwrite refusal passed.")
