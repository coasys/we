//! `Transitions` plays a change to a transitioned property out over its
//! duration, by CSS's rules: no transition on a node's first frame, a
//! change mid-flight starts from the value on screen, reduced motion jumps.
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_layout::animate::Transitions;
use we_layout::defaults::{style_of, StyleCx};
use we_template::{NodeId, ResolvedChild, ResolvedNode};

fn rail(width: &str) -> ResolvedNode {
    let props: IndexMap<Arc<str>, Value> = [
        ("width", Value::from(width)),
        ("transition", Value::from("width 200ms linear")),
    ]
    .into_iter()
    .map(|(k, v)| (Arc::from(k), v))
    .collect();
    ResolvedNode {
        id: NodeId::from("rail"),
        ty: Arc::from("Column"),
        props,
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        transition: None,
        surfaces: Default::default(),
    }
}

/// The width the tree `apply` answered with draws `rail` at — the
/// resolved one's when nothing is moving.
fn drawn(t: &mut Transitions, node: &ResolvedNode, now: f64, reduced: bool) -> f32 {
    let scx = StyleCx::empty();
    let tree = t.apply(node, &scx, now, reduced);
    let tree = tree.as_ref().unwrap_or(node);
    match style_of(tree, &scx).layout.width {
        Some(we_style::Dimension::Px(px)) => px,
        other => panic!("not a px width: {other:?}"),
    }
}

#[test]
fn a_first_frame_does_not_transition() {
    let mut t = Transitions::default();
    assert_eq!(drawn(&mut t, &rail("256px"), 0.0, false), 256.0);
    assert!(!t.running(0.0));
}

#[test]
fn a_change_plays_out_over_the_duration_and_stops() {
    let mut t = Transitions::default();
    drawn(&mut t, &rail("72px"), 0.0, false);
    let wide = rail("256px");
    assert_eq!(
        drawn(&mut t, &wide, 1.0, false),
        72.0,
        "starts where it was"
    );
    assert!(t.running(1.0));
    assert_eq!(drawn(&mut t, &wide, 1.1, false), 164.0, "halfway, linear");
    assert_eq!(drawn(&mut t, &wide, 1.2, false), 256.0);
    assert!(!t.running(1.2), "done at the end of its duration");
    assert!(
        t.apply(&wide, &StyleCx::empty(), 1.3, false).is_none(),
        "nothing left to draw"
    );
}

#[test]
fn a_change_mid_flight_starts_from_the_value_on_screen() {
    let mut t = Transitions::default();
    drawn(&mut t, &rail("72px"), 0.0, false);
    drawn(&mut t, &rail("272px"), 1.0, false);
    assert_eq!(drawn(&mut t, &rail("272px"), 1.05, false), 122.0);
    // Back to narrow: from 122, not from 272.
    let narrow = rail("72px");
    assert_eq!(drawn(&mut t, &narrow, 1.05, false), 122.0);
    assert_eq!(drawn(&mut t, &narrow, 1.15, false), 97.0);
    assert_eq!(drawn(&mut t, &narrow, 1.25, false), 72.0);
}

#[test]
fn reduced_motion_jumps() {
    let mut t = Transitions::default();
    drawn(&mut t, &rail("72px"), 0.0, true);
    assert_eq!(drawn(&mut t, &rail("256px"), 1.0, true), 256.0);
    assert!(!t.running(1.0));
}

#[test]
fn only_the_node_that_changed_is_rewritten() {
    let mut t = Transitions::default();
    let mut root = rail("72px");
    root.id = NodeId::from("root");
    root.children
        .push(ResolvedChild::Node(Box::new(rail("72px"))));
    let scx = StyleCx::empty();
    assert!(t.apply(&root, &scx, 0.0, false).is_none());
    if let ResolvedChild::Node(n) = &mut root.children[0] {
        n.props.insert(Arc::from("width"), Value::from("172px"));
    }
    let tree = t.apply(&root, &scx, 1.0, false).expect("the child moves");
    assert!(
        !tree.props.contains_key("styles"),
        "the parent is drawn as resolved"
    );
}
