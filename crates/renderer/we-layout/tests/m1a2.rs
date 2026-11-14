//! M1 round A2 — `position: fixed` resolves against the viewport, never
//! the nearest positioned ancestor. CSS: only an ancestor with a
//! `transform`, `filter`, `perspective` or `contain: paint/layout` becomes
//! a fixed element's containing block; ordinary `relative`/`absolute`/
//! `fixed` ancestors do not. Round A gave fixed the absolute chain.
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_layout::defaults::StyleCx;
use we_layout::{layout, Measure, PartsSpec, Pos2, Rect, Size, Vec2};
use we_template::{NodeId, ResolvedChild, ResolvedNode};

struct TestMeasure;
impl Measure for TestMeasure {
    fn parts_spec(&self, _node: &ResolvedNode) -> Option<PartsSpec> {
        None
    }
    fn measure(&self, _node: &ResolvedNode, _style: &we_style::Style, avail: Size) -> Size {
        Size::new(avail.x.min(10.0), avail.y.min(10.0))
    }
    fn measure_text(&self, _o: &ResolvedNode, _s: &we_style::Style, _t: &str, _a: Size) -> Size {
        Size::new(10.0, 10.0)
    }
}

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

fn child(parent: &mut ResolvedNode, n: ResolvedNode) {
    parent.children.push(ResolvedChild::Node(Box::new(n)));
}

fn lay_out(root: &ResolvedNode, w: f32, h: f32) -> we_layout::Layout {
    let scx = StyleCx::empty();
    layout(
        &TestMeasure,
        &scx,
        root,
        Rect::from_min_size(Pos2::new(0.0, 0.0), Vec2::new(w, h)),
    )
}

/// An 800×800 viewport holding a 300×200 `relative` box, a static wrapper
/// inside it, and the fixed child built from `props`.
fn fixed_under_relative(props: &[(&str, Value)]) -> Rect {
    let mut root = node("Column", "r", &[]);
    let mut rel = node(
        "Column",
        "r/rel",
        &[
            ("position", Value::from("relative")),
            ("width", Value::from("300px")),
            ("height", Value::from("200px")),
        ],
    );
    let mut wrapper = node("Column", "r/rel/w", &[]);
    let mut all = vec![("position", Value::from("fixed"))];
    all.extend(props.iter().cloned());
    child(&mut wrapper, node("Column", "r/rel/w/f", &all));
    child(&mut rel, wrapper);
    child(&mut root, rel);
    let out = lay_out(&root, 800.0, 800.0);
    out.rects.get(&NodeId::from("r/rel/w/f")).copied().unwrap()
}

#[test]
fn fixed_height_percent_is_the_viewport_not_a_relative_ancestor() {
    let f = fixed_under_relative(&[
        ("height", Value::from("100%")),
        ("width", Value::from("10px")),
    ]);
    assert_eq!(
        f.height(),
        800.0,
        "fixed height:100% is the viewport's 800: {f:?}"
    );
}

#[test]
fn fixed_width_percent_is_the_viewport_not_a_relative_ancestor() {
    let f = fixed_under_relative(&[
        ("width", Value::from("100%")),
        ("height", Value::from("10px")),
    ]);
    assert_eq!(
        f.width(),
        800.0,
        "fixed width:100% is the viewport's 800: {f:?}"
    );
}

/// `top: 50%` is half the viewport's height. The relative box and the
/// wrapper both sit at the origin, so the inset is the rect's `y`.
#[test]
fn fixed_top_percent_is_the_viewport_not_a_relative_ancestor() {
    let f = fixed_under_relative(&[
        ("top", Value::from("50%")),
        ("width", Value::from("10px")),
        ("height", Value::from("10px")),
    ]);
    assert_eq!(
        f.min.y, 400.0,
        "fixed top:50% is 400 down the 800 viewport: {f:?}"
    );
}

/// The app frame round A synthesises is itself `position: fixed`, inset by
/// `meta.frame`'s bands. It is a positioned ancestor for absolute children,
/// but a fixed descendant still measures against the whole viewport.
#[test]
fn the_app_frame_is_not_a_fixed_descendants_containing_block() {
    let mut root = node("Column", "r", &[]);
    let mut frame = node(
        "Column",
        "frame",
        &[
            ("position", Value::from("fixed")),
            ("left", Value::from("72px")),
            ("top", Value::from("0")),
            ("width", Value::from("728px")),
            ("height", Value::from("600px")),
        ],
    );
    let mut wrapper = node("Column", "frame/w", &[]);
    child(
        &mut wrapper,
        node(
            "Column",
            "frame/w/f",
            &[
                ("position", Value::from("fixed")),
                ("width", Value::from("100%")),
                ("height", Value::from("100%")),
            ],
        ),
    );
    child(
        &mut wrapper,
        node(
            "Column",
            "frame/w/a",
            &[
                ("position", Value::from("absolute")),
                ("width", Value::from("100%")),
                ("height", Value::from("100%")),
            ],
        ),
    );
    child(&mut frame, wrapper);
    child(&mut root, frame);
    let out = lay_out(&root, 800.0, 800.0);
    let f = out.rects.get(&NodeId::from("frame/w/f")).copied().unwrap();
    assert_eq!(
        (f.width(), f.height()),
        (800.0, 800.0),
        "a fixed child of the fixed frame spans the viewport: {f:?}"
    );
    let a = out.rects.get(&NodeId::from("frame/w/a")).copied().unwrap();
    assert_eq!(
        (a.width(), a.height()),
        (728.0, 600.0),
        "an absolute child of the frame still takes the frame's box: {a:?}"
    );
}
