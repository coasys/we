//! E3c-13: surface lifetime — the runtime owns the table, generation-
//! tagged, fed through the inbox; `ScreenState.surfaces` is gone. The
//! design's 6.2 tests live here; the session-side ones (poll/wake) are in
//! `we-session/tests/surface.rs`.
use std::sync::Arc;

use serde_json::json;
use we_expr::Value;
use we_metrics::SizeTier;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{
    LocalState, NodeId, ResolvedChild, ResolvedNode, Runtime, SchemaNode, StaticHost, StoreBag,
    SurfaceKey, SurfaceTag,
};

fn schema(v: serde_json::Value) -> SchemaNode {
    serde_json::from_value(v).unwrap()
}

fn screen() -> ScreenState {
    ScreenState::desktop(ScreenSchema::default(), "/")
}

fn rig(node: SchemaNode, bag: StoreBag) -> (Runtime, StaticHost, LocalState, ScreenState) {
    rig_arc(node, Arc::new(bag))
}

fn rig_arc(node: SchemaNode, bag: Arc<StoreBag>) -> (Runtime, StaticHost, LocalState, ScreenState) {
    let locals = LocalState::new();
    let runtime = Runtime::new(node, "test", bag.clone(), locals.clone()).trust_unclassified_bag();
    let host = StaticHost::new(bag);
    (runtime, host, locals, screen())
}

fn find_ty<'a>(node: &'a ResolvedNode, ty: &str) -> Option<&'a ResolvedNode> {
    if node.ty.as_ref() == ty {
        return Some(node);
    }
    node.children.iter().find_map(|c| match c {
        ResolvedChild::Node(n) => find_ty(n, ty),
        _ => None,
    })
}

fn find_all_ty<'a>(node: &'a ResolvedNode, ty: &str, out: &mut Vec<&'a ResolvedNode>) {
    if node.ty.as_ref() == ty {
        out.push(node);
    }
    for c in &node.children {
        if let ResolvedChild::Node(n) = c {
            find_all_ty(n, ty, out);
        }
    }
}

/// The node's own `$surface` tag — host tags sit first in the list, so a
/// mount root that is itself a `$surface` still answers `Node` here.
fn node_tag(node: &ResolvedNode) -> SurfaceTag {
    node.surfaces
        .iter()
        .find(|t| matches!(t.key, SurfaceKey::Node(_)))
        .unwrap_or_else(|| panic!("{:?} carries no node surface tag", node.id))
        .clone()
}

/// A frontend measurement, end to end: the report enters through the
/// inbox, `poll`'s drain applies it, the next frame resolves against it.
fn measure(
    rt: &mut Runtime,
    host: &mut StaticHost,
    screen: &mut ScreenState,
    tag: &SurfaceTag,
    width: f32,
) {
    rt.report_surface(tag, width);
    rt.drain_inbox(host, screen);
    rt.frame(host, screen);
}

