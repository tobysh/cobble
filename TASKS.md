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
| `cobble-storage`: file format read/write, atomic writes, ULID IDs | claimed | agent/cobble-storage | |
| `cobble-index`: SQLite schema + `rebuild_all()` | todo | | |
| `cobble-watcher`: FS watch → incremental reindex | todo | | |
| Tauri commands: `create_page`, `get_page`, `update_page_blocks`, `list_children`, `move_page`, `delete_page` | todo | | |
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

1. Check this file is current (`git pull` / re-read after a merge).
2. Edit your row: set `Status` to `claimed`, fill `Owner / branch` with your worktree's branch name (see `CLAUDE.md`), commit just that change with a message like `tasks: claim cobble-storage file format`.
3. Push/merge that claim *before* starting real work, so two agents don't claim the same row.
4. Update to `in-progress` → `done` as you go; `blocked` with a one-line reason if you get stuck on something another agent owns.
