//! E3c-13, egui half: after each layout the frontend walks the tree and
//! reports every surface tag's **content-box** width — the box
//! `ResizeObserver` reports (`createSurface.ts:47`, `contentBoxSize`), so
//! a padded `$surface` binds its inside width, not the border box.
use std::sync::Arc;

use we_app::RendererApp;
use we_egui::Registry;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{ResolvedChild, ResolvedNode, SchemaNode, StoreBag};

fn find<'a>(n: &'a ResolvedNode, ty: &str) -> Option<&'a ResolvedNode> {
    if n.ty.as_ref() == ty {
        return Some(n);
    }
    n.children.iter().find_map(|c| match c {
        ResolvedChild::Node(n) => find(n, ty),
        _ => None,
    })
}

/// 1000px of surface box with 120px of padding each side: the content box
/// is 760 — `sm`. Reporting the border rect (1000 — `md`) instead is the
/// sabotage this test exists to catch.
#[test]
fn egui_reports_the_surface_content_box() {
    let schema: SchemaNode = serde_json::from_value(serde_json::json!({
        "type": "Column",
        "props": { "width": "1000px" },
        "children": [{
            "type": "$surface",
            "props": { "width": "100%", "px": "120px" },
            "children": [{ "type": "Label", "props": {
                "t": { "$": "surface.tier" },
                "w": { "$": "surface.width" }
            }}]
        }]
    }))
    .expect("schema parses");
    let app = RendererApp::new(
        schema,
        "test",
        Arc::new(StoreBag::new()),
        ScreenState::desktop(ScreenSchema::default(), "/"),
        Registry::with_builtins(),
    );
    let mut harness =
        egui_kittest::Harness::new_ui_state(|ui, app: &mut RendererApp| app.frame_body(ui), app);
    harness.run_steps(5);

    let root = harness.state().session.runtime.resolved().unwrap().clone();
    let label = find(&root, "Label").expect("the label resolved");
    let w = label.props.get("w").expect("surface.width bound");
    let t = label.props.get("t").expect("surface.tier bound");
    assert_eq!(
        w.to_json().as_f64(),
        Some(760.0),
        "the report is the content box — 1000 − 2×120 padding: {w:?}"
    );
    assert_eq!(
        t.to_json().as_str(),
        Some("sm"),
        "760px is `sm` — the border box's `md` would be the wrong box"
    );
}
