//! `hello-world` — the minimal sample plugin for Cobble's M4 plugin-host MVP.
//!
//! This is deliberately the smallest possible real plugin: it declares zero
//! permissions (see `plugin.toml`) and its `render-block` export returns a
//! static UI-schema document without ever calling `get-block-data` or
//! `update-block-data`. Its purpose is to exercise the guest side of the
//! WIT contract (`wit/cobble-plugin.wit`, copied from
//! `crates/cobble-plugin-host/wit/cobble-plugin.wit`) end-to-end — the
//! `init`/`render-block` exports and the always-permitted `log` import —
//! not to demonstrate the block-data host calls (see
//! `docs/PLUGINS.md`'s "Status: what's real today" for why: those aren't
//! wired to `cobble-storage` yet, so a permissioned example would have
//! nothing real to read or write today anyway).
//!
//! The UI-schema vocabulary returned by `render-block` below
//! (`{"widget":"text","value":...}`) is illustrative, not authoritative —
//! per `docs/PLUGINS.md`, the widget vocabulary `UiSchemaRenderer.tsx` will
//! render isn't finalized yet. Treat this as "the simplest thing consistent
//! with current scaffolding," matching the example in `docs/PLUGINS.md`.

wit_bindgen::generate!({
    path: "wit",
    world: "plugin",
});

struct Component;

impl Guest for Component {
    fn init() -> u32 {
        // API version this plugin was built against — see the doc comment
        // on `init` in wit/cobble-plugin.wit. Nothing validates this against
        // the host's version yet; it's a handshake seam for future use.
        1
    }

    fn render_block(block_type: String, _data_json: String) -> Result<String, HostError> {
        log("hello-world: rendering a block".to_string());

        match block_type.as_str() {
            "hello_world.greeting" => {
                Ok(r#"{"widget":"text","value":"Hello, world!"}"#.to_string())
            }
            _ => Err(HostError::NotFound),
        }
    }
}

export!(Component);
