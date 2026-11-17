//! B1: a page laid out beside a docked panel. The live window puts the data
//! panel (F11) on the right and the page in the central panel; the page's
//! `meta.frame` band is `position: fixed; width: calc(100vw - …)`, so its
//! `vw` must be the space the panel left, not the whole window.
use std::sync::Arc;

use egui::Vec2;
use egui_kittest::kittest::Queryable;
use egui_kittest::Harness;
use we_app::RendererApp;
use we_egui::Registry;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{SchemaNode, StoreBag};

const WINDOW: f32 = 1000.0;
const PANEL: f32 = 320.0;

#[test]
fn the_page_lays_out_in_the_space_left_after_a_panel() {
    let schema: SchemaNode = serde_json::from_value(serde_json::json!({
        "type": "Column",
        "props": {
            "position": "fixed", "left": "0px", "top": "0px",
            "width": "100vw", "height": "100vh",
            "ax": "end"
        },
        "children": [{ "type": "we-text", "children": ["RIGHT EDGE"] }]
    }))
    .expect("schema parses");
    let app = RendererApp::new(
        schema,
        "panel-layout",
        Arc::new(StoreBag::new()),
        ScreenState::desktop(ScreenSchema::default(), "/"),
        Registry::with_builtins(),
    );
    let mut h = Harness::builder()
        .with_size(Vec2::new(WINDOW, 600.0))
        .build_ui_state(
            |ui, app: &mut RendererApp| {
                egui::Panel::right("panel")
                    .exact_size(PANEL)
                    .show(ui, |ui| {
                        ui.label("DATA PANEL");
                    });
                egui::CentralPanel::default()
                    .frame(egui::Frame::NONE)
                    .show(ui, |ui| {
                        let room = ui.max_rect().size();
                        app.frame_body_in(ui, room);
                    });
            },
            app,
        );
    we_app::init_host(&h.ctx);
    for _ in 0..8 {
        h.run();
    }
    let panel = h.get_by_label("DATA PANEL").rect();
    let text = h.get_by_label("RIGHT EDGE").rect();
    assert!(
        text.right() <= panel.left(),
        "the page's right edge {} is under the panel (panel starts at {}; window {WINDOW})",
        text.right(),
        WINDOW - PANEL
    );
}