#[test]
fn unmount_late_report_remount_starts_fresh() {
    // 6.2: a key leaving the live set is pruned at commit; a late report
    // for the old generation lands nowhere (it cannot even recreate the
    // entry), and the remount mints a new generation starting at
    // `{0, base}` — createSurface's initial, `createSurface.ts:39`.
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$if",
            "props": {
                "condition": { "$": "show" },
                "then": {
                    "type": "$surface",
                    "children": [{ "type": "Label", "props": {
                        "t": { "$": "surface.tier" },
                        "w": { "$": "surface.width" }
                    }}]
                },
                "else": { "type": "Empty" }
            }
        }]
    }));
    let bag = Arc::new(StoreBag::new());
    bag.set_root("show", Value::Bool(true));
    let (mut rt, mut host, _locals, mut screen) = rig_arc(node, bag.clone());

    let root = rt.frame(&mut host, &screen).clone();
    let old = node_tag(find_ty(&root, "$surface").expect("the surface mounts"));
    let key = old.key.clone();
    measure(&mut rt, &mut host, &mut screen, &old, 400.0);
    let root = rt.resolved().unwrap().clone();
    let label = find_ty(&root, "Label").unwrap();
    assert!(
        label
            .props
            .get("w")
            .is_some_and(|v| v.strict_eq(&Value::from(400.0))),
        "the applied report reaches the binding: {:?}",
        label.props.get("w")
    );

    // Unmount: the entry is pruned; a report landing after that —
    // addressed to the old generation — is dropped, not resurrected.
    bag.set_root("show", Value::Bool(false));
    rt.frame(&mut host, &screen);
    assert!(
        rt.surface_measure(&key).is_none(),
        "a dead key keeps no entry"
    );
    rt.report_surface(&old, 999.0);
    rt.drain_inbox(&mut host, &mut screen);
    assert!(
        rt.surface_measure(&key).is_none(),
        "a late report must not recreate the entry"
    );
    assert_eq!(
        rt.stats().surfaces_dropped,
        1,
        "the stale report counts as dropped"
    );

    // Remount: a new generation at `{0, base}` — the old tag's 999 does
    // not leak into the same-`NodeId` incarnation.
    bag.set_root("show", Value::Bool(true));
    let root = rt.frame(&mut host, &screen).clone();
    let surf = find_ty(&root, "$surface").expect("the surface remounts");
    let new = node_tag(surf);
    assert_eq!(new.key, old.key, "same node id, same key");
    assert_ne!(
        new.generation, old.generation,
        "a remount is a new generation"
    );
    assert_eq!(
        rt.surface_measure(&key),
        Some((0.0, SizeTier::Base)),
        "the remount starts fresh — createSurface's initial"
    );
    let label = find_ty(&root, "Label").unwrap();
    assert!(
        label
            .props
            .get("t")
            .is_some_and(|v| v.strict_eq(&Value::from("base"))),
        "the binding reads the fresh record"
    );

    // And a stale report after the remount still dies on the generation.
    rt.report_surface(&old, 999.0);
    rt.drain_inbox(&mut host, &mut screen);
    assert_eq!(
        rt.surface_measure(&key),
        Some((0.0, SizeTier::Base)),
        "the old generation's report is dropped"
    );
    assert_eq!(rt.stats().surfaces_dropped, 2);
}

#[test]
fn stale_generation_report_is_dropped() {
    // The explicit form of the rule inside the test above: reporting a
    // tag whose generation is no longer live changes nothing.
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$if",
            "props": {
                "condition": { "$": "show" },
                "then": { "type": "$surface", "children": [] },
                "else": { "type": "Empty" }
            }
        }]
    }));
    let bag = Arc::new(StoreBag::new());
    bag.set_root("show", Value::Bool(true));
    let (mut rt, mut host, _locals, mut screen) = rig_arc(node, bag.clone());

    let root = rt.frame(&mut host, &screen).clone();
    let gen0 = node_tag(find_ty(&root, "$surface").unwrap());
    bag.set_root("show", Value::Bool(false));
    rt.frame(&mut host, &screen);
    bag.set_root("show", Value::Bool(true));
    let root = rt.frame(&mut host, &screen).clone();
    let gen1 = node_tag(find_ty(&root, "$surface").unwrap());
    measure(&mut rt, &mut host, &mut screen, &gen1, 700.0);
    assert_eq!(
        rt.surface_measure(&gen1.key),
        Some((700.0, SizeTier::Sm)),
        "the live generation applies"
    );

    rt.report_surface(&gen0, 2000.0);
    rt.drain_inbox(&mut host, &mut screen);
    assert_eq!(
        rt.surface_measure(&gen1.key),
        Some((700.0, SizeTier::Sm)),
        "the stale generation's report changes nothing"
    );
    assert!(!rt.dirty(&screen), "a dropped report is not work");
    assert_eq!(rt.stats().surfaces_dropped, 1);
}

#[test]
fn nested_alias_surfaces() {
    // 6.2: `as` names the binding — `surface` by default; an `inner` alias
    // leaves the outer addressable beside it (SurfaceRenderer.tsx:44-48's
    // `{...context, [asKey]: surface}`).
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$surface",
            "children": [
                { "type": "Label", "props": {
                    "t": { "$": "surface.tier" },
                    "w": { "$": "surface.width" }
                }},
                { "type": "$surface", "props": { "as": "inner" }, "children": [
                    { "type": "Tag", "props": {
                        "ti": { "$": "inner.tier" },
                        "to": { "$": "surface.tier" }
                    }}
                ]}
            ]
        }]
    }));
    let (mut rt, mut host, _locals, screen) = rig(node, StoreBag::new());
    let mut screen = screen;

    let root = rt.frame(&mut host, &screen).clone();
    let mut surfaces = Vec::new();
    find_all_ty(&root, "$surface", &mut surfaces);
    assert_eq!(surfaces.len(), 2);
    let (outer, inner) = (node_tag(surfaces[0]), node_tag(surfaces[1]));

    measure(&mut rt, &mut host, &mut screen, &outer, 1000.0); // → md
    measure(&mut rt, &mut host, &mut screen, &inner, 700.0); // → sm
    let root = rt.resolved().unwrap().clone();
    let label = find_ty(&root, "Label").unwrap();
    assert!(
        label
            .props
            .get("t")
            .is_some_and(|v| v.strict_eq(&Value::from("md"))),
        "the outer surface binds its own tier: {:?}",
        label.props.get("t")
    );
    assert!(label
        .props
        .get("w")
        .is_some_and(|v| v.strict_eq(&Value::from(1000.0))));
    let tag = find_ty(&root, "Tag").unwrap();
    assert!(
        tag.props
            .get("ti")
            .is_some_and(|v| v.strict_eq(&Value::from("sm"))),
        "the inner alias binds the inner measure: {:?}",
        tag.props.get("ti")
    );
    assert!(
        tag.props
            .get("to")
            .is_some_and(|v| v.strict_eq(&Value::from("md"))),
        "the outer `surface` stays addressable beside `inner`: {:?}",
        tag.props.get("to")
    );
}

