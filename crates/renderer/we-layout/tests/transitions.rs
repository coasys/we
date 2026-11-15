//! `Transitions` plays a change to a transitioned property out over its
//! duration, by CSS's rules: no transition on a node's first frame, a
//! change mid-flight starts from the value on screen, reduced motion jumps.
use std::collections::HashMap;
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_layout::animate::Transitions;
use we_layout::defaults::{style_of, StyleCx};
use we_template::{
    NodeId, ResolvedChild, ResolvedNode, Transition, TransitionEffect, TransitionKind,
};

/// No `$if` in the tree.
fn none() -> HashMap<NodeId, bool> {
    HashMap::new()
}

/// The `$if` the label is the `then` of, with its condition.
fn site(condition: bool) -> HashMap<NodeId, bool> {
    [(NodeId::from("if"), condition)].into_iter().collect()
}

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
    let tree = t.apply(node, &none(), &scx, now, reduced);
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
        t.apply(&wide, &none(), &StyleCx::empty(), 1.3, false)
            .is_none(),
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
    assert!(t.apply(&root, &none(), &scx, 0.0, false).is_none());
    if let ResolvedChild::Node(n) = &mut root.children[0] {
        n.props.insert(Arc::from("width"), Value::from("172px"));
    }
    let tree = t
        .apply(&root, &none(), &scx, 1.0, false)
        .expect("the child moves");
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
        site: Some(NodeId::from("if")),
    });
    n
}

fn opacity(
    t: &mut Transitions,
    root: &ResolvedNode,
    conditions: &HashMap<NodeId, bool>,
    now: f64,
) -> f32 {
    let scx = StyleCx::empty();
    let tree = t.apply(root, conditions, &scx, now, false);
    let tree = tree.as_ref().unwrap_or(root);
    let node = match tree.children.first() {
        Some(ResolvedChild::Node(n)) => n,
        _ => panic!("the label"),
    };
    style_of(node, &scx).paint.opacity.unwrap_or(1.0)
}

/// The tree with and without the label a `$if` (`if`) shows.
fn trees() -> (ResolvedNode, ResolvedNode) {
    let mut root = rail("72px");
    root.id = NodeId::from("root");
    root.props.shift_remove("transition");
    let mut with_label = root.clone();
    with_label
        .children
        .push(ResolvedChild::Node(Box::new(label())));
    (root, with_label)
}

/// A `$if` that goes from false to true fades its `then` in, through the
/// duration, to its own opacity — and again each time it does.
#[test]
fn a_conditional_turning_true_fades_its_then_in() {
    let (root, with_label) = trees();
    let mut t = Transitions::default();
    assert!(t
        .apply(&root, &site(false), &StyleCx::empty(), 0.0, false)
        .is_none());
    assert_eq!(opacity(&mut t, &with_label, &site(true), 1.0), 0.0);
    assert!(t.running(1.0));
    assert!((opacity(&mut t, &with_label, &site(true), 1.05) - 0.5).abs() < 1e-3);
    assert_eq!(opacity(&mut t, &with_label, &site(true), 1.1), 1.0);
    assert!(!t.running(1.1));
    assert!(t
        .apply(&root, &site(false), &StyleCx::empty(), 2.0, false)
        .is_none());
    assert_eq!(opacity(&mut t, &with_label, &site(true), 3.0), 0.0);
}

/// A `$if` first seen true starts visible (`ConditionalRenderer`'s
/// `startVisible`): on the first tree, in a tree long after it (a page
/// navigated to), and when it mounts again after leaving the tree — each
/// is a new conditional, with its own initial condition.
#[test]
fn a_conditional_first_seen_true_is_drawn_at_once() {
    let (root, with_label) = trees();
    let mut t = Transitions::default();
    assert_eq!(
        opacity(&mut t, &with_label, &site(true), 0.0),
        1.0,
        "first tree"
    );
    let mut t = Transitions::default();
    assert!(t
        .apply(&root, &none(), &StyleCx::empty(), 0.0, false)
        .is_none());
    assert_eq!(
        opacity(&mut t, &with_label, &site(true), 1.0),
        1.0,
        "mounted after the first tree"
    );
    assert!(t
        .apply(&root, &none(), &StyleCx::empty(), 2.0, false)
        .is_none());
    assert_eq!(
        opacity(&mut t, &with_label, &site(true), 3.0),
        1.0,
        "mounted again after leaving"
    );
}

/// Reduced motion asked for while a track runs stops it where it is going:
/// the next frame draws the target, not the rest of the animation.
#[test]
fn reduced_motion_asked_mid_flight_jumps_to_the_end() {
    let mut t = Transitions::default();
    drawn(&mut t, &rail("72px"), 0.0, false);
    let wide = rail("256px");
    assert_eq!(drawn(&mut t, &wide, 1.0, false), 72.0);
    assert_eq!(
        drawn(&mut t, &wide, 1.05, true),
        256.0,
        "reduced: at the end"
    );
    assert!(!t.running(1.05));
}

/// A duration that drops to 0 while a track runs (the same target, a
/// different `transition`) stops it the same way.
#[test]
fn a_duration_dropped_to_zero_mid_flight_jumps_to_the_end() {
    let mut t = Transitions::default();
    drawn(&mut t, &rail("72px"), 0.0, false);
    let wide = rail("256px");
    assert_eq!(drawn(&mut t, &wide, 1.0, false), 72.0);
    let mut instant = rail("256px");
    instant
        .props
        .insert(Arc::from("transition"), Value::from("width 0ms linear"));
    assert_eq!(
        drawn(&mut t, &instant, 1.05, false),
        256.0,
        "0ms: at the end"
    );
    assert!(!t.running(1.05));
}

/// The same for a `$if`'s enter fade already running.
#[test]
fn reduced_motion_asked_mid_fade_shows_the_node() {
    let (root, with_label) = trees();
    let mut t = Transitions::default();
    assert!(t
        .apply(&root, &site(false), &StyleCx::empty(), 0.0, false)
        .is_none());
    assert_eq!(opacity(&mut t, &with_label, &site(true), 1.0), 0.0);
    let scx = StyleCx::empty();
    let tree = t.apply(&with_label, &site(true), &scx, 1.05, true);
    let tree = tree.as_ref().unwrap_or(&with_label);
    let node = match tree.children.first() {
        Some(ResolvedChild::Node(n)) => n,
        _ => panic!("the label"),
    };
    assert_eq!(style_of(node, &scx).paint.opacity.unwrap_or(1.0), 1.0);
    assert!(!t.running(1.05));
}
