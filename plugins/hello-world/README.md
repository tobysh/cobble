# hello-world

The minimal sample plugin for Cobble's plugin API (M4 MVP scope). See
`docs/PLUGINS.md` for the full plugin system reference and `docs/ARCHITECTURE.md`'s
"Plugin system" section for the original design intent.

## What this is

- `plugin.toml` — manifest declaring zero permissions (`read_pages`/`write_pages`/
  `network`/`events`/`custom_ui` all off) and one contributed block type,
  `hello_world.greeting`.
- `wit/cobble-plugin.wit` — a copy of `crates/cobble-plugin-host/wit/cobble-plugin.wit`,
  the shared host/guest contract (per `docs/PLUGINS.md`, a plugin author copies this
  in rather than depending on the host crate).
- `src/lib.rs` — implements the two guest exports (`init`, `render-block`).
  `render-block` returns a static UI-schema document (`{"widget":"text","value":"Hello, world!"}`)
  for its one block type, and calls the always-permitted `log` host import. It never
  calls `get-block-data`/`update-block-data`, consistent with declaring zero
  permissions in the manifest.

## What this isn't (yet)

- **Not buildable/loadable end-to-end today.** Per `docs/PLUGINS.md`'s "Status" section,
  as of this writing there's no `src-tauri` command that loads a plugin from disk and no
  `UiSchemaRenderer`/`PluginBlockNode` on the frontend to render its output — this is the
  plugin-side artifact only, shaped for when that infrastructure exists.
- **Not part of the Cargo workspace.** This crate targets the Component Model
  (`wasm32-wasip2` via `cargo-component`), not a normal host-target crate, so it's
  intentionally excluded from `../../Cargo.toml`'s `members` and from
  `cargo check --workspace`. See the toolchain note in `Cargo.toml` and
  `docs/PLUGINS.md`'s "Writing a plugin today" section for how to actually build it
  (`cargo component build --release`, once `rustup target add wasm32-wasip2` and
  `cargo install cargo-component` are set up — neither is a Cobble dependency).
- Once `PluginInstance::load` + a host-side loader exist, this is the `wasm_bytes`
  target: `plugins/hello-world/target/wasm32-wasip2/release/hello_world_plugin.wasm`.