#[test]
fn keyed_row_removal_drops_entry() {
    // 6.2: an `$each` row's surface is keyed by the row's `NodeId`; the
    // row leaving the live set drops its entry at commit.
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$each",
            "props": { "items": { "$": "rows" }, "as": "row" },
            "children": [{ "type": "$surface", "children": [
                { "type": "Label", "props": { "w": { "$": "surface.width" } } }
            ]}]
        }]
    }));
    let rows = |ids: &[&str]| {
        Value::List(Arc::new(
            ids.iter()
                .map(|id| {
                    Value::Obj(Arc::new(
                        [("id".into(), Value::from(*id))].into_iter().collect(),
                    ))
                })
                .collect(),
        ))
    };
    let bag = Arc::new(StoreBag::new());
    bag.set_root("rows", rows(&["a", "b"]));
    let (mut rt, mut host, _locals, screen) = rig_arc(node, bag.clone());

    let root = rt.frame(&mut host, &screen).clone();
    let mut surfaces = Vec::new();
    find_all_ty(&root, "$surface", &mut surfaces);
    assert_eq!(surfaces.len(), 2, "one surface per row");
    let a = surfaces
        .iter()
        .find(|s| s.id.as_str().contains("#ks:1:a"))
        .map(|s| node_tag(s))
        .expect("row a's surface");
    let b = surfaces
        .iter()
        .find(|s| s.id.as_str().contains("#ks:1:b"))
        .map(|s| node_tag(s))
        .expect("row b's surface");
    assert!(rt.surface_measure(&a.key).is_some());
    assert!(rt.surface_measure(&b.key).is_some());

    bag.set_root("rows", rows(&["b"]));
    rt.frame(&mut host, &screen);
    assert!(
        rt.surface_measure(&a.key).is_none(),
        "the removed row's entry is dropped at commit"
    );
    assert!(
        rt.surface_measure(&b.key).is_some(),
        "the surviving row keeps its entry — and its generation"
    );
    let root = rt.resolved().unwrap().clone();
    let b2 = node_tag(find_ty(&root, "$surface").unwrap());
    assert_eq!(b2, b, "same key, same generation — not a remount");
}

#[test]
fn removal_does_not_dirty() {
    // 6.2: pruning a key does not bump the surface revision — the node
    // that could read the entry is gone, so nothing can observe a change.
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$if",
            "props": {
                "condition": { "$": "show" },
                "then": { "type": "$surface", "children": [] },
                "else": { "type": "Empty" }
            }
        }]
    }));
    let bag = Arc::new(StoreBag::new());
    bag.set_root("show", Value::Bool(true));
    let (mut rt, mut host, _locals, mut screen) = rig_arc(node, bag.clone());

    let root = rt.frame(&mut host, &screen).clone();
    measure(
        &mut rt,
        &mut host,
        &mut screen,
        &node_tag(find_ty(&root, "$surface").unwrap()),
        400.0,
    );
    let revision = rt.surface_revision();

    bag.set_root("show", Value::Bool(false));
    rt.frame(&mut host, &screen);
    assert_eq!(
        rt.surface_revision(),
        revision,
        "the removal frame must not move the surface revision"
    );
    assert!(
        !rt.dirty(&screen),
        "and the removal leaves nothing dirty behind"
    );
}

