//! `we-scroll-area` is laid out as the primitive is: `display: block`,
//! `overflow: auto`, `minWidth: 0` and `minHeight: 0` beneath whatever the
//! template says. The inspector's body is one in a column of fixed height,
//! with `flex: 1`; without `minHeight: 0` it would grow to its content and
//! push the panel's chrome off, and without `overflow: auto` nothing would
//! scroll to the rows below the fold.
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

fn add(parent: &mut ResolvedNode, child: ResolvedNode) {
    parent.children.push(ResolvedChild::Node(Box::new(child)));
}

#[test]
fn a_bounded_inspector_scrolls_to_its_last_row() {
    // A panel 200px tall: a 20px header, then the body (`flex: 1`), which
    // holds ten 50px rows.
    let mut body = node("we-scroll-area", "body", &[("flex", "1")]);
    let mut rows = node("Column", "rows", &[]);
    for i in 0..10 {
        add(
            &mut rows,
            node(
                "Column",
                &format!("row{i}"),
                &[("height", "50px"), ("width", "100%")],
            ),
        );
    }
    add(&mut body, rows);
    let mut panel = node(
        "Column",
        "panel",
        &[("height", "200px"), ("width", "300px")],
    );
    add(&mut panel, node("Column", "head", &[("height", "20px")]));
    add(&mut panel, body);

    let tokens = we_style::TokenTable::new(IndexMap::new());
    let scx = StyleCx {
        tokens: &tokens,
        ..StyleCx::empty()
    };
    let out = layout(
        &TestMeasure,
        &scx,
        &panel,
        Rect::from_min_size(Pos2::new(0.0, 0.0), Vec2::new(600.0, 600.0)),
    );
    let body_id = NodeId::from("body");
    let area = out.rects[&body_id];
    assert_eq!(
        area.height(),
        180.0,
        "the body takes the room left: {area:?}"
    );
    assert_eq!(
        out.rects[&NodeId::from("panel")].height(),
        200.0,
        "the panel stays 200px"
    );
    assert!(out.scroll.contains_key(&body_id), "the body scrolls");
    let content = out.scroll_content[&body_id];
    assert!(
        content.max.y - area.min.y >= 500.0,
        "its content reaches the last row: {content:?} in {area:?}"
    );
    assert!(
        out.rects[&NodeId::from("row9")].max.y > area.max.y,
        "the last row lies below the fold, reached by scrolling"
    );
}
