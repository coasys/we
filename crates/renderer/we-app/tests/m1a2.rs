//! M1 round A2 — the app frame no longer owns the glyph policy. A harness
//! that asks for `MissingGlyphPolicy::Panic` (kittest's default) must get a
//! strict frame from `frame_body`: a codepoint no installed font has panics.
//! Round A's `install_media` reset the policy to `Tofu` on every frame, so
//! no harness could ever render strictly.
use std::sync::Arc;

use we_app::RendererApp;
use we_egui::Registry;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{SchemaNode, StoreBag};

fn app_with_text(text: &str) -> RendererApp {
    let schema: SchemaNode = serde_json::from_value(serde_json::json!({
        "type": "Column",
        "meta": { "name": "glyphs", "description": "", "icon": "text-aa" },
        "children": [{ "type": "we-text", "props": { "text": text } }]
    }))
    .expect("schema parses");
    RendererApp::new(
        schema,
        "glyphs",
        Arc::new(StoreBag::default()),
        ScreenState::desktop(ScreenSchema::default(), "/"),
        Registry::with_builtins(),
    )
}

/// U+10FFFE is a noncharacter no font has. Under the harness's `Panic`
/// policy `frame_body` must not quietly downgrade it to tofu.
#[test]
#[should_panic(expected = "No glyph")]
fn a_strict_harness_gets_a_strict_frame() {
    let app = app_with_text("strict \u{10FFFE}");
    let mut harness = egui_kittest::Harness::builder()
        .with_context_setup(we_egui::install_media)
        .build_ui_state(|ui, app: &mut RendererApp| app.frame_body(ui), app);
    harness.run_steps(2);
}
