//! `Transitions` plays a change to a transitioned property out over its
//! duration, by CSS's rules: no transition on a node's first frame, a
//! change mid-flight starts from the value on screen, reduced motion jumps.
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_layout::animate::Transitions;
use we_layout::defaults::{style_of, StyleCx};
use we_template::{
    NodeId, ResolvedChild, ResolvedNode, Transition, TransitionEffect, TransitionKind,
};

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

/// A row a `$if` mounts, carrying `enterTransition: { type: "fade",
/// duration: 100 }`.
fn label() -> ResolvedNode {
    let mut n = rail("72px");
    n.id = NodeId::from("label");
    n.props.shift_remove("transition");
    let fade = TransitionEffect {
        kind: TransitionKind::Fade,
        duration: Some(100.0),
        easing: Some("linear".into()),
        delay: None,
        direction: None,
        distance: None,
        axis: None,
        extra: Default::default(),
    };
    n.transition = Some(Transition {
        enter: Some(vec![fade]),
        exit: None,
        open: None,
    });
    n
}

fn opacity(t: &mut Transitions, root: &ResolvedNode, now: f64) -> f32 {
    let scx = StyleCx::empty();
    let tree = t.apply(root, &scx, now, false);
    let tree = tree.as_ref().unwrap_or(root);
    let node = match tree.children.first() {
        Some(ResolvedChild::Node(n)) => n,
        _ => panic!("the label"),
    };
    style_of(node, &scx).paint.opacity.unwrap_or(1.0)
}

#[test]
fn a_node_a_branch_mounts_fades_in_and_one_there_from_the_start_does_not() {
    let mut root = rail("72px");
    root.id = NodeId::from("root");
    root.props.shift_remove("transition");
    let with_label = {
        let mut r = root.clone();
        r.children.push(ResolvedChild::Node(Box::new(label())));
        r
    };
    // There on the first tree: drawn as it is.
    let mut t = Transitions::default();
    assert_eq!(opacity(&mut t, &with_label, 0.0), 1.0);
    // Mounted later: from 0, through the duration, to its own opacity.
    let mut t = Transitions::default();
    assert!(t.apply(&root, &StyleCx::empty(), 0.0, false).is_none());
    assert_eq!(opacity(&mut t, &with_label, 1.0), 0.0);
    assert!(t.running(1.0));
    assert!((opacity(&mut t, &with_label, 1.05) - 0.5).abs() < 1e-3);
    assert_eq!(opacity(&mut t, &with_label, 1.1), 1.0);
    assert!(!t.running(1.1));
    // Unmounted and mounted again: it fades in again.
    assert!(t.apply(&root, &StyleCx::empty(), 2.0, false).is_none());
    assert_eq!(opacity(&mut t, &with_label, 3.0), 0.0);
}
