//! `spaceStore.firstScreenOpen`, as the TS host publishes it after #505: the
//! work a template holds until the first screen is up (the sidebar's latest
//! calls) starts after the host's first drawn frame, not before it.
use std::sync::Arc;

use egui::Vec2;
use egui_kittest::Harness;
use we_app::RendererApp;
use we_egui::Registry;
use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{SchemaNode, StoreBag};

fn open(bag: &StoreBag) -> Value {
    match bag.root("spaceStore") {
        Some(Value::Namespace(ns)) => ns.get("firstScreenOpen"),
        _ => Value::Undefined,
    }
}

#[test]
fn the_host_opens_the_first_screen_after_its_first_frame() {
    let bag = Arc::new(StoreBag::new());
    bag.set_host_member("spaceStore", "firstScreenOpen", Value::Bool(false));
    let schema: SchemaNode = serde_json::from_value(serde_json::json!({
        "type": "we-text", "children": ["hello"]
    }))
    .unwrap();
    let mut app = RendererApp::new(
        schema,
        "first-screen",
        bag.clone(),
        ScreenState::desktop(ScreenSchema::default(), "/"),
        Registry::with_builtins(),
    );
    app.hold_first_screen(bag.clone());
    assert!(
        open(&bag).strict_eq(&Value::Bool(false)),
        "closed before any frame"
    );

    let mut h = Harness::builder()
        .with_size(Vec2::new(400.0, 300.0))
        .build_ui_state(|ui, app: &mut RendererApp| app.frame_body(ui), app);
    we_app::init_host(&h.ctx);
    h.step();
    assert!(
        open(&bag).strict_eq(&Value::Bool(true)),
        "open after the first frame"
    );
}
