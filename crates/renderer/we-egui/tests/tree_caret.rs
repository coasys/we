//! A `we-tree-item`'s caret is the web primitive's chevron — an open
//! stroked path (`M3 1.5 L7 5 L3 8.5`, 1.5px, round) in `text-faint`,
//! pointing right and turned a quarter when the row is open — not a filled
//! triangle. Glow parity: the Coasys tree's carets were egui-grey wedges.
use std::cell::RefCell;
use std::sync::Arc;

use indexmap::IndexMap;
use we_egui::{layout, paint, EditState, MeasureCx, Registry, StyleCx};
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

const FAINT: egui::Color32 = egui::Color32::from_rgb(120, 130, 140);

fn tokens() -> TokenTable {
    TokenTable::new(
        [
            ("--we-space-100", "4px"),
            ("--we-space-200", "8px"),
            ("--we-role-text-faint", "rgb(120, 130, 140)"),
        ]
        .iter()
        .map(|(k, v)| (Arc::from(*k), Arc::from(*v)))
        .collect::<IndexMap<Arc<str>, Arc<str>>>(),
    )
}

/// The caret part's rect and every stroked path drawn in it.
fn carets(root: &ResolvedNode, item: &str) -> (egui::Rect, Vec<egui::epaint::PathShape>, bool) {
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
            egui::Rect::from_min_size(ui.cursor().min, egui::vec2(300.0, 400.0)),
        );
        let mut events = Vec::new();
        let mut edit = EditState::default();
        paint(ui, &registry, &scx, root, &lay, &mut events, &mut edit, 0.0);
        let caret = lay.parts[&(NodeId::from(item), "caret")];
        let shapes: Vec<_> = ctx.graphics(|g| {
            g.get(ui.layer_id())
                .map(|list| list.all_entries().map(|cs| cs.shape.clone()).collect())
                .unwrap_or_default()
        });
        let paths = shapes
            .iter()
            .filter_map(|s| match s {
                egui::Shape::Path(p) if caret.contains_rect(p.visual_bounding_rect()) => {
                    Some(p.clone())
                }
                _ => None,
            })
            .collect();
        let filled = shapes.iter().any(|s| match s {
            egui::Shape::Path(p) => {
                p.fill != egui::Color32::TRANSPARENT
                    && caret.contains_rect(p.visual_bounding_rect())
            }
            _ => false,
        });
        *out.borrow_mut() = Some((caret, paths, filled));
    });
    harness.run_steps(2);
    drop(harness);
    out.into_inner().unwrap()
}

fn tree(open: bool) -> ResolvedNode {
    let mut tree = node("we-tree", "t", &[]);
    let mut parent = node(
        "we-tree-item",
        "t/a",
        &[("value", Value::from("a")), ("open", Value::Bool(open))],
    );
    parent
        .children
        .push(ResolvedChild::Text(Arc::from("Calls")));
    let mut child = node("we-tree-item", "t/a/b", &[("value", Value::from("b"))]);
    child.slot = Some(Arc::from("children"));
    child
        .children
        .push(ResolvedChild::Text(Arc::from("Weekly sync")));
    parent.children.push(ResolvedChild::Node(Box::new(child)));
    tree.children.push(ResolvedChild::Node(Box::new(parent)));
    tree
}

#[test]
fn a_closed_caret_is_a_right_pointing_chevron() {
    let (caret, paths, filled) = carets(&tree(false), "t/a");
    assert!(!filled, "the caret is stroked, not filled");
    let [p] = paths.as_slice() else {
        panic!("one chevron in the caret {caret:?}: {paths:?}");
    };
    assert!(!p.closed, "an open path");
    assert_eq!(p.points.len(), 3, "{:?}", p.points);
    assert_eq!(p.stroke.width, 1.5);
    assert_eq!(p.stroke.color, egui::epaint::ColorMode::Solid(FAINT));
    // `M3 1.5 L7 5 L3 8.5` in a 10px box centred in the 16px caret.
    let o = caret.center() - egui::vec2(5.0, 5.0);
    let want = [(3.0, 1.5), (7.0, 5.0), (3.0, 8.5)].map(|(x, y)| o + egui::vec2(x, y));
    for (got, want) in p.points.iter().zip(want) {
        assert!((*got - want).length() < 0.01, "{:?} vs {want:?}", p.points);
    }
}

#[test]
fn an_open_caret_points_down() {
    let (caret, paths, _) = carets(&tree(true), "t/a");
    let [p] = paths.as_slice() else {
        panic!("one chevron in the caret {caret:?}: {paths:?}");
    };
    // Rotated 90° about the caret's centre: the tip is below it.
    let tip = p.points[1];
    assert!((tip.x - caret.center().x).abs() < 0.01, "{:?}", p.points);
    assert!(
        (tip.y - (caret.center().y + 2.0)).abs() < 0.01,
        "{:?}",
        p.points
    );
}
