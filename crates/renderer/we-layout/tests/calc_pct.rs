//! Percentage terms inside `calc()` resolve against the containing block
//! the way the browser does — width/max-width against the CB's width,
//! padding (every edge) against the CB *width* — instead of dropping the
//! percent term or resolving against a stale base.
//!
//! The TS oracle (`buildLayoutStyles`) passes the expressions through
//! verbatim: `calc(100% - 2 * var(--we-space-300))`, `calc(10% + 16px)`,
//! `calc(33.33% - 6px)` — the numbers below are what a browser computes
//! at a 400px containing block with `--we-space-300: 12px`.

use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_layout::defaults::StyleCx;
use we_layout::{layout, Measure, PartsSpec, Pos2, Rect, Size, Vec2};
use we_style::TokenTable;
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

fn tokens() -> TokenTable {
    TokenTable::new(
        [("--we-space-300", "12px")]
            .iter()
            .map(|(k, v)| (Arc::from(*k), Arc::from(*v)))
            .collect::<IndexMap<Arc<str>, Arc<str>>>(),
    )
}

fn run(root: &ResolvedNode, w: f32, h: f32) -> we_layout::Layout {
    let tokens = tokens();
    let scx = StyleCx {
        tokens: &tokens,
        ..StyleCx::empty()
    };
    layout(
        &TestMeasure,
        &scx,
        root,
        Rect::from_min_size(Pos2::new(0.0, 0.0), Vec2::new(w, h)),
    )
}

fn rect(out: &we_layout::Layout, id: &str) -> Rect {
    out.rects.get(&NodeId::from(id)).copied().unwrap()
}

/// `max-width: calc(100% - 2 * 12px)` at a 400px CB clamps a stretched
/// child to 376px.
#[test]
fn calc_percent_max_width() {
    let mut root = node("Column", "r", &[]);
    let child = node(
        "Column",
        "r/c",
        &[
            (
                "maxWidth",
                Value::from("calc(100% - 2 * var(--we-space-300))"),
            ),
            ("height", Value::from("10px")),
        ],
    );
    root.children = vec![ResolvedChild::Node(Box::new(child))];

    let out = run(&root, 400.0, 200.0);
    let c = rect(&out, "r/c");
    assert!(
        (c.width() - 376.0).abs() < 0.01,
        "calc(100% - 24px) at CB 400 must be 376, got {c:?}"
    );
}

/// `padding: calc(10% + 16px)` — every edge reads the CB *width* (top and
/// bottom included): 40 + 16 = 56px at CB 400, so the child lands at
/// (56, 56) and gets 400 - 112 = 288px of content width.
#[test]
fn calc_percent_padding_edges_use_cb_width() {
    let mut box_ = node("Column", "b", &[("p", Value::from("calc(10% + 16px)"))]);
    let child = node(
        "Column",
        "b/c",
        &[
            ("width", Value::from("100%")),
            ("height", Value::from("10px")),
        ],
    );
    box_.children = vec![ResolvedChild::Node(Box::new(child))];
    let mut root = node("Column", "r", &[]);
    root.children = vec![ResolvedChild::Node(Box::new(box_))];

    let out = run(&root, 400.0, 200.0);
    let c = rect(&out, "b/c");
    assert!(
        (c.min.x - 56.0).abs() < 0.01,
        "left pad must be 56 (10% of CB width 400 + 16), got {c:?}"
    );
    assert!(
        (c.min.y - 56.0).abs() < 0.01,
        "top pad must also read the CB width: 56, got {c:?}"
    );
    assert!(
        (c.width() - 288.0).abs() < 0.01,
        "content width must be 400 - 2*56 = 288, got {c:?}"
    );
}

/// `width: calc(33.33% - 6px)` at CB 400 → 133.32 - 6 = 127.32px. Taffy
/// snaps every rect to the whole-pixel grid (`use_rounding` — the shipped
/// policy), so the used width lands on 127.
#[test]
fn calc_percent_width() {
    let mut root = node("Column", "r", &[]);
    let child = node(
        "Column",
        "r/c",
        &[
            ("width", Value::from("calc(33.33% - 6px)")),
            ("height", Value::from("10px")),
        ],
    );
    root.children = vec![ResolvedChild::Node(Box::new(child))];

    let out = run(&root, 400.0, 200.0);
    let c = rect(&out, "r/c");
    assert!(
        (c.width() - 127.32).abs() < 0.5,
        "calc(33.33% - 6px) at CB 400 must be 127.32 (pixel-snapped), got {c:?}"
    );
}

/// The base is the *parent's content box*, not the root frame: a 40px
/// padded wrapper inside the 400px root gives its child a 320px CB, so
/// `width: calc(50% - 5px)` computes 155 — not 195.
#[test]
fn calc_percent_uses_parent_content_box() {
    let mut wrapper = node("Column", "w", &[("p", Value::from("40px"))]);
    let child = node(
        "Column",
        "w/c",
        &[
            ("width", Value::from("calc(50% - 5px)")),
            ("height", Value::from("10px")),
        ],
    );
    wrapper.children = vec![ResolvedChild::Node(Box::new(child))];
    let mut root = node("Column", "r", &[]);
    root.children = vec![ResolvedChild::Node(Box::new(wrapper))];

    let out = run(&root, 400.0, 200.0);
    let c = rect(&out, "w/c");
    assert!(
        (c.width() - 155.0).abs() < 0.01,
        "calc(50% - 5px) against the 320px content box must be 155, got {c:?}"
    );
}
