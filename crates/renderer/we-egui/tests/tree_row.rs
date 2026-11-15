//! `we-tree-item`'s row has the web primitive's geometry: the theme's tree
//! padding (`--we-theme-tree-padding`, else `space-100 space-200`) with the
//! start held at `space-200`, a 32px floor, `space-200` between its parts,
//! the default slot growing so a trailing count docks at the row's end, rows
//! `space-100` apart (`--we-theme-tree-gap`), and — with `caret: end` — a
//! level indenting by the tree's `lead`. Glow parity: Coasys' tree rows sat
//! 24px apart with the counts beside the labels; the web's are 44px apart
//! with the counts in a column at the edge.
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
    }
}

fn s(v: &str) -> Value {
    Value::from(v)
}

/// The kit's `treeRow` shape: a 24px lead, a growing label, a count.
fn row_content(id: &str) -> ResolvedNode {
    let mut row = node(
        "Row",
        &format!("{id}/row"),
        &[("width", s("100%")), ("gap", s("200")), ("ay", s("center"))],
    );
    for (name, props) in [
        ("lead", vec![("width", s("24px")), ("height", s("24px"))]),
        ("label", vec![("flex", s("1")), ("height", s("24px"))]),
        ("count", vec![("width", s("20px")), ("height", s("20px"))]),
    ] {
        let n = node("Column", &format!("{id}/{name}"), &props);
        row.children.push(ResolvedChild::Node(Box::new(n)));
    }
    row
}

fn item(id: &str, value: &str, open: bool) -> ResolvedNode {
    let mut n = node(
        "we-tree-item",
        id,
        &[("value", s(value)), ("open", Value::Bool(open))],
    );
    n.children
        .push(ResolvedChild::Node(Box::new(row_content(id))));
    n
}

fn tokens() -> TokenTable {
    TokenTable::new(
        [
            ("--we-space-100", "4px"),
            ("--we-space-200", "8px"),
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
fn tree_rows_take_the_web_geometry() {
    let mut tree = node("we-tree", "t", &[("caret", s("end")), ("lead", s("24px"))]);
    let mut parent = item("t/a", "a", true);
    let mut child = item("t/a/b", "b", false);
    child.slot = Some("children".into());
    parent.children.push(ResolvedChild::Node(Box::new(child)));
    tree.children.push(ResolvedChild::Node(Box::new(parent)));
    tree.children
        .push(ResolvedChild::Node(Box::new(item("t/c", "c", false))));

    let (rects, parts) = lay_out(&tree);
    let r = |id: &str| rects[&NodeId::from(id)];
    let row = |id: &str| parts[&(NodeId::from(id), "row")];

    // 8px padding over a 24px lead, under and over.
    assert_eq!(row("t/a").height(), 40.0, "row {:?}", row("t/a"));
    // The lead starts at the row's `space-200`, not the theme's 10px.
    assert_eq!(r("t/a/lead").min.x - row("t/a").min.x, 8.0);
    // A level in by the tree's lead.
    assert_eq!(r("t/a/b/lead").min.x - r("t/a/lead").min.x, 24.0);
    // Rows `space-100` apart: a row and its children, and two items.
    assert_eq!(row("t/a/b").min.y - row("t/a").max.y, 4.0);
    assert_eq!(r("t/c").min.y - r("t/a").max.y, 4.0);
    // A leaf's count docks at the row's end, inside its 10px padding…
    assert_eq!(row("t/c").max.x - r("t/c/count").max.x, 10.0);
    // …and an expandable row's sits before the caret (16px + 8px gap).
    assert_eq!(row("t/a").max.x - r("t/a/count").max.x, 10.0 + 16.0 + 8.0);
}

/// With the caret first, a leaf keeps the caret's slot empty, so its content
/// lines up with an expandable sibling's (`[part='caret'][data-leaf]` is
/// `visibility: hidden`, not gone).
#[test]
fn a_leaf_keeps_the_caret_slot_when_the_caret_leads() {
    let mut tree = node("we-tree", "t", &[]);
    let mut parent = item("t/a", "a", false);
    parent
        .props
        .insert(Arc::from("expandable"), Value::Bool(true));
    tree.children.push(ResolvedChild::Node(Box::new(parent)));
    tree.children
        .push(ResolvedChild::Node(Box::new(item("t/c", "c", false))));
    let (rects, _) = lay_out(&tree);
    let r = |id: &str| rects[&NodeId::from(id)];
    assert_eq!(r("t/c/lead").min.x, r("t/a/lead").min.x);
    // 8px start, the 16px caret, the row's 8px gap.
    assert_eq!(r("t/a/lead").min.x, 8.0 + 16.0 + 8.0);
}
