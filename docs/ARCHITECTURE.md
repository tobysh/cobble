# Cobble — Architecture

Cobble is a Notion-style workspace app: Rust backend, Tauri desktop shell, React/TypeScript frontend. Local-first, single-user, single-device for now. This document is the durable source of truth for the design decisions below — copied in from the original planning session so it survives across machines and agent sessions, not just one machine's local plan cache.

## Core decisions

- **Stack**: Rust + Tauri + React/TypeScript.
- **Storage**: hybrid — plain JSON files are the source of truth; SQLite is a fully rebuildable derived index/cache (fast queries, FTS, database views).
- **Content model**: full nested page tree + rich block editor (paragraph, heading, to-do, toggle, quote, code, image, divider, table, embedded sub-page, drag-reorder).
- **Databases**: full Notion-style typed properties + multiple views (table, board, list, calendar, gallery).
- **Calendar**: global calendar driven by a reserved `date` property on any page, daily-journal auto-create-on-click, composes with (but is distinct from) per-database calendar views.
- **Plugins**: sandboxed WASM (wasmtime, WASI component model). Can register block types, sidebar panels, slash commands/automations, data sources. UI renders through a declarative schema mapped to the app's own themed components (plugin UI can't break theming by construction), with an opt-in sandboxed-iframe escape hatch for custom UI.
- **Theme**: three selectable themes — **Light** and **Dark** mirror Notion's own palettes (colored tags/accents included); **Night** is a strict off-black/off-white monochrome theme. Default on first launch: Dark. One reserved muted "danger" accent exists in all three themes, for destructive/error states only.
- **Motion**: glassmorphic surfaces (translucent blur, iOS-26-"Liquid Glass"-inspired) for overlays/panels, Framer-Motion-driven spring animations for the command dropdown (`/` menu, Cmd+K palette) and hover states.
- **Sync**: not built now, but the file format uses stable ULIDs and diffable JSON specifically so a future sync layer doesn't require a rewrite.

## Repo layout

```
cobble/
├── Cargo.toml                  # workspace root
├── src-tauri/                  # thin Tauri shell: command handlers only, no business logic
│   └── src/{main.rs, commands/{pages,blocks,databases,search,calendar,plugins}.rs, state.rs, events.rs}
├── crates/
│   ├── cobble-core/            # domain types (Page, Block, PropertySchema, DatabaseSchema) — no I/O
│   ├── cobble-storage/         # on-disk file format, atomic writes, ULID IDs
│   ├── cobble-index/           # SQLite schema/migrations, rebuild-from-files, query layer
│   ├── cobble-watcher/         # `notify`-based FS watcher → incremental index updates
│   ├── cobble-search/          # FTS5 query helpers
│   ├── cobble-plugin-host/     # wasmtime host, WIT bindings, permission enforcement
│   └── cobble-plugin-sdk/      # Rust SDK for plugin authors (compiled to a WASI component)
├── frontend/                   # Vite + React + TypeScript
│   └── src/{app, editor/{nodes,plugins,plugin-blocks}, database, calendar, sidebar, theme, plugin-runtime, state, lib/tauri-client.ts}
└── plugins/hello-world/        # sample plugin used to validate the plugin host
```

Business logic lives in testable Rust crates (`cargo test`, no Tauri needed); `src-tauri` only marshals frontend calls into core/storage/index calls. Frontend uses TanStack Query for server-state (backed by `invoke()`, invalidated on file-change events from `cobble-watcher`) and Zustand for UI-only state.

**Block editor: Lexical.** Each block type maps to a Lexical `Node` subclass; `DecoratorNode` handles image/table/sub-page blocks and plugin-declared UI. Lexical's JSON serialization maps closely onto the on-disk block schema. `frontend/src/editor/serialization.ts` (Lexical `EditorState` ↔ on-disk block JSON) is the single highest-risk correctness surface in the frontend — treat changes there with the same care as a storage-format migration.

**Type sharing**: `ts-rs` or `specta` generate TypeScript types from `cobble-core` Rust types — keep the IPC boundary in sync as the schema evolves; don't hand-maintain duplicate type definitions on both sides.

## File format & storage

