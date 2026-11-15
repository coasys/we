//! A home lane's drag with a template's own `onResize` — the handler the
//! web's `PanelLane` would call, which need not make the lane the width it
//! was asked for:
//!
//! each width a drag asks for reaches the handler once, however many paths
//! (the pre-resolve drag, paint, the release) see it asked for.
use std::sync::Arc;

use egui::{Pos2, Rect, Vec2};
use egui_kittest::Harness;
use we_app::RendererApp;
use we_egui::Registry;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{ResolvedChild, ResolvedNode, SchemaNode, StaticHost, StoreBag};

/// A row holding the `tree` lane (200px, its handle on the end edge) and
/// a column filling the rest. The lane's `onResize` is `on_resize`.
fn harness(on_resize: Option<serde_json::Value>) -> Harness<'static, RendererApp> {
    let mut lane = serde_json::json!({ "lane": "tree", "resize": "end", "width": "200px" });
    if let Some(h) = on_resize {
        lane["onResize"] = h;
    }
    let schema: SchemaNode = serde_json::from_value(serde_json::json!({
        "type": "Row",
        "props": { "width": "100%", "height": "400px" },
        "children": [
            { "type": "$panels", "props": lane },
            { "type": "Column", "props": { "flex": "1", "height": "400px" } }
        ]
    }))
    .expect("schema parses");
    let app = RendererApp::new(
        schema,
        "test",
        Arc::new(StoreBag::new()),
        ScreenState::desktop(ScreenSchema::default(), "/"),
        Registry::with_builtins(),
    );
    let mut h = Harness::builder()
        .with_size(Vec2::new(1000.0, 500.0))
        .build_ui_state(|ui, app: &mut RendererApp| app.frame_body(ui), app);
    h.run_steps(4);
    h
}

fn lane(h: &Harness<'_, RendererApp>) -> Rect {
    fn find(n: &ResolvedNode) -> Option<&ResolvedNode> {
        if n.ty.as_ref() == "$lane" {
            return Some(n);
        }
        n.children.iter().find_map(|c| match c {
            ResolvedChild::Node(n) => find(n),
            _ => None,
        })
    }
    let app = h.state();
    let root = app.session.runtime.resolved().expect("resolved");
    let node = find(root).expect("the lane");
    app.layout().expect("laid out").rects[&node.id]
}

fn pointer(h: &mut Harness<'_, RendererApp>, pos: Pos2, pressed: Option<bool>) {
    h.event(egui::Event::PointerMoved(pos));
    if let Some(pressed) = pressed {
        h.event(egui::Event::PointerButton {
            pos,
            button: egui::PointerButton::Primary,
            pressed,
            modifiers: egui::Modifiers::NONE,
        });
    }
    h.step();
}

/// How many times the template's handler ran: it invokes `test.resized`,
/// which nothing answers, so the host records each call.
fn calls(h: &Harness<'_, RendererApp>) -> usize {
    h.state()
        .session
        .host_as::<StaticHost>()
        .expect("a static host")
        .dropped
        .iter()
        .filter(|t| t.as_str() == "test.resized")
        .count()
}

/// The handler records the width and leaves the lane where it is — what
/// an `onResize` that snaps, refuses or defers looks like from paint:
/// the drawn width never becomes the one asked for. Five moves of 10px
/// ask for five widths, and the release at the last of them asks for
/// nothing new, so the handler runs five times — not once from the drag
/// before the resolve and again from paint on every frame.
#[test]
fn a_handler_that_keeps_the_width_hears_each_width_once() {
    let mut h = harness(Some(serde_json::json!({
        "$invoke": "test.resized",
        "args": [{ "$": "event.detail.width" }]
    })));
    let r = lane(&h);
    assert_eq!(r.width(), 200.0, "the authored width: {r:?}");
    let from = Pos2::new(r.max.x, r.center().y);
    pointer(&mut h, from, None);
    pointer(&mut h, from, Some(true));
    for i in 1..=5 {
        pointer(&mut h, from + Vec2::new(10.0 * i as f32, 0.0), None);
    }
    pointer(&mut h, from + Vec2::new(50.0, 0.0), Some(false));
    h.run_steps(3);
    assert_eq!(lane(&h).width(), 200.0, "the handler kept the width");
    assert_eq!(calls(&h), 5, "one call per width asked for");
}
