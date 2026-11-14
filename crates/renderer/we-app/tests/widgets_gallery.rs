//! Snapshots of the E5b widget gallery — the same `widgets_ui`
//! `--gallery widgets` opens, dark-themed, rendered headless. Baselines
//! live in `tests/snapshots/`; re-record with
//! `UPDATE_SNAPSHOTS=1 cargo test -p we-app widgets_gallery`.
use std::cell::RefCell;
use std::rc::Rc;

use egui_kittest::{Harness, SnapshotResults};
use we_app::gallery_widgets::{widgets_tree, widgets_ui};
use we_widgets::EditState;

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
