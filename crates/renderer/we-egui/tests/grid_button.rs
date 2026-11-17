//! In a `minChildWidth` grid a `width: 100%` bare `we-button` fills its
//! track, and so does the card inside it — the People and Channels grids on
//! the web. Glow parity: Rust drew each card shrink-wrapped and centred in
//! its track.
use std::cell::RefCell;
use std::sync::Arc;

use indexmap::IndexMap;
use we_egui::{layout, MeasureCx, Registry, StyleCx};
use we_expr::Value;
use we_style::TokenTable;
use we_template::{NodeId, ResolvedChild, ResolvedNode};

fn node(ty: &str, id: &str, props: &[(&str, Value)]) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from(id),
        ty: Arc::from(ty),
        props: props
            .iter()
            .map(|(k, v)| (Arc::from(*k), v.clone()))
            .collect::<IndexMap<Arc<str>, Value>>(),
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        transition: None,
        surfaces: Default::default(),
    }
}

fn s(v: &str) -> Value {
    Value::from(v)
}

fn tokens() -> TokenTable {
    TokenTable::new(
        [
            ("--we-space-100", "4px"),
            ("--we-space-200", "8px"),
            ("--we-space-300", "12px"),
            ("--we-space-400", "16px"),
            ("--we-radius-300", "8px"),
            ("--we-theme-tree-padding", "8px 10px"),
        ]
        .iter()
        .map(|(k, v)| (Arc::from(*k), Arc::from(*v)))
        .collect::<IndexMap<Arc<str>, Arc<str>>>(),
    )
}

type Rects = (
    std::collections::HashMap<NodeId, egui::Rect>,
    std::collections::HashMap<(NodeId, &'static str), egui::Rect>,
);

fn lay_out(root: &ResolvedNode) -> Rects {
    let registry = Registry::with_builtins();
    let table = tokens();
    let out = RefCell::new(None);
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let ctx = ui.ctx().clone();
        let scx = StyleCx {
            tokens: &table,
            ..StyleCx::empty()
        };
        let lay = layout(
            &MeasureCx::new(&ctx),
            &scx,
            &registry,
            root,
            egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(300.0, 600.0)),
        );
        *out.borrow_mut() = Some((
            lay.rects.clone(),
            lay.parts.iter().map(|(k, v)| (k.clone(), *v)).collect(),
        ));
    });
    harness.run_steps(1);
    drop(harness);
    out.into_inner().unwrap()
}

#[test]
fn a_full_width_bare_button_fills_its_grid_track() {
    let mut root = node("Column", "r", &[("width", s("760px"))]);
    let mut grid = node(
        "Grid",
        "r/g",
        &[("minChildWidth", s("240px")), ("gap", s("12px"))],
    );
    for i in 0..4 {
        let mut b = node(
            "we-button",
            &format!("r/g/{i}"),
            &[("variant", s("bare")), ("width", s("100%"))],
        );
        let mut card = node(
            "Card",
            &format!("r/g/{i}/c"),
            &[
                ("width", s("100%")),
                ("direction", s("row")),
                ("gap", s("300")),
            ],
        );
        card.children
            .push(ResolvedChild::Text(Arc::from("Juni Okafor")));
        b.children.push(ResolvedChild::Node(Box::new(card)));
        grid.children.push(ResolvedChild::Node(Box::new(b)));
    }
    root.children.push(ResolvedChild::Node(Box::new(grid)));
    let (rects, _) = lay_out(&root);
    let track = (760.0 - 24.0) / 3.0;
    for i in 0..4 {
        let b = rects[&NodeId::from(format!("r/g/{i}").as_str())];
        let c = rects[&NodeId::from(format!("r/g/{i}/c").as_str())];
        assert!((b.width() - track).abs() < 1.0, "button {i}: {b:?}");
        assert!((c.width() - track).abs() < 1.0, "card {i}: {c:?}");
    }
}

/// The Coasys rail's AI button: a full-width ghost `lg` button, `ax: start`,
/// its icon box inset by `px`. On the web the 32px box starts at `px`
/// (11.5px), so the sparkle centres at 27.5 of the 72px rail.
#[test]
fn a_start_aligned_button_puts_its_content_at_its_padding() {
    let mut root = node("Column", "r", &[("width", s("72px"))]);
    let mut b = node(
        "we-button",
        "r/b",
        &[
            ("variant", s("ghost")),
            ("size", s("lg")),
            ("width", s("100%")),
            ("height", s("auto")),
            ("ax", s("start")),
            ("ay", s("center")),
            ("py", s("300")),
            (
                "px",
                s("calc((72px - 1px - 2rem) / 2 - var(--we-space-200))"),
            ),
        ],
    );
    let mut row = node(
        "Row",
        "r/b/i",
        &[
            ("width", s("2rem")),
            ("height", s("2rem")),
            ("flexShrink", s("0")),
        ],
    );
    row.children.push(ResolvedChild::Node(Box::new(node(
        "we-icon",
        "r/b/i/x",
        &[("name", s("sparkle"))],
    ))));
    b.children.push(ResolvedChild::Node(Box::new(row)));
    root.children.push(ResolvedChild::Node(Box::new(b)));
    let (rects, parts) = lay_out(&root);
    let i = rects[&NodeId::from("r/b/i")];
    assert!(
        (i.min.x - 11.5).abs() < 0.6,
        "icon box {i:?}, button {:?}, parts {parts:?}",
        rects[&NodeId::from("r/b")]
    );
}

