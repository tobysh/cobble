//! `cobble-plugin-host`: the wasmtime sandbox that runs Cobble plugins.
//!
//! See `docs/ARCHITECTURE.md#plugin-system` for the design this crate
//! implements: sandboxed WASM (wasmtime, Component Model) plugins that read
//!/write their own block data and render a declarative UI schema, gated by
//! a manifest-declared permission set that's checked on every host call
//! (CLAUDE.md: "Plugin host calls are deny-by-default").
//!
//! Module map:
//! - [`engine`]: `Engine`/`Store` sandbox configuration — fuel metering,
//!   memory limits.
//! - `host` (private, re-exported pieces below): the
//!   `wasmtime::component::bindgen!`-generated bindings for
//!   `wit/cobble-plugin.wit`, and the permission-checked `Host` trait impl.
//! - [`manifest`]: `plugin.toml` parsing.
//! - [`permissions`]: the permission-grant type the `Host` impl checks
//!   against.
//! - [`plugin`]: the high-level "load, call, drop" API other crates use.

pub mod engine;
mod host;
pub mod manifest;
pub mod permissions;
pub mod plugin;

pub use host::cobble::plugin::host::Host as PluginHost;
pub use host::cobble::plugin::types::HostError;
pub use host::HostState;
pub use plugin::{PluginError, PluginInstance};
