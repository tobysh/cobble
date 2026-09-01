//! Permission enforcement.
//!
//! CLAUDE.md: "Plugin host calls are deny-by-default. Every new host
//! function `cobble-plugin-host` exposes needs an explicit permission check
//! against the calling plugin's manifest before it's usable." This module is
//! that check. Every `impl host::Host for HostState` method in `host.rs`
//! (other than `log`, which is unconditionally permitted) calls
//! [`Granted::require`] before doing anything else.

use crate::manifest::Permissions;

/// A single grantable capability, at the granularity the M4 WIT surface
/// needs. Deliberately a closed enum, not a free-form string — every variant
/// here must correspond to a real host function's gate, so an unused
/// permission (or a host function with no gate) is a compile-time-visible
/// mismatch rather than a typo waiting to happen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Permission {
    ReadPages,
    WritePages,
    /// The `custom_ui` sandboxed-iframe escape hatch (M5, see
    /// `docs/ARCHITECTURE.md`'s "Escape hatch" paragraph). This is a
    /// materially bigger trust boundary than the other permissions here —
    /// granting it lets a plugin run its own arbitrary HTML/JS inside a
    /// sandboxed `<iframe sandbox="allow-scripts">` rather than only the
    /// declarative UI schema — so it gets the same deny-by-default
    /// enforcement, checked both here (manifest-level: did the plugin
    /// author declare it at all) and again by the frontend's consent gate
    /// (did the *user* agree, separately from what the manifest declares).
    CustomUi,
}

impl Permission {
    fn granted_by(self, permissions: &Permissions) -> bool {
        match self {
            Permission::ReadPages => permissions.read_pages,
            Permission::WritePages => permissions.write_pages,
            Permission::CustomUi => permissions.custom_ui,
        }
    }
}

/// A resolved, read-only view of one plugin instance's granted permissions —
/// what `HostState` actually consults on every gated call. Built once from a
/// parsed [`Manifest`](crate::manifest::Manifest) at plugin-load time and
/// carried for the lifetime of the instance; a manifest can't be mutated out
/// from under a running instance mid-call.
#[derive(Debug, Clone)]
pub struct Granted {
    permissions: Permissions,
}

/// Denied — the calling plugin's manifest does not grant `permission`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("permission denied: plugin manifest does not grant {permission:?}")]
pub struct PermissionDenied {
    pub permission: Permission,
}

impl Granted {
    pub fn new(permissions: Permissions) -> Self {
        Self { permissions }
    }

    /// Returns `Ok(())` if `permission` is granted, `Err(PermissionDenied)`
    /// otherwise. Every gated host function calls this first, before doing
    /// any work, per CLAUDE.md's deny-by-default rule.
    pub fn require(&self, permission: Permission) -> Result<(), PermissionDenied> {
        if permission.granted_by(&self.permissions) {
            Ok(())
        } else {
            Err(PermissionDenied { permission })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn permissions(read_pages: bool, write_pages: bool) -> Permissions {
        Permissions {
            read_pages,
            write_pages,
            network: Vec::new(),
            events: Vec::new(),
            custom_ui: false,
        }
    }

    #[test]
    fn denies_when_not_granted() {
        let granted = Granted::new(permissions(false, false));
        let err = granted.require(Permission::ReadPages).unwrap_err();
        assert_eq!(err.permission, Permission::ReadPages);
    }

    #[test]
    fn allows_when_granted() {
        let granted = Granted::new(permissions(true, false));
        assert!(granted.require(Permission::ReadPages).is_ok());
        assert!(granted.require(Permission::WritePages).is_err());
    }

    #[test]
    fn permissions_are_independent() {
        let granted = Granted::new(permissions(false, true));
        assert!(granted.require(Permission::ReadPages).is_err());
        assert!(granted.require(Permission::WritePages).is_ok());
    }

    fn permissions_with_custom_ui(custom_ui: bool) -> Permissions {
        Permissions {
            read_pages: false,
            write_pages: false,
            network: Vec::new(),
            events: Vec::new(),
            custom_ui,
        }
    }

    #[test]
    fn custom_ui_denied_by_default() {
        // A manifest with no `[permissions]` table at all (or `custom_ui`
        // simply absent) parses to `Permissions::default()`, which must not
        // grant the iframe escape hatch — this is the manifest-level half
        // of "deny-by-default" for `custom_ui` specifically.
        let granted = Granted::new(Permissions::default());
        let err = granted.require(Permission::CustomUi).unwrap_err();
        assert_eq!(err.permission, Permission::CustomUi);
    }

    #[test]
    fn custom_ui_denied_when_manifest_sets_it_false() {
        let granted = Granted::new(permissions_with_custom_ui(false));
        assert!(granted.require(Permission::CustomUi).is_err());
    }

    #[test]
    fn custom_ui_allowed_when_manifest_grants_it() {
        let granted = Granted::new(permissions_with_custom_ui(true));
        assert!(granted.require(Permission::CustomUi).is_ok());
    }

    #[test]
    fn custom_ui_is_independent_of_other_permissions() {
        // Granting `read_pages`/`write_pages` must not incidentally grant
        // `custom_ui` — it's a materially bigger trust boundary (arbitrary
        // script execution vs. scoped data access) and is gated separately
        // on purpose.
        let granted = Granted::new(permissions(true, true));
        assert!(granted.require(Permission::CustomUi).is_err());
    }
}
