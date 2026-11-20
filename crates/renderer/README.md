# `crates/renderer` — the Rust/egui renderer

A second renderer for WE's template language, beside the Solid/TypeScript one.
It runs the same `we-bundle` files — `bundles/coasys.bundle.json` unchanged —
in an egui/eframe window, native and `wasm32-unknown-unknown`, and is meant to
end up connected to AD4M through the `we-store` executor trait.

Tests come from the vectors and the briefs: the shared conformance vectors
(`packages/schema-system/conformance`, task C1) and the task briefs in the
plan, not from implementation convenience.

## Layout

Dependency direction — never the other way:

```
we-expr  <-  we-screen  <-  we-template  <-  we-store  <-  we-widgets  <-  we-app
we-style depends on we-expr only; we-ad4m depends on we-store.
```

| crate         | what it is                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `we-expr`     | `Value`, `Namespace`, `Env`, `parse`/`eval`/`ParseCache` — the value layer. No egui, no I/O, wasm-clean.                    |
| `we-screen`   | `ScreenState`, `Navigator`, the back stack (task E2).                                                                       |
| `we-template` | Bundle + `SchemaNode` serde types, `ResolvedNode`/`ResolvedChild`/`NodeId`, handler tokens, `Host`, the normal-form writer. |
| `we-store`    | The `Executor` trait the store bag talks through, plus `FakeExecutor`. No egui, no I/O, wasm-clean.                         |
| `we-style`    | `Style` — design-system props resolved under the theme (task E4).                                                           |
| `we-widgets`  | The `Widget` contract, `MeasureCx`/`PaintCx`, `Registry`, the red unknown-widget box. The only crate that needs egui.       |
| `we-ad4m`     | `Executor` over `ad4m-client` (task E7).                                                                                    |
| `we-app`      | The eframe binary: window, menus, OS integration.                                                                           |

## Running

```bash
cargo run -p we-app -- --offline                 # bundle at ../../bundles/coasys.bundle.json
cargo run -p we-app -- --offline --bundle PATH   # another bundle
```

The window opens titled with the bundle's `name` (`Coasys`). `--offline` is the
only mode for now — there is no executor yet, so a bundle parses but nothing
renders past the scaffold text.

## Checking

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
cargo check --locked --target wasm32-unknown-unknown
```

The toolchain (`rust-toolchain.toml`) pins the channel and the
`wasm32-unknown-unknown` target; keep `CARGO_TARGET_DIR` pointed at
`crates/renderer/target` so the worktree does not share build output.

## Shared vectors

Rust tests reach repo files with paths relative to the workspace —
`../../bundles/coasys.bundle.json`, and later the conformance vectors under
`../../packages/schema-system/conformance/` (`CARGO_MANIFEST_DIR`-relative in
tests). A vector is a shared file both renderers read; it is not copied here.
