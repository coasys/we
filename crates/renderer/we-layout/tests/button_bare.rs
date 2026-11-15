//! `we-button variant="bare"` is a wrapper: its variant's `height: auto` and
//! zero padding win over the size tier's fixed control height and padding,
//! as the web merges them (`VARIANT_DEFAULTS` over `SIZE_DEFAULTS`). Glow
//! parity: Coasys' People and Channels cards sat in 40px buttons and
//! overlapped the next grid row.
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

fn bare_button(props: &[(&str, Value)]) -> (Rect, Rect) {
    let mut all = vec![("variant", Value::from("bare"))];
    all.extend(props.iter().cloned());
    let mut button = node("we-button", "b", &all);
    button.children.push(ResolvedChild::Node(Box::new(node(
        "Column",
        "b/card",
        &[
            ("width", Value::from("100%")),
            ("height", Value::from("70px")),
        ],
    ))));
    let mut root = node("Column", "r", &[]);
    root.children.push(ResolvedChild::Node(Box::new(button)));
    let tokens = we_style::TokenTable::new(
        [
            ("--we-component-height-md", "40px"),
            ("--we-space-400", "16px"),
        ]
        .iter()
        .map(|(k, v)| (Arc::from(*k), Arc::from(*v)))
        .collect::<IndexMap<Arc<str>, Arc<str>>>(),
    );
    let scx = StyleCx {
        tokens: &tokens,
        ..StyleCx::empty()
    };
    let out = layout(
        &TestMeasure,
        &scx,
        &root,
        Rect::from_min_size(Pos2::new(0.0, 0.0), Vec2::new(600.0, 600.0)),
    );
    (
        out.rects[&NodeId::from("b")],
        out.rects[&NodeId::from("b/card")],
    )
}

#[test]
fn a_bare_button_wraps_its_content() {
    let (button, card) = bare_button(&[]);
    assert_eq!(button.height(), 70.0, "button {button:?}");
    // No padding: a full-width card fills the button edge to edge.
    assert_eq!(card, button, "card {card:?} in button {button:?}");
}

#[test]
fn a_bare_button_of_any_size_wraps_its_content() {
    let (button, _) = bare_button(&[("size", Value::from("sm"))]);
    assert_eq!(button.height(), 70.0, "button {button:?}");
}
