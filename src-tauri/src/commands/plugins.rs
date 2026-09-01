//! Plugin trust-boundary checks the frontend must consult before crossing
//! them — currently just the `custom_ui` sandboxed-iframe escape hatch (see
//! `docs/ARCHITECTURE.md`'s "Escape hatch" paragraph under "Plugin system").
//!
//! There is no installed-plugin registry in `AppState` yet (that's separate,
//! not-yet-landed M4/M5 scope — see the scope notes in
//! `crates/cobble-plugin-host/wit/cobble-plugin.wit` and `manifest.rs`), so
//! this command is intentionally stateless: it takes the plugin's raw
//! `plugin.toml` text as an argument (the frontend already has it, from
//! wherever it discovered/loaded the plugin) rather than looking a plugin up
//! by id from a store this crate doesn't have. What matters for
//! CLAUDE.md's "Plugin host calls are deny-by-default" rule is that this is
//! a real, independent, host-side re-parse of the manifest — the frontend's
//! `CustomUiFrame` component calls this before ever rendering the iframe, so
//! a compromised or buggy frontend can't simply lie about what the manifest
//! grants. This is *in addition to*, not a replacement for, the frontend's
//! own user-consent gate (`frontend/src/state/pluginTrust.ts`) — a plugin
//! whose manifest grants `custom_ui` still needs the user's explicit Allow
//! before its iframe renders.

use cobble_plugin_host::manifest::Manifest;
use cobble_plugin_host::permissions::{Granted, Permission};

/// Returns whether `manifest_toml` grants the plugin the `custom_ui`
/// capability. Fails closed: a manifest that doesn't parse is an `Err`, not
/// an implicit `Ok(false)`/`Ok(true)` — callers must treat any error the
/// same as "not granted" and never render the iframe.
#[tauri::command]
pub fn check_custom_ui_permission(manifest_toml: String) -> Result<bool, String> {
    check_custom_ui_permission_impl(&manifest_toml)
}

fn check_custom_ui_permission_impl(manifest_toml: &str) -> Result<bool, String> {
    let manifest = Manifest::parse(manifest_toml).map_err(|err| err.to_string())?;
    let granted = Granted::new(manifest.permissions);
    Ok(granted.require(Permission::CustomUi).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn denies_when_permissions_table_is_absent() {
        let toml_str = r#"
            [plugin]
            id = "p"
            name = "P"
            version = "0.1.0"
        "#;
        assert_eq!(check_custom_ui_permission_impl(toml_str), Ok(false));
    }

    #[test]
    fn denies_when_manifest_sets_custom_ui_false() {
        let toml_str = r#"
            [plugin]
            id = "p"
            name = "P"
            version = "0.1.0"

            [permissions]
            custom_ui = false
        "#;
        assert_eq!(check_custom_ui_permission_impl(toml_str), Ok(false));
    }

    #[test]
    fn allows_when_manifest_grants_custom_ui() {
        let toml_str = r#"
            [plugin]
            id = "p"
            name = "P"
            version = "0.1.0"

            [permissions]
            custom_ui = true
        "#;
        assert_eq!(check_custom_ui_permission_impl(toml_str), Ok(true));
    }

    #[test]
    fn malformed_manifest_is_an_error_not_an_implicit_grant() {
        let result = check_custom_ui_permission_impl("this is not [valid toml");
        assert!(result.is_err());
    }

    #[test]
    fn other_granted_permissions_do_not_leak_into_custom_ui() {
        let toml_str = r#"
            [plugin]
            id = "p"
            name = "P"
            version = "0.1.0"

            [permissions]
            read_pages = true
            write_pages = true
        "#;
        assert_eq!(check_custom_ui_permission_impl(toml_str), Ok(false));
    }
}
