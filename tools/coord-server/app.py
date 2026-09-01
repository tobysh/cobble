"""Coordination server for cobble's multi-agent workflow.

Replaces the git-based TASKS.md claim protocol: with N worktrees each holding their own
checkout, TASKS.md is only ever as fresh as the last fetch+merge, which is exactly how two
agents both built cobble-storage independently (see TASKS.md history, 2026-09-01). This
server is the single live copy every agent talks to over HTTP instead.

Run with: uvicorn app:app --host 0.0.0.0 --port 8420
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import db

app = FastAPI(title="cobble coordination server")


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


@app.on_event("startup")
def on_startup():
    db.init_db()


# ---- agents -----------------------------------------------------------------

class RegisterAgent(BaseModel):
    id: str
    branch: Optional[str] = None
    worktree: Optional[str] = None
    note: Optional[str] = None


class UpdateAgent(BaseModel):
    branch: Optional[str] = None
    worktree: Optional[str] = None
    status: Optional[str] = None
    current_task: Optional[str] = None
    note: Optional[str] = None


@app.post("/agents")
def add_agent(agent: RegisterAgent):
    """Register (or re-register) an agent by id. Idempotent — safe to call again after a
    restart."""
    with db.connect() as conn:
        conn.execute(
            """
            INSERT INTO agents (id, branch, worktree, status, current_task, note, updated_at)
            VALUES (?, ?, ?, 'idle', NULL, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                branch = excluded.branch,
                worktree = excluded.worktree,
                note = excluded.note,
                updated_at = excluded.updated_at
            """,
            (agent.id, agent.branch, agent.worktree, agent.note, now()),
        )
        row = conn.execute("SELECT * FROM agents WHERE id = ?", (agent.id,)).fetchone()
    return dict(row)


@app.get("/agents")
def list_agents():
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM agents ORDER BY id").fetchall()
    return [dict(r) for r in rows]


@app.get("/agents/{agent_id}")
def get_agent(agent_id: str):
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM agents WHERE id = ?", (agent_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"unknown agent {agent_id!r}")
    return dict(row)


@app.post("/agents/{agent_id}")
def update_agent(agent_id: str, update: UpdateAgent):
    """An agent reports its own status/current task/free-form note. Auto-registers if this
    id hasn't called POST /agents yet, so a fresh agent can just start posting updates."""
    fields = {k: v for k, v in update.model_dump().items() if v is not None}
    with db.connect() as conn:
        existing = conn.execute("SELECT 1 FROM agents WHERE id = ?", (agent_id,)).fetchone()
        if existing is None:
            conn.execute(
                "INSERT INTO agents (id, status, updated_at) VALUES (?, 'idle', ?)",
                (agent_id, now()),
            )
        if fields:
            set_clause = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(
                f"UPDATE agents SET {set_clause}, updated_at = ? WHERE id = ?",
                (*fields.values(), now(), agent_id),
            )
        row = conn.execute("SELECT * FROM agents WHERE id = ?", (agent_id,)).fetchone()
    return dict(row)


# ---- tasks --------------------------------------------------------------------

TERMINAL_UNAVAILABLE = {"claimed", "in-progress"}  # statuses that block a new claim


class NewTask(BaseModel):
    id: str
    milestone: str
    description: str
    status: str = "todo"


class ClaimTask(BaseModel):
    agent_id: str
    branch: Optional[str] = None


class UpdateTask(BaseModel):
    status: Optional[str] = None
    owner: Optional[str] = None
    branch: Optional[str] = None
    notes: Optional[str] = None


@app.get("/tasks")
def list_tasks():
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM tasks ORDER BY milestone, id").fetchall()
    return [dict(r) for r in rows]


@app.get("/tasks/{task_id}")
def get_task(task_id: str):
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"unknown task {task_id!r}")
    return dict(row)


@app.post("/tasks")
def create_task(task: NewTask):
    with db.connect() as conn:
        existing = conn.execute("SELECT 1 FROM tasks WHERE id = ?", (task.id,)).fetchone()
        if existing is not None:
            raise HTTPException(status_code=409, detail=f"task {task.id!r} already exists")
        conn.execute(
            "INSERT INTO tasks (id, milestone, description, status, updated_at) VALUES (?, ?, ?, ?, ?)",
            (task.id, task.milestone, task.description, task.status, now()),
        )
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task.id,)).fetchone()
    return dict(row)


@app.post("/tasks/{task_id}/claim")
def claim_task(task_id: str, claim: ClaimTask):
    """Atomic claim: fails with 409 if someone else already holds it. This is the operation
    the old git protocol couldn't make atomic — two agents could both read `todo` from
    TASKS.md before either had pushed a claim."""
    with db.immediate_transaction() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"unknown task {task_id!r}")
        if row["status"] in TERMINAL_UNAVAILABLE and row["owner"] != claim.agent_id:
            raise HTTPException(
                status_code=409,
                detail=f"task {task_id!r} already claimed by {row['owner']!r} (status={row['status']!r})",
            )
        if row["status"] == "done":
            raise HTTPException(status_code=409, detail=f"task {task_id!r} is already done")
        conn.execute(
            "UPDATE tasks SET status = 'claimed', owner = ?, branch = ?, updated_at = ? WHERE id = ?",
            (claim.agent_id, claim.branch, now(), task_id),
        )
        updated = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return dict(updated)


@app.post("/tasks/{task_id}")
def update_task(task_id: str, update: UpdateTask):
    fields = {k: v for k, v in update.model_dump().items() if v is not None}
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"unknown task {task_id!r}")
        if fields:
            set_clause = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(
                f"UPDATE tasks SET {set_clause}, updated_at = ? WHERE id = ?",
                (*fields.values(), now(), task_id),
            )
        updated = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return dict(updated)
