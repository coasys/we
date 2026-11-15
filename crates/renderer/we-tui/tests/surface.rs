//! E3c-13: the terminal frontend's surface reports — `paint_frame`
//! measures each surface tag's content box in cells and exports it in
//! px (cells × `CELL_PX`), the same box a `ResizeObserver` answers
//! (design 6.2: "the TUI does the same in cells converted back to px
//! with its `CellProjection`").
#![cfg(not(target_arch = "wasm32"))]
use std::sync::Arc;

use serde_json::json;
use we_session::Session;
use we_template::{MountCx, RootSpec, SchemaNode, StoreBag, SurfaceKey};
use we_tui::draw::paint_frame;
use we_tui::palette::load_theme_set;

fn session(node: SchemaNode) -> Session {
    let bag = Arc::new(StoreBag::new());
    Session::offline(
        RootSpec::Single {
            node: Box::new(node),
            cx: MountCx::explicit("test"),
        },
        bag,
        we_screen::ScreenState::desktop(we_screen::ScreenSchema::default(), "/"),
    )
}

/// A 90-cell terminal: the `$surface` node fills it, and 120px of
/// `px` padding insets its content box to 90 − 2×15 = 60 cells =
/// 480px — the content box is the report, not the border box.
#[test]
fn tui_reports_the_content_box_in_px() {
    let node: SchemaNode = serde_json::from_value(json!({
        "type": "Column",
        "children": [{
            "type": "$surface",
            "props": { "width": "100%", "px": "120px" },
            "children": [{ "type": "Tag", "props": {
                "w": { "$": "surface.width" },
                "t": { "$": "surface.tier" }
            } }]
        }]
    }))
    .unwrap();
    let mut session = session(node);
    let root = session.resolve();
    let tag = root
        .children
        .iter()
        .find_map(|c| match c {
            we_template::ResolvedChild::Node(n) if !n.surfaces.is_empty() => Some(
                n.surfaces
                    .iter()
                    .find(|t| matches!(t.key, SurfaceKey::Node(_)))
                    .expect("a $surface carries its node tag")
                    .clone(),
            ),
            _ => None,
        })
        .expect("the surface resolves");

    let theme = load_theme_set().theme("dark").0.clone();
    let frame = paint_frame(
        &root,
        (90, 30),
        &theme,
        we_tui::palette::Palette::of(&theme),
        true,
        None,
        &std::collections::HashMap::new(),
    );
    let reported = frame
        .surface_reports
        .iter()
        .find(|(t, _)| t == &tag)
        .map(|(_, w)| *w);
    assert_eq!(
        reported,
        Some(480.0),
        "the report is the content box — 90 cells − 2×120px of padding → 60 cells × 8px"
    );
}

/// The report rides the session's inbox — the same channel a measured
/// egui frame uses — and the next resolve binds it.
#[test]
fn tui_report_reaches_the_session() {
    let node: SchemaNode = serde_json::from_value(json!({
        "type": "Column",
        "props": { "w": { "$": "surface.width" } },
        "children": [{
            "type": "$surface",
            "children": []
        }]
    }))
    .unwrap();
    let mut session = session(node);
    let root = session.resolve();
    let host = root
        .surfaces
        .iter()
        .find(|t| matches!(t.key, SurfaceKey::Host(_)))
        .expect("the mount root carries the host tag")
        .clone();
    session.report_surface(&host, 960.0);
    let tick = session.poll();
    assert_eq!(tick.surfaces, 1, "the report drained");
    let root = session.resolve();
    assert!(
        root.props
            .get("w")
            .is_some_and(|v| v.strict_eq(&we_expr::Value::from(960.0))),
        "the host surface binds the reported measure: {:?}",
        root.props.get("w")
    );
}
