//! Snapshots of the E5b widget gallery — the same `widgets_ui`
//! `--gallery widgets` opens, dark-themed, rendered headless. Baselines
//! live in `tests/snapshots/`; re-record with
//! `UPDATE_SNAPSHOTS=1 cargo test -p we-app widgets_gallery`.
use std::cell::RefCell;
use std::rc::Rc;

use egui_kittest::{kittest::Queryable, Harness, SnapshotResults};
use we_app::gallery_widgets::{widgets_tree, widgets_ui};
use we_egui::EditState;

fn snap(name: &str, open: bool, results: &mut SnapshotResults) {
    let edit = Rc::new(RefCell::new(EditState::default()));
    let tree = widgets_tree(open);
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

/// The open dialog over the gallery tree is content-sized and centred —
/// the same `widgets_ui` `--gallery widgets` paints. The snapshot catches
/// the pixel change; this pins the geometry, so a layout regression fails
/// a test rather than landing silently in a re-recorded baseline. (The
/// overlay host column once inherited `layout`'s `min-height: 100vh` page
/// floor — the dialog filled the viewport and every assertion below except
/// the height bound still passed.)
#[test]
fn widgets_open_modal_sizes_to_content() {
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
    let dialog = harness.get_by_label("Example modal").rect();
    let inside = harness.get_by_label("Inside the modal").rect();
    // Centred in the 420×720 viewport.
    assert!(
        (dialog.center().x - 210.0).abs() < 1.0 && (dialog.center().y - 360.0).abs() < 1.0,
        "dialog not centred: {dialog:?}"
    );
    // Content-sized: title strip + one button + the size-md padding — far
    // under the `100dvh - 64px` cap, so the bottom edge sits well inside.
    assert!(
        dialog.height() < inside.height() + 220.0,
        "dialog not sized to content: {dialog:?} vs {inside:?}"
    );
    assert!(
        dialog.max.y < 660.0,
        "dialog reaches the viewport: {dialog:?}"
    );
    assert!(dialog.contains_rect(inside));
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
