# Cobble Plugins

This is the plugin system reference: how it's built, what a plugin can and can't do, how
permissions are enforced, and how to actually write one. It's written for two audiences at
once — someone extending the host implementation (`crates/cobble-plugin-host/`) and someone
writing a plugin against it — and says which sections are for which where it matters.

**Read this alongside `docs/ARCHITECTURE.md`'s "Plugin system" section**, which is the original
design intent. This document describes the same system in depth, plus what's actually built
today versus still planned — those two things currently diverge, and the gap matters if you're
trying to do something with the plugin host right now.

## Status: what's real today

Be deliberate about reading this section before the rest — it'll save you from designing against
a host function or a build tool that doesn't exist yet.

**Implemented and working** (`crates/cobble-plugin-host/`):
- A wasmtime sandbox that loads a WASI **Component Model** component, enforces a fuel budget and
  a memory cap per call, and tears down cleanly on trap/fuel-exhaustion/error.
- A WIT interface (`wit/cobble-plugin.wit`) defining two guest exports (`init`, `render-block`)
  and three host imports (`get-block-data`, `update-block-data`, `log`).
- `plugin.toml` manifest parsing (`[plugin]` identity, `[permissions]`, `[contributes]`).
- Deny-by-default permission enforcement: `get-block-data` requires `read_pages`,
  `update-block-data` requires `write_pages`, checked on every call.
- A high-level `PluginInstance::load(...)` / `render_block(...)` API
  (`crates/cobble-plugin-host/src/plugin.rs`) other Rust code can use to actually run a plugin.

**Not implemented yet** — planned per `docs/ARCHITECTURE.md`, but don't build against these:
- `get-block-data`/`update-block-data` are **not wired to `cobble-storage`** — the permission
  check and input validation both run for real, but the actual read returns `not-found`
  unconditionally and the actual write is a no-op that returns `Ok(())` without persisting
  anything. See the "NOTE: not yet wired" comments in `crates/cobble-plugin-host/src/host.rs`.
