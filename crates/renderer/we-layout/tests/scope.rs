//! Custom-property scope flows DOWN the resolved tree the way CSS inherits
//! custom properties down the DOM: a node's emitted `--we-*` decls (a `tone`
//! writes 13 re-pointings; a `styles` hatch writes them verbatim) scope its
//! descendants' `var()`s — and stop at the subtree edge, so a sibling outside
//! keeps the theme's values.
//!
//! The fixture the re-review asked for: a nested container with an override,
//! a consuming descendant, and a sibling outside the scope.

use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_layout::defaults::StyleCx;
use we_layout::{layout, Measure, PartsSpec, Pos2, Rect, Size, Vec2};
use we_style::{eval_color, Color, TokenTable};
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

/// The roles `tone` re-points — enough of the light theme's table for the
/// var chains `toneVariables` emits to resolve.
fn theme_tokens() -> TokenTable {
    TokenTable::new(
        [
            ("--we-role-accent", "oklch(0.553 0.15998 288)"),
            ("--we-role-danger", "oklch(0.637 0.237 27)"),
            ("--we-space-200", "8px"),
        ]
        .iter()
        .map(|(k, v)| (Arc::from(*k), Arc::from(*v)))
        .collect::<IndexMap<Arc<str>, Arc<str>>>(),
    )
}

fn role(tokens: &TokenTable, name: &str) -> Color {
    eval_color(tokens.get(&format!("--we-role-{name}")).unwrap()).unwrap()
}

/// `tone: danger` on a container re-points the accent roles for every node
/// inside it — a child's `bg: accent` draws the danger family, while a
/// sibling outside the subtree keeps the theme's accent.
#[test]
fn tone_scopes_descendant_vars() {
    let mut parent = node("Column", "p", &[("tone", Value::from("danger"))]);
    let child = node(
        "Column",
        "p/c",
        &[
            ("bg", Value::from("accent")),
            ("height", Value::from("10px")),
        ],
    );
    parent.children = vec![ResolvedChild::Node(Box::new(child))];
    let sibling = node(
        "Column",
        "s",
        &[
            ("bg", Value::from("accent")),
            ("height", Value::from("10px")),
        ],
    );
    let mut root = node("Column", "r", &[]);
    root.children = vec![
        ResolvedChild::Node(Box::new(parent)),
        ResolvedChild::Node(Box::new(sibling)),
    ];

    let tokens = theme_tokens();
    let scx = StyleCx {
        tokens: &tokens,
        ..StyleCx::empty()
    };
    let out = layout(
        &TestMeasure,
        &scx,
        &root,
        Rect::from_min_size(Pos2::new(0.0, 0.0), Vec2::new(400.0, 200.0)),
    );

    let got = |id: &str| out.styles.get(&NodeId::from(id)).unwrap().paint.bg;
    assert_eq!(
        got("p/c"),
        Some(role(&tokens, "danger")),
        "a descendant's bg: accent resolves in the ancestor's tone scope"
    );
    assert_eq!(
        got("s"),
        Some(role(&tokens, "accent")),
        "a sibling outside the subtree keeps the theme's accent"
    );
}

/// The `styles` escape hatch's custom-property declarations inherit the same
/// way — even on a node that has no `tone` of its own.
#[test]
fn styles_custom_props_scope_descendants() {
    let styles = Value::Obj(Arc::new(
        [(Arc::from("--we-role-accent"), Value::from("#123456"))]
            .into_iter()
            .collect::<IndexMap<Arc<str>, Value>>(),
    ));
    let mut parent = node("Column", "p", &[("styles", styles)]);
    let child = node(
        "Column",
        "p/c",
        &[
            ("bg", Value::from("accent")),
            ("height", Value::from("10px")),
        ],
    );
    parent.children = vec![ResolvedChild::Node(Box::new(child))];
    let sibling = node(
        "Column",
        "s",
        &[
            ("bg", Value::from("accent")),
            ("height", Value::from("10px")),
        ],
    );
    let mut root = node("Column", "r", &[]);
    root.children = vec![
        ResolvedChild::Node(Box::new(parent)),
        ResolvedChild::Node(Box::new(sibling)),
    ];

    let tokens = theme_tokens();
    let scx = StyleCx {
        tokens: &tokens,
        ..StyleCx::empty()
    };
    let out = layout(
        &TestMeasure,
        &scx,
        &root,
        Rect::from_min_size(Pos2::new(0.0, 0.0), Vec2::new(400.0, 200.0)),
    );

    let got = |id: &str| out.styles.get(&NodeId::from(id)).unwrap().paint.bg;
    assert_eq!(got("p/c"), eval_color("#123456"));
    assert_eq!(got("s"), Some(role(&tokens, "accent")));
}
