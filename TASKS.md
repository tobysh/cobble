# Task board

Live status for `docs/ARCHITECTURE.md`'s milestones. This file is the multi-agent coordination point — see "Working with multiple agents" in `CLAUDE.md` for the protocol. Keep entries short; this is a claim board, not a design doc.

Status values: `todo` · `claimed` · `in-progress` · `blocked` · `done`

## M0 — Scaffolding

| Task | Status | Owner / branch | Notes |
|---|---|---|---|
| Cargo workspace root + `src-tauri` crate | done | — | `Cargo.toml`, `src-tauri/` |
| Vite + React + TS frontend scaffold | done | — | `frontend/` |
| Tauri shell wired to frontend (dev/build commands, ports) | done | — | root `package.json` + `pnpm-workspace.yaml` hold the Tauri CLI; `frontend/` has its own `package.json` for the app itself |
| Linux system deps for Tauri (webkit2gtk, etc.) | done | — | installed via apt in this dev environment; a fresh machine will need the same (see README) |
| Full `pnpm exec tauri build --debug` verified end-to-end | done | — | fixed a Vite/esbuild target bug (`safari13` tripped a destructuring-transform bug on this Vite 8/esbuild combo — removed the pinned `build.target`); deb/rpm/AppImage bundles all built successfully |

## M1 — Page tree + basic editor + storage

| Task | Status | Owner / branch | Notes |
|---|---|---|---|
| `cobble-core`: `Page`/`Block` domain types | done | main (solo session) | `Page`/`Block`/`PropertyValue`/ULID-based `PageId`/`BlockId`; `database_schema` left as opaque JSON pending M3; round-trip tests pass |
| `cobble-storage`: file format read/write, atomic writes, ULID IDs | done | merged to `main` via PR #1 (`agent/cobble-storage`) | Conflict resolved — `agent/task1`'s independent duplicate was not merged; that worktree/branch can be dropped. `Workspace::open/write_page/read_page/read_page_by_id/find_page_path/list_pages/trash_page`, 17 tests passing |
| `cobble-index`: SQLite schema + `rebuild_all()` | in-progress | `agent/task0` (rebased onto main, PR pending) | |
| `cobble-watcher`: FS watch → incremental reindex | in-progress | agent/cobble-watcher (rebased onto main, PR pending) | crate scaffolded: debounced `notify` watch over the pages dir, content-hash reconciliation → `WatchEvent{Created,Modified,Removed}`; convergence test passes. Not yet wired to `cobble-index` or Tauri commands. |
| Tauri commands: `create_page`, `get_page`, `update_page_blocks`, `list_children`, `move_page`, `delete_page` | in-progress | `agent/cobble-tauri-commands` (pushed) | 7 tests passing against `cobble-storage`; not yet merged to `main` — ready whenever |
| Frontend: sidebar page tree | todo | | |
| Frontend: Lexical editor shell, minimal node set (paragraph/heading/todo/divider) | todo | | |

## M2 — Rich blocks + global calendar

| Task | Status | Owner / branch | Notes |
|---|---|---|---|
| Remaining block types (toggle, quote, code, image, table, sub-page) | todo | | |
| Drag-to-reorder | todo | | |
| Slash-command menu | todo | | |
| `properties` table + reserved `date`/`_is_daily_note` keys | todo | | |
| Global `CalendarGrid` + daily-note template/auto-create | todo | | |

## M3 — Databases + views

| Task | Status | Owner / branch | Notes |
|---|---|---|---|
| `database_schema` + typed properties read/write | todo | | |
| Table view | todo | | |
| Board/Kanban view | todo | | |
| List view | todo | | |
| Gallery view | todo | | |
| Database calendar view (shares `CalendarGrid`) | todo | | |
| Filter/sort/group query builder | todo | | |

## M4 — Plugin API MVP

| Task | Status | Owner / branch | Notes |
|---|---|---|---|
| `cobble-plugin-host`: wasmtime setup, fuel/memory limits | todo | | |
| WIT interface (`cobble-plugin.wit`) | todo | | |
| Manifest parsing + permission enforcement | todo | | |
| `PluginBlockNode` (Lexical decorator) | todo | | |
| `UiSchemaRenderer.tsx` | todo | | |
| `hello-world` sample plugin | todo | | |

## M5 — Theming, motion & hardening

| Task | Status | Owner / branch | Notes |
|---|---|---|---|
| Light/Dark/Night tokens + theme switcher | todo | | |
| `frontend/src/theme/motion.ts` shared presets | todo | | |
| Glassmorphic `CommandPalette.tsx` (Cmd+K + slash menu share the motion language) | todo | | |
| Hover animation pass across interactive elements | todo | | |
| Stylelint/CI token-enforcement rule | todo | | |
| `custom_ui` iframe escape hatch + permission-consent UI | todo | | |
| Search polish, backlinks panel, trash/restore | todo | | |

## How to claim a task

1. `git fetch origin && git log origin/main -1 -- TASKS.md` (or just re-read this file after pulling `main`) — a claim that only exists in your local worktree doesn't count; someone else can't see it.
2. Edit your row: set `Status` to `claimed`, fill `Owner / branch` with your worktree's branch name (see `CLAUDE.md`), commit just that change with a message like `tasks: claim cobble-storage file format`.
3. **`git push` your branch to `origin`, then merge that one-line claim commit into `main` and `git push origin main` immediately** — a claim sitting only in a local commit (even a pushed *branch*, if it's not also merged to `main`) is invisible to another agent reading `main`'s `TASKS.md`, which is exactly how the M1 `cobble-storage` double-build happened (2026-09-01: `agent/cobble-storage` and `agent/task1` both built it — see that row's note). Do the merge-to-`main` step *before* starting real work, not after.
4. Update to `in-progress` → `done` as you go, pushing + merging the status line each time — not just at the end. `blocked` with a one-line reason if you get stuck on something another agent owns.
5. If you're not sure whether a task is already spoken for (e.g. someone told you your assignment out-of-band, not through this file), `git fetch` and check here first — `TASKS.md` on `main` is the single source of truth for claims. If another coordination doc (e.g. `agents.md`) disagrees with this file, this file wins; reconcile the other doc or flag the mismatch rather than trusting it silently.
