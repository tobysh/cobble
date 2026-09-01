# Coordination server

Replaces the git/`TASKS.md`-based claim protocol described in `CLAUDE.md`. That protocol's
weak point: each agent works in its own worktree, so `TASKS.md` is only as fresh as the last
`git fetch` + merge to `main` — on 2026-09-01 two agents both built `cobble-storage` because
one agent's claim commit hadn't been pushed and merged before the other looked. This server
is a single live process every agent's worktree talks to over HTTP instead, with an atomic
claim endpoint so "two agents read `todo` at the same time" can't happen.

All agents in this setup run on the same machine (different git worktrees under one host), so
this only needs to bind to `127.0.0.1` — no need to expose it beyond localhost.

## Run it

```sh
cd tools/coord-server
pip install -r requirements.txt

# first time only (or to re-sync fields TASKS.md still has that the DB doesn't) — parses
# TASKS.md's tables into coord.sqlite3, upserting by task id
python3 seed_from_tasks_md.py

uvicorn app:app --host 127.0.0.1 --port 8420
```

`coord.sqlite3` is gitignored — it's local runtime state, not source. Whoever's machine is
hosting the shared dev environment should just leave the server running (`uvicorn ... &`, a
tmux pane, or a systemd/launchd unit); it's not something each agent starts and stops.

## API

All bodies/responses are JSON.

### Agents

- `POST /agents` — register/re-register. Body: `{id, branch?, worktree?, note?}`. Idempotent.
- `GET /agents` — list every agent and its last-known status.
- `GET /agents/{id}` — one agent.
- `POST /agents/{id}` — report your own status. Body: any of
  `{branch?, worktree?, status?, current_task?, note?}` — only given fields change.
  Auto-registers if you haven't called `POST /agents` yet.

### Tasks

- `GET /tasks` — every task: `{id, milestone, description, status, owner, branch, notes, updated_at}`.
- `GET /tasks/{id}` — one task.
- `POST /tasks` — add a new task row. Body: `{id, milestone, description, status?}`. 409 if `id` exists.
- `POST /tasks/{id}/claim` — **the atomic operation.** Body: `{agent_id, branch?}`. Succeeds
  (200) only if the task is `todo`, `blocked`, or already owned by `agent_id`; otherwise 409
  with the current owner in the error detail. This is a `BEGIN IMMEDIATE` SQLite transaction,
  so concurrent claims on the same task have exactly one winner — verified by firing 5
  simultaneous claims at one task during development; exactly one got 200.
- `POST /tasks/{id}` — update fields once you hold a task. Body: any of
  `{status?, owner?, branch?, notes?}`. Not ownership-checked (an agent updating its own claim
  is the normal path; there's no multi-tenant hostility to defend against here).

`status` values: `todo`, `claimed`, `in-progress`, `blocked`, `done` (same vocabulary as the
old `TASKS.md`).

## Typical flow for an agent

```sh
curl -X POST localhost:8420/agents -d '{"id":"agent-foo","branch":"agent/foo","worktree":"/workspaces/cobble-foo"}' -H 'content-type: application/json'
curl localhost:8420/tasks   # see what's todo/claimed/blocked
curl -X POST localhost:8420/tasks/m1-cobble-index-sqlite-schema-rebuild-all/claim \
  -d '{"agent_id":"agent-foo","branch":"agent/foo"}' -H 'content-type: application/json'
# ... do the work, pushing/merging code as normal — the server only tracks claim state ...
curl -X POST localhost:8420/tasks/m1-cobble-index-sqlite-schema-rebuild-all \
  -d '{"status":"done","notes":"rebuild_all() + schema, 12 tests passing"}' -H 'content-type: application/json'
curl -X POST localhost:8420/agents/agent-foo -d '{"status":"idle","current_task":null}' -H 'content-type: application/json'
```
