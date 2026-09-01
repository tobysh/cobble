;; Hand-written Component Model test fixture used by `tests/sandbox.rs` and
;; `tests/permission_gate.rs` to exercise the real `wasmtime::component`
;; instantiate/call path (the same machinery `crate::plugin::PluginInstance`
;; uses for real plugins) without needing an external wasm toolchain.
;;
;; Deliberately independent of `wit/cobble-plugin.wit` / the bindgen'd
;; `Plugin` world: this fixture uses flat (non-namespaced) import/export
;; names and purely numeric (i32/u32) signatures so it can be hand-authored
;; directly in the Component Model text format without needing to encode
;; strings through the canonical ABI (which needs a guest-side allocator/
;; `realloc` export — out of scope for a host-side sandbox-mechanics test).
;; It proves the mechanism (Linker imports, Component instantiate, fuel
;; metering, memory limiting, trap propagation) generically; the *interface
;; shape* (what functions exist, their real string/JSON signatures) is
;; separately proven by `wit/cobble-plugin.wit` compiling through
;; `bindgen!` in `src/host.rs`.
(component
  (import "add" (func $add (param "a" s32) (param "b" s32) (result s32)))
  (import "gated-op" (func $gated (param "n" u32) (result u32)))

  (core func $core_add (canon lower (func $add)))
  (core func $core_gated (canon lower (func $gated)))

  (core module $m
    (import "host" "add" (func $host_add (param i32 i32) (result i32)))
    (import "host" "gated-op" (func $host_gated (param i32) (result i32)))

    (memory (export "memory") 1)

    (func (export "run_add") (param i32 i32) (result i32)
      local.get 0
      local.get 1
      call $host_add)

    (func (export "call_gated") (param i32) (result i32)
      local.get 0
      call $host_gated)

    (func (export "loop_forever") (result i32)
      (loop $l
        br $l)
      i32.const 0)

    (func (export "trap_now")
      unreachable)

    ;; Grows memory by one page at a time until the host's ResourceLimiter
    ;; denies the growth (memory.grow returns -1 per the core wasm spec,
    ;; rather than trapping on its own), at which point it explicitly traps
    ;; so the host-side test can observe "memory limit enforced" as a
    ;; regular call error rather than having to inspect memory size.
    (func (export "grow_until_trap") (result i32)
      (local $r i32)
      (local $i i32)
      (loop $l
        i32.const 1
        memory.grow
        local.set $r
        local.get $r
        i32.const -1
        i32.eq
        if
          unreachable
        end
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        local.get $i
        i32.const 100000
        i32.lt_s
        br_if $l)
      i32.const 0)
  )

  (core instance $m_inst (instantiate $m
    (with "host" (instance
      (export "add" (func $core_add))
      (export "gated-op" (func $core_gated))
    ))
  ))

  (func $run_add (param "a" s32) (param "b" s32) (result s32)
    (canon lift (core func $m_inst "run_add")))
  (func $call_gated (param "n" u32) (result u32)
    (canon lift (core func $m_inst "call_gated")))
  (func $loop_forever (result s32)
    (canon lift (core func $m_inst "loop_forever")))
  (func $trap_now
    (canon lift (core func $m_inst "trap_now")))
  (func $grow_until_trap (result s32)
    (canon lift (core func $m_inst "grow_until_trap")))

  (export "run-add" (func $run_add))
  (export "call-gated" (func $call_gated))
  (export "loop-forever" (func $loop_forever))
  (export "trap-now" (func $trap_now))
  (export "grow-until-trap" (func $grow_until_trap))
)