/// A card whose description is a long truncated line stays in its track:
/// the card's `width: 100%` is a definite specified size, which caps its
/// automatic minimum (CSS flexbox §4.5), so the line truncates instead of
/// widening the card. Glow parity: Social DNA's Connection types cards
/// grew past their tracks and spilled over the tree panel.
#[test]
fn a_truncated_line_does_not_widen_a_full_width_card() {
    let mut root = node("Column", "r", &[("width", s("760px"))]);
    let mut grid = node(
        "Grid",
        "r/g",
        &[("minChildWidth", s("240px")), ("gap", s("12px"))],
    );
    for i in 0..3 {
        let mut b = node(
            "we-button",
            &format!("r/g/{i}"),
            &[("variant", s("bare")), ("width", s("100%"))],
        );
        let mut card = node(
            "Card",
            &format!("r/g/{i}/c"),
            &[
                ("width", s("100%")),
                ("direction", s("row")),
                ("gap", s("300")),
            ],
        );
        let mut col = node(
            "Column",
            &format!("r/g/{i}/c/col"),
            &[("flex", s("1")), ("minWidth", s("0"))],
        );
        let mut text = node(
            "we-text",
            &format!("r/g/{i}/c/col/t"),
            &[("truncate", Value::Bool(true))],
        );
        text.children.push(ResolvedChild::Text(Arc::from(
            "Loosely connected — worth knowing about, nothing implied, and then some more words",
        )));
        col.children.push(ResolvedChild::Node(Box::new(text)));
        card.children.push(ResolvedChild::Node(Box::new(col)));
        b.children.push(ResolvedChild::Node(Box::new(card)));
        grid.children.push(ResolvedChild::Node(Box::new(b)));
    }
    root.children.push(ResolvedChild::Node(Box::new(grid)));
    let (rects, _) = lay_out(&root);
    let track = (760.0 - 24.0) / 3.0;
    for i in 0..3 {
        let b = rects[&NodeId::from(format!("r/g/{i}").as_str())];
        let c = rects[&NodeId::from(format!("r/g/{i}/c").as_str())];
        assert!((b.width() - track).abs() < 1.0, "button {i}: {b:?}");
        assert!(
            (c.min.x - b.min.x).abs() < 1.0 && (c.width() - track).abs() < 1.0,
            "card {i}: {c:?} in button {b:?}"
        );
    }
}

/// Two fixed boxes in a button: `w×h` each, ids `<id>/a` and `<id>/b`.
fn button_with_two(props: &[(&str, Value)], a: (&str, &str), b: (&str, &str)) -> ResolvedNode {
    let mut root = node("Column", "r", &[("width", s("300px"))]);
    let mut btn = node("we-button", "r/b", props);
    for (id, (w, h)) in [("r/b/a", a), ("r/b/b", b)] {
        btn.children.push(ResolvedChild::Node(Box::new(node(
            "Row",
            id,
            &[("width", s(w)), ("height", s(h)), ("flexShrink", s("0"))],
        ))));
    }
    root.children.push(ResolvedChild::Node(Box::new(btn)));
    root
}

/// The slot is `display: contents`: an authored `gap` on the button is the
/// gap between its children — `0px` puts them edge to edge (the tier's
/// 12px is only the fallback).
#[test]
fn a_buttons_authored_gap_spaces_its_children() {
    let root = button_with_two(
        &[("variant", s("ghost")), ("gap", s("0px"))],
        ("20px", "20px"),
        ("20px", "20px"),
    );
    let (rects, _) = lay_out(&root);
    let a = rects[&NodeId::from("r/b/a")];
    let b = rects[&NodeId::from("r/b/b")];
    assert!((b.min.x - a.max.x).abs() < 0.5, "a {a:?} b {b:?}");
}

/// Without an authored gap the size tier's gap still applies (md: 12px).
#[test]
fn a_buttons_default_gap_is_its_size_tier() {
    let root = button_with_two(
        &[("variant", s("ghost"))],
        ("20px", "20px"),
        ("20px", "20px"),
    );
    let (rects, _) = lay_out(&root);
    let a = rects[&NodeId::from("r/b/a")];
    let b = rects[&NodeId::from("r/b/b")];
    assert!((b.min.x - a.max.x - 12.0).abs() < 0.5, "a {a:?} b {b:?}");
}

/// An authored `ay: start` top-aligns a short child beside a tall one.
#[test]
fn a_buttons_ay_aligns_its_children() {
    let root = button_with_two(
        &[
            ("variant", s("bare")),
            ("ay", s("start")),
            ("height", s("60px")),
        ],
        ("20px", "40px"),
        ("20px", "16px"),
    );
    let (rects, _) = lay_out(&root);
    let btn = rects[&NodeId::from("r/b")];
    let a = rects[&NodeId::from("r/b/a")];
    let b = rects[&NodeId::from("r/b/b")];
    assert!((a.min.y - btn.min.y).abs() < 0.5, "a {a:?} in {btn:?}");
    assert!((b.min.y - btn.min.y).abs() < 0.5, "b {b:?} in {btn:?}");
}

/// An authored `direction: column` stacks the children.
#[test]
fn a_buttons_direction_stacks_its_children() {
    let root = button_with_two(
        &[
            ("variant", s("bare")),
            ("direction", s("column")),
            ("gap", s("4px")),
        ],
        ("20px", "20px"),
        ("20px", "20px"),
    );
    let (rects, _) = lay_out(&root);
    let a = rects[&NodeId::from("r/b/a")];
    let b = rects[&NodeId::from("r/b/b")];
    assert!((a.min.x - b.min.x).abs() < 0.5, "a {a:?} b {b:?}");
    assert!((b.min.y - a.max.y - 4.0).abs() < 0.5, "a {a:?} b {b:?}");
}