- No `cobble-plugin-sdk` crate exists yet (the Rust SDK for plugin authors mentioned in
  `docs/ARCHITECTURE.md`'s repo layout). Writing a plugin today means targeting the WIT interface
  directly with generic component-model tooling — see [Writing a plugin
  today](#writing-a-plugin-today-without-a-sdk) below.
- No `plugins/hello-world/` sample plugin exists yet.
- No `frontend/src/plugin-runtime/UiSchemaRenderer.tsx` exists yet — nothing on the frontend
  renders a plugin's `render-block` output today. The UI-schema *vocabulary* it will render isn't
  formally specified anywhere yet either, beyond "a JSON tree over a small widget vocabulary" in
  the architecture doc. If you're building this, that vocabulary is a design decision you'll need
  to make (or find already made in a newer version of this doc/the coordination server) before
  the renderer can exist.
- `register-block-type`, `register-slash-command`, `register-sidebar-panel`, `query-pages`,
  `create-page`, `subscribe-event`/`on-event`, `http-fetch`, and the `custom_ui` iframe escape
  hatch are all M5 scope per the WIT file's own header comment and are not on the WIT surface at
  all yet. `network`, `events`, and `custom_ui` *are* parsed from `plugin.toml` and preserved
  (so the manifest format won't need a breaking change once these land) but nothing currently
  reads them.

In short: **the M4 MVP scope is "a plugin that reads/writes its own block's data and renders a
declarative UI for it," and even that is only host-side-sandboxed today — the storage wiring and
the frontend renderer are the two biggest open pieces.** If your task is to close one of those
gaps, this document tells you exactly where the seam is.

## Mental model

A Cobble plugin is a **WebAssembly component** — not a raw `.wasm` module, but one built against
the [Component Model](https://component-model.bytecodealliance.org/), which adds structured types
(strings, records, variants, results) and a standard way for a component to declare what it
imports and exports. Cobble's host and every plugin agree on a shared interface described once in
WIT (**W**asm **I**nterface **T**ype) and compiled into both sides:

```
crates/cobble-plugin-host/wit/cobble-plugin.wit   ← the one shared contract
        │                                    │
        ▼ (host side, Rust)                  ▼ (guest side, any language with
wasmtime::component::bindgen!                  component-model support)
generates Rust bindings the host             generates bindings the plugin
implements (crates/cobble-plugin-host/       author's code implements/calls
src/host.rs)
```

Neither side hand-writes serialization code — `bindgen!` (host) and the guest language's own WIT
tooling (`wit-bindgen`, `jco`, etc., depending on language) generate it from the same `.wit` file,
so the host and every plugin, regardless of what language it's written in, agree on the wire
format by construction.

**The plugin never gets raw access to the filesystem, the network, or the rest of the app's
state.** Every capability it has is an explicit function the host exposes on the `host` WIT
interface, and every one of those functions (other than `log`) checks the calling plugin's
manifest-declared permissions before doing anything. This is what "sandboxed" means concretely
here — not just "runs in a wasm VM" (which bounds what instructions it can execute) but "can only
reach the outside world through a small, permission-checked API" (which bounds what it can
*affect*, even with unlimited compute).

### What plugins render, and why they can't break theming

A plugin doesn't ship HTML, CSS, or JS to render its UI (except through the not-yet-built
`custom_ui` opt-in escape hatch — see [Status](#status-whats-real-today) above). Instead,
its `render-block` export returns a JSON document describing UI in terms of a small, fixed
vocabulary of widgets (text, button, input, list — the exact vocabulary is still being defined;
see [Status](#status-whats-real-today)). The frontend's `UiSchemaRenderer` (once built) maps
that vocabulary onto the app's own themed React components. A plugin literally cannot specify a
raw hex color or inject arbitrary markup, because the schema has no slot for one — this is
`docs/ARCHITECTURE.md`'s "plugins can't break theming by construction" property, and it's a
structural guarantee (there's no color field to abuse), not a lint rule a plugin could work
around.

## The manifest: `plugin.toml`

Every plugin ships a `plugin.toml` describing its identity, what it's allowed to do, and what it
contributes to the app. Parsed by `crates/cobble-plugin-host/src/manifest.rs`.

```toml
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
```

- **`[plugin]`** — `id`, `name`, `version` are all required strings. `id` is what the host uses
  to identify the plugin in logs and (eventually) in `plugin_block` attrs
  (`{plugin_id, block_type, data}` — see `docs/ARCHITECTURE.md#file-format--storage`).
- **`[permissions]`** — everything here defaults to `false`/empty if the whole section is
  omitted, and every field defaults independently if some are present and others aren't (see
  `Permissions`'s `#[serde(default)]` in `manifest.rs`). This section is the *only* thing the
  permission check ever consults — a plugin that wants to read block data must set
  `read_pages = true` here, full stop. Today only `read_pages` and `write_pages` are actually
  enforced (they gate the two block-data host calls); `network`, `events`, and `custom_ui` are
  parsed and preserved but not yet consulted by anything (see [Status](#status-whats-real-today)).
- **`[contributes]`** — declarative registration of what the plugin adds: block types, slash
  commands, sidebar panels, data sources. **Not enforced by `cobble-plugin-host` at all** — per
  its own doc comment, this is the frontend registry's job once `PluginBlockNode` /
  `UiSchemaRenderer` exist. The plugin host only parses and stores it today.

**Why coarse, page-level permissions instead of one permission per host function?** This is a
deliberate design choice explained in `manifest.rs`'s module doc: `read_pages`/`write_pages` are
capability grants a *user* can reason about at install time ("this plugin can read your pages"),
not a low-level API-surface grant. As the WIT surface grows in M5, new host functions will map
onto this same small set of user-facing permissions rather than each minting its own manifest
field.

## Permission enforcement

This is the mechanism `CLAUDE.md`'s "Plugin host calls are deny-by-default" rule refers to, and
it's the single most important thing to understand if you're adding a new host function.

`crates/cobble-plugin-host/src/permissions.rs` defines a closed enum:

```rust
pub enum Permission {
    ReadPages,
    WritePages,
}
```

This is deliberately a fixed enum, not a free-form string — **every variant must correspond to a
real host function's gate.** That's what makes an unused permission, or a host function *missing*
a gate, a compile-time-visible mismatch instead of something that only shows up as a security bug
later. `Granted` wraps a parsed `Permissions` (from the manifest) and exposes one method:

```rust
impl Granted {
    pub fn require(&self, permission: Permission) -> Result<(), PermissionDenied> {
        if permission.granted_by(&self.permissions) {
            Ok(())
        } else {
            Err(PermissionDenied { permission })
        }
    }
}
```

Every gated method in the `Host` trait implementation (`crates/cobble-plugin-host/src/host.rs`)
calls `self.granted.require(Permission::Whatever)?` as its **first line**, before touching
anything else:

```rust
fn get_block_data(&mut self, page_id: String, block_id: String) -> Result<String, HostError> {
    self.granted.require(Permission::ReadPages)?;
    // ... only reachable once the check above passes
}
```

`log` is the one exception — it's unconditionally permitted, because logging a plugin's own debug
output isn't a capability worth gating (see its doc comment in the WIT file).

### Adding a new gated host function — the checklist

If you're extending the host API (M5 work: `query-pages`, `http-fetch`, `subscribe-event`, etc.),
follow this exact sequence, matching how `get-block-data`/`update-block-data` were built:

1. Add the function to the `host` interface in `wit/cobble-plugin.wit`, with a doc comment
   stating which permission it requires (see the existing two as a template — every function
   there names its gate in its own doc comment).
2. Add a new `Permission` variant in `permissions.rs` if this needs a new grant (or reuse
   `ReadPages`/`WritePages` if it's the same class of capability). Add a `network`/`events`-style
   field to `manifest.rs`'s `Permissions` struct if the manifest doesn't already carry what this
   needs (`network`/`events`/`custom_ui` already exist, parsed but unused — check if one of those
   is actually the right home before adding a new field).
3. Implement the method in `impl cobble::plugin::host::Host for HostState` in `host.rs`, with
   `self.granted.require(Permission::Whatever)?` as the **first line**, before any other logic —
   this is not optional, it's the whole point of deny-by-default.
4. Validate any ID/JSON arguments the same way `get_block_data`/`update_block_data` do (reuse
   `cobble_core`'s `FromStr` for IDs, `serde_json::from_str::<Value>` for JSON blobs) — a
   permission grant doesn't mean the *arguments* are trustworthy.
5. Add a test in `crates/cobble-plugin-host/tests/permission_gate.rs` proving both directions:
   denied without the permission, reachable-past-the-check with it. Follow the existing pattern —
   call `HostState`'s trait method directly in plain Rust, no compiled guest component needed
   (see that file's header comment for why: it exercises exactly the code wasmtime would call for
   a guest's host-import, without needing a real guest-side toolchain for every test).

Skipping step 3's ordering, or skipping step 5 entirely, is exactly the class of bug
`CLAUDE.md`'s rule exists to prevent — a new capability that's reachable without a permission
check.

## The WIT interface, in full

`crates/cobble-plugin-host/wit/cobble-plugin.wit` — read this file directly for the authoritative,
commented version; this section explains the parts that need more context than a WIT doc comment
gives.

```wit
package cobble:plugin@0.1.0;

interface types {
    enum host-error {
        permission-denied,
        not-found,
        invalid-argument,
        internal,
    }
}

interface host {
    use types.{host-error};
    get-block-data: func(page-id: string, block-id: string) -> result<string, host-error>;
    update-block-data: func(page-id: string, block-id: string, data-json: string) -> result<_, host-error>;
    log: func(message: string);
}

interface guest {
    use types.{host-error};
    init: func() -> u32;
    render-block: func(block-type: string, data-json: string) -> result<string, host-error>;
}

world plugin {
    import host;
    export guest;
}
```

If you haven't read WIT before: a `world` is the top-level contract a component implements —
`import host` means the plugin *consumes* the `host` interface (the runtime must provide it, the
plugin calls into it), `export guest` means the plugin *provides* the `guest` interface (the
runtime calls into it). This is why the Rust bindings generated by `bindgen!` produce a `Host`
trait the *host* implements (for `import host`) and a `Guest`-calling API the host uses to invoke
the plugin's exports (for `export guest`) — `crates/cobble-plugin-host/src/host.rs` implements the
former, `crates/cobble-plugin-host/src/plugin.rs`'s `PluginInstance` calls the latter.

**`host-error` is a payload-free enum, not a record with a message string**, and that's a
deliberate ABI choice explained in the WIT file's own comment: it flattens to a single core `i32`
in the canonical ABI, which keeps host→guest error returns simple on both sides (and easy to
hand-author in WAT test fixtures, which is exactly what `tests/fixtures/sandbox_smoke.wat` does
for the sandbox tests). If you're tempted to add a message field to `host-error` for a richer
error, know that you're trading that simplicity away — prefer a new enum variant for a new *kind*
of failure over trying to carry free-form text.

**Why do the host functions return `result<T, host-error>` instead of trapping?** Look at the
comment on `impl cobble::plugin::host::Host for HostState` in `host.rs`: `bindgen!` only wraps a
function's return in `wasmtime::Result` (i.e., makes a failure a hard trap) when the WIT signature
*doesn't* already declare a `result<_, E>`. Since every gated function here declares one, a
permission denial or bad argument is a normal `Err(HostError::...)` value the plugin's own code
can catch and branch on — e.g. show "this plugin needs page-read access" in its own UI — rather
than the whole call aborting. Prefer this pattern (`result<T, host-error>`) for any new host
function too, unless the failure really is unrecoverable-by-design.

**`init` returning a `u32`** is meant to be an API-version handshake — see its doc comment: "learn
which API version [the plugin] was built against" so a plugin built against a newer/older
`cobble-plugin.wit` than the running host can degrade gracefully. Nothing currently *checks* that
returned value against anything (there's no version-compatibility logic yet) — if you're adding
version negotiation, this is the seam.

## The sandbox: fuel and memory

`crates/cobble-plugin-host/src/engine.rs`. Two independent limits, both configurable via
`SandboxLimits`:

- **Fuel** (`max_fuel`, default 10,000,000): wasmtime decrements this roughly per
  basic-block/instruction executed. When it hits zero, the in-flight call traps with
  `Trap::OutOfFuel` — a tight infinite loop in a plugin fails fast instead of hanging the host.
  Fuel is **refilled before every host→guest entry point** (`engine::refuel`, called by
  `PluginInstance` before `call_init`/`render_block`), so a long-lived plugin instance gets a
  fresh compute budget on every call rather than slowly starving across many legitimate calls
  over its lifetime.
- **Memory** (`max_memory_bytes`, default 64 MiB): a hard cap on the plugin's linear memory for
  the lifetime of its `Store`, enforced via `wasmtime::StoreLimits`. A `memory.grow` past this
  cap is denied per the core wasm spec (returns `-1` to the guest, or fails instantiation
  outright if the module's declared minimum already exceeds the cap).

Both are per-`Store` (i.e. per plugin instance), configured once via `engine::configure_store`
right after `Store::new`. If you're writing a test or a new host entry point that calls into a
plugin, remember to call `engine::refuel` before each call if you're not going through
`PluginInstance` (which already does this for you in `call_init`/`render_block`) — otherwise fuel
from a previous call carries over and a plugin could exhaust its host's patience across calls
instead of within one.

See `crates/cobble-plugin-host/tests/sandbox.rs` for the tests proving both limits actually hold
under a real (if hand-written) wasm component — a useful reference for the exact wasmtime API
calls (`get_typed_func`, `.call(&mut store, args)`) if you're extending sandbox behavior.

## Writing a plugin today (without a SDK)

Since `cobble-plugin-sdk` doesn't exist yet, building a plugin today means targeting
`wit/cobble-plugin.wit` directly with general-purpose Component Model tooling. This walks through
the Rust path, which is the most mature toolchain for this today; any language with WASI
Preview 2 component support ([the Bytecode Alliance's guide](https://component-model.bytecodealliance.org/)
lists current options) works the same way in principle.

### Toolchain

```sh
rustup target add wasm32-wasip2
cargo install cargo-component
```

`cargo-component` is what turns a normal Rust crate targeting `wasm32-wasip2` into a Component
Model `.wasm` component, using `wit-bindgen` under the hood to generate Rust bindings from a
`.wit` file — the guest-side counterpart to what `wasmtime::component::bindgen!` does on the host.
Neither of these is a Cobble dependency; they're installed by the plugin author, separately from
this repo.

### Minimal plugin skeleton

```
my-plugin/
├── Cargo.toml
├── plugin.toml
├── wit/
│   └── cobble-plugin.wit    # copy from crates/cobble-plugin-host/wit/
└── src/
    └── lib.rs
```

`Cargo.toml`:

```toml
[package]
name = "my-plugin"
version = "0.1.0"
edition = "2021"

[dependencies]
wit-bindgen = "*"  # pin to whatever's current on crates.io — not a Cobble-pinned version

[lib]
crate-type = ["cdylib"]

[package.metadata.component]
package = "cobble:plugin"

[package.metadata.component.target]
path = "wit"
world = "plugin"
```

`src/lib.rs`:

```rust
wit_bindgen::generate!({
    path: "wit",
    world: "plugin",
});

struct Component;

impl Guest for Component {
    fn init() -> u32 {
        // API version this plugin was built against — see the WIT doc comment
        // on `init` for what this is for.
        1
    }

    fn render_block(block_type: String, data_json: String) -> Result<String, HostError> {
        // `data_json` is whatever was last written via `update-block-data` for
        // this block (or "{}" for a fresh block). Return a UI-schema JSON
        // document — see docs/PLUGINS.md's Status section: the widget
        // vocabulary isn't finalized yet, so treat this as illustrative.
        match block_type.as_str() {
            "hello_world.greeting" => Ok(r#"{"widget":"text","value":"Hello from a plugin!"}"#.into()),
            _ => Err(HostError::NotFound),
        }
    }
}

export!(Component);
```

Calling a host function looks like a normal function call once bound:

```rust
fn render_block(block_type: String, data_json: String) -> Result<String, HostError> {
    log("rendering a block".to_string());  // always permitted, no permission needed
    // let data = get_block_data(&page_id, &block_id)?;  // needs read_pages = true in plugin.toml
    // ...
}
```

Build it:

```sh
cargo component build --release
```

This produces a `.wasm` file that's already a Component Model component (not a raw core module —
`cargo-component` handles that distinction for you). That's the `wasm_bytes` you'd hand to
`PluginInstance::load(engine, wasm_bytes, manifest, sandbox_limits)`.

### Loading and calling it from the host side

This is the Rust-side API `src-tauri`'s future plugin commands (not built yet — see
[Status](#status-whats-real-today)) will use, and what you'd call directly today to test a
plugin end-to-end without a UI:

```rust
use cobble_plugin_host::engine::{self, SandboxLimits};
use cobble_plugin_host::manifest::Manifest;
use cobble_plugin_host::plugin::PluginInstance;

let engine = engine::new_engine()?;
let wasm_bytes = std::fs::read("my-plugin/target/wasm32-wasip2/release/my_plugin.wasm")?;
let manifest = Manifest::load("my-plugin/plugin.toml")?;

let mut instance = PluginInstance::load(&engine, &wasm_bytes, &manifest, SandboxLimits::default())?;
// `load` already calls the plugin's `init` export for you.

let result = instance.render_block("hello_world.greeting", "{}")?;
match result {
    Ok(ui_schema_json) => println!("{ui_schema_json}"),
    Err(host_error) => eprintln!("plugin declined to render: {host_error:?}"),
}
```

### Testing a plugin's host-integration without a compiled guest

If you're testing *host-side* behavior (permission enforcement, sandbox limits) rather than a
specific plugin's logic, you don't need a real guest component at all for permission checks —
`crates/cobble-plugin-host/tests/permission_gate.rs` calls `HostState`'s trait methods directly,
which exercises exactly the code wasmtime would invoke for a guest's host-import call. Reach for
an actual compiled `.wasm` (or, for sandbox-limit tests specifically, a hand-written WAT fixture
like `tests/fixtures/sandbox_smoke.wat`) only when you need to prove something through a *real*
wasm call boundary — e.g. that fuel exhaustion during actual guest execution traps cleanly.

## Security model summary

For anyone evaluating whether this sandbox is safe to grant a permission to, or extending it:

- **Compute is bounded** by fuel metering — a plugin cannot hang the host with an infinite loop.
- **Memory is bounded** per instance — a plugin cannot exhaust host memory via unbounded
  allocation.
- **Capabilities are enumerable and denied by default** — the entire set of things a plugin can
  affect outside its own wasm sandbox is the `host` WIT interface's function list, and every one
  of those (bar `log`) requires an explicit manifest grant checked on every call, not just at
  load time. There is currently no filesystem or network access exposed to plugins at all — the
  planned `http-fetch` (M5) is described in `docs/ARCHITECTURE.md` as host-mediated with an
  allowlist, specifically so a plugin never gets a raw socket.
- **A trap, fuel exhaustion, or memory-limit violation tears the instance down cleanly** — dropping
  a `Store<HostState>` frees everything backing it (memory, tables, the component instance) with
  no separate teardown step and no way for a failed call to leave the host in a bad state (see
  the doc comment on `PluginInstance`, and `tests/sandbox.rs`'s "instantiate a fresh instance
  after a prior one failed" assertions).
- **What isn't sandboxed yet**: the storage wiring gap means `read_pages`/`write_pages` grants
  currently don't actually reach real data (see [Status](#status-whats-real-today)) — so today
  there's genuinely nothing sensitive for even a fully-permissioned plugin to reach. Don't treat
  that as "the sandbox is stronger than it looks" — treat it as "the sandbox hasn't been tested
  against real data flowing through it yet." Adversarial testing (filesystem escape attempts,
  network-permission bypass attempts, resource-exhaustion attempts beyond fuel/memory) is called
  out as follow-up verification work in `docs/ARCHITECTURE.md`'s "Verification approach" section
  and should happen before `read_pages`/`write_pages` are wired to real storage, not after.

## Roadmap: M4 vs M5

Per `docs/ARCHITECTURE.md`'s milestones, in case you're deciding what to pick up:

- **M4 (current)**: `cobble-plugin-host` (this crate, mostly built), the WIT interface (built),
  manifest + permission enforcement (built), wiring `get-block-data`/`update-block-data` to real
  `cobble-storage` calls (not done), `PluginBlockNode` + `UiSchemaRenderer` on the frontend (not
  done), a `hello-world` sample plugin (not done).
- **M5**: theming/motion hardening, plus (plugin-relevant) the `custom_ui` sandboxed-iframe
  escape hatch, `register-slash-command`/`register-sidebar-panel`/`register-block-type`,
  `subscribe-event`/`on-event`, permission-gated `http-fetch`, and a permission-consent UI shown
  to the user at plugin install time.

Check the coordination server (`GET localhost:8420/tasks`, see `CLAUDE.md`) for current
claims/status before starting any of the above — this doc won't stay perfectly in sync with live
task state.
