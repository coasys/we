//! A bare `egui::Context` driving `RendererApp::frame_body` — the Coasys
//! app at the `people` route under glow, 1280x800 — with no window and no
//! renderer, so a test can count work and read repaint requests frame by
//! frame.
#![allow(dead_code)]

use egui::{vec2, Event, PointerButton, Pos2, RawInput, Rect};
use we_app::RendererApp;
use we_template::{Bundle, ResolvedChild, ResolvedNode};

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));

pub struct Driver {
    pub app: RendererApp,
    pub ctx: egui::Context,
    time: f64,
}

/// What one frame produced that the tests read.
pub struct Frame {
    pub counters: we_egui::counters::Counters,
    /// egui was asked for another frame straight away.
    pub repaint: bool,
}

impl Driver {
    pub fn new() -> Self {
        let bundle = Bundle::parse(BUNDLE).unwrap();
        let (app, fell_back) = we_app::coasys_app(&bundle, "people", "glow").unwrap();
        assert!(!fell_back, "glow is a recorded theme");
        let ctx = egui::Context::default();
        we_app::init_host(&ctx);
        let mut d = Self {
            app,
            ctx,
            time: 0.0,
        };
        for _ in 0..8 {
            d.frame(vec![]);
        }
        d
    }

    pub fn frame(&mut self, events: Vec<Event>) -> Frame {
        self.time += 1.0 / 60.0;
        let input = RawInput {
            screen_rect: Some(Rect::from_min_size(Pos2::ZERO, vec2(1280.0, 800.0))),
            time: Some(self.time),
            events,
            ..Default::default()
        };
        we_egui::counters::take();
        let app = &mut self.app;
        let mut out = self.ctx.run_ui(input, |ui| app.frame_body(ui));
        // Nothing uploads here; say so, or epaint's debug check panics.
        out.textures_delta.clear();
        Frame {
            counters: we_egui::counters::take(),
            repaint: out
                .viewport_output
                .values()
                .any(|v| v.repaint_delay == std::time::Duration::ZERO),
        }
    }

    pub fn lane(&self, name: &str) -> Rect {
        fn find<'n>(n: &'n ResolvedNode, name: &str) -> Option<&'n ResolvedNode> {
            if n.ty.as_ref() == "$lane"
                && n.props.get("lane").map(|v| v.js_string()).as_deref() == Some(name)
            {
                return Some(n);
            }
            n.children.iter().find_map(|c| match c {
                ResolvedChild::Node(c) => find(c, name),
                ResolvedChild::Text(_) => None,
            })
        }
        let root = self.app.session.runtime.resolved().unwrap().clone();
        let node = find(&root, name).unwrap_or_else(|| panic!("no $lane {name}"));
        self.app.layout().unwrap().rects[&node.id]
    }
}

impl Driver {
    /// The laid-out rect of the rail — the fixed `zIndex: "chrome"`
    /// column that widens while the pointer is over it.
    pub fn rail(&self) -> Rect {
        fn find(n: &ResolvedNode) -> Option<&ResolvedNode> {
            if n.handlers.contains_key("onMouseEnter")
                && n.props.get("zIndex").map(|v| v.js_string()).as_deref() == Some("chrome")
            {
                return Some(n);
            }
            n.children.iter().find_map(|c| match c {
                ResolvedChild::Node(c) => find(c),
                ResolvedChild::Text(_) => None,
            })
        }
        let root = self.app.session.runtime.resolved().unwrap().clone();
        let node = find(&root).expect("the rail");
        self.app.layout().unwrap().rects[&node.id]
    }
}

pub fn button(pos: Pos2, pressed: bool) -> Event {
    Event::PointerButton {
        pos,
        button: PointerButton::Primary,
        pressed,
        modifiers: egui::Modifiers::NONE,
    }
}
