//! Per-theme snapshots of the style gallery — the same `gallery_ui`
//! `--gallery style` opens, rendered headless through `egui_kittest`.
//! Baselines live in `tests/snapshots/`; re-record with
//! `UPDATE_SNAPSHOTS=1 cargo test -p we-app gallery`.

use egui_kittest::{Harness, SnapshotOptions, SnapshotResults};
use we_app::gallery::{gallery_ui, load_theme_set};

/// Every raster input that could vary across processes or machines,
/// pinned per the re-review's determinism recommendation:
///
/// - fonts: egui's bundled `FontDefinitions` with their fixed family
///   order — no system-font discovery, no drift when egui's default set
///   changes;
/// - scale: `pixels_per_point = 1.0`, so the pixel grid is the point grid;
/// - backend: the wgpu test renderer — `egui_kittest`'s adapter selector
///   prefers the CPU adapter and its `RendererOptions` are `PREDICTABLE`,
///   i.e. a deterministic software rasterizer rather than whatever GPU
///   the host happens to have.
///
/// The comparison is calibrated from dify 0.8.0's actual comparator:
/// `egui_kittest` passes `threshold` to `dify::diff::get_results` as the
/// raw per-pixel gate — the maximum weighted squared YIQ distance
/// (`0.5053·Δy² + 0.299·Δi² + 0.1957·Δq²`, max 35215) a non-AA pixel may
/// move before it counts as failed. It is NOT dify-cli's normalized
/// `[0,1]` knob (that one is squared × 35215 inside `dify::run`). In
/// these units `0.05` fails any pixel channel change of ≥1 level (the
/// smallest nonzero delta, a 1-level blue shift, is 0.0565) — i.e. the
/// per-pixel policy is "byte-identical modulo AA", and AA-classified
/// edge pixels are exempted by dify regardless. `max_failed_pixels(8)`
/// is then the changed-area budget for raster speckle: far below the
/// ~8k-px phase shift this harness once recorded (max 29 channel
/// levels, Δ≈425 ≫ 0.05), a moved border, or a missing glyph.
fn pinned_harness(size: egui::Vec2) -> egui_kittest::HarnessBuilder {
    Harness::builder()
        .with_size(size)
        .with_pixels_per_point(1.0)
        .with_context_setup(|ctx| {
            ctx.set_fonts(egui::FontDefinitions::default());
        })
        .wgpu()
        .with_options(SnapshotOptions::new().threshold(0.05).max_failed_pixels(8))
}

#[test]
fn gallery_snapshots_per_theme() {
    let set = load_theme_set();
    assert_eq!(
        set.len(),
        6,
        "all six themes must snapshot (was a nonempty check): {}",
        we_app::gallery::tokens_dir().display()
    );
    let mut results = SnapshotResults::new();
    for theme in set.iter() {
        let theme = theme.clone();
        let mut harness = pinned_harness(egui::Vec2::new(760.0, 1440.0)).build_ui(|ui| {
            gallery_ui(ui, &theme);
        });
        harness.run();
        harness.snapshot(format!("style_{}", theme.id));
        results.extend_harness(&mut harness);
    }
    results.unwrap();
}
