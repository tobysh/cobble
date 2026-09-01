"""SQLite access for the coordination server. One connection per call, WAL mode,
BEGIN IMMEDIATE for the claim path so two agents racing on the same task get a real
winner instead of a last-write-wins clobber."""

import os
import sqlite3
from contextlib import contextmanager

DB_PATH = os.environ.get("COORD_DB_PATH", os.path.join(os.path.dirname(__file__), "coord.sqlite3"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    milestone   TEXT NOT NULL,
    description TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'todo',
    owner       TEXT,
    branch      TEXT,
    notes       TEXT,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS agents (
    id           TEXT PRIMARY KEY,
    branch       TEXT,
    worktree     TEXT,
    status       TEXT,
    current_task TEXT,
    note         TEXT,
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
"""


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


@contextmanager
def immediate_transaction():
    """A connection with a BEGIN IMMEDIATE transaction already open, for callers
    that need to read-then-write atomically (the claim endpoint)."""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
