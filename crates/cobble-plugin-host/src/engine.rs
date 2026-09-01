//! `Engine`/`Store` sandbox configuration: fuel metering (bounds how much
//! compute one plugin call can burn) and a linear-memory cap (bounds how
//! much memory one plugin instance can allocate). Both are configurable via
//! [`SandboxLimits`], with the defaults below chosen to comfortably run a
//! small UI-rendering call while making a runaway/malicious plugin fail fast
//! instead of hanging the host or exhausting its memory.
//!
//! This module is deliberately generic over the `Store`'s data type (`T`) —
//! it's exercised directly by core-module/plain-component test fixtures in
//! `tests/` as well as by [`crate::plugin::PluginInstance`], which layers the
//! real `cobble-plugin.wit` bindings and permission-checked `HostState` on
//! top of the same `Engine`/`Store` setup.

use wasmtime::{Config, Engine, Store, StoreLimits, StoreLimitsBuilder};

/// Sandbox resource caps for one plugin `Store`. Both bounds are per-call
/// (fuel is refilled before each host->guest entry point; see
/// [`refuel`]) / per-instance (memory is capped for the lifetime of the
/// `Store`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SandboxLimits {
    /// Units of fuel available for one call into the plugin. Wasmtime
    /// decrements fuel roughly per basic-block/instruction executed; when it
    /// hits zero, the in-flight call traps with `Trap::OutOfFuel` instead of
    /// running forever.
    pub max_fuel: u64,
    /// Hard cap, in bytes, on the plugin instance's linear memory. A
    /// `memory.grow` that would exceed this is denied (returns `-1` to the
    /// guest per the core wasm spec, or fails instantiation outright if the
    /// module's declared minimum already exceeds it).
    pub max_memory_bytes: usize,
}

/// Defaults: 10,000,000 fuel units (enough headroom for a small UI-schema
/// render call; a tight infinite loop burns through this in well under a
/// second) and a 64 MiB memory cap (generous for JSON block data + a small
/// render pass, small enough that a runaway allocation loop fails fast).
impl Default for SandboxLimits {
    fn default() -> Self {
        Self {
            max_fuel: 10_000_000,
            max_memory_bytes: 64 * 1024 * 1024,
        }
    }
}

/// Implemented by a `Store`'s data type so [`configure_store`] can reach its
/// [`StoreLimits`] generically. `cobble-plugin-host`'s real `HostState`
/// implements this; test fixtures that just want fuel/memory enforcement
/// without the rest of `HostState` can implement it on a minimal struct.
pub trait LimitsProvider {
    fn resource_limits(&mut self) -> &mut StoreLimits;
}

/// Build an `Engine` configured for sandboxed plugin execution: fuel
/// consumption tracking on, the Component Model enabled (plugins are
/// WASI-preview2-style components per `docs/ARCHITECTURE.md#plugin-system`),
/// and Cranelift as the compilation strategy (default, explicit for
/// clarity).
pub fn new_engine() -> anyhow::Result<Engine> {
    let mut config = Config::new();
    config.consume_fuel(true);
    config.wasm_component_model(true);
    config.strategy(wasmtime::Strategy::Cranelift);
    Ok(Engine::new(&config)?)
}

/// Build the `StoreLimits` half of a [`SandboxLimits`] memory cap. Kept
/// separate from fuel (which lives on the `Store` itself, set via
/// [`refuel`]) since `StoreLimitsBuilder` is what a `HostState` embeds.
pub fn store_limits(limits: SandboxLimits) -> StoreLimits {
    StoreLimitsBuilder::new()
        .memory_size(limits.max_memory_bytes)
        // Tables aren't part of the plugin sandbox's threat model (no
        // plugin-controlled table growth is exposed on the WIT surface);
        // leave the table-count default (unlimited) rather than picking an
        // arbitrary number.
        .build()
}

/// Wire fuel + the memory limiter into a freshly-created `Store`. Call once
/// right after `Store::new`; call [`refuel`] before each subsequent
/// host->guest call to reset the compute budget per-call rather than
/// per-instance (a long-lived plugin instance shouldn't slowly starve of
/// fuel across many legitimate calls).
pub fn configure_store<T: LimitsProvider + 'static>(
    store: &mut Store<T>,
    limits: SandboxLimits,
) -> anyhow::Result<()> {
    store.limiter(|data| data.resource_limits());
    refuel(store, limits)
}

/// Reset the store's fuel to `limits.max_fuel`. Wasmtime fuel is
/// monotonically consumed; a long-lived plugin instance calls this before
/// each entry point so one call's compute budget doesn't bleed into the
/// next.
pub fn refuel<T>(store: &mut Store<T>, limits: SandboxLimits) -> anyhow::Result<()> {
    // `set_fuel` overwrites the remaining budget outright, so this is
    // correct whether or not fuel remains from a prior call.
    store.set_fuel(limits.max_fuel)?;
    Ok(())
}
