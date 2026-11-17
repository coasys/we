//! Fonts are registered from the styles layout resolved, before anything
//! is measured, so the first frame lays text out in the chains it will
//! keep. A chain registered only when a measure first asks for it waits
//! for the next pass if any text was laid out before it (egui keeps a
//! font change for the next pass then), and the first frame draws that
//! text in a fallback.
//!
//! The style memo means a second resolve per node no longer shows as a
//! cost (what `drag_perf::a_layout_resolves_each_style_once` counted), so
//! this asks the question that matters directly.
use std::sync::Arc;

use egui::{vec2, Pos2, RawInput, Rect};
use we_app::RendererApp;
use we_egui::Registry;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{SchemaNode, StoreBag};

/// Every family egui has in use, by name.
fn families(ctx: &egui::Context) -> Vec<String> {
    ctx.fonts(|f| {
        f.families()
            .into_iter()
            .filter_map(|fam| match fam {
                egui::FontFamily::Name(n) => Some(n.to_string()),
                _ => None,
            })
            .collect()
    })
}

/// Text in an installed family, then text in a stack of two — a chain no
/// install foresaw, measured after text was already laid out this pass.
#[test]
fn a_stack_first_seen_on_the_first_frame_is_in_use_on_it() {
    let schema: SchemaNode = serde_json::from_value(serde_json::json!({
        "type": "Column",
        "children": [
            { "type": "we-text", "props": { "fontFamily": "'Mozilla Text'" }, "children": ["first"] },
            { "type": "we-text", "props": { "fontFamily": "VT323, 'DM Sans'" }, "children": ["second"] }
        ]
    }))
    .expect("schema parses");
    let mut app = RendererApp::new(
        schema,
        "test",
        Arc::new(StoreBag::new()),
        ScreenState::desktop(ScreenSchema::default(), "/"),
        Registry::with_builtins(),
    );
    let ctx = egui::Context::default();
    we_app::init_host(&ctx);
    // The installed families are in use once a pass has begun. Nothing
    // uploads here; say so, or epaint's debug check panics.
    ctx.run_ui(RawInput::default(), |_| {})
        .textures_delta
        .clear();
    assert!(
        !families(&ctx).iter().any(|f| f == "VT323, DM Sans"),
        "the stack is not one install registers"
    );
    let input = RawInput {
        screen_rect: Some(Rect::from_min_size(Pos2::ZERO, vec2(800.0, 600.0))),
        time: Some(1.0),
        ..Default::default()
    };
    let mut out = ctx.run_ui(input, |ui| app.frame_body(ui));
    out.textures_delta.clear();
    let in_use = families(&ctx);
    assert!(
        in_use.iter().any(|f| f == "VT323, DM Sans"),
        "the stack's chain is in use on the first frame that lays it out: {in_use:?}"
    );
}
