//! Taffy layout: a `Row` with `gap` and fixed children lands them at the
//! expected rects — the DS props reaching the tree walk, driven by a test
//! [`Measure`] impl (no egui).
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_layout::defaults::StyleCx;
use we_layout::{layout, Measure, PartsSpec, Pos2, Rect, Size, Vec2};
use we_template::{NodeId, ResolvedChild, ResolvedNode};

/// Every node is a plain container — children lay out directly, leaves take
/// the room they're offered.
struct TestMeasure;

impl Measure for TestMeasure {
    fn parts_spec(&self, _node: &ResolvedNode) -> Option<PartsSpec> {
        None
    }

    fn measure(&self, _node: &ResolvedNode, _style: &we_style::Style, avail: Size) -> Size {
        Size::new(avail.x.min(10.0), avail.y.min(10.0))
    }

    fn measure_text(&self, _owner: &ResolvedNode, _style: &we_style::Style, _text: &str) -> Size {
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

#[test]
fn row_with_gap_and_fixed_children() {
    // gap "300" is a spacing token → 12px; width "100px" → 100.
    let mut row = node(
        "Row",
        "r",
        &[
            ("direction", Value::from("row")),
            ("gap", Value::from("300")),
        ],
    );
    let a = node(
        "Column",
        "r/a",
        &[
            ("width", Value::from("100px")),
            ("height", Value::from("20px")),
        ],
    );
    let b = node(
        "Column",
        "r/b",
        &[
            ("width", Value::from("40px")),
            ("height", Value::from("20px")),
        ],
    );
    row.children = vec![
        ResolvedChild::Node(Box::new(a)),
        ResolvedChild::Node(Box::new(b)),
    ];

    // gap "300" resolves through the theme's `--we-space-300` token.
    let mut vars = IndexMap::new();
    vars.insert(Arc::from("--we-space-300"), Arc::from("12px"));
    let tokens = we_style::TokenTable::new(vars);
    let scx = StyleCx {
        tokens: &tokens,
        ..StyleCx::empty()
    };

    let out = layout(
        &TestMeasure,
        &scx,
        &row,
        Rect::from_min_size(Pos2::new(0.0, 0.0), Vec2::new(400.0, 100.0)),
    );

    let a = out.rects.get(&NodeId::from("r/a")).copied().unwrap();
    let b = out.rects.get(&NodeId::from("r/b")).copied().unwrap();
    assert_eq!(a.size(), Vec2::new(100.0, 20.0));
    assert_eq!(b.size(), Vec2::new(40.0, 20.0));
    assert!(
        (b.min.x - a.max.x - 12.0).abs() < 0.01,
        "gap must be 12px: a {a:?} b {b:?}"
    );
    assert_eq!(a.min, Pos2::new(0.0, 0.0));
}
