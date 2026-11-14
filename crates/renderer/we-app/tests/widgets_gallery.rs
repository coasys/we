//! Snapshots of the E5b widget gallery — the same `widgets_ui`
//! `--gallery widgets` opens, dark-themed, rendered headless. Baselines
//! live in `tests/snapshots/`; re-record with
//! `UPDATE_SNAPSHOTS=1 cargo test -p we-app widgets_gallery`.
use std::cell::RefCell;
use std::rc::Rc;

use egui_kittest::{Harness, SnapshotOptions, SnapshotResults};
use we_app::gallery_widgets::{widgets_tree, widgets_ui};
use we_egui::EditState;

fn snap(name: &str, open: bool, results: &mut SnapshotResults) {
    let edit = Rc::new(RefCell::new(EditState::default()));
    let tree = widgets_tree(open);
    let e = edit.clone();
    let mut harness = Harness::builder()
        .with_size(egui::vec2(420.0, 720.0))
        // Pinned raster inputs, same policy as `gallery.rs`: bundled
        // fonts, 1px-per-point, CPU-preferred wgpu adapter, 0.6 YIQ
        // per-pixel tolerance with an 8px changed-area budget.
        .with_pixels_per_point(1.0)
        .with_context_setup(|ctx| {
            ctx.set_fonts(egui::FontDefinitions::default());
            ctx.set_theme(egui::ThemePreference::Dark);
        })
        .wgpu()
        .with_options(SnapshotOptions::new().threshold(0.6).max_failed_pixels(8))
        .build_ui(move |ui| {
            let mut events = Vec::new();
            widgets_ui(ui, &tree, &mut e.borrow_mut(), &mut events, 0.0);
        });
    harness.run();
    harness.snapshot(format!("widgets_{name}_dark"));
    results.extend_harness(&mut harness);
}

#[test]
fn widgets_gallery_snapshots_dark() {
    let mut results = SnapshotResults::new();
    snap("rest", false, &mut results);
    snap("open", true, &mut results);
    results.unwrap();
}

/// The open-modal backdrop dims the whole viewport — every pixel is
/// opaque, and the bare corners all carry the same scrimmed surface
/// colour (previously only the content rect was opaque, so the dim
/// looked patchy).
#[test]
fn widgets_open_backdrop_covers_viewport() {
    let edit = Rc::new(RefCell::new(EditState::default()));
    let tree = widgets_tree(true);
    let e = edit.clone();
    let mut harness = Harness::builder()
        .with_size(egui::vec2(420.0, 720.0))
        .with_context_setup(|ctx| {
            ctx.set_fonts(egui::FontDefinitions::default());
            ctx.set_theme(egui::ThemePreference::Dark);
        })
        .build_ui(move |ui| {
            let mut events = Vec::new();
            widgets_ui(ui, &tree, &mut e.borrow_mut(), &mut events, 0.0);
        });
    harness.run();
    let image = harness.render().expect("render");
    let (w, h) = (image.width(), image.height());
    assert_eq!((420, 720), (w, h));
    assert!(
        image.pixels().all(|p| p.0[3] == 255),
        "viewport has transparent pixels under the backdrop"
    );
    let corners =
        [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)].map(|(x, y)| image.get_pixel(x, y).0);
    let [r, g, b, _] = corners[0];
    for c in corners {
        assert!(
            c[0].abs_diff(r) < 4 && c[1].abs_diff(g) < 4 && c[2].abs_diff(b) < 4,
            "scrimmed surface differs between corners: {corners:?}"
        );
    }
}
