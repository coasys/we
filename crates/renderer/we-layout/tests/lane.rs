//! `$lane` — a home lane folded away (`collapsed`, which the resolver also
//! sets for a `foldEmpty` lane with nothing open) takes no room, as the web's
//! `PanelLane` does: `width: 0`, `min-width: 0`, its border and fill hidden.
//! Glow parity: the Coasys inspector lane left a 340px strip on every route.
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

fn row_with_lane(collapsed: bool) -> (Rect, Rect) {
    let mut root = node(
        "Row",
        "r",
        &[
            ("width", Value::from("100%")),
            ("height", Value::from("100%")),
        ],
    );
    let main = node(
        "Column",
        "r/main",
        &[("flex", Value::from("1")), ("minWidth", Value::from("0"))],
    );
    let mut lane = node(
        "$lane",
        "r/lane",
        &[
            ("lane", Value::from("inspector")),
            ("width", Value::from("340px")),
            ("minWidth", Value::from("280px")),
            ("borderLeft", Value::from("1px solid border")),
            ("collapsed", Value::Bool(collapsed)),
        ],
    );
    lane.children.push(ResolvedChild::Node(Box::new(node(
        "Column",
        "r/lane/c",
        &[("width", Value::from("200px"))],
    ))));
    root.children.push(ResolvedChild::Node(Box::new(main)));
    root.children.push(ResolvedChild::Node(Box::new(lane)));
    let out = layout(
        &TestMeasure,
        &StyleCx::empty(),
        &root,
        Rect::from_min_size(Pos2::new(0.0, 0.0), Vec2::new(1000.0, 600.0)),
    );
    (
        out.rects[&NodeId::from("r/main")],
        out.rects[&NodeId::from("r/lane")],
    )
}

#[test]
fn an_open_lane_keeps_its_width() {
    let (main, lane) = row_with_lane(false);
    assert_eq!(lane.width(), 340.0);
    assert_eq!(main.width(), 660.0);
}

#[test]
fn a_collapsed_lane_takes_no_room() {
    let (main, lane) = row_with_lane(true);
    assert_eq!(lane.width(), 0.0, "lane {lane:?}");
    assert_eq!(main.width(), 1000.0, "main {main:?}");
}
