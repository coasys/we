//! A transition watches every input a target is computed from, not only
//! the resolve: a height of `50vh` changes when the window does, with no
//! resolve in between (the surfaces report widths; a window that only
//! gets shorter resolves nothing). Seen then, it transitions then (as CSS does on a
//! resize); missed, the next unrelated resolve would find a target that
//! moved long ago and play the old one back — a visible jump backward.
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
    size: egui::Vec2,
}

impl Driver {
    fn frame(&mut self) {
        self.time += 1.0 / 60.0;
        let input = RawInput {
            screen_rect: Some(Rect::from_min_size(Pos2::ZERO, self.size)),
            time: Some(self.time),
            ..Default::default()
        };
        let app = &mut self.app;
        let mut out = self.ctx.run_ui(input, |ui| app.frame_body(ui));
        out.textures_delta.clear();
    }

    /// The drawn height of the node with id prop `box`.
    fn height(&self) -> f32 {
        fn find(n: &ResolvedNode) -> Option<&ResolvedNode> {
            if n.props.get("id").map(|v| v.js_string()).as_deref() == Some("box") {
                return Some(n);
            }
            n.children.iter().find_map(|c| match c {
                ResolvedChild::Node(n) => find(n),
                _ => None,
            })
        }
        let root = self.app.session.runtime().resolved().unwrap().clone();
        let node = find(&root).expect("the box");
        self.app.layout().unwrap().rects[&node.id].height()
    }

    fn resolves(&self) -> u64 {
        self.app.session.stats().resolves
    }
}

fn driver() -> Driver {
    let schema: SchemaNode = serde_json::from_value(serde_json::json!({
        "type": "Column",
        "props": { "width": "100%" },
        "children": [
            { "type": "Column", "props": {
                "id": "box", "width": "40px", "height": "50vh",
                "transition": "height 300ms linear"
            }},
            { "type": "we-text", "children": [{ "$": "routeStore.params.q" }] }
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
    let ctx = egui::Context::default();
    we_app::init_host(&ctx);
    let mut d = Driver {
        app,
        ctx,
        time: 0.0,
        size: vec2(1000.0, 600.0),
    };
    for _ in 0..6 {
        d.frame();
    }
    d
}

#[test]
fn a_shorter_window_is_not_played_back_at_the_next_resolve() {
    let mut d = driver();
    assert_eq!(d.height(), 300.0, "50vh of a 600px window");
    let resolved = d.resolves();
    d.size = vec2(1000.0, 400.0);
    // Long enough for any transition the resize started to finish.
    for _ in 0..40 {
        d.frame();
    }
    assert_eq!(d.resolves(), resolved, "a shorter window resolves nothing");
    assert_eq!(d.height(), 200.0, "50vh of a 400px window");
    // A resolve about something else entirely.
    d.app.session.apply_screen(ScreenOp::SetParam {
        name: "q".into(),
        value: Some("x".into()),
        push: None,
    });
    for i in 0..5 {
        d.frame();
        assert_eq!(
            d.height(),
            200.0,
            "frame {i} after an unrelated resolve: the box stays where the window put it"
        );
    }
    assert!(d.resolves() > resolved, "the param change resolved again");
}
