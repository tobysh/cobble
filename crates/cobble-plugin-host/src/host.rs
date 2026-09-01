//! `wasmtime::component::bindgen!`-generated bindings for
//! `wit/cobble-plugin.wit`, plus the [`HostState`] that backs them and the
//! permission-gated `Host` trait implementation.

use crate::engine::{LimitsProvider, SandboxLimits};
use crate::permissions::{Granted, Permission, PermissionDenied};
use cobble_core::{BlockId, PageId};
use std::str::FromStr;
use wasmtime::StoreLimits;

wasmtime::component::bindgen!({
    path: "wit/cobble-plugin.wit",
    world: "plugin",
});

/// Per-instance state carried by a plugin's `Store`. Holds exactly what the
/// `Host` trait impl below needs: the resolved permission grant to check
/// against, the plugin's own id (for error messages / future logging), and
/// the memory-limiter state `wasmtime::Store::limiter` reads from.
pub struct HostState {
    pub plugin_id: String,
    pub granted: Granted,
    pub sandbox: SandboxLimits,
    limits: StoreLimits,
}

impl HostState {
    pub fn new(plugin_id: impl Into<String>, granted: Granted, sandbox: SandboxLimits) -> Self {
        Self {
            plugin_id: plugin_id.into(),
            granted,
            limits: crate::engine::store_limits(sandbox),
            sandbox,
        }
    }
}

impl LimitsProvider for HostState {
    fn resource_limits(&mut self) -> &mut StoreLimits {
        &mut self.limits
    }
}

impl From<PermissionDenied> for cobble::plugin::types::HostError {
    fn from(_: PermissionDenied) -> Self {
        cobble::plugin::types::HostError::PermissionDenied
    }
}

/// The `types` interface declares no functions of its own (just the shared
/// `host-error` enum), so its generated `Host` trait has no methods to
/// implement — this impl just satisfies `add_to_linker`'s bound.
impl cobble::plugin::types::Host for HostState {}

/// `impl Host` for the `host` interface's imports — this is where every
/// CLAUDE.md-mandated permission gate lives. Each method other than `log`
/// calls `self.granted.require(..)` before doing anything else.
///
/// These return the WIT-level `result<T, host-error>` directly (not wrapped
/// in `wasmtime::Result`) — bindgen only wraps the *outer* return in
/// `wasmtime::Result` for functions that don't declare a `result<_, E>` at
/// the WIT level, since those need some way to signal a trap. Ours already
/// have an explicit error case, so a permission denial or bad input is a
/// normal `Err(HostError::...)` return, not a trap — a plugin can catch and
/// handle it, which is the point of it being a typed error rather than a
/// hard failure.
impl cobble::plugin::host::Host for HostState {
    fn get_block_data(
        &mut self,
        page_id: String,
        block_id: String,
    ) -> Result<String, cobble::plugin::types::HostError> {
        self.granted.require(Permission::ReadPages)?;
        // IDs are ULIDs everywhere in `cobble-core` ("Block IDs are
        // forever" — CLAUDE.md); reuse that parser rather than duplicating
        // ID-shape validation here, and reject anything that isn't one
        // before treating it as a real (if absent) page/block.
        if PageId::from_str(&page_id).is_err() || BlockId::from_str(&block_id).is_err() {
            return Err(cobble::plugin::types::HostError::InvalidArgument);
        }
        // Not yet wired to `cobble-storage` — see the scope note on
        // `get-block-data` in `wit/cobble-plugin.wit`. Once wired, this
        // looks up `page_id`/`block_id` and returns the block's
        // `attrs.data` JSON, or `HostError::NotFound` if either doesn't
        // exist.
        Err(cobble::plugin::types::HostError::NotFound)
    }

    fn update_block_data(
        &mut self,
        page_id: String,
        block_id: String,
        data_json: String,
    ) -> Result<(), cobble::plugin::types::HostError> {
        self.granted.require(Permission::WritePages)?;
        if PageId::from_str(&page_id).is_err() || BlockId::from_str(&block_id).is_err() {
            return Err(cobble::plugin::types::HostError::InvalidArgument);
        }
        if serde_json::from_str::<serde_json::Value>(&data_json).is_err() {
            return Err(cobble::plugin::types::HostError::InvalidArgument);
        }
        // Not yet wired to `cobble-storage` — same scope note as
        // `get_block_data` above. Permission + input validation happen
        // here regardless of whether the write path exists yet, since
        // those are this crate's job either way.
        Ok(())
    }

    fn log(&mut self, message: String) {
        // Always permitted (see the doc comment on `log` in the WIT file).
        eprintln!("[plugin:{}] {message}", self.plugin_id);
    }
}
