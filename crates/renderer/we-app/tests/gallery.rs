//! Per-theme snapshots of the style gallery — the same `gallery_ui`
//! `--gallery style` opens, rendered headless through `egui_kittest`.
//! Baselines live in `tests/snapshots/`; re-record with
//! `UPDATE_SNAPSHOTS=1 cargo test -p we-app gallery`.

use egui_kittest::{Harness, SnapshotResults};
use we_app::gallery::{gallery_ui, load_theme_set};

#[test]
fn gallery_snapshots_per_theme() {
    let set = load_theme_set();
    assert!(
        !set.is_empty(),
        "no token tables found at {}",
        we_app::gallery::tokens_dir().display()
    );
    let mut results = SnapshotResults::new();
    for theme in set.iter() {
        let theme = theme.clone();
        let mut harness = Harness::builder()
            .with_size(egui::Vec2::new(760.0, 940.0))
            .build_ui(|ui| {
                gallery_ui(ui, &theme);
            });
        harness.run();
        harness.snapshot(format!("style_{}", theme.id));
        results.extend_harness(&mut harness);
    }
    results.unwrap();
}
