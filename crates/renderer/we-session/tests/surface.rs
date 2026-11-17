//! E3c-13, session half: `Session::report_surface` rides the same inbox
//! every other between-frames producer does — the wake, the `Tick::dirty`
//! bit, and the quiet drain all fall out of it.
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use serde_json::json;
use we_metrics::{tier_for_width, Breakpoints};
use we_screen::{ScreenSchema, ScreenState};
use we_session::{Session, Tick};
use we_template::{ResolvedChild, ResolvedNode, RootSpec, SchemaNode, StoreBag, SurfaceKey};

fn schema(v: serde_json::Value) -> SchemaNode {
    serde_json::from_value(v).unwrap()
}

/// A session over one mount ("test") whose root reads `surface.*`.
fn session(node: SchemaNode) -> Session {
    Session::offline(
        RootSpec::single(node, "test"),
        Arc::new(StoreBag::new()),
        ScreenState::desktop(ScreenSchema::default(), "/"),
    )
}

/// The mount's host tag — the surface every mount carries, at the slot
/// the frontend paints the session into (no template node holds it).
fn host_tag(session: &Session) -> we_template::SurfaceTag {
    let tag = session
        .host_surfaces()
        .first()
        .expect("the mount claims its host surface")
        .clone();
    assert!(matches!(tag.key, SurfaceKey::Host(_)));
    tag
}

fn prop<'a>(node: &'a ResolvedNode, key: &str) -> Option<&'a we_expr::Value> {
    node.props.get(key)
}

#[test]
fn report_dirties_poll() {
    // The surface revision is part of `poll`'s dirty tuple: a report that
    // changes the width re-resolves; the drain reports it in `surfaces`.
    let node = schema(json!({
        "type": "Row",
        "props": { "w": { "$": "surface.width" } },
        "children": []
    }));
    let mut session = session(node);
    session.resolve();
    let tag = host_tag(&session);
    assert_eq!(session.poll(), Tick::default(), "a fresh session is quiet");

    session.report_surface(&tag, 500.0);
    let tick = session.poll();
    assert!(tick.dirty, "an applied report dirties the next resolve");
    assert_eq!(tick.surfaces, 1, "the drain counted it");

    let root = session.resolve();
    assert!(
        prop(&root, "w").is_some_and(|v| v.strict_eq(&we_expr::Value::from(500.0))),
        "the measured width reaches the binding: {:?}",
        prop(&root, "w")
    );
    assert_eq!(
        session.poll(),
        Tick::default(),
        "applied + resolved — the next tick is quiet"
    );
}

#[test]
fn same_width_report_is_quiet() {
    // A report that changes neither width nor tier does not move the
    // surface revision — the `setSurface` guard at createSurface.ts:52.
    let node = schema(json!({
        "type": "Row",
        "props": { "w": { "$": "surface.width" } },
        "children": []
    }));
    let mut session = session(node);
    session.resolve();
    let tag = host_tag(&session);
    session.report_surface(&tag, 500.0);
    assert!(session.poll().dirty);
    session.resolve();

    session.report_surface(&tag, 500.0);
    let tick = session.poll();
    assert!(
        !tick.dirty,
        "the same width again moves nothing — no re-resolve"
    );
    assert_eq!(
        tick.surfaces, 1,
        "the report still drained (applied: no-op)"
    );
}

#[test]
fn a_surface_report_wakes_a_sleeping_session() {
    // The whole point of riding the inbox: a measurement landing between
    // frames is a `push` — the frontend's `Waker` hears it exactly once.
    let node = schema(json!({
        "type": "Row",
        "props": { "w": { "$": "surface.width" } },
        "children": []
    }));
    let mut session = session(node);
    session.resolve();
    let tag = host_tag(&session);
    assert!(!session.poll().dirty);

    let wakes = Arc::new(AtomicUsize::new(0));
    let w = wakes.clone();
    session.set_waker(Arc::new(move || {
        w.fetch_add(1, Ordering::SeqCst);
    }));
    session.report_surface(&tag, 400.0);
    assert_eq!(
        wakes.load(Ordering::SeqCst),
        1,
        "one arrival, one wake — the sleeping session is called to poll"
    );
    assert!(session.poll().dirty, "and the poll finds the work");
    let root = session.resolve();
    assert!(prop(&root, "w").is_some_and(|v| v.strict_eq(&we_expr::Value::from(400.0))));
    assert_eq!(session.poll(), Tick::default());
}

