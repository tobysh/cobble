"""One-time migration: import the existing TASKS.md table rows into the coordination
server's SQLite DB, so the server starts with the same state instead of everyone re-claiming
from scratch. Re-running it is safe (upserts by task id) but only pulls in fields TASKS.md
actually had — status/owner/notes changes made through the API afterwards are not
overwritten unless you literally re-run this with fresher TASKS.md content committed.
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402

TASKS_MD = Path(__file__).resolve().parents[2] / "TASKS.md"
STATUS_VALUES = {"todo", "claimed", "in-progress", "blocked", "done"}


def slugify(text: str) -> str:
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")[:60]


def parse_tasks_md(path: Path):
    milestone = None
    milestone_code = None
    in_table = False
    tasks = []
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        heading = re.match(r"^##\s+(M\d+)\s*[—-]\s*(.+)$", line)
        if heading:
            milestone_code, milestone_name = heading.groups()
            milestone = f"{milestone_code} — {milestone_name}"
            in_table = False
            continue
        if line.startswith("## How to claim"):
            break
        if line.startswith("| Task |"):
            in_table = True
            continue
        if line.startswith("|---") or line.startswith("|-"):
            continue
        if in_table and line.startswith("|") and milestone:
            cols = [c.strip() for c in line.strip("|").split("|")]
            if len(cols) != 4:
                continue
            task_text, status, owner, notes = cols
            status = status if status in STATUS_VALUES else "todo"
            branch = None
            if owner and owner != "—":
                m = re.search(r"agent/[\w./-]+", owner)
                branch = m.group(0) if m else owner
            task_id = f"{milestone_code.lower()}-{slugify(task_text)}"
            tasks.append(
                {
                    "id": task_id,
                    "milestone": milestone,
                    "description": task_text,
                    "status": status,
                    "owner": branch,
                    "branch": branch,
                    "notes": notes or None,
                }
            )
        elif not line.startswith("|"):
            in_table = False
    return tasks


def main() -> None:
    tasks = parse_tasks_md(TASKS_MD)
    db.init_db()
    with db.connect() as conn:
        for t in tasks:
            conn.execute(
                """
                INSERT INTO tasks (id, milestone, description, status, owner, branch, notes, updated_at)
                VALUES (:id, :milestone, :description, :status, :owner, :branch, :notes,
                        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                ON CONFLICT(id) DO UPDATE SET
                    milestone = excluded.milestone,
                    description = excluded.description,
                    status = excluded.status,
                    owner = excluded.owner,
                    branch = excluded.branch,
                    notes = excluded.notes,
                    updated_at = excluded.updated_at
                """,
                t,
            )
    print(f"seeded {len(tasks)} tasks from {TASKS_MD} into {db.DB_PATH}")


if __name__ == "__main__":
    main()
