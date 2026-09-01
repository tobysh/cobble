//! `plugin.toml` parsing.
//!
//! Format choice: TOML, matching `docs/ARCHITECTURE.md#plugin-system`
//! ("Manifest (`plugin.toml`): `[permissions]` ... and `[contributes]` ...")
//! verbatim — the architecture doc is the source of truth for this repo, and
//! it already committed to TOML + this exact shape, so there's no format
//! decision left to make here beyond following it. TOML also matches the
//! rest of the plugin-authoring ergonomics (Cargo-style manifest, easy to
//! hand-write, comments allowed) better than JSON would for something plugin
//! authors edit by hand.
//!
//! Permission granularity: the architecture doc's `[permissions]` table
//! (`read_pages`, `write_pages`, `network`, `events`, `custom_ui`) is coarser
//! than "one permission per host function" would be, and that's deliberate —
//! it's a page-level capability grant a user can reason about at install
//! time ("this plugin can read your pages"), not a low-level API surface
//! grant. It maps onto the M4 WIT surface as: `read_pages` gates
//! `host::get-block-data`, `write_pages` gates `host::update-block-data`.
//! `network`/`events`/`custom_ui` are parsed and preserved (so the manifest
//! format doesn't need a breaking change once M5 wires them up) but nothing
//! in the M4 WIT surface uses them yet — see `wit/cobble-plugin.wit`'s scope
//! note.

use serde::Deserialize;
use std::path::Path;

/// A plugin's parsed `plugin.toml`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Manifest {
    pub plugin: PluginIdentity,
    #[serde(default)]
    pub permissions: Permissions,
    #[serde(default)]
    pub contributes: Contributes,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct PluginIdentity {
    pub id: String,
    pub name: String,
    pub version: String,
}

/// `[permissions]`. All default to the deny-by-default posture: absent from
/// the manifest means not granted.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct Permissions {
    pub read_pages: bool,
    pub write_pages: bool,
    /// Host allowlist for `http-fetch` (not yet exposed on the WIT surface —
    /// see `wit/cobble-plugin.wit` scope note). Parsed and preserved so the
    /// manifest format is stable once it lands.
    pub network: Vec<String>,
    /// Event names the plugin wants to subscribe to via
    /// `subscribe-event`/`on-event` (not yet on the WIT surface — same
    /// note).
    pub events: Vec<String>,
    /// Opt-in sandboxed-iframe escape hatch (M5 scope, see architecture
    /// doc's "Escape hatch" paragraph). Parsed and preserved only.
    pub custom_ui: bool,
}

impl Default for Permissions {
    fn default() -> Self {
        Self {
            read_pages: false,
            write_pages: false,
            network: Vec::new(),
            events: Vec::new(),
            custom_ui: false,
        }
    }
}

/// `[contributes]`. Declarative registration — what the plugin adds to the
/// app. Not enforced by the plugin host itself (that's the frontend
/// registry's job once `PluginBlockNode`/`UiSchemaRenderer` exist); parsed
/// here because it lives in the same manifest file.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(default)]
pub struct Contributes {
    pub block_types: Vec<String>,
    pub slash_commands: Vec<String>,
    pub sidebar_panels: Vec<String>,
    pub data_sources: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ManifestError {
    #[error("failed to read manifest at {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to parse manifest at {path}: {source}")]
    Parse {
        path: String,
        #[source]
        source: toml::de::Error,
    },
}

impl Manifest {
    /// Parse a `plugin.toml` from its raw text contents.
    pub fn parse(toml_str: &str) -> Result<Self, toml::de::Error> {
        toml::from_str(toml_str)
    }

    /// Load and parse a `plugin.toml` from disk.
    pub fn load(path: impl AsRef<Path>) -> Result<Self, ManifestError> {
        let path = path.as_ref();
        let text = std::fs::read_to_string(path).map_err(|source| ManifestError::Io {
            path: path.display().to_string(),
            source,
        })?;
        Self::parse(&text).map_err(|source| ManifestError::Parse {
            path: path.display().to_string(),
            source,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINIMAL: &str = r#"
        [plugin]
        id = "hello-world"
        name = "Hello World"
        version = "0.1.0"
    "#;

    const FULL: &str = r#"
        [plugin]
        id = "hello-world"
        name = "Hello World"
        version = "0.1.0"

        [permissions]
        read_pages = true
        write_pages = true
        network = ["api.example.com"]
        events = ["page.created"]
        custom_ui = false

        [contributes]
        block_types = ["hello_world.greeting"]
        slash_commands = ["/hello"]
        sidebar_panels = []
        data_sources = []
    "#;

    #[test]
    fn parses_minimal_manifest_with_deny_by_default_permissions() {
        let m = Manifest::parse(MINIMAL).unwrap();
        assert_eq!(m.plugin.id, "hello-world");
        assert_eq!(m.plugin.version, "0.1.0");
        assert_eq!(m.permissions, Permissions::default());
        assert!(!m.permissions.read_pages);
        assert!(!m.permissions.write_pages);
        assert!(m.contributes.block_types.is_empty());
    }

    #[test]
    fn parses_full_manifest() {
        let m = Manifest::parse(FULL).unwrap();
        assert!(m.permissions.read_pages);
        assert!(m.permissions.write_pages);
        assert_eq!(m.permissions.network, vec!["api.example.com".to_string()]);
        assert_eq!(m.contributes.block_types, vec!["hello_world.greeting".to_string()]);
    }

    #[test]
    fn rejects_manifest_missing_required_identity_fields() {
        let bad = r#"
            [plugin]
            id = "hello-world"
        "#;
        assert!(Manifest::parse(bad).is_err());
    }

    #[test]
    fn load_reports_io_error_for_missing_file() {
        let err = Manifest::load("/nonexistent/plugin.toml").unwrap_err();
        assert!(matches!(err, ManifestError::Io { .. }));
    }
}
