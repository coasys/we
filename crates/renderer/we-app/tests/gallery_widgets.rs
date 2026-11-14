//! Per-theme snapshots of the E5a widget gallery — `we-app --gallery
//! widgets`'s schema rendered through `RendererApp`, the same path real
//! panels take. Baselines live in `tests/snapshots/`; re-record with
//! `UPDATE_SNAPSHOTS=1 cargo test -p we-app gallery_widgets`.

use egui_kittest::{Harness, SnapshotResults};
use we_app::gallery::{load_theme_set, WidgetsApp};

#[test]
fn widget_gallery_snapshots_per_theme() {
    let set = load_theme_set();
    assert!(
        !set.is_empty(),
        "no token tables found at {}",
        we_app::gallery::tokens_dir().display()
    );
    let mut results = SnapshotResults::new();
    for theme in set.iter() {
        let id = theme.id.to_string();
        let app = WidgetsApp::app_for(&set, &id);
        let mut harness = Harness::builder()
            .with_size(egui::Vec2::new(820.0, 1600.0))
            .build_ui_state(|ui, app: &mut we_app::RendererApp| app.frame_body(ui), app);
        // The animated widgets request repaints — run a fixed few steps.
        harness.run_steps(4);
        harness.snapshot(format!("widgets_{id}"));
        results.extend_harness(&mut harness);
    }
    results.unwrap();
}
