# The `font_raster` SIGSEGV on CI

CI job "Rust renderer (fmt, clippy, tests, wasm)" (`.github/workflows/build.yaml`)
runs `cargo test --locked` on a GPU-less `ubuntu-26.04` runner, with
`mesa-vulkan-drivers` installed so egui_kittest's wgpu renderer finds lavapipe.

## What CI shows

Every renderer-CI failure in the last 150 `CI` runs was read (8 failed renderer
jobs). Two are SIGSEGVs, both today, both in `font_raster`, none anywhere else:

| Run / job                                           | Where it died                                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 43735703929 attempt 1, job 132877735949 (151e1ee77) | `running 3 tests`, then SIGSEGV 2.5 s later — no test reported                                                               |
| 43740466029 attempt 1, job 132892285659             | `a_static_face_still_gets_the_synthesised_bold ... ok` at +0.5 s, SIGSEGV 1.9 s later with the other two tests still running |

Both re-ran green unchanged.

Timeline that matters:

- 2026-11-14 21:17 `dc55026bc` installs lavapipe; wgpu snapshot tests run on CI from here.
- 2026-11-15 13:19 `68adc60fb` adds `font_raster`.
- Renderer CI ran wgpu snapshot tests between those two points without a crash; of
  the four runs since `font_raster` exists, two crashed in it.

What sets `font_raster` apart: every `shoot()` builds a fresh `Harness`, and
egui_kittest's default renderer makes a new wgpu instance + device on the first
`render()` and drops it with the harness. `font_raster` does that 16 times across
3 test threads (6 + 2 + 8), so it is the binary with the most concurrent device
creation _and destruction_. `coasys_render`, which runs before it and also renders
in parallel, makes far fewer devices per thread and passed both times.

## Adapter

egui_kittest 0.37's `default_wgpu_setup` sorts adapters CPU-first, then Vulkan
before GL. `strace` confirms `libvulkan_lvp.so` is loaded. On CI there is no other
Vulkan device, so it is lavapipe there too.

## Reproduction attempts — none crashed

Box: AMD Threadripper 2950X (32 threads, Zen 1, no AVX-512), Ubuntu 24.04, host
mesa 25.2.8. Binary: `target/debug/deps/font_raster-*` at `d64d5b482`, run
directly in a loop (`VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json`),
default test threads unless noted.

| #   | Setup                                                                                                                                                                                                                                         | Runs               | SIGSEGV           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------- |
| 1   | host mesa 25.2.8 lavapipe, 32 cores                                                                                                                                                                                                           | 200                | 0                 |
| 2   | as 1, `taskset -c 0,1`                                                                                                                                                                                                                        | 200                | 0                 |
| 3   | **CI's stack**: resolute (26.04) sysroot — glibc 2.43, mesa 26.0.8, LLVM 21 — run under its `ld-linux` with `--library-path`, `WGPU_BACKEND=vulkan`, `taskset -c 0-3`                                                                         | 100                | 0                 |
| 4   | as 3, all wgpu backends (no `WGPU_BACKEND`) and mesa's EGL/llvmpipe from the sysroot (`__EGL_VENDOR_LIBRARY_FILENAMES`, `LIBGL_ALWAYS_SOFTWARE=1`, host implicit Vulkan layers disabled), as on a runner where EGL is mesa rather than nvidia | 100                | 0                 |
| 5   | temporary stress test (not committed): 16 threads × 8 harness renders each, fresh device per harness — host mesa                                                                                                                              | 30 (3 840 renders) | 0                 |
| 6   | as 5, CI's mesa 26.0.8 (setup 3)                                                                                                                                                                                                              | 30                 | 0                 |
| 7   | as 5, CI's mesa + EGL (setup 4)                                                                                                                                                                                                               | 30                 | 0                 |
| 8   | AddressSanitizer build (`RUSTC_BOOTSTRAP=1 -Zsanitizer=address`), host mesa                                                                                                                                                                   | 30                 | 0, no ASan report |
| 9   | as 8, CI's mesa + EGL                                                                                                                                                                                                                         | 30                 | 0, no ASan report |

`--test-threads=1` was not looped: with no crash at default threads there was
nothing for it to compare against.

So no backtrace: the crash did not happen once in ~750 runs of the binary and
~11 500 concurrent renders, on CI's own mesa/LLVM/glibc. What this box cannot
reproduce is the runner's hardware: a 4-vCPU EPYC VM (often Zen 4, with
AVX-512, which LLVM's lavapipe JIT can target and this Zen 1 cannot). Text
rasterising goes through `vello_cpu`/`fearless_simd`, whose dispatch tops out
at AVX2 — the same path here as on CI — and ASan found nothing in the
instrumented Rust, which points away from our font code and at the native GPU
stack.

## The fix, and how sure it is

Unproven locally. The evidence for it is the CI log alone: the crash came only
in the binary that makes and drops the most wgpu devices concurrently, only
while two or three of its tests were rendering at once, and only since that
binary existed.

`we-app/tests/support/gpu.rs` gives such a harness a renderer —
`.renderer(gpu::serial())` — that is egui_kittest's own lazy wgpu renderer with
the same defaults (so no image changes), but whose texture uploads, render and
device drop each hold one process-wide lock. Layout, painting and assertions
stay parallel. No retries, no `--test-threads=1`, no `#[ignore]`: if the crash
is not concurrency on lavapipe, it will come back, and in a test that renders
alone, which would be the next lead.

## After the fix (`ffb07d383`)

| Setup                                       | Runs | SIGSEGV |
| ------------------------------------------- | ---- | ------- |
| host mesa, `taskset -c 0,1`                 | 100  | 0       |
| CI's mesa + EGL (setup 4), `taskset -c 0-3` | 100  | 0       |

These prove only that nothing broke: with no crash before, there is no rate to
compare against. The real test is CI: a renderer job that crashes in a wgpu
test again after this means the cause is elsewhere, and that run's core is
worth keeping.

Gates from `crates/renderer`, all green: `cargo test --locked`,
`cargo clippy --all-targets --locked -- -D warnings`, `cargo fmt --all -- --check`,
`cargo check --locked --target wasm32-unknown-unknown`,
`bash scripts/check-egui-free.sh`. No snapshot PNG changed.

Not wired: the harnesses in `m1a`, `m1a2`, `tree` and `dump` never call
`render()` or `snapshot()`, so they never make a device. A new harness that
renders must take `.renderer(gpu::serial())` — nothing enforces it.
