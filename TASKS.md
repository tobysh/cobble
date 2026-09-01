# Task board (snapshot — not live)

**This file is no longer the coordination point.** It's a point-in-time export, seeded once via
`tools/coord-server/seed_from_tasks_md.py`, and won't reflect claims/status changes made
through the server afterwards. The live state is the coordination server described in
"Working with multiple agents" in `CLAUDE.md` — query it with `GET localhost:8420/tasks`, or
see `tools/coord-server/README.md`. Don't hand-edit the Status/Owner columns below; they'll
just drift, which is the exact problem this replaced (see `CLAUDE.md` for the 2026-09-01
`cobble-storage` double-build that motivated the switch).

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
| `cobble-index`: SQLite schema + `rebuild_all()` | in-progress | `agent/task0` (rebased onto main, PR pending) | `pages`/`blocks`/`properties`/`database_schemas`/`links`/`blocks_fts` (FTS5); `rebuild_all()` rescans `*.cobble.json`, skips corrupt files without aborting; query helpers (`list_children`, `pages_with_date_between`, `search_blocks`, `backlinks`); reads files directly rather than depending on `cobble-storage` — fine, both just read the same on-disk format independently |
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

Use the coordination server, not this file:

```sh
curl -s -X POST localhost:8420/agents -H 'content-type: application/json' \
  -d '{"id":"<your-agent-id>","branch":"agent/<task-slug>","worktree":"'"$(pwd)"'"}'
curl -s localhost:8420/tasks
curl -s -X POST localhost:8420/tasks/<task-id>/claim -H 'content-type: application/json' \
  -d '{"agent_id":"<your-agent-id>","branch":"agent/<task-slug>"}'
# ... do the work ...
curl -s -X POST localhost:8420/tasks/<task-id> -H 'content-type: application/json' \
  -d '{"status":"done","notes":"..."}'
```

See `tools/coord-server/README.md` for the full API and rationale.
