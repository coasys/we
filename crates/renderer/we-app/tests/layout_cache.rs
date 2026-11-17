//! E3c-12b P3: the frame's layout cache keys on everything `style_of`
//! reads — a theme swap between frames must re-lay out, or paint draws
//! new metrics into the old theme's rects.
use std::sync::Arc;

use indexmap::IndexMap;
use we_app::RendererApp;
use we_egui::Registry;
use we_screen::{ScreenSchema, ScreenState};
use we_style::{Polarity, Theme, TokenTable};
use we_template::{ResolvedChild, SchemaNode, StoreBag};

/// A `Column` over one `div` whose `height` is `1rem` — the rect moves
/// with the theme's recorded `--we-font-size-300` and nothing else.
fn app() -> RendererApp {
    let schema: SchemaNode = serde_json::from_value(serde_json::json!({
        "type": "Column",
        "meta": { "name": "cache", "description": "", "icon": "box" },
        "children": [
            { "type": "div", "props": { "height": "1rem" } }
        ]
    }))
    .expect("schema parses");
    RendererApp::new(
        schema,
        "cache",
        Arc::new(StoreBag::default()),
        ScreenState::desktop(ScreenSchema::default(), "/"),
        Registry::with_builtins(),
    )
}

/// A theme whose only recorded var is the unit metrics' fold input.
fn theme(id: &str, font_size_300: &str) -> Theme {
    let mut vars = IndexMap::new();
    vars.insert(Arc::from("--we-font-size-300"), Arc::from(font_size_300));
    Theme {
        id: Arc::from(id),
        polarity: Polarity::Dark,
        tokens: Arc::new(TokenTable::new(vars)),
    }
}

/// The lone child's laid-out height this frame.
fn child_height(app: &RendererApp) -> f32 {
    let root = app.session.runtime().resolved().expect("resolved");
    let id = match &root.children[0] {
        ResolvedChild::Node(n) => n.id.clone(),
        ResolvedChild::Text(_) => panic!("the child is a node"),
    };
    app.layout()
        .expect("a frame laid out")
        .rects
        .get(&id)
        .unwrap_or_else(|| panic!("{id:?} has a rect"))
        .height()
}

/// Frame 0 lays out under `sixteen`; the pick swaps to `twenty` before
/// frame 1 — same resolved tree, same offered rect — so only the key's
/// theme/metrics side can have moved. The cached rects must follow.
#[test]
fn a_theme_swap_relays_out_the_frame() {
    let frame = std::cell::Cell::new(0usize);
    let heights = std::cell::RefCell::new(Vec::new());
    let next = theme("twenty", "20px");
    let mut harness = egui_kittest::Harness::new_ui_state(
        |ui, app: &mut RendererApp| {
            if frame.get() == 0 {
                app.theme = theme("sixteen", "16px");
            } else if frame.get() == 1 {
                app.theme = next.clone();
            }
            frame.set(frame.get() + 1);
            app.frame_body(ui);
            heights.borrow_mut().push(child_height(app));
        },
        app(),
    );
    harness.run_steps(3);
    let seen = heights.borrow();
    assert_eq!(seen[0], 16.0, "the 16px theme's 1rem is 16px: {seen:?}");
    assert!(
        seen.len() > 1 && seen[1..].iter().all(|&h| h == 20.0),
        "the theme swap must re-lay out to 20px: {seen:?}"
    );
}
