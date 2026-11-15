//! Glow parity: text nothing colours is the theme's body colour. The web
//! declares `color: var(--we-type-body-color, var(--we-role-text))` where a
//! theme applies (`BODY_TYPE`, 2-themes/themeStyles.ts), so a card's name
//! with no `color` of its own is near-white on Coasys Glow. Rust fell back to
//! egui's grey visuals colour.
use std::sync::Arc;

use we_app::gallery::load_theme_set;
use we_app::RendererApp;
use we_egui::Registry;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{SchemaNode, StoreBag};

#[test]
fn uncoloured_text_is_the_theme_body_colour() {
    let schema: SchemaNode = serde_json::from_value(serde_json::json!({
        "type": "Column",
        "meta": { "name": "body", "description": "", "icon": "text-t" },
        "children": [{ "type": "we-text", "children": ["Juni Okafor"] }]
    }))
    .unwrap();
    let mut app = RendererApp::new(
        schema,
        "body",
        Arc::new(StoreBag::default()),
        ScreenState::desktop(ScreenSchema::default(), "/"),
        Registry::with_builtins(),
    );
    let theme = load_theme_set().get("glow").expect("glow tokens").clone();
    let role = theme
        .tokens
        .get("--we-role-text")
        .expect("--we-role-text")
        .to_string();
    let want = we_style::eval_color(&role).expect("role text parses");
    let [r, g, b, _] = want.to_premultiplied();
    let want = egui::Color32::from_rgb((r * 255.0) as u8, (g * 255.0) as u8, (b * 255.0) as u8);
    app.theme = theme;
    let mut h =
        egui_kittest::Harness::new_ui_state(|ui, app: &mut RendererApp| app.frame_body(ui), app);
    h.run();
    let got = h.ctx.global_style().visuals.text_color();
    assert_eq!(got, want, "body text colour (role text {role})");
}
