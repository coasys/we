//! M1a — containing-block resolution: the page root's `min-height: 100vh`
//! floor (a regression guard — it predates round A), and out-of-flow
//! children's percent sizes resolving against their containing block
//! rather than the in-flow parent's taffy box — the app rail's collapse
//! case. `absolute` takes the nearest positioned ancestor's padding box;
//! `fixed` takes the viewport (round A2, `m1a2.rs`).
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
        surfaces: Default::default(),
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

/// Regression guard, not a red test for round A: the page root's
/// `min-height: 100vh` floor already held at `e123e1607`, before any round A
/// change. Kept so the floor cannot regress while the app frame wrapper
/// (`we-app/tests/m1a.rs`) is reworked around it.
#[test]
fn root_viewport_floor_regression_guard() {
    let mut root = node("Column", "r", &[]);
    child(
        &mut root,
        node(
            "Column",
            "r/c",
            &[
                ("width", Value::from("10px")),
                ("height", Value::from("10px")),
            ],
        ),
    );
    let out = lay_out(&root, 400.0, 100.0);
    let r = out.rects.get(&NodeId::from("r")).copied().unwrap();
    assert_eq!(r.height(), 100.0, "root must fill the layout rect height");
}

/// The app rail's shape: `position: fixed` + `height: 100%` inside a
/// zero-height static wrapper. The fixed child's containing block is the
/// viewport, so 100% must be the layout rect height — not the parent's 0.
#[test]
fn fixed_child_percent_height_is_viewport() {
    let mut root = node("Column", "r", &[]);
    let mut wrapper = node("Column", "r/w", &[]);
    child(
        &mut wrapper,
        node(
            "Column",
            "r/w/f",
            &[
                ("position", Value::from("fixed")),
                ("height", Value::from("100%")),
                ("width", Value::from("72px")),
                ("top", Value::from("0")),
                ("left", Value::from("0")),
            ],
        ),
    );
    child(&mut root, wrapper);
    let out = lay_out(&root, 400.0, 100.0);
    let f = out.rects.get(&NodeId::from("r/w/f")).copied().unwrap();
    assert_eq!(
        f.height(),
        100.0,
        "fixed child 100% must be the viewport height: {f:?}"
    );
}

/// Nested: an `absolute` child's percent resolves against the nearest
/// *positioned* ancestor's padding box — not the static parent between.
#[test]
fn absolute_child_percent_resolves_against_positioned_ancestor() {
    let mut root = node(
        "Column",
        "r",
        &[
            ("position", Value::from("relative")),
            ("height", Value::from("200px")),
        ],
    );
    let mut wrapper = node("Column", "r/w", &[]);
    child(
        &mut wrapper,
        node(
            "Column",
            "r/w/a",
            &[
                ("position", Value::from("absolute")),
                ("height", Value::from("50%")),
                ("width", Value::from("10px")),
            ],
        ),
    );
    child(&mut root, wrapper);
    let out = lay_out(&root, 400.0, 400.0);
    let a = out.rects.get(&NodeId::from("r/w/a")).copied().unwrap();
    assert_eq!(
        a.height(),
        100.0,
        "absolute child 50% must be half the 200px positioned ancestor: {a:?}"
    );
}
