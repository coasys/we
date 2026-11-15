//! Input follows paint order across raised boxes (positioned, `z-index > 0`).
//! Paint confines a raised box's raised descendants to its stacking
//! context, orders a context's raised boxes by z, tree order breaking ties,
//! and draws each translated by its scrollers and cut by their clips. A
//! click must reach what that order shows on top, and nothing under it:
//! not the egui widget beneath (a button), and not the geometric container
//! checks (`onClick` on a Column).
use std::cell::RefCell;
use std::sync::Arc;

use indexmap::IndexMap;
use we_egui::{layout, paint, EditState, Layout, MeasureCx, Registry, StyleCx, WidgetEvent};
use we_expr::Value;
use we_template::{HandlerRef, NodeId, ResolvedChild, ResolvedNode};

fn node(ty: &str, id: &str, props: &[(&str, &str)]) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from(id),
        ty: Arc::from(ty),
        props: props
            .iter()
            .map(|(k, v)| (Arc::from(*k), Value::from(*v)))
            .collect::<IndexMap<Arc<str>, Value>>(),
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        transition: None,
        surfaces: Default::default(),
    }
}

/// `node` with an authored `onClick`.
fn clickable(ty: &str, id: &str, props: &[(&str, &str)]) -> ResolvedNode {
    let mut n = node(ty, id, props);
    n.handlers.insert(
        Arc::from("onClick"),
        HandlerRef {
            tokens: vec![],
            scope: Default::default(),
        },
    );
    n
}

fn with(mut parent: ResolvedNode, kids: Vec<ResolvedNode>) -> ResolvedNode {
    parent
        .children
        .extend(kids.into_iter().map(|k| ResolvedChild::Node(Box::new(k))));
    parent
}

/// An absolutely placed box: `left`, `top`, `width`, `height` in px.
fn boxed(id: &str, z: &str, at: [u32; 4]) -> ResolvedNode {
    let [l, t, w, h] = at.map(|v| format!("{v}px"));
    clickable(
        "Column",
        id,
        &[
            ("position", "absolute"),
            ("zIndex", z),
            ("left", &l),
            ("top", &t),
            ("width", &w),
            ("height", &h),
        ],
    )
}

fn root(kids: Vec<ResolvedNode>) -> ResolvedNode {
    with(
        node(
            "Column",
            "root",
            &[
                ("position", "relative"),
                ("width", "400px"),
                ("height", "400px"),
            ],
        ),
        kids,
    )
}

/// Paint `root`, click at each point in turn, and return which nodes
/// emitted `onClick` for each click.
fn clicks(root: ResolvedNode, at: &[egui::Pos2]) -> (Layout, Vec<Vec<String>>) {
    let registry = Registry::with_builtins();
    let events: RefCell<Vec<WidgetEvent>> = RefCell::new(Vec::new());
    let edit = RefCell::new(EditState::default());
    let lay_out = RefCell::new(None);
    let mut h = egui_kittest::Harness::builder()
        .with_size(egui::vec2(400.0, 400.0))
        .allow_missing_glyphs()
        .with_context_setup(we_egui::install_media)
        .build_ui(|ui| {
            let cx = MeasureCx::new(ui.ctx());
            let scx = StyleCx::empty();
            let area = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(400.0, 400.0));
            let lay = layout(&cx, &scx, &registry, &root, area);
            paint(
                ui,
                &registry,
                &scx,
                &root,
                &lay,
                &mut events.borrow_mut(),
                &mut edit.borrow_mut(),
                0.0,
            );
            *lay_out.borrow_mut() = Some(lay);
        });
    h.run();
    let mut out = Vec::new();
    for &p in at {
        events.borrow_mut().clear();
        h.hover_at(p);
        h.run();
        for pressed in [true, false] {
            h.event(egui::Event::PointerButton {
                pos: p,
                button: egui::PointerButton::Primary,
                pressed,
                modifiers: egui::Modifiers::NONE,
            });
            h.run();
        }
        let mut got: Vec<String> = events
            .borrow()
            .iter()
            .filter(|e| e.handler.as_ref() == "onClick")
            .map(|e| e.node.as_str().to_string())
            .collect();
        got.sort();
        got.dedup();
        out.push(got);
    }
    drop(h);
    let lay = lay_out.borrow_mut().take().expect("laid out");
    (lay, out)
}

