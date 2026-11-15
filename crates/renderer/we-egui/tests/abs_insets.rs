//! An absolutely positioned box with both insets on an axis and an `auto`
//! size there is as large as its containing block less the insets (CSS 2.1
//! §10.3.7, §10.6.4) — a definite size its children's percentages resolve
//! against. Glow parity: the About page's header bar is
//! `position: absolute; left: 0; right: 0` holding a `width: 100%` row, and
//! Rust gave that row no width, so the logo, the links and the GitHub badge
//! piled up over the hero.
use std::sync::Arc;

use indexmap::IndexMap;
use we_egui::{layout, MeasureCx, Registry, StyleCx};
use we_expr::Value;
use we_template::{NodeId, ResolvedChild, ResolvedNode};

fn node(id: &str, ty: &str, props: &[(&str, &str)], kids: Vec<ResolvedNode>) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from(id),
        ty: Arc::from(ty),
        props: props
            .iter()
            .map(|(k, v)| (Arc::from(*k), Value::from(*v)))
            .collect::<IndexMap<Arc<str>, Value>>(),
        handlers: IndexMap::new(),
        slot: None,
        children: kids
            .into_iter()
            .map(|k| ResolvedChild::Node(Box::new(k)))
            .collect(),
        transition: None,
        surfaces: Default::default(),
    }
}

fn rects(root: &ResolvedNode, ids: &[&str]) -> Vec<egui::Rect> {
    let reg = Registry::with_builtins();
    let mut out = Vec::new();
    let mut h = egui_kittest::Harness::new_ui(|ui| {
        let ctx = ui.ctx().clone();
        let area = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(1200.0, 800.0));
        let lay = layout(&MeasureCx::new(&ctx), &StyleCx::empty(), &reg, root, area);
        out = ids
            .iter()
            .map(|id| {
                lay.rects
                    .get(&NodeId::from(*id))
                    .copied()
                    .unwrap_or(egui::Rect::NOTHING)
            })
            .collect();
    });
    h.run_steps(1);
    drop(h);
    out
}

#[test]
fn a_child_percentage_resolves_against_the_inset_box() {
    let inner = node(
        "inner",
        "Row",
        &[
            ("width", "100%"),
            ("maxWidth", "1040px"),
            ("height", "120px"),
        ],
        vec![],
    );
    let bar = node(
        "bar",
        "Row",
        &[
            ("position", "absolute"),
            ("top", "0"),
            ("left", "0"),
            ("right", "0"),
            ("ax", "center"),
        ],
        vec![inner],
    );
    let root = node(
        "rel",
        "Column",
        &[
            ("position", "relative"),
            ("width", "100%"),
            ("height", "600px"),
        ],
        vec![bar],
    );
    let r = rects(&root, &["bar", "inner"]);
    assert_eq!(r[0].width(), 1200.0, "bar {:?}", r[0]);
    assert_eq!(r[1].width(), 1040.0, "inner {:?}", r[1]);
    assert_eq!(r[1].min.x, 80.0, "centred: {:?}", r[1]);
}

#[test]
fn insets_on_the_block_axis_size_it_too() {
    let inner = node("inner", "Column", &[("height", "50%")], vec![]);
    let boxed = node(
        "box",
        "Column",
        &[
            ("position", "absolute"),
            ("top", "100px"),
            ("bottom", "100px"),
            ("left", "0"),
            ("width", "10px"),
        ],
        vec![inner],
    );
    let root = node(
        "rel",
        "Column",
        &[
            ("position", "relative"),
            ("width", "100%"),
            ("height", "600px"),
        ],
        vec![boxed],
    );
    let r = rects(&root, &["box", "inner"]);
    assert_eq!(r[0].height(), 400.0, "box {:?}", r[0]);
    assert_eq!(r[1].height(), 200.0, "inner {:?}", r[1]);
}