#[test]
fn viewport_report_reaches_the_tier_egui_computes() {
    // Dump/CLI do no layout: `open` reports each host surface at the
    // `--viewport` width. The tier that binds is the one `tier_for_width`
    // computes — the same rule the egui frontend's content-box report
    // resolves through the shared table, so a dump at 700px and an egui
    // frame measuring 700px agree.
    let node = schema(json!({
        "type": "Row",
        "props": {
            "t": { "$": "surface.tier" },
            "w": { "$": "surface.width" }
        },
        "children": []
    }));
    let mut s1 = session(node);
    let root = s1.resolve();
    s1.report_host_surfaces(&root, 700.0);
    let root = s1.resolve();
    assert!(prop(&root, "w").is_some_and(|v| v.strict_eq(&we_expr::Value::from(700.0))));
    assert_eq!(
        prop(&root, "t").map(|v| v.to_text().to_string()),
        Some(
            tier_for_width(700.0, &Breakpoints::default())
                .name()
                .to_string()
        ),
        "the dump's viewport tier is the shared rule's answer — sm"
    );

    s1.report_host_surfaces(&root, 1440.0);
    let root = s1.resolve();
    assert_eq!(
        prop(&root, "t").map(|v| v.to_text().to_string()),
        Some("lg".to_string()),
        "and the default 1440 viewport is lg — the egui window at that size"
    );

    // Nested `$surface` nodes stay at their initial: no layout measured them.
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$surface",
            "children": [{ "type": "Tag", "props": { "t": { "$": "surface.tier" } } }]
        }]
    }));
    let mut s2 = session(node);
    let root = s2.resolve();
    s2.report_host_surfaces(&root, 1440.0);
    let root = s2.resolve();
    fn find<'a>(n: &'a ResolvedNode, ty: &str) -> Option<&'a ResolvedNode> {
        if n.ty.as_ref() == ty {
            return Some(n);
        }
        n.children.iter().find_map(|c| match c {
            ResolvedChild::Node(n) => find(n, ty),
            _ => None,
        })
    }
    assert_eq!(
        find(&root, "Tag")
            .and_then(|t| t.props.get("t"))
            .map(|v| v.to_text().to_string()),
        Some("base".to_string()),
        "a nested surface keeps createSurface's `{{0, base}}` under a viewport report"
    );
}

/// Lal U1, headless half: dump and the CLI report the host as
/// `--viewport` — the mount's boundary, which exists whatever the root
/// looks like. A root fragment opening with text, or several roots, has
/// no node that could carry the host's tag.
#[test]
fn headless_host_report_reaches_every_root_shape() {
    for node in [
        json!({ "children": ["heading", { "type": "Label", "props": { "w": { "$": "surface.width" } } }] }),
        json!({ "children": [
            { "type": "Label", "props": { "w": { "$": "surface.width" } } },
            { "type": "Label", "props": { "w": { "$": "surface.width" } } }
        ]}),
    ] {
        let mut session = session(schema(node));
        let root = session.resolve();
        session.report_host_surfaces(&root, 1440.0);
        session.poll();
        let root = session.resolve();
        let ws: Vec<_> = root
            .children
            .iter()
            .filter_map(|c| match c {
                ResolvedChild::Node(n) if n.ty.as_ref() == "Label" => prop(n, "w").cloned(),
                _ => None,
            })
            .collect();
        assert!(!ws.is_empty());
        for w in ws {
            assert!(
                w.strict_eq(&we_expr::Value::from(1440.0)),
                "every root reads the viewport: {w:?}"
            );
        }
    }
}