/// Two z 1 siblings overlap: the later one paints on top, so it takes the
/// click — the button inside the earlier one does not, nor does the
/// earlier box's own `onClick`.
#[test]
fn of_two_equal_z_siblings_the_later_takes_the_click() {
    let a = with(
        boxed("a", "1", [0, 0, 200, 200]),
        vec![clickable(
            "we-button",
            "a/b",
            &[("width", "200px"), ("height", "200px"), ("text", "under")],
        )],
    );
    let b = boxed("b", "1", [100, 100, 200, 200]);
    let (_, got) = clicks(
        root(vec![a, b]),
        &[egui::pos2(150.0, 150.0), egui::pos2(50.0, 50.0)],
    );
    assert_eq!(got[0], ["b"], "in the overlap");
    assert_eq!(got[1], ["a", "a/b"], "the control: outside the overlap");
}

/// A z 100 box inside a z 1 box stacks inside that context: a z 2
/// sibling of the z 1 box paints over it and takes the click.
#[test]
fn a_high_z_inside_a_low_context_stays_under_a_higher_sibling() {
    let a = with(
        boxed("a", "1", [0, 0, 200, 200]),
        vec![boxed("a/c", "100", [100, 100, 100, 100])],
    );
    let b = boxed("b", "2", [150, 150, 200, 200]);
    let (_, got) = clicks(
        root(vec![a, b]),
        &[egui::pos2(175.0, 175.0), egui::pos2(125.0, 125.0)],
    );
    assert_eq!(got[0], ["b"], "in the overlap");
    assert_eq!(got[1], ["a", "a/c"], "the control: c outside b");
}

/// A higher z earlier in the tree still paints over a lower z after it:
/// the z 2 box takes the click in the overlap, not the later z 1 one.
#[test]
fn a_higher_z_earlier_in_the_tree_takes_the_click() {
    let a = boxed("a", "2", [0, 0, 200, 200]);
    let b = boxed("b", "1", [100, 100, 200, 200]);
    let (_, got) = clicks(
        root(vec![a, b]),
        &[egui::pos2(150.0, 150.0), egui::pos2(250.0, 250.0)],
    );
    assert_eq!(got[0], ["a"], "in the overlap");
    assert_eq!(got[1], ["b"], "the control: b outside a");
}

/// A raised box inside a scroller is cut by the scroller's clip, and only
/// blocks input where it shows: below the scroller, the box's hidden part
/// does not keep a click from the sibling there.
#[test]
fn a_raised_box_in_a_scroller_blocks_only_where_it_shows() {
    let scroller = with(
        node(
            "Column",
            "s",
            &[
                ("position", "relative"),
                ("height", "100px"),
                ("overflowY", "auto"),
            ],
        ),
        vec![
            clickable("Column", "s/item", &[("height", "300px")]),
            boxed("s/r", "1", [0, 60, 200, 80]),
        ],
    );
    let below = clickable("Column", "below", &[("height", "200px")]);
    let (lay, got) = clicks(
        root(vec![scroller, below]),
        &[egui::pos2(50.0, 80.0), egui::pos2(50.0, 120.0)],
    );
    let r = lay.rects[&NodeId::from("s/r")];
    assert!(r.contains(egui::pos2(50.0, 120.0)), "laid out under: {r:?}");
    assert_eq!(got[0], ["s/r"], "where it shows, over the item");
    assert_eq!(got[1], ["below"], "where the scroller clips it");
}
