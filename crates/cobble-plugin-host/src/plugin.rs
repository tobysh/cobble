//! High-level "load a plugin component, call into it, tear it down" API —
//! the thing `src-tauri`'s future `commands/plugins.rs` and the
//! `hello-world` sample plugin's host-side test harness will actually call.

use crate::engine::{self, SandboxLimits};
use crate::host::{HostState, Plugin as PluginBindings};
use crate::manifest::Manifest;
use crate::permissions::Granted;
use wasmtime::component::{Component, HasSelf, Linker};
use wasmtime::{Engine, Store};

#[derive(Debug, thiserror::Error)]
pub enum PluginError {
    #[error("failed to compile plugin component: {0}")]
    Compile(#[source] anyhow::Error),
    #[error("failed to link plugin component: {0}")]
    Link(#[source] anyhow::Error),
    #[error("failed to instantiate plugin component: {0}")]
    Instantiate(#[source] anyhow::Error),
    #[error("plugin call failed (trap, fuel exhaustion, or memory-limit violation): {0}")]
    Call(#[source] anyhow::Error),
}

/// One loaded, instantiated plugin: a `Store` + the bindgen'd `Plugin`
/// world, ready to have its guest-exported functions called. Dropping this
/// tears the instance down cleanly — there's no separate explicit teardown
/// step, matching wasmtime's own resource model (a `Store` and everything
/// backed by it — memory, tables, the component instance — is freed on
/// drop, including after a trap/fuel-exhaustion/memory-limit error, so a
/// failed call never leaks the instance or leaves it in a state that must be
/// manually cleaned up).
pub struct PluginInstance {
    store: Store<HostState>,
    bindings: PluginBindings,
    sandbox: SandboxLimits,
}

impl PluginInstance {
    /// Compile `wasm_bytes` as a component, instantiate it against the host
    /// functions in `wit/cobble-plugin.wit`, and call its `init` export.
    ///
    /// `manifest` supplies the plugin's identity and granted permissions —
    /// every host function this instance can call back into is checked
    /// against `manifest.permissions` (see `crate::host::HostState`'s `Host`
    /// impl).
    pub fn load(
        engine: &Engine,
        wasm_bytes: &[u8],
        manifest: &Manifest,
        sandbox: SandboxLimits,
    ) -> Result<Self, PluginError> {
        let component = Component::new(engine, wasm_bytes)
            .map_err(|e| PluginError::Compile(anyhow::Error::from(e)))?;

        let mut linker = Linker::<HostState>::new(engine);
        PluginBindings::add_to_linker::<_, HasSelf<_>>(&mut linker, |state| state)
            .map_err(|e| PluginError::Link(anyhow::Error::from(e)))?;

        let granted = Granted::new(manifest.permissions.clone());
        let host_state = HostState::new(manifest.plugin.id.clone(), granted, sandbox);
        let mut store = Store::new(engine, host_state);
        engine::configure_store(&mut store, sandbox).map_err(PluginError::Instantiate)?;

        let bindings = PluginBindings::instantiate(&mut store, &component, &linker)
            .map_err(|e| PluginError::Instantiate(anyhow::Error::from(e)))?;

        let mut instance = Self {
            store,
            bindings,
            sandbox,
        };
        instance.call_init()?;
        Ok(instance)
    }

    /// Refuel before an entry point so each call gets the full configured
    /// compute budget rather than sharing one budget across the instance's
    /// whole lifetime.
    fn refuel(&mut self) -> Result<(), PluginError> {
        engine::refuel(&mut self.store, self.sandbox).map_err(PluginError::Call)
    }

    fn call_init(&mut self) -> Result<u32, PluginError> {
        self.refuel()?;
        self.bindings
            .cobble_plugin_guest()
            .call_init(&mut self.store)
            .map_err(|e| PluginError::Call(anyhow::Error::from(e)))
    }

    /// Call the plugin's `render-block` export for one block instance,
    /// returning the UI-schema JSON document (or the plugin's own
    /// `host-error` if it declined to render).
    pub fn render_block(
        &mut self,
        block_type: &str,
        data_json: &str,
    ) -> Result<Result<String, crate::host::cobble::plugin::types::HostError>, PluginError> {
        self.refuel()?;
        self.bindings
            .cobble_plugin_guest()
            .call_render_block(&mut self.store, block_type, data_json)
            .map_err(|e| PluginError::Call(anyhow::Error::from(e)))
    }
}
