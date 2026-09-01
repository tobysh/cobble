//! Proves the CLAUDE.md-mandated permission gate on the real
//! `cobble-plugin.wit` host functions: a plugin manifest without a
//! permission is denied, one with it succeeds. This calls `HostState`'s
//! `Host` trait implementation (`src/host.rs`) directly, in plain Rust —
//! the exact code wasmtime invokes for a guest's host-import call, without
//! needing an actual compiled guest component (`update-block-data`'s guest
//! side needs the Component Model canonical ABI's string+realloc machinery,
//! which requires a real guest-side toolchain; see the crate-level doc
//! comment / PR description for that follow-up). `tests/sandbox.rs`
//! separately proves a permission gate holds through an *actual* wasm call,
//! using a numeric-only fixture that sidesteps that same toolchain gap.

use cobble_core::{BlockId, PageId};
use cobble_plugin_host::manifest::{Manifest, Permissions};
use cobble_plugin_host::permissions::{Granted, Permission};
use cobble_plugin_host::{HostError, HostState, PluginHost};

/// A well-formed (if nonexistent) page/block ID pair, so tests exercise the
/// permission gate rather than incidentally tripping ID-shape validation.
fn fresh_ids() -> (String, String) {
    (PageId::new().to_string(), BlockId::new().to_string())
}

fn permissions(read_pages: bool, write_pages: bool) -> Permissions {
    Permissions {
        read_pages,
        write_pages,
        network: Vec::new(),
        events: Vec::new(),
        custom_ui: false,
    }
}

fn host_state(permissions: Permissions) -> HostState {
    HostState::new(
        "test-plugin",
        Granted::new(permissions),
        Default::default(),
    )
}

#[test]
fn update_block_data_denied_without_write_pages_permission() {
    let mut state = host_state(permissions(false, false));
    let (page_id, block_id) = fresh_ids();

    let result = state.update_block_data(page_id, block_id, "{}".into());

    assert_eq!(result, Err(HostError::PermissionDenied));
}

#[test]
fn update_block_data_succeeds_with_write_pages_permission() {
    let mut state = host_state(permissions(false, true));
    let (page_id, block_id) = fresh_ids();

    let result = state.update_block_data(page_id, block_id, r#"{"count":1}"#.into());

    assert_eq!(result, Ok(()));
}

#[test]
fn update_block_data_rejects_invalid_json_even_when_permitted() {
    let mut state = host_state(permissions(false, true));
    let (page_id, block_id) = fresh_ids();

    let result = state.update_block_data(page_id, block_id, "not json".into());

    assert_eq!(result, Err(HostError::InvalidArgument));
}

#[test]
fn update_block_data_rejects_malformed_ids_even_when_permitted() {
    let mut state = host_state(permissions(false, true));

    let result =
        state.update_block_data("not-a-ulid".into(), "also-not-a-ulid".into(), "{}".into());

    assert_eq!(result, Err(HostError::InvalidArgument));
}

#[test]
fn get_block_data_denied_without_read_pages_permission() {
    let mut state = host_state(permissions(false, false));
    let (page_id, block_id) = fresh_ids();

    let result = state.get_block_data(page_id, block_id);

    assert_eq!(result, Err(HostError::PermissionDenied));
}

#[test]
fn get_block_data_permitted_reaches_past_the_permission_check() {
    let mut state = host_state(permissions(true, false));
    let (page_id, block_id) = fresh_ids();

    // Storage isn't wired up yet (see `wit/cobble-plugin.wit`'s scope note),
    // so this can't assert a successful read end to end — but it proves the
    // permission check is not what's stopping it: a granted call with a
    // well-formed (if nonexistent) ID pair gets a different error
    // (`NotFound`, from the not-yet-wired lookup) than a denied one
    // (`PermissionDenied`).
    let result = state.get_block_data(page_id, block_id);

    assert_eq!(result, Err(HostError::NotFound));
}

// `custom_ui` (M5's sandboxed-iframe escape hatch, see
// `docs/ARCHITECTURE.md`'s "Escape hatch" paragraph) has no WIT-level host
// function of its own — it isn't something a plugin *calls*, it's a
// capability the frontend checks before it's willing to mount the iframe at
// all. That check has to go through the real manifest parser (not a
// hand-built `Permissions` value) because it's exactly the code path
// `src-tauri/src/commands/plugins.rs::check_custom_ui_permission` runs on
// the frontend's behalf — this is what proves that path is deny-by-default
// end to end, from raw `plugin.toml` text to a granted/denied verdict.
fn parse_and_check_custom_ui(toml_str: &str) -> Result<(), cobble_plugin_host::permissions::PermissionDenied> {
    let manifest = Manifest::parse(toml_str).expect("well-formed test manifest");
    Granted::new(manifest.permissions).require(Permission::CustomUi)
}

#[test]
fn custom_ui_denied_when_manifest_omits_the_permissions_table_entirely() {
    let toml_str = r#"
        [plugin]
        id = "no-permissions-plugin"
        name = "No Permissions"
        version = "0.1.0"
    "#;
    assert!(parse_and_check_custom_ui(toml_str).is_err());
}

#[test]
fn custom_ui_denied_when_manifest_explicitly_sets_it_false() {
    let toml_str = r#"
        [plugin]
        id = "explicit-false-plugin"
        name = "Explicit False"
        version = "0.1.0"

        [permissions]
        custom_ui = false
    "#;
    assert!(parse_and_check_custom_ui(toml_str).is_err());
}

#[test]
fn custom_ui_allowed_only_when_manifest_explicitly_grants_it() {
    let toml_str = r#"
        [plugin]
        id = "custom-ui-plugin"
        name = "Custom UI"
        version = "0.1.0"

        [permissions]
        custom_ui = true
    "#;
    assert!(parse_and_check_custom_ui(toml_str).is_ok());
}

#[test]
fn log_is_always_permitted_regardless_of_manifest() {
    let mut state = host_state(permissions(false, false));
    // `log` has no `result<_, E>` at the WIT level (see its doc comment in
    // `wit/cobble-plugin.wit`) — it's infallible by construction, not just
    // by policy, so there's nothing to assert beyond "this compiles and
    // doesn't panic."
    state.log("hello from a plugin with no permissions".into());
}
