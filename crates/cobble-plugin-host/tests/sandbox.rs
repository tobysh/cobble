//! Exercises `crate::engine`'s fuel metering and memory limiting through the
//! real `wasmtime::component` instantiate/call path, using the hand-written
//! `tests/fixtures/sandbox_smoke.wat` component (see that file's header
//! comment for why it's numeric-only rather than built against
//! `wit/cobble-plugin.wit` directly). Covers the task's required cases:
//! successful call in/out, fuel exhaustion, memory-limit enforcement, and
//! (bonus, alongside `tests/permission_gate.rs`) a permission gate enforced
//! through an actual wasm call rather than only at the Rust level.

use cobble_plugin_host::engine::{self, LimitsProvider, SandboxLimits};
use wasmtime::component::{Component, Linker};
use wasmtime::{Engine, Store, StoreLimits};

struct TestState {
    limits: StoreLimits,
    gate_open: bool,
}

impl LimitsProvider for TestState {
    fn resource_limits(&mut self) -> &mut StoreLimits {
        &mut self.limits
    }
}

fn engine() -> Engine {
    engine::new_engine().expect("engine configures cleanly")
}

fn component(engine: &Engine) -> Component {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/sandbox_smoke.wat");
    let bytes = wat::parse_file(path).expect("fixture is valid component-model WAT");
    Component::new(engine, &bytes).expect("fixture compiles as a component")
}

fn linker(engine: &Engine) -> Linker<TestState> {
    let mut linker = Linker::<TestState>::new(engine);
    let mut root = linker.root();
    root.func_wrap("add", |_store: wasmtime::StoreContextMut<'_, TestState>, (a, b): (i32, i32)| {
        Ok((a + b,))
    })
    .unwrap();
    linker
        .root()
        .func_wrap(
            "gated-op",
            |store: wasmtime::StoreContextMut<'_, TestState>, (n,): (u32,)| {
                if store.data().gate_open {
                    Ok((n * 2,))
                } else {
                    Err(wasmtime::Error::msg("permission denied: gate is not open"))
                }
            },
        )
        .unwrap();
    linker
}

fn new_store(engine: &Engine, sandbox: SandboxLimits, gate_open: bool) -> Store<TestState> {
    let state = TestState {
        limits: engine::store_limits(sandbox),
        gate_open,
    };
    let mut store = Store::new(engine, state);
    engine::configure_store(&mut store, sandbox).expect("store configures cleanly");
    store
}

#[test]
fn successful_call_in_and_out_of_a_sandboxed_module() {
    let engine = engine();
    let component = component(&engine);
    let linker = linker(&engine);
    let mut store = new_store(&engine, SandboxLimits::default(), false);

    let instance = linker
        .instantiate(&mut store, &component)
        .expect("instantiates cleanly");
    let run_add = instance
        .get_typed_func::<(i32, i32), (i32,)>(&mut store, "run-add")
        .expect("run-add is exported");

    let (result,) = run_add.call(&mut store, (17, 25)).expect("call succeeds");

    assert_eq!(result, 42);
}

#[test]
fn fuel_exhaustion_is_caught_not_hung() {
    let engine = engine();
    let component = component(&engine);
    let linker = linker(&engine);
    // A tiny fuel budget — the fixture's `loop-forever` export never
    // terminates on its own, so this proves fuel metering (not the guest)
    // is what stops it.
    let tiny_fuel = SandboxLimits {
        max_fuel: 10_000,
        ..SandboxLimits::default()
    };
    let mut store = new_store(&engine, tiny_fuel, false);

    let instance = linker
        .instantiate(&mut store, &component)
        .expect("instantiates cleanly");
    let loop_forever = instance
        .get_typed_func::<(), (i32,)>(&mut store, "loop-forever")
        .expect("loop-forever is exported");

    let result = loop_forever.call(&mut store, ());

    let err = result.expect_err("an unbounded loop must be stopped by fuel exhaustion");
    let message = format!("{err:#}");
    assert!(
        message.contains("fuel") || message.contains("all fuel consumed"),
        "expected a fuel-exhaustion error, got: {message}"
    );

    // Teardown is clean: the store/instance can simply be dropped, and a
    // fresh instance can still be created and used afterward.
    drop(store);
    let mut store2 = new_store(&engine, SandboxLimits::default(), false);
    let instance2 = linker
        .instantiate(&mut store2, &component)
        .expect("a fresh instance still works after a prior instance exhausted its fuel");
    let run_add = instance2
        .get_typed_func::<(i32, i32), (i32,)>(&mut store2, "run-add")
        .unwrap();
    assert_eq!(run_add.call(&mut store2, (1, 1)).unwrap(), (2,));
}

