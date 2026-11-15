#!/usr/bin/env bash
# The core crates must never pull a UI toolkit (egui/eframe/epaint/emath/
# winit) or tokio — a TUI/wasm frontend reuses them. `cargo tree` resolves
# the whole transitive graph, so an edge added anywhere in the core chain
# shows up here.
#
# The resolve runs once over the whole feature/target matrix instead of
# enumerating combinations:
#   --all-features   activates every feature a core crate declares, so an
#                    optional egui dep gated behind one still resolves.
#   --target all     keeps every [target.'cfg(...)'] section — a wasm32-only
#                    edge the host platform's resolve would prune still
#                    shows (default: the host's cfg only).
#   -e normal,build  the surface a reusing frontend actually resolves.
#                    Dev-deps only ever compile for the crate's own tests —
#                    we-screen's wasm-only `wasm-bindgen-test` chain pulls
#                    `wasm-bindgen-futures` → `tokio` there, which can never
#                    leak into a consumer.
#
# we-tui is held to the same rule, and per-target: a dependency hidden behind
# cfg(windows)/cfg(unix) only resolves when that platform is asked for, so the
# crate is checked on the native triples it can actually run on. wasm32 is not
# one of them (crossterm is native-only).
set -euo pipefail
cd "$(dirname "$0")/.."

core="we-session we-layout we-catalog we-data we-expr we-screen we-template we-style we-metrics"
args=()
for p in $core; do args+=(-p "$p"); done

deny='egui|eframe|epaint|emath|winit|tokio'

# A stale lockfile (a manifest edge the lock lacks) is a failure too — cargo
# tree --locked exits nonzero and must not fall through to a pass.
if ! tree="$(cargo tree --locked --all-features --target all -e normal,build "${args[@]}")"; then
    echo "egui-free check FAILED: cargo tree --locked could not resolve the core crates (stale Cargo.lock?)" >&2
    exit 1
fi
if echo "$tree" | grep -E "\b(${deny}) +v[0-9]"; then
    echo "egui-free check FAILED: a core crate pulled a denied dependency" >&2
    exit 1
fi

# we-tui, host + the other native desktops — per-target.
for target in "" x86_64-pc-windows-msvc x86_64-apple-darwin; do
    if ! tree="$(cargo tree --locked --all-features -e normal,build ${target:+--target "$target"} -p we-tui)"; then
        echo "egui-free check FAILED: cargo tree --locked could not resolve we-tui${target:+ on $target}" >&2
        exit 1
    fi
    if echo "$tree" | grep -E "\b(${deny}) +v[0-9]"; then
        echo "egui-free check FAILED: we-tui pulled a denied dependency${target:+ on $target}" >&2
        exit 1
    fi
done
echo "egui-free check passed: ${core} + we-tui pull no ${deny//|/, } (core: all features, all targets; we-tui: per native target)"
