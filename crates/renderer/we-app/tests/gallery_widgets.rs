//! Per-theme snapshots of the E5a widget gallery — `we-app --gallery
//! widgets`'s schema rendered through `RendererApp`, the same path real
//! panels take. Baselines live in `tests/snapshots/`; re-record with
//! `UPDATE_SNAPSHOTS=1 cargo test -p we-app gallery_widgets`.

use egui_kittest::{Harness, SnapshotResults};
use we_app::gallery::{load_theme_set, WidgetsApp};

/// The gallery's resolved tree paints every node — nothing lands on the
/// `__unknown__` red box. This is the assertion the `$lane` fix hangs on:
/// a `$`-type the registry knows is a widget, not a `$todo:` placeholder.
#[test]
fn gallery_resolves_every_node() {
    let set = load_theme_set();
    let mut app = WidgetsApp::app_for(&set, "light");
    let resolved = app.session.resolve().clone();
    let mut unknown = Vec::new();
    let mut lanes = 0usize;
    fn walk(
        n: &we_template::ResolvedNode,
        app: &we_app::RendererApp,
        unknown: &mut Vec<String>,
        lanes: &mut usize,
    ) {
        if app.registry.widget_for(&n.ty).type_name() == "__unknown__" {
            unknown.push(n.ty.to_string());
        }
        if n.ty.as_ref() == "$lane" {
            *lanes += 1;
        }
        for c in &n.children {
            if let we_template::ResolvedChild::Node(n) = c {
                walk(n, app, unknown, lanes);
            }
        }
    }
    walk(&resolved, &app, &mut unknown, &mut lanes);
    assert!(unknown.is_empty(), "unknown widget types: {unknown:?}");
    assert!(
        lanes >= 1,
        "the gallery's $lane must resolve as the Lane widget"
    );
}

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
        // The animated widgets request repaints — run a fixed few steps,
        // then step (with real time between) until image loads settle:
        // `data:` sources decode on a loader thread, so instant frames
        // alone would snapshot a still-pending image.
        harness.run_steps(4);
        for _ in 0..100 {
            if !harness.ctx.has_pending_images() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
            harness.step();
        }
        harness.snapshot(format!("widgets_{id}"));
        results.extend_harness(&mut harness);
    }
    results.unwrap();
}