#[test]
fn repeated_mounts_do_not_grow_the_table() {
    // 6.2: a key claimed each frame keeps one entry; a remount replaces,
    // never accumulates. Generations still climb — each mount is new.
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$if",
            "props": {
                "condition": { "$": "show" },
                "then": { "type": "$surface", "children": [] },
                "else": { "type": "Empty" }
            }
        }]
    }));
    let bag = Arc::new(StoreBag::new());
    bag.set_root("show", Value::Bool(false));
    let (mut rt, mut host, _locals, screen) = rig_arc(node, bag.clone());

    let mut last_gen = 0u64;
    for i in 0..5 {
        bag.set_root("show", Value::Bool(i % 2 == 0));
        let root = rt.frame(&mut host, &screen).clone();
        // Host("test") always; the node surface on even rounds.
        let want: usize = if i % 2 == 0 { 2 } else { 1 };
        assert_eq!(
            rt.stats().surfaces,
            want,
            "round {i}: the live set is what this frame resolved"
        );
        if i % 2 == 0 {
            let tag = node_tag(find_ty(&root, "$surface").unwrap());
            assert!(
                tag.generation > last_gen || i == 0,
                "every remount is a new generation"
            );
            last_gen = tag.generation;
        }
    }
}

#[test]
fn host_surface_binds_at_mount_root() {
    // 6.2: every mount claims `Host(mount)` bound as `surface` at the
    // mount root — `surface.tier` works with no template `$surface` at
    // all, at `{0, base}` until the frontend measures it.
    let node = schema(json!({
        "type": "Row",
        "props": {
            "t": { "$": "surface.tier" },
            "w": { "$": "surface.width" }
        },
        "children": []
    }));
    let (mut rt, mut host, _locals, screen) = rig(node, StoreBag::new());
    let mut screen = screen;

    let root = rt.frame(&mut host, &screen).clone();
    assert_eq!(root.ty.as_ref(), "Row");
    assert!(
        root.props
            .get("t")
            .is_some_and(|v| v.strict_eq(&Value::from("base"))),
        "the host surface starts at createSurface's initial"
    );
    assert!(root
        .props
        .get("w")
        .is_some_and(|v| v.strict_eq(&Value::from(0.0))));
    assert!(
        root.surfaces.is_empty(),
        "the host's tag sits on no template node — it is the boundary"
    );
    let tag = rt
        .host_surfaces()
        .first()
        .expect("the mount claims its host surface")
        .clone();
    assert_eq!(
        tag.key,
        SurfaceKey::Host(we_template::MountId::from("test")),
        "keyed by the mount's identity"
    );

    measure(&mut rt, &mut host, &mut screen, &tag, 700.0);
    let root = rt.resolved().unwrap().clone();
    assert!(
        root.props
            .get("t")
            .is_some_and(|v| v.strict_eq(&Value::from("sm"))),
        "700px is `sm` — the tier `tier_for_width` computes: {:?}",
        root.props.get("t")
    );
    assert!(root
        .props
        .get("w")
        .is_some_and(|v| v.strict_eq(&Value::from(700.0))));
}

#[test]
fn root_that_is_a_surface_keeps_its_own_tag() {
    // A mount root that is itself a `$surface` carries its node tag only;
    // the host's boundary is outside the template (Lal U1) and measures
    // separately — two boxes, two records.
    let node = schema(json!({
        "type": "$surface",
        "children": [{ "type": "Label", "props": { "w": { "$": "surface.width" } } }]
    }));
    let (mut rt, mut host, _locals, screen) = rig(node, StoreBag::new());
    let mut screen = screen;

    let root = rt.frame(&mut host, &screen).clone();
    assert_eq!(root.ty.as_ref(), "$surface");
    assert_eq!(
        root.surfaces.to_vec(),
        vec![node_tag(&root)],
        "the node's own tag, and no host tag"
    );
    assert_eq!(
        root.surfaces[0].key,
        SurfaceKey::Node(root.id.clone()),
        "keyed by the node"
    );
    let host_tag = rt.host_surfaces()[0].clone();

    measure(&mut rt, &mut host, &mut screen, &host_tag, 1440.0);
    measure(&mut rt, &mut host, &mut screen, &node_tag(&root), 500.0);
    let root = rt.resolved().unwrap().clone();
    assert!(
        find_ty(&root, "Label")
            .and_then(|l| l.props.get("w"))
            .is_some_and(|v| v.strict_eq(&Value::from(500.0))),
        "the node's own measure reaches `surface` (innermost wins)"
    );
    assert_eq!(
        rt.surface_measure(&SurfaceKey::Host(we_template::MountId::from("test"))),
        Some((1440.0, SizeTier::Lg)),
        "the host's entry holds the boundary's own measure"
    );
}