- One JSON file per page: `pages/<title-slug>-<ulid>.cobble.json`. Flat directory — tree structure lives in a `parent_id` field, not the path, so renames/moves never touch other files and IDs stay stable for future sync/links.
- Every block has a stable ULID. Page file shape: `{format_version, id, kind: "page"|"database", parent_id, title, icon, properties, database_schema, blocks[]}`. Blocks: `{id, type, attrs, content, children[]}`. Plugin-contributed blocks use `type: "plugin_block"` with `attrs: {plugin_id, block_type, data}` so unknown/disabled plugin data degrades to a placeholder rather than corrupting the schema.
- **A database is a page** (`kind: "database"`) carrying `database_schema` (typed property defs + saved `views[]`). **A database row is a page** whose `parent_id` is the database and whose `properties._schema_ref` points at it.
- SQLite (`.cobble/index.sqlite3`, WAL mode) mirrors this: `pages`, `blocks` (flattened, for search/backlinks), `properties` (typed, indexed on `value_date` — powers the global calendar), `database_schemas`, `blocks_fts` (FTS5), `links` (backlinks/relations).
- **Consistency model**: files are truth, SQLite is a derived cache. Write path: mutate in-memory → atomic file write (temp file + fsync + rename) → reindex just that file → emit event to invalidate frontend queries. Read path for editing goes straight to the file; list/search/view reads go through SQLite. `cobble-watcher` catches external edits and reindexes just the changed file (content-hash check avoids redundant work from the app's own writes). Full `rebuild_all()` is the recovery path if the index is missing/corrupt/version-mismatched.

## Theming

- CSS custom properties in `frontend/src/theme/tokens.css`, structured as semantic tokens (`--bg-canvas`, `--bg-surface`, `--bg-glass`, `--text-primary`, `--text-secondary`, `--selection-bg`, `--focus-ring`, `--accent`, `--danger`, `--tag-*`) remapped per `data-theme="light"|"dark"|"night"`.
  - **Light/Dark**: Notion-style palettes, real accent hue, full colored tag support.
  - **Night**: strict grayscale ramp (`--gray-0`…`--gray-12`), zero hue except the shared `--danger` accent.
- **One reserved danger accent** (`--danger`) per theme, muted relative to that theme's palette, used only for destructive/error states.
- Enforcement: a lint rule (stylelint or CI grep) rejects raw hex/hsl/rgb outside `tokens.css`. Plugin UI is enforced structurally — the declarative UI schema only exposes semantic variants, never raw color.

## Motion & visual design

- Shared Framer Motion presets in `frontend/src/theme/motion.ts`, reused by every animated surface.
- Glassmorphism via a `--bg-glass` token (semi-transparent surface + `backdrop-filter: blur(...)`) with a hairline border, applied to command palette, slash menu, popovers, dialogs.
- Command dropdown (`/` slash menu + Cmd+K palette): spring-based scale+fade+slight-blur-in entrance, staggered item fade-in, quicker reverse exit — one shared motion language across both.
- Hover animations kept fast (~120–180ms) via shared presets, not ad hoc per component.

## Plugin system

- Runtime: wasmtime, WASI-preview2 components, interface defined once in `crates/cobble-plugin-host/wit/cobble-plugin.wit`, consumed by host and guest via `wit-bindgen`. Per-plugin `Store` with fuel metering + memory limits.
- Host API: page/data access (`get-page`, `query-pages`, `create-page`, `update-block-data`), `subscribe-event`/`on-event` (automations hook), permission-gated `http-fetch` (host-mediated, no raw sockets), registration calls (`register-block-type`, `register-slash-command`, `register-sidebar-panel`).
- **Rendering mechanism**: plugins return a declarative UI schema (JSON tree over a small widget vocabulary) rather than shipping HTML/JS. `frontend/src/plugin-runtime/UiSchemaRenderer.tsx` maps this to the app's own themed React primitives — this is what makes "plugins can't break theming" structural, not conventional. A single generic `PluginBlockNode` (Lexical `DecoratorNode`) hosts all plugin blocks, differentiated at the render layer by plugin registry lookup (sidesteps Lexical's requirement that node types be statically registered).
- Escape hatch: `permissions.custom_ui = true` allows a sandboxed `<iframe sandbox="allow-scripts">` with postMessage comms and injected theme CSS variables — flagged to the user at install as visually unverified.
- Manifest (`plugin.toml`): `[permissions]` (read_pages, write_pages, network allowlist, events, custom_ui) and `[contributes]` (block_types, slash_commands, sidebar_panels, data_sources). Deny-by-default — every host call checks the calling plugin's parsed permission set first.

## Global calendar & daily notes

- Reserved `date` property key on any page powers the global calendar: `SELECT ... FROM properties WHERE key = 'date' AND value_date BETWEEN ? AND ?` joined to `pages`.
- Clicking a day looks for a page with `date == day AND _is_daily_note == true`; if absent, creates one from a user-editable template (`.cobble/templates/daily-note.cobble.json`) under a configurable Journal root.
- Per-database calendar views share the same `CalendarGrid` component as the global calendar but a different query hook (scoped by `database_id` + chosen date property vs. unscoped `key = 'date'`).

## Milestones

1. **M0 — Scaffolding**: workspace init, Tauri + Vite wired together, dev loop confirmed.
2. **M1 — Page tree + basic editor + storage**: `cobble-core`/`cobble-storage`/`cobble-index`/`cobble-watcher`, minimal block set (paragraph/heading/todo/divider), sidebar page tree, save-on-change.
3. **M2 — Rich blocks + global calendar**: remaining block types, drag-reorder, slash menu, `properties`/date indexing, global `CalendarGrid`, daily notes.
4. **M3 — Databases + views**: `database_schema`, typed properties, table/board/list/gallery/calendar views, filter/sort/group.
5. **M4 — Plugin API MVP**: `cobble-plugin-host`, WIT interface, manifest + permission enforcement, `PluginBlockNode` + `UiSchemaRenderer`, `hello-world` sample plugin.
6. **M5 — Theming, motion & hardening**: finalize Light/Dark/Night tokens + theme switcher, Framer Motion presets + glassmorphic command palette/slash menu/hover animations, stylelint enforcement, `custom_ui` iframe path, permission-consent UI, search polish, backlinks, trash/restore.

Live task-level status and claims are tracked in `TASKS.md`, not here — this file is the stable design reference and should only change when an architectural decision actually changes.

## Verification approach

- `cobble-core`/`cobble-storage`/`cobble-index`: `cargo test` round-trip tests (Page ↔ JSON, byte-stable re-serialize), atomic-write crash-simulation, `rebuild_all()` correctness against fixture directories.
- `cobble-watcher`: integration test writing/modifying/deleting files in a temp dir, asserting index convergence.
- `cobble-plugin-host`: load `hello-world`, assert manifest parsing, permission-denial on out-of-scope calls, fuel-exhaustion termination; adversarial test plugins (filesystem escape, network-permission bypass, resource exhaustion) to verify the sandbox holds.
- Frontend: Vitest for `UiSchemaRenderer` (schema→DOM, no non-token colors reachable) and editor serialization round-trip.
- End-to-end: Playwright via `tauri-driver` per milestone.
- Manual checkpoint each milestone via `pnpm exec tauri dev`, including a "kill mid-edit, relaunch, confirm no data loss" check since file-durability is the app's core safety promise.
