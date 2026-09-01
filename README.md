# cobble

A Notion-style workspace app: Rust backend, Tauri desktop shell, React/TypeScript frontend. Off-black/off-white "Night" theme plus Notion-mirrored Light/Dark themes, a global calendar, relational databases, and a sandboxed WASM plugin API.

> **This is a vibecoded project.** It's built almost entirely with AI coding assistance because I can't code that well myself. Expect rough edges, and don't assume any part of it has had a careful human review.

## Status

Early / actively in progress. See `TASKS.md` for a snapshot of what's done and in flight, and `docs/ARCHITECTURE.md` for the full design doc (storage format, data model, plugin system, theming, milestones).

## Setup

```sh
# one-time system deps (Linux) — Tauri needs these to compile/run
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

pnpm install   # installs root (Tauri CLI) + frontend/ deps
```

## Running it

```sh
pnpm exec tauri dev            # full app, hot-reloading (needs a display)
pnpm exec tauri build --debug  # full build without launching (headless-friendly)
pnpm --dir frontend dev        # frontend only, Vite dev server on port 1420
```

## Checking it builds

```sh
cargo check --workspace   # fast compile check, all crates
cargo test --workspace    # unit/integration tests
pnpm --dir frontend build # frontend typecheck + build
```

## Layout

- `crates/cobble-core` — shared types, no I/O
- `crates/cobble-storage` — file-backed persistence (files are the source of truth)
- `crates/cobble-index` — SQLite cache/index over the files
- `crates/cobble-watcher` — filesystem watching
- `crates/cobble-plugin-host` — sandboxed WASM plugin runtime
- `src-tauri` — Tauri desktop shell
- `frontend` — React/TypeScript UI
- `tools/coord-server` — multi-agent coordination server used during development

See `CLAUDE.md` for day-to-day conventions and `docs/ARCHITECTURE.md` for the design rationale.

## License

Unlicensed — personal project, no license granted for reuse.