#[test]
fn host_surface_needs_no_root_node() {
    // Lal U1: a root fragment opening with text, or holding several
    // roots, still has its host surface — the mount's boundary — and no
    // resolved node carries a `Host` tag.
    fn hosts_on_nodes(n: &ResolvedNode) -> usize {
        n.surfaces
            .iter()
            .filter(|t| matches!(t.key, SurfaceKey::Host(_)))
            .count()
            + n.children
                .iter()
                .map(|c| match c {
                    ResolvedChild::Node(n) => hosts_on_nodes(n),
                    _ => 0,
                })
                .sum::<usize>()
    }
    for v in [
        json!({ "children": ["heading", { "type": "Label", "props": { "w": { "$": "surface.width" } } }] }),
        json!({ "children": [
            { "type": "Label", "props": { "w": { "$": "surface.width" } } },
            { "type": "Label", "props": { "w": { "$": "surface.width" } } }
        ]}),
    ] {
        let (mut rt, mut host, _locals, screen) = rig(schema(v), StoreBag::new());
        let mut screen = screen;
        let root = rt.frame(&mut host, &screen).clone();
        assert_eq!(hosts_on_nodes(&root), 0);
        let tag = rt.host_surfaces()[0].clone();
        measure(&mut rt, &mut host, &mut screen, &tag, 950.0);
        let mut labels = Vec::new();
        find_all_ty(rt.resolved().unwrap(), "Label", &mut labels);
        assert!(!labels.is_empty());
        for l in labels {
            assert!(
                l.props
                    .get("w")
                    .is_some_and(|v| v.strict_eq(&Value::from(950.0))),
                "every root reads the boundary: {:?}",
                l.props.get("w")
            );
        }
    }
}

#[test]
fn threshold_edges() {
    // 6.2's pinned boundaries — `tier_for_width` decides, and a width
    // equal to a breakpoint takes the higher tier.
    let node = schema(json!({
        "type": "Column",
        "children": [{ "type": "$surface", "children": [] }]
    }));
    let (mut rt, mut host, _locals, screen) = rig(node, StoreBag::new());
    let mut screen = screen;

    let root = rt.frame(&mut host, &screen).clone();
    let tag = node_tag(find_ty(&root, "$surface").unwrap());
    for (width, want) in [
        (639.5, SizeTier::Base),
        (640.0, SizeTier::Sm),
        (899.5, SizeTier::Sm),
        (900.0, SizeTier::Md),
        (1199.5, SizeTier::Md),
        (1200.0, SizeTier::Lg),
    ] {
        measure(&mut rt, &mut host, &mut screen, &tag, width);
        assert_eq!(
            rt.surface_measure(&tag.key).map(|(_, t)| t),
            Some(want),
            "content width {width} is {want:?} — the design's table"
        );
    }
}

#[test]
fn first_frame_base_then_measured() {
    // 6.2's render risk, spelled out: frame 1 resolves at the initial
    // `{0, base}`, the report lands, frame 2 shows the measured tier,
    // and frame 3 is quiet — the measurement cycle settles.
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$surface",
            "children": [{ "type": "Label", "props": {
                "t": { "$": "surface.tier" },
                "w": { "$": "surface.width" }
            }}]
        }]
    }));
    let (mut rt, mut host, _locals, screen) = rig(node, StoreBag::new());
    let mut screen = screen;

    let root = rt.frame(&mut host, &screen).clone();
    let label = find_ty(&root, "Label").unwrap();
    assert!(
        label
            .props
            .get("t")
            .is_some_and(|v| v.strict_eq(&Value::from("base"))),
        "frame 1: the surface starts `{{0, base}}` — createSurface.ts:39"
    );
    assert!(label
        .props
        .get("w")
        .is_some_and(|v| v.strict_eq(&Value::from(0.0))));

    let tag = node_tag(find_ty(&root, "$surface").unwrap());
    measure(&mut rt, &mut host, &mut screen, &tag, 950.0);
    let root = rt.resolved().unwrap().clone();
    let label = find_ty(&root, "Label").unwrap();
    assert!(
        label
            .props
            .get("t")
            .is_some_and(|v| v.strict_eq(&Value::from("md"))),
        "frame 2: 950px measures `md`"
    );
    assert!(label
        .props
        .get("w")
        .is_some_and(|v| v.strict_eq(&Value::from(950.0))));

    // Frame 3 is quiet: nothing moved since `last` recorded.
    assert!(
        !rt.dirty(&screen),
        "frame 3: the measure is applied, nothing left over"
    );
    let resolves = rt.stats().resolves;
    rt.frame(&mut host, &screen);
    assert_eq!(
        rt.stats().resolves,
        resolves,
        "a quiet frame does not re-resolve"
    );
}