#[test]
fn memory_limit_is_enforced() {
    let engine = engine();
    let component = component(&engine);
    let linker = linker(&engine);
    // The fixture starts with a 1-page (64 KiB) memory and grows one page
    // at a time. Cap it at 2 pages so growth is denied almost immediately.
    let tiny_memory = SandboxLimits {
        max_memory_bytes: 2 * 64 * 1024,
        ..SandboxLimits::default()
    };
    let mut store = new_store(&engine, tiny_memory, false);

    let instance = linker
        .instantiate(&mut store, &component)
        .expect("instantiates cleanly under a tight memory cap");
    let grow_until_trap = instance
        .get_typed_func::<(), (i32,)>(&mut store, "grow-until-trap")
        .expect("grow-until-trap is exported");

    let result = grow_until_trap.call(&mut store, ());
    result.expect_err("growth past the memory limit must be denied, tripping the guest's trap");
}

#[test]
fn a_trap_tears_down_cleanly_without_hanging_the_host() {
    let engine = engine();
    let component = component(&engine);
    let linker = linker(&engine);
    let mut store = new_store(&engine, SandboxLimits::default(), false);

    let instance = linker
        .instantiate(&mut store, &component)
        .expect("instantiates cleanly");
    let trap_now = instance
        .get_typed_func::<(), ()>(&mut store, "trap-now")
        .expect("trap-now is exported");

    trap_now
        .call(&mut store, ())
        .expect_err("unreachable must surface as a call error, not a host crash/hang");

    // The host process is still alive and can keep using wasmtime normally.
    drop(store);
    let mut store2 = new_store(&engine, SandboxLimits::default(), false);
    let instance2 = linker.instantiate(&mut store2, &component).unwrap();
    let run_add = instance2
        .get_typed_func::<(i32, i32), (i32,)>(&mut store2, "run-add")
        .unwrap();
    assert_eq!(run_add.call(&mut store2, (2, 2)).unwrap(), (4,));
}

#[test]
fn permission_gate_denies_through_a_real_wasm_call() {
    let engine = engine();
    let component = component(&engine);
    let linker = linker(&engine);
    let mut store = new_store(&engine, SandboxLimits::default(), /* gate_open */ false);

    let instance = linker.instantiate(&mut store, &component).unwrap();
    let call_gated = instance
        .get_typed_func::<(u32,), (u32,)>(&mut store, "call-gated")
        .unwrap();

    call_gated
        .call(&mut store, (21,))
        .expect_err("host closure denies the gated operation when the permission isn't granted");
}

#[test]
fn permission_gate_allows_through_a_real_wasm_call() {
    let engine = engine();
    let component = component(&engine);
    let linker = linker(&engine);
    let mut store = new_store(&engine, SandboxLimits::default(), /* gate_open */ true);

    let instance = linker.instantiate(&mut store, &component).unwrap();
    let call_gated = instance
        .get_typed_func::<(u32,), (u32,)>(&mut store, "call-gated")
        .unwrap();

    let (result,) = call_gated
        .call(&mut store, (21,))
        .expect("host closure allows the gated operation once granted");
    assert_eq!(result, 42);
}
