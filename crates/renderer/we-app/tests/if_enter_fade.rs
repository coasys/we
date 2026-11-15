//! A `$if`'s enter fade, by the web's `ConditionalRenderer` rules: each
//! conditional starts from its own initial condition (`startVisible`) and
//! fades in only on a later false → true change; only the `then` branch is
//! wrapped, so the `else` never fades.
//!
//! - a page navigated to whose conditional is true from the start draws its
//!   body at once;
//! - true → false draws the `else` at once;
//! - false → true fades the `then` in.
use std::sync::Arc;

use egui::{vec2, Pos2, RawInput, Rect};
use we_app::RendererApp;
use we_egui::Registry;
use we_screen::{ScreenOp, ScreenSchema, ScreenState};
use we_template::{ResolvedChild, ResolvedNode, SchemaNode, StoreBag};

struct Driver {
    app: RendererApp,
    ctx: egui::Context,
    time: f64,
}

impl Driver {
    fn new(path: &str) -> Self {
        let fade = serde_json::json!({ "type": "fade", "duration": 300 });
        // Pages are chosen by the path, as a route would choose them, with
        // plain `$if`s of their own (no transition): a page's body mounts
        // when it is navigated to.
        let page = |path: &str, body: serde_json::Value| {
            serde_json::json!({
                "type": "$if",
                "props": {
                    "condition": { "$": format!("routeStore.currentPath == '{path}'") },
                    "then": body
                }
            })
        };
        let schema: SchemaNode = serde_json::from_value(serde_json::json!({
            "type": "Column",
            "children": [
                page("/", serde_json::json!(
                    { "type": "we-text", "props": { "id": "home" }, "children": ["home"] }
                )),
                page("/b", serde_json::json!({ "type": "Column", "children": [{
                    "type": "$if",
                    "props": {
                        "condition": true,
                        "enterTransition": fade,
                        "then": { "type": "we-text", "props": { "id": "body" }, "children": ["body"] }
                    }
                }]})),
                page("/c", serde_json::json!({ "type": "Column", "children": [{
                    "type": "$if",
                    "props": {
                        "condition": { "$": "routeStore.params.show == 'y'" },
                        "enterTransition": fade,
                        "then": { "type": "we-text", "props": { "id": "then" }, "children": ["then"] },
                        "else": { "type": "we-text", "props": { "id": "else" }, "children": ["else"] }
                    }
                }]}))
            ]
        }))
        .expect("schema parses");
        let app = RendererApp::new(
            schema,
            "test",
            Arc::new(StoreBag::new()),
            ScreenState::desktop(ScreenSchema::default(), path),
            Registry::with_builtins(),
        );
        let ctx = egui::Context::default();
        we_app::init_host(&ctx);
        let mut d = Self {
            app,
            ctx,
            time: 0.0,
        };
        for _ in 0..6 {
            d.frame();
        }
        d
    }

    fn frame(&mut self) {
        self.time += 1.0 / 60.0;
        let input = RawInput {
            screen_rect: Some(Rect::from_min_size(Pos2::ZERO, vec2(800.0, 600.0))),
            time: Some(self.time),
            ..Default::default()
        };
        let app = &mut self.app;
        let mut out = self.ctx.run_ui(input, |ui| app.frame_body(ui));
        out.textures_delta.clear();
    }

    /// The drawn opacity of the node with id prop `id`, or `None` when it
    /// is not in the tree.
    fn opacity(&self, id: &str) -> Option<f32> {
        fn find<'n>(n: &'n ResolvedNode, id: &str) -> Option<&'n ResolvedNode> {
            if n.props.get("id").map(|v| v.js_string()).as_deref() == Some(id) {
                return Some(n);
            }
            n.children.iter().find_map(|c| match c {
                ResolvedChild::Node(n) => find(n, id),
                _ => None,
            })
        }
        let root = self.app.session.runtime().resolved()?.clone();
        let node = find(&root, id)?;
        let style = self.app.layout()?.styles.get(&node.id)?;
        Some(style.paint.opacity.unwrap_or(1.0))
    }

    fn apply(&mut self, op: ScreenOp) {
        self.app.session.apply_screen(op);
    }
}

fn navigate(to: &str) -> ScreenOp {
    ScreenOp::Navigate {
        to: to.into(),
        query: None,
        base_depth: None,
        replace: false,
    }
}

fn show(value: &str) -> ScreenOp {
    ScreenOp::SetParam {
        name: "show".into(),
        value: Some(value.into()),
        push: None,
    }
}

/// `ConditionalRenderer.tsx:75-82`: a conditional mounted with its
/// condition true starts visible — opacity 1, nothing to animate — however
/// long after the app's first frame it mounts.
#[test]
fn a_page_navigated_to_draws_its_true_conditional_at_once() {
    let mut d = Driver::new("/");
    assert_eq!(d.opacity("home"), Some(1.0));
    d.apply(navigate("/b"));
    d.frame();
    assert_eq!(
        d.opacity("body"),
        Some(1.0),
        "the conditional mounted true: its body is not faded in"
    );
}

/// `ConditionalRenderer.tsx:327-331`: only the `then` content is wrapped;
/// the `else` is `Show`'s fallback and never animates.
#[test]
fn true_to_false_draws_the_else_at_once() {
    let mut d = Driver::new("/c?show=y");
    assert_eq!(d.opacity("then"), Some(1.0), "true from the start");
    d.apply(show("n"));
    d.frame();
    assert_eq!(d.opacity("then"), None, "the then branch left");
    assert_eq!(d.opacity("else"), Some(1.0), "the else is not faded in");
}

/// `ConditionalRenderer.tsx:147-163`: a later false → true fades the
/// `then` in from its hidden opacity.
#[test]
fn false_to_true_fades_the_then_in() {
    let mut d = Driver::new("/c?show=n");
    assert_eq!(d.opacity("else"), Some(1.0));
    d.apply(show("y"));
    d.frame();
    let first = d.opacity("then").expect("the then branch mounted");
    assert!(first < 0.5, "it starts faint: {first}");
    for _ in 0..30 {
        d.frame();
    }
    assert_eq!(d.opacity("then"), Some(1.0), "and ends opaque");
}
