# Developing Cobble

This is a guide to *working in this repository*: how it's put together, how to read it, how to
change it safely, and how to keep it healthy. It assumes you know basic Rust (structs, enums,
`impl`, `Result`/`Option`, `cargo`) but have never touched Tauri, and that you can read
TypeScript/React but haven't necessarily used Zustand or Lexical before.

For *what* Cobble is and *why* it's designed the way it is, read `docs/ARCHITECTURE.md` first —
it's the design doc and the source of truth for architectural decisions. This file is the
companion "how do I actually work in here" guide. `CLAUDE.md` has day-to-day conventions and the
multi-agent coordination protocol; skim it too if you're going to commit anything.

If you just want to get the app running, jump to [Running things](#running-things). If you want
to understand the shape of the codebase before changing anything, start at
[The three layers](#the-three-layers-of-this-app).

## The three layers of this app

Cobble is three things stacked on top of each other:

```
┌─────────────────────────────────────────┐
│  frontend/  (React + TypeScript)         │  ← what the user sees and clicks
│  runs inside an OS webview                │
└───────────────┬───────────────────────────┘
                 │ invoke("command_name", { args })
                 │ (Tauri's IPC bridge — see "What Tauri actually is" below)
┌───────────────▼───────────────────────────┐
│  src-tauri/   (thin Rust shell)            │  ← #[tauri::command] functions only
│  translates frontend calls into crate calls│
└───────────────┬───────────────────────────┘
                 │ plain Rust function calls
┌───────────────▼───────────────────────────┐
│  crates/cobble-*  (plain Rust libraries)   │  ← all the actual logic
│  no Tauri dependency, testable with        │
│  `cargo test`, no GUI needed               │
└─────────────────────────────────────────────┘
```

The important idea: **almost nothing interesting happens in `src-tauri`.** It exists only to
expose functions the frontend can call, and each one is a few lines that call into a
`cobble-*` crate and translate the result. All the real logic — reading/writing page files,
maintaining the search index, watching the filesystem, running plugins — lives in crates you can
`cargo test` without ever launching the app or having a display attached. That split is
deliberate and load-bearing: it's what lets this repo be developed headlessly (no GUI needed to
verify most changes) and by multiple agents/contributors working on different crates at once.

The other idea worth internalizing up front, because it explains half the code you'll read:
**files are the source of truth, SQLite is a disposable cache.** Every page is a JSON file on
disk. The SQLite database (`cobble-index`) exists purely to make queries (search, "list children
of this page", "what's on the calendar this week") fast — it can be deleted and rebuilt from the
JSON files at any time with no data loss. You'll see this show up constantly: write paths always
touch the file first, index second; read paths for editing go straight to the file, read paths
for listing/search go through the index.

## What Tauri actually is

If you've never used Tauri, the one-sentence version: **it's a way to ship a native desktop app
where the UI is a webview (rendered with your OS's built-in browser engine) and the backend is a
compiled Rust binary, with a typed RPC bridge connecting the two.**

A few contrasts that might help if you're coming from other stacks:

- **Not Electron.** Electron bundles a full copy of Chromium into every app. Tauri uses the
  operating system's own webview (WebKit on Linux/macOS via `libwebkit2gtk` — see the `apt-get
  install` line in `README.md` — WKWebView on macOS, WebView2 on Windows). That's why the
  Linux setup step installs `libwebkit2gtk-4.1-dev`: it's not a Cobble dependency, it's what
  Tauri needs to have a webview to render into at all. Consequence: no Chromium binary to ship,
  much smaller app bundles, but you're at the mercy of whatever webview version the OS provides.
- **Two processes, one language boundary.** There's a Rust process (compiled from
  `src-tauri/` + the `cobble-*` crates) and a webview process running your `frontend/` bundle
  (plain HTML/CSS/JS, built by Vite). They don't share memory or types automatically — every
  interaction between them is an explicit, serialized message.
- **Not a web app with a Rust API server.** There's no HTTP server, no port, no network stack
  involved in frontend↔backend calls (in dev mode Vite does run on `localhost:1420` — see
  `devUrl` in `src-tauri/tauri.conf.json` — but that's just how Tauri points its embedded
  webview at the dev server; production builds embed the built frontend directly, no server).

### The `invoke()` bridge

The single mechanism connecting the two sides is `invoke()`. On the Rust side, you write a plain
function and tag it:

```rust
// src-tauri/src/commands/pages.rs
#[tauri::command]
pub fn get_page(state: State<AppState>, id: PageId) -> Result<Option<Page>, String> {
    get_page_impl(&state.workspace, id)
}
```

...and register it once in `src-tauri/src/lib.rs`:

```rust
.invoke_handler(tauri::generate_handler![
  commands::pages::create_page,
  commands::pages::get_page,
  commands::pages::update_page_blocks,
  commands::pages::list_children,
  commands::pages::move_page,
  commands::pages::delete_page,
])
```

On the frontend side, you call it by name, passing arguments as a plain object:

```typescript
// frontend/src/state/api.ts
const page = await invoke<BackendPage | null>('get_page', { id })
```

A few things worth knowing about this bridge, because they explain patterns you'll see
throughout the code:

- **Everything is serialized as JSON under the hood.** Arguments and return values must be
  `Serialize`/`Deserialize` on the Rust side and JSON-compatible on the TS side. This is why
  `cobble-core` types derive `serde::{Serialize, Deserialize}` — the same derive that lets them
  round-trip to disk as JSON also lets them cross the `invoke()` boundary.
- **Rust `snake_case` becomes JS `camelCase` automatically for argument names**, but *not* for
  the JSON *shape* of returned structs (those keep whatever serde produces, which is
  `snake_case` unless a field has `#[serde(rename)]`). This is exactly why `state/api.ts` has a
  `BackendPage` interface with `snake_case` fields matching the wire format, and a
  `fromBackendPage()` mapper that converts to the UI-facing `camelCase` `Page` type in
  `state/types.ts`. If you add a new Rust command argument or return field, check both directions
  before assuming the naming "just works."
- **Errors are just another return value.** Commands here return `Result<T, String>` — a
  `#[tauri::command]` fn returning `Err(String)` gets turned into a rejected Promise on the JS
  side, but there's no special Rust-error-type marshaling; every error type is flattened to a
  `String` with `.map_err(|err| err.to_string())` before it crosses the boundary (see any
  function in `src-tauri/src/commands/pages.rs`).
- **State is shared via `app.manage()` + `tauri::State`.** `AppState` (workspace + index) is
  constructed once in `lib.rs`'s `setup()` closure and handed to Tauri with `app.manage(...)`.
  Every command that needs it just declares `state: State<AppState>` as a parameter and Tauri
  injects it — this is dependency injection, not a global; see [State
  management](#state-management-and-concurrency) below for how the locking works.

### `main.rs` vs `lib.rs`

You'll notice `src-tauri/src/main.rs` is almost empty:

```rust
fn main() {
  app_lib::run();
}
```

...and all the actual setup lives in `src-tauri/src/lib.rs`'s `run()` function. This split
exists because Tauri apps can also target mobile (iOS/Android), which needs the app's entry point
to be a library function callable from platform-specific glue code, not a `fn main()` (mobile
platforms don't have a traditional `main`). Cobble is desktop-only today, but the scaffold
follows Tauri's standard convention so mobile isn't a rewrite later. In practice: **almost
everything you do lives in `lib.rs` and the modules it pulls in, never `main.rs`.**

### `tauri.conf.json` and capabilities

`src-tauri/tauri.conf.json` is Tauri's own config (window size, app identifier, how to build the
frontend, bundling targets). Skim it once; you likely won't need to touch it unless you're
changing window behavior or bundle settings.

`src-tauri/capabilities/default.json` is Tauri's *permission* system — a separate, coarser-grained
thing from the plugin permission system described in `docs/PLUGINS.md`. It controls what native
APIs the **webview itself** is allowed to call (filesystem, shell, dialogs, etc.) — Tauri is
deny-by-default here too, same philosophy as the plugin host. Right now it just grants
`core:default`, the baseline permission set. If you ever add a Tauri plugin (e.g. for native file
dialogs), you'll need to add its permission here — the app will fail at runtime, not compile
time, if you forget, so check the browser devtools console in `tauri dev` if a Tauri API call
silently does nothing.

## Rust patterns you'll see everywhere here

If your Rust experience is "I know the syntax and `Result`/`Option`" level, here are the patterns
this codebase leans on repeatedly, explained once so you're not re-deriving them from context
every time.

### Cargo workspace = multiple crates, one `cargo` invocation

The root `Cargo.toml` is a *workspace* — it doesn't build anything itself, it just lists member
crates:

```toml
[workspace]
members = ["src-tauri", "crates/cobble-core", "crates/cobble-storage", "crates/cobble-index", "crates/cobble-watcher", "crates/cobble-plugin-host"]
```

Each member is its own crate with its own `Cargo.toml`, its own `src/lib.rs`, its own tests — but
`cargo check --workspace` / `cargo test --workspace` run across all of them in one invocation,
and they share a `target/` build cache and a single `Cargo.lock`. When you see
`cobble-core = { path = "../crates/cobble-core" }` in another crate's `Cargo.toml`, that's a
plain local path dependency — no different from depending on a crates.io crate, except the source
is right there in the repo.

Why split into so many crates instead of one big one? Two reasons, both explained in `CLAUDE.md`:
it makes the crate/directory boundary a natural unit of parallel work (one person/agent can own
`cobble-index` while another owns `cobble-watcher` without stepping on each other), and it
enforces layering — `cobble-core` *can't* accidentally do file I/O because it doesn't depend on
`std::fs`-using crates at all; the dependency graph itself is the enforcement mechanism, not just
a convention.

### The newtype-ID pattern

Every ID in this codebase (`PageId`, `BlockId`, `ViewId`) is generated by one macro in
`crates/cobble-core/src/id.rs`:

```rust
macro_rules! ulid_id {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub Ulid);
        // ... `new()`, `Display`, `FromStr`, `From<Ulid>`
    };
}

ulid_id!(PageId);
ulid_id!(BlockId);
ulid_id!(ViewId);
```

If macros are new to you: this is a declarative macro (`macro_rules!`) that expands to a struct
definition at compile time — `ulid_id!(PageId);` literally pastes in a `struct PageId(pub Ulid)`
plus all those trait impls, so all three ID types get the identical set of derives and methods
without hand-writing them three times.

The *point* of wrapping a plain `Ulid` in `struct PageId(Ulid)` rather than passing `Ulid` (or
worse, `String`) around directly is type safety: a function that takes `(page_id: PageId,
block_id: BlockId)` can't be called with the arguments swapped, because they're different types —
the compiler catches it. This is why `get_block_data(page_id: String, block_id: String)` in the
plugin host's WIT-generated bindings re-validates with `PageId::from_str`/`BlockId::from_str`
immediately (`crates/cobble-plugin-host/src/host.rs`) — once IDs cross a boundary that only knows
raw strings (like the wasm ABI), you lose that compiler guarantee and have to re-check by hand at
the boundary.

`#[serde(transparent)]` means the wrapper is invisible in JSON — a `PageId` serializes as just
the ULID string (`"01ARZ3ND..."`, not `{"0": "01ARZ3ND..."}`), which is what makes it usable
directly as a JSON map key or an `invoke()` argument.

### serde attributes worth recognizing

You'll see these constantly in `cobble-core` and `cobble-storage`; each solves a specific
JSON-shape problem:

| Attribute | What it does | Why it's used here |
|---|---|---|
| `#[serde(rename_all = "snake_case")]` | Renames enum variants/fields to `snake_case` in JSON | Rust convention is `PascalCase` variants (`BlockType::SubPage`); the on-disk/wire format uses `snake_case` (`"sub_page"`) |
| `#[serde(default, skip_serializing_if = "...")]` | Field is optional on read, omitted from output when empty/default | Keeps page JSON files clean (no `"attrs": {}` clutter on every block) and makes old files without a newer field still parse |
| `#[serde(transparent)]` | Struct with one field serializes as just that field's value | The ID newtype pattern above |
| `#[serde(tag = "type")]` | Enum serializes as `{"type": "variant_name", ...other fields}` | `Mark` (`Bold`/`Italic`/`Link { href }`) — lets a JSON object self-describe which variant it is |

The general rule worth internalizing: **default-and-skip everywhere a field is optional** is what
makes the on-disk format additive-friendly — a page file written by an older version of Cobble
still parses after you add a new optional field, because missing fields fall back to their
`#[serde(default)]`.

### Errors: `thiserror` enums, not `String` (except at the Tauri boundary)

Every crate below `src-tauri` defines its own error enum with `thiserror`:

```rust
#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("io error at {path}: {source}")]
    Io { path: PathBuf, #[source] source: std::io::Error },
    #[error("page {0} not found")]
    PageNotFound(PageId),
    #[error("page {page} failed database schema validation: {source}")]
    SchemaValidation { page: PageId, #[source] source: PropertyValidationError },
}
```

`#[error("...")]` generates the `Display` impl (what you get from `.to_string()` or `{err}`);
`#[source]` wires up `std::error::Error::source()` so error-chain tools (and just eyeballing a
debug print) can see *what caused* the error, not just the top-level message. This is the pattern
to follow if you add a new fallible operation: define or extend a `thiserror` enum in the crate
where the error originates, don't reach for `anyhow`/`Box<dyn Error>` inside `cobble-*` crates
(the plugin host is the one place `anyhow` shows up, because it's wrapping wasmtime's own error
types at a boundary where a rich local enum wouldn't buy much).

`String` errors only appear at the very last hop, inside `src-tauri/src/commands/*.rs`, via
`.map_err(|err| err.to_string())` — because that's the boundary being flattened for `invoke()`
(see "Errors are just another return value" above). Keep that flattening at the Tauri boundary,
not earlier — a `cobble-index` function that returned `String` errors would make its own tests
worse at telling you what actually went wrong.

### `?` and the "impl function" split

Nearly every Tauri command in this codebase is two functions: a thin `#[tauri::command]` wrapper
that only unlocks state, and a plain `_impl` function that does the actual work and is what gets
unit-tested:

```rust
#[tauri::command]
pub fn create_page(state: State<AppState>, title: String, parent_id: Option<PageId>) -> Result<Page, String> {
    let mut index = state.index.lock().map_err(|_| "index lock poisoned")?;
    create_page_impl(&state.workspace, &mut index, title, parent_id)
}

fn create_page_impl(workspace: &Workspace, index: &mut Index, title: String, parent_id: Option<PageId>) -> Result<Page, String> {
    let mut page = Page::new(title);
    page.parent_id = parent_id;
    let path = workspace.write_page(&page).map_err(|err| err.to_string())?;
    index.reindex_file(&path).map_err(|err| err.to_string())?;
    Ok(page)
}
```

`create_page_impl` takes plain `&Workspace`/`&mut Index` instead of `State<AppState>`, so its
tests (in the `#[cfg(test)] mod tests` block at the bottom of the same file) can call it directly
against a temp-dir `Workspace` and an in-memory `Index`, with zero Tauri runtime involved. **This
is the split to copy whenever you add a new command**: keep the `#[tauri::command]` function to
"unlock state, delegate", and put logic + tests on the `_impl` function.

Every `?` you see is ordinary Rust error propagation — nothing Tauri-specific. The one thing to
watch for is `.map_err(|err| err.to_string())?` converting a rich local error into a `String`
right before it would otherwise propagate further; that's the "flatten only at the command
boundary" rule above, made visible in the code.

### State management and concurrency

```rust
// src-tauri/src/state.rs
pub struct AppState {
    pub workspace: Workspace,
    pub index: Mutex<Index>,
}
```

`Workspace` holds only a root path — no interior mutability, no shared state — so it's safely
shared across threads with no lock at all (concurrency safety comes from the filesystem's own
atomic-rename guarantee, not from Rust). `Index` wraps a `rusqlite::Connection`, which can't be
shared across threads without synchronization, so it's behind a `std::sync::Mutex`.

The lock-poisoning handling you'll see (`.lock().map_err(|_| "index lock poisoned")?` in
commands, or the `Ok(guard) => guard, Err(poisoned) => poisoned.into_inner()` pattern in
`lib.rs`'s watcher-drain thread) exists because a `Mutex` in Rust becomes "poisoned" if a thread
panics while holding the lock — the two call sites handle it differently on purpose: a command
returns a clean error to the frontend rather than panicking the whole app, while the long-lived
background drain thread recovers the poisoned guard and keeps going, because one bad reindex
shouldn't permanently stop the watcher from processing every future file change.

### Testing conventions

Tests live next to the code they test, in a `#[cfg(test)] mod tests { ... }` block at the bottom
of the same file — not in a separate `tests/` directory, *except* for true integration tests that
exercise a crate's public API as an outside caller would (`crates/cobble-plugin-host/tests/` and
`crates/cobble-watcher/tests/` do this, because they're testing cross-module behavior — a real
wasm call, a real filesystem watch loop — that doesn't belong to any one internal module).
`tempfile::tempdir()` is the standard way to get an isolated, auto-cleaned-up directory for
filesystem tests; you'll see `open_temp_workspace()`-style helpers repeated across
`cobble-storage`, `cobble-index`, and `src-tauri/src/commands/pages.rs`.

## Repo map

```
cobble/
├── Cargo.toml                  workspace root — lists every Rust crate below
├── CLAUDE.md                   day-to-day conventions + multi-agent coordination protocol
├── TASKS.md                    point-in-time snapshot of task status (not live — see coord server)
├── docs/
│   ├── ARCHITECTURE.md         the design doc — read this before any non-trivial change
│   ├── DEVELOPMENT.md          this file
│   └── PLUGINS.md              plugin-authoring guide
├── src-tauri/                  thin Tauri shell — command handlers only, no business logic
│   └── src/
│       ├── main.rs             entry point, just calls app_lib::run()
│       ├── lib.rs              app setup: opens the workspace/index, starts the watcher, registers commands
│       ├── state.rs            AppState (the Workspace + Mutex<Index> shared across commands)
│       ├── watch.rs            applies cobble-watcher events to the index
│       └── commands/
│           └── pages.rs        create_page / get_page / update_page_blocks / list_children / move_page / delete_page
├── crates/
│   ├── cobble-core/             domain types: Page, Block, PropertyValue, DatabaseSchema, IDs — NO I/O
│   ├── cobble-storage/          on-disk file format, atomic writes, the Workspace type
│   ├── cobble-index/            SQLite schema, rebuild-from-files, query helpers (search, calendar, backlinks)
│   ├── cobble-watcher/          notify-based filesystem watcher → WatchEvent stream
│   └── cobble-plugin-host/      wasmtime sandbox, WIT bindings, permission enforcement (see docs/PLUGINS.md)
├── frontend/                    Vite + React + TypeScript
│   └── src/
│       ├── main.tsx, App.tsx    entry point, top-level layout/routing (loading/empty/page/calendar views)
│       ├── state/
│       │   ├── types.ts         TypeScript mirror of cobble-core's types
│       │   ├── api.ts           invoke() wrappers + backend<->frontend shape mapping
│       │   ├── store.ts         Zustand store: all app state + the actions that call api.ts
│       │   └── ulid.ts          client-side ULID generation (new blocks need an id before the first save)
│       ├── editor/               Lexical-based block editor (PageView, nodes.ts, serialization.ts, SlashMenu)
│       ├── sidebar/              page tree (Sidebar.tsx)
│       ├── calendar/             CalendarView.tsx
│       ├── command-palette/      Cmd+K palette (CommandPalette.tsx)
│       └── theme/                tokens.css (semantic color tokens), motion.ts (shared Framer Motion presets)
└── tools/coord-server/           FastAPI + SQLite multi-agent task-coordination server (see its own README)
```

Not everything `docs/ARCHITECTURE.md` describes exists yet — it's the target design, not a
progress report. As of this writing there is no `cobble-search` crate, no `cobble-plugin-sdk`, no
`plugins/hello-world/` sample plugin, and no `frontend/src/plugin-runtime/` — those are M4/M5
scope. Check `TASKS.md` (or better, the live coordination server — see `CLAUDE.md`) for what's
actually done versus planned before assuming a file exists.

## Data flow: following one edit end-to-end

Concretely tracing what happens when a user types in the editor and it autosaves ties the whole
stack together. This is the single most useful mental walkthrough if you're new to the repo.

1. **User types** in the Lexical editor (`frontend/src/editor/PageView.tsx`). Lexical maintains
   its own internal `EditorState` (a tree of `Node`s).
2. On change, `frontend/src/editor/serialization.ts` walks Lexical's node tree and converts it
   back into `Block[]` — the exact shape `cobble_core::Block` has on the Rust side (see the big
   comment at the top of that file: it deliberately mirrors Lexical's text-node model onto the
   on-disk block schema so this conversion stays close to 1:1). New nodes get a fresh ID from
   `state/ulid.ts`'s `newUlid()`; existing nodes keep the ID that was assigned when they were
   last saved, tracked via a `NodeKey -> BlockId` side-map (`PageView`'s `nodeIdMap` ref) since
   Lexical's own node objects don't carry Cobble's block ID.
3. The store's `saveBlocks(pageId, blocks)` action (`frontend/src/state/store.ts`) calls
   `api.updatePageBlocks(id, blocks)` (`frontend/src/state/api.ts`), which calls
   `invoke('update_page_blocks', { id, blocks })`.
4. That crosses the IPC bridge into `#[tauri::command] update_page_blocks`
   (`src-tauri/src/commands/pages.rs`), which locks the index, loads the current page from disk
   (`workspace.read_page_by_id`), replaces its `blocks`, and calls `workspace.write_page(&page)`.
5. `Workspace::write_page` (`crates/cobble-storage/src/workspace.rs`) validates the page's
   properties against its parent's database schema if applicable, then calls
   `file_format::write_page_atomic` — which serializes to JSON, writes to a temp file in the same
   directory, `fsync`s it, then does an atomic POSIX `rename()` over the real path. This is what
   makes "files are truth" a safety guarantee and not just a convention: a crash mid-write leaves
   either the fully-old file or the fully-new file, never a half-written one. If the title
   changed since the last write (so the filename would change), the new file is written *before*
   the old one is deleted, so there's never a window where the page exists under neither name.
6. Back in the command, `index.reindex_file(&path)` (`crates/cobble-index`) re-reads that one
   file and replaces just its rows in SQLite (`pages`, `blocks`, `properties`, `blocks_fts`,
   `links`) — every other page's rows are untouched.
7. Independently, `cobble-watcher`'s background thread (spawned in `lib.rs`'s `setup()`) also
   notices the file changed (via a debounced `notify` watch) and calls the same
   `index.reindex_file()` through `watch::apply_watch_event`
   (`src-tauri/src/watch.rs`). This is deliberately redundant for the app's *own* writes (the
   file's already current by the time the watcher gets to it, so it's a harmless no-op re-read)
   — but it's the *only* mechanism that picks up genuinely external edits, e.g. someone editing a
   `.cobble.json` file by hand or syncing it in from another machine. One reindex mechanism
   covers both cases instead of two divergent ones.
8. The command returns the updated `Page` back across `invoke()`; `saveBlocks` merges the
   response into the Zustand store, and React re-renders whatever reads that page's state.

A few gaps worth knowing about if you're picking up related work: **`docs/ARCHITECTURE.md`
describes TanStack Query + file-change events invalidating frontend queries; that isn't wired up
yet** — the current frontend is plain Zustand with actions that call `api.ts` directly and
update the store themselves (see `frontend/src/state/store.ts`). There's no Tauri event emission
from the backend on file change yet, and no `@tanstack/react-query` dependency in
`frontend/package.json`. If you're picking up cross-window/live-reload work, that's the gap to
close.

## Running things

```sh
pnpm exec tauri dev                 # full app, hot-reloading (needs a display — GUI app)
pnpm exec tauri build --debug       # full build without launching, good for headless verification
pnpm --dir frontend build           # frontend only: tsc -b && vite build (typecheck + bundle)
pnpm --dir frontend dev             # Vite dev server alone, port 1420 (no Rust side running)

cargo check --workspace             # fast compile check, all Rust crates
cargo test --workspace              # unit + integration tests, all Rust crates
cargo check -p app                  # just the Tauri shell crate (its package name is "app")
cargo test -p cobble-index          # just one crate's tests
```

**There is no display in most CI/headless/container environments.** `tauri dev` and the built
binary need a windowing system to open a window in; they will fail (or hang) without one.
`cargo check`/`cargo test`/`tauri build --debug`/`pnpm --dir frontend build` do **not** need a
display and are the right way to verify a change in a headless agent session or CI. If you're
working in a container and need to see the real UI, you'll need to either forward a display or
run on a machine with one.

Frontend linting: `pnpm --dir frontend lint` runs `oxlint` (config in `frontend/.oxlintrc.json`).

## Recipes: making common changes safely

### Adding a new Tauri command

1. Write the logic as a plain function over `&Workspace`/`&mut Index` (or whatever it needs) in
   `src-tauri/src/commands/<area>.rs`, with unit tests in the same file's `#[cfg(test)] mod
   tests`.
2. Wrap it in a thin `#[tauri::command] pub fn ...` that unlocks `State<AppState>` and delegates
   — copy the shape of any existing command in `pages.rs`.
3. Register it in `invoke_handler(tauri::generate_handler![...])` in `src-tauri/src/lib.rs`.
4. Add a wrapper in `frontend/src/state/api.ts` that calls `invoke('your_command', {...})`,
   mapping any `snake_case` DTO shape to the frontend's `camelCase` types if needed.
5. `cargo test --workspace` and `pnpm --dir frontend build` to verify both sides compile and pass
   before wiring up UI that calls it.

### Adding a field to `Page` or `Block`

`cobble-core` types are the shared contract between the on-disk format, the SQLite index, and the
frontend. Per `CLAUDE.md`: prefer additive changes (a new `Option<T>` field with
`#[serde(default, skip_serializing_if = "Option::is_none")]`) so old page files on disk still
parse. If you do need a breaking shape change, bump `CURRENT_FORMAT_VERSION` in
`crates/cobble-core/src/page.rs` and write a migration path in `cobble-storage` — and per
`CLAUDE.md`, do it as its own small, fast, clearly-flagged task, since nearly every crate depends
on `cobble-core`.

After changing a `cobble-core` type, check whether it needs a matching change in:
- `crates/cobble-index/src/schema.rs` + `rebuild.rs` (if the field should be queryable/indexed)
- `frontend/src/state/types.ts` (the hand-maintained TypeScript mirror — see the note below on
  why this isn't generated yet)
- `frontend/src/state/api.ts` (if the wire shape needs mapping, like `date`/`_is_daily_note`
  do today)

**Type sharing is currently hand-maintained, not generated.** `docs/ARCHITECTURE.md` calls for
`ts-rs` or `specta` to generate `state/types.ts` from `cobble-core`, but that isn't wired up yet
— `types.ts` is a manually-kept-in-sync mirror (see its file-level comment). Until that lands,
**changing a `cobble-core` field's name or shape and not updating `types.ts` to match is a silent
runtime bug, not a compile error** — TypeScript has no way to know the Rust side changed. Grep
`frontend/src/state/types.ts` for the field whenever you touch `cobble-core`.

### Adding an indexed/queryable property

1. Add the column or table change in `crates/cobble-index/src/schema.rs`'s `apply()` (and
   `clear_all()` if it's a new table).
2. Populate it in `crates/cobble-index/src/rebuild.rs`'s `insert_page`/`insert_property`/
   `insert_block` as appropriate.
3. Add a query function in `crates/cobble-index/src/query.rs` and expose it as an `Index` method
   in `crates/cobble-index/src/lib.rs`.
4. Remember `cobble-index`'s schema has no migration story by design — `rebuild_all()` is the
   only way old data gets the new column populated (see the comment on `schema::apply`: "this is
   a cache, not a migration target"). That's fine for a derived index; don't add anything to
   `cobble-index` that would make it *not* safe to wipe and rebuild at any time.

### Working on the plugin system

See `docs/PLUGINS.md` — it covers both the plugin-author-facing manifest/API and the host-side
implementation (permission gates, sandbox limits, the WIT interface) in depth.

## Conventions worth internalizing (from `CLAUDE.md`, made concrete)

- **`cobble-core` has no I/O.** If you're about to add a file read or a SQL query inside
  `crates/cobble-core/src/`, stop — that belongs in `cobble-storage` or `cobble-index`. The
  crate's own module doc says this explicitly; the dependency graph enforces it (`cobble-core`
  doesn't depend on `rusqlite` or do filesystem calls at all).
- **Files are truth, SQLite is a cache.** Any new write path must go file → reindex, never index-
  only. If you're writing something that only updates SQLite, ask whether it should exist as a
  page file first.
- **Block/page IDs are forever.** Never reuse or reassign a `PageId`/`BlockId` on move/edit/rename
  — anything that references a block (relations, backlinks, plugin data) stores the ID, and a
  reused ID would silently repoint an existing reference at the wrong thing.
- **Theme tokens only in `frontend/`.** No raw hex/hsl/rgb in component styles — go through
  `frontend/src/theme/tokens.css`'s semantic tokens. This applies doubly to anything reachable
  from the plugin UI-schema renderer (see `docs/PLUGINS.md`) — plugin UI must not be able to
  specify a raw color, full stop.
- **Plugin host calls are deny-by-default.** Covered in depth in `docs/PLUGINS.md`.
- **Use the coordination server, not `TASKS.md`, to find/claim work.** `TASKS.md` is a
  point-in-time snapshot; `GET localhost:8420/tasks` (see `CLAUDE.md` and
  `tools/coord-server/README.md`) is live. If you're picking up a task in a multi-agent session,
  claim it there before starting.

## Where to go from here

- Read `docs/ARCHITECTURE.md` for the full design rationale behind any of the above.
- Read `docs/PLUGINS.md` if you're building or extending the plugin system.
- Check the coordination server or `TASKS.md` for what's currently in progress before starting
  something that might overlap with someone else's work.
