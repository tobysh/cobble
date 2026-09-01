# Cobble

A Notion-style workspace app — Rust backend, Tauri desktop shell, React/TypeScript frontend. Off-black/off-white monochrome "Night" theme plus Notion-mirrored Light/Dark themes, a global calendar, full relational databases, and a sandboxed WASM plugin API.

**Read `docs/ARCHITECTURE.md` before making any non-trivial change.** It's the full design doc (storage format, data model, plugin system, theming, motion, milestones) and is the source of truth — more detailed and more durable than this file. This file (`CLAUDE.md`) covers *how to work in this repo day to day*; `docs/ARCHITECTURE.md` covers *what we're building and why*. Check the coordination server (`GET localhost:8420/tasks`, see "Working with multiple agents" below) for current status before picking up work.

## Commands

```sh
# one-time environment setup (Linux) — Tauri needs these system libs to compile/run
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

pnpm install                       # installs both root (Tauri CLI) and frontend/ deps (pnpm workspace)

pnpm exec tauri dev                 # full app, hot-reloading (needs a display — GUI app)
pnpm exec tauri build --debug       # full build without launching, good for CI/headless verification
pnpm --dir frontend build           # frontend only (tsc -b && vite build)
pnpm --dir frontend dev             # Vite dev server alone, port 1420

cargo check --workspace             # fast compile check, all crates
cargo test --workspace              # unit/integration tests (cobble-core/storage/index/watcher/plugin-host)
cargo check -p app                  # just the Tauri shell crate (package name is "app", see src-tauri/Cargo.toml)
```

There is no display in most CI/headless/container environments — `tauri dev` and running the built binary need one. `tauri build --debug` and `cargo check`/`cargo test` do not, and are the right way to verify work in a headless agent session.

## Conventions specific to this project

- **Files are truth, SQLite is a cache.** Never make `cobble-index` the only place a piece of data lives. Any write path that doesn't go file → reindex is a bug, not a shortcut.
- **`cobble-core` has no I/O.** If you're tempted to add a file read or a SQL query there, it belongs in `cobble-storage` or `cobble-index` instead.
- **Theme tokens only.** No raw hex/hsl/rgb in component styles — everything goes through `frontend/src/theme/tokens.css`'s semantic tokens, which are defined per-theme (`light`/`dark`/`night`). This applies doubly to anything reachable from the plugin `UiSchemaRenderer` — plugins must never be able to specify a raw color.
- **Plugin host calls are deny-by-default.** Every new host function `cobble-plugin-host` exposes needs an explicit permission check against the calling plugin's manifest before it's usable — don't add a capability without wiring its permission gate in the same change.
- **Block IDs are forever.** Blocks and pages are identified by ULID, never by position/index — anything that references a block (relations, links, plugin data) stores the ID, and IDs are never reused or reassigned on edit/move.

## Working with multiple agents

This repo is set up to be worked on by several Claude Code instances at once, all currently on the same host as separate git worktrees. The coordination point is the **coordination server** in `tools/coord-server/` (FastAPI + SQLite, see its README) — not `TASKS.md`. `TASKS.md` used to be the live claim board via git, but with N worktrees each holding their own checkout it was only ever as fresh as the last `fetch`+merge to `main`, which is exactly how `agent/cobble-storage` and `agent/task1` both ended up independently building the full `cobble-storage` crate on 2026-09-01. The server is a single live process every worktree talks to over HTTP, with an atomic claim endpoint, so that race can't happen. `TASKS.md` is now a point-in-time snapshot only — don't hand-edit its status/owner columns; treat the server's `GET /tasks` as truth.

Start of session:
```sh
curl -s -X POST localhost:8420/agents -H 'content-type: application/json' \
  -d '{"id":"<your-agent-id>","branch":"agent/<task-slug>","worktree":"'"$(pwd)"'"}'
curl -s localhost:8420/tasks   # see what's todo/claimed/in-progress/blocked/done
```
If nothing answers on `localhost:8420`, the server isn't running — start it per `tools/coord-server/README.md` rather than falling back to editing `TASKS.md` by hand.

A few things that make parallel work safe here specifically:

- **Crate/directory boundaries are the parallelism unit.** `cobble-core`, `cobble-storage`, `cobble-index`, `cobble-watcher`, `cobble-search`, `cobble-plugin-host`, `cobble-plugin-sdk`, and `frontend/` are deliberately separable. Prefer claiming a whole crate or a whole frontend subdirectory (`editor/`, `database/`, `calendar/`, `theme/`, `plugin-runtime/`) per task rather than splitting one file across two agents.
- **`cobble-core` is the one shared surface — be careful there.** Almost everything depends on it. If your task requires changing a type in `cobble-core`, either: (a) make it additive (new optional field, new enum variant) so other in-flight work doesn't break, or (b) if it must be a breaking change, do it in its own small, fast task and post a note on it via `POST /tasks/{id}` so other agents know to rebase. Don't leave `cobble-core` in a state that fails `cargo check --workspace`.
- **Use a separate git worktree per agent/task**, not the same working directory two instances both run `cargo`/`pnpm` in simultaneously — concurrent builds in one `target/`/`node_modules` will race and corrupt each other's build state.
  ```sh
  git worktree add ../cobble-<task-slug> -b agent/<task-slug>
  cd ../cobble-<task-slug> && pnpm install   # each worktree needs its own install
  ```
  Each worktree gets its own `target/` and build state; only the git history is shared. Merge back to `main` via a normal branch/PR flow, not by editing the same files from two worktrees at once.
- **Before ending a task, verify the crates/dirs you touched still build**: `cargo check --workspace` for any Rust change, `pnpm --dir frontend build` for any frontend change — even if your task was scoped to one crate, a breaking `cobble-core` change can silently break a sibling crate that isn't yours.
- **Commit small and often within your task**, so a conflict (if two agents did end up touching overlapping code) is a normal git merge conflict to resolve, not a lost afternoon of work.
- **Claim before starting real work**: `POST /tasks/{id}/claim {"agent_id": "...", "branch": "..."}`. A 409 means someone beat you to it — go pick something else, don't just start working anyway. This *is* atomic (unlike the old git protocol), so there's no push/merge dance needed before it's real.
- **Update task status as you go** (`POST /tasks/{id} {"status": "...", "notes": "..."}`), not just at the end — another agent deciding what to pick up next is reading it live. And update your own agent record (`POST /agents/{id}`) when you go idle or switch tasks.
- **The coordination server is the only source of truth for claims.** If you were told your assignment some other way (a separate notes file like the stray `agents.md`, a message, an out-of-band list), reconcile it against `GET /tasks` before starting — don't trust an assignment that hasn't been cross-checked against the live server, and don't leave a second coordination file around that can drift out of sync with it.

## Environment notes

This was scaffolded in a GitHub Codespace as a temporary environment (per the user) — expect to redo the one-time system-dependency install (see Commands) on whatever machine becomes the permanent dev environment. Nothing about the app itself is Codespace-specific.
