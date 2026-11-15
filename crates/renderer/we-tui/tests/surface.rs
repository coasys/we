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
    session.resolve();
    let host = session
        .host_surfaces()
        .first()
        .expect("the mount claims its host surface")
        .clone();
    assert!(matches!(host.key, SurfaceKey::Host(_)));
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

fn label_w(root: &we_template::ResolvedNode) -> Vec<Option<f64>> {
    fn walk(n: &we_template::ResolvedNode, out: &mut Vec<Option<f64>>) {
        if n.ty.as_ref() == "Tag" {
            out.push(n.props.get("w").and_then(|v| v.to_json().as_f64()));
        }
        for c in &n.children {
            if let we_template::ResolvedChild::Node(n) = c {
                walk(n, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(root, &mut out);
    out
}

/// Lal U1: the TUI's host surface is the pane the app paints the session
/// into — 100 cells, 800px — not any template node. A text-first root
/// fragment has no first node to carry a tag, and a root sizing itself
/// off `surface.width` must not measure itself.
#[test]
fn tui_host_surface_is_the_pane() {
    let theme = load_theme_set().theme("dark").0.clone();
    for node in [
        json!({ "children": ["heading", { "type": "Tag", "props": { "w": { "$": "surface.width" } } }] }),
        json!({
            "type": "Column",
            "props": { "width": { "$": "surface.width >= 640 ? '320px' : '720px'" } },
            "children": [{ "type": "Tag", "props": { "w": { "$": "surface.width" } } }]
        }),
    ] {
        let node: SchemaNode = serde_json::from_value(node).unwrap();
        let mut app = we_tui::TuiApp::new(session(node), theme.clone(), true);
        let area = ratatui::layout::Rect::new(0, 0, 100, 31);
        for _ in 0..6 {
            let mut buf = ratatui::buffer::Buffer::empty(area);
            app.render_into(&mut buf, area);
            app.session.poll();
        }
        let root = app.session.resolve();
        assert_eq!(
            label_w(&root),
            vec![Some(800.0)],
            "the pane is the host: 100 cells × 8px"
        );
    }
}
