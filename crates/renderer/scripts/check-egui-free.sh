#!/usr/bin/env bash
# The core crates must never pull a UI toolkit (egui/eframe/winit) or tokio —
# a TUI/wasm frontend reuses them. `cargo tree` resolves the whole transitive
# graph, so an edge added anywhere in the core chain shows up here.
set -euo pipefail
cd "$(dirname "$0")/.."

core="we-session we-layout we-catalog we-data we-expr we-screen we-template we-style"
args=()
for p in $core; do args+=(-p "$p"); done

# A stale lockfile (a manifest edge the lock lacks) is a failure too — cargo
# tree --locked exits nonzero and must not fall through to a pass.
if ! tree="$(cargo tree --locked "${args[@]}")"; then
    echo "egui-free check FAILED: cargo tree --locked could not resolve the core crates (stale Cargo.lock?)" >&2
    exit 1
fi
if echo "$tree" | grep -E '\b(egui|eframe|winit|tokio) +v[0-9]'; then
    echo "egui-free check FAILED: a core crate pulled egui/eframe/winit/tokio" >&2
    exit 1
fi
echo "egui-free check passed: ${core} pull no egui/eframe/winit/tokio"