#[test]
fn stable_tier_width_change_keeps_edits() {
    // 6.2: a width change inside one tier changes `surface.width` — and
    // keeps an edited local whose initial read only `surface.tier`.
    // (R2 carried over: `{"$":"[surface.tier]"}` reads only `tier`; the
    // store's per-member tracking keeps the edit. A tier move resets.)
    let node = schema(json!({
        "type": "Column",
        "children": [{
            "type": "$surface",
            "children": [{
                "type": "Row",
                "$localState": { "sel": { "type": "array", "initial": { "$": "[surface.tier]" } } },
                "children": []
            }]
        }]
    }));
    let (mut rt, mut host, locals, screen) = rig(node, StoreBag::new());
    let mut screen = screen;

    let root = rt.frame(&mut host, &screen).clone();
    let tag = node_tag(find_ty(&root, "$surface").unwrap());
    let row = NodeId::new("test:/$surface0/Row0");
    let sel = || match locals.get(&row, "sel") {
        Value::List(items) => items
            .first()
            .and_then(|v| v.to_json().as_str().map(String::from)),
        other => panic!("sel must stay a list: {other:?}"),
    };
    assert_eq!(sel().as_deref(), Some("base"), "sel seeds [surface.tier]");

    locals.set(
        &row,
        "sel",
        Value::List(Arc::new(vec![Value::from("mine")])),
    );
    locals.touch(&row, "sel");

    // An unread member moving is no input of this initial — the edit stays.
    measure(&mut rt, &mut host, &mut screen, &tag, 401.0); // still `base`
    assert_eq!(
        sel().as_deref(),
        Some("mine"),
        "a width report inside one tier must not reset the edit"
    );
    assert!(locals.is_touched(&row, "sel"), "a kept edit stays touched");
    let root = rt.resolved().unwrap().clone();
    assert_eq!(
        rt.surface_measure(&tag.key),
        Some((401.0, SizeTier::Base)),
        "but surface.width did move — it is just not read: {:?}",
        root.id
    );

    // The read member moving resets — the dep is granular, not absent.
    measure(&mut rt, &mut host, &mut screen, &tag, 1000.0); // → `md`
    assert_eq!(
        sel().as_deref(),
        Some("md"),
        "the tier moving resets to the new initial"
    );
    assert!(
        !locals.is_touched(&row, "sel"),
        "a real reset clears touched"
    );
}

#[test]
fn host_and_template_surface_nesting() {
    // 6.2's nesting rule both ways: a template `$surface` shadows the
    // mount's host surface for its children (`surface` innermost wins),
    // while siblings still read the host's.
    let node = schema(json!({
        "type": "Column",
        "children": [
            { "type": "Row", "props": { "a": { "$": "surface.tier" } } },
            { "type": "$surface", "children": [
                { "type": "Tag", "props": { "b": { "$": "surface.tier" } } }
            ]}
        ]
    }));
    let (mut rt, mut host, _locals, screen) = rig(node, StoreBag::new());
    let mut screen = screen;

    let root = rt.frame(&mut host, &screen).clone();
    let host_tag = rt
        .host_surfaces()
        .first()
        .expect("the mount claims its host surface")
        .clone();
    let inner = node_tag(find_ty(&root, "$surface").unwrap());

    measure(&mut rt, &mut host, &mut screen, &host_tag, 1300.0); // → lg
    measure(&mut rt, &mut host, &mut screen, &inner, 700.0); // → sm
    let root = rt.resolved().unwrap().clone();
    assert!(
        find_ty(&root, "Row")
            .and_then(|n| n.props.get("a"))
            .is_some_and(|v| v.strict_eq(&Value::from("lg"))),
        "outside the surface: `surface` is the mount's host boundary"
    );
    assert!(
        find_ty(&root, "Tag")
            .and_then(|n| n.props.get("b"))
            .is_some_and(|v| v.strict_eq(&Value::from("sm"))),
        "inside: `surface` is the innermost binding — the node's own"
    );
}
