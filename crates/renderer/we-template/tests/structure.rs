//! Structure ops: `$panels` lanes, `$part` host parts, `$agent` profiles,
//! `$animate` transitions, `meta.recordViews` kind preference, and the query
//! pool's keyed dedup / gating.

use std::sync::Arc;

use serde_json::json;
use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{
    AppSpec, BundleTemplate, LocalState, PartSource, ResolvedChild, ResolvedNode, Runtime,
    SchemaNode, StaticHost, StoreBag,
};

fn schema(v: serde_json::Value) -> SchemaNode {
    serde_json::from_value(v).unwrap()
}

fn screen(href: &str) -> ScreenState {
    ScreenState::desktop(ScreenSchema::default(), href)
}

fn rig(node: SchemaNode, bag: StoreBag, href: &str) -> (Runtime, StaticHost, ScreenState) {
    let locals = LocalState::new();
    let bag = Arc::new(bag);
    let runtime = Runtime::new(node, "test", bag.clone(), locals.clone());
    let host = StaticHost::new(bag, locals);
    (runtime, host, screen(href))
}

fn snapshot(stores: serde_json::Value) -> StoreBag {
    StoreBag::from_snapshot(&json!({"stores": stores, "queries": {}, "invokes": {}})).unwrap()
}

fn types(node: &ResolvedNode, out: &mut Vec<String>) {
    out.push(node.ty.to_string());
    for c in &node.children {
        if let ResolvedChild::Node(n) = c {
            types(n, out);
        }
    }
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

fn template(meta: serde_json::Value, node: serde_json::Value) -> BundleTemplate {
    serde_json::from_value(json!({
        "id": "t",
        "meta": meta,
        "type": node["type"],
        "props": node.get("props").cloned().unwrap_or(json!({})),
        "children": node.get("children").cloned().unwrap_or(json!([])),
    }))
    .unwrap()
}

fn app_rt(
    app: Option<SchemaNode>,
    template: Option<BundleTemplate>,
    href: &str,
) -> (Runtime, StaticHost, ScreenState) {
    let locals = LocalState::new();
    let bag = Arc::new(snapshot(json!({
        "sessionStore": { "bootState": "ready" }
    })));
    let spec = AppSpec {
        app,
        template,
        pages: vec![],
        boot: None,
    };
    let rt = Runtime::app(spec, bag.clone(), locals.clone());
    (rt, StaticHost::new(bag, locals), screen(href))
}

#[test]
fn panels_mount_lane_sections_from_meta() {
    let tmpl = template(
        json!({ "panels": [
            { "id": "tree", "home": "tree", "node": { "type": "TreeBody" } },
            { "id": "insp", "home": "inspector", "node": { "type": "InspBody" } },
            { "id": "off", "home": "tree", "open": false, "node": { "type": "OffBody" } }
        ]}),
        json!({ "type": "Row", "children": [
            { "type": "$panels", "props": { "lane": "tree" } },
            { "type": "$panels", "props": { "lane": "inspector" } }
        ]}),
    );
    let (mut rt, mut host, screen) = app_rt(None, Some(tmpl), "/space/demo");
    let root = rt.frame(&mut host, &screen).clone();
    let mut tys = Vec::new();
    types(&root, &mut tys);
    assert_eq!(tys.iter().filter(|t| *t == "$lane").count(), 2, "{tys:?}");
    assert!(tys.iter().any(|t| t == "TreeBody"), "{tys:?}");
    assert!(tys.iter().any(|t| t == "InspBody"), "{tys:?}");
    assert!(
        !tys.iter().any(|t| t == "OffBody"),
        "closed section must not render: {tys:?}"
    );
}

#[test]
fn part_uses_the_source_and_falls_back_to_a_placeholder() {
    struct Parts;
    impl PartSource for Parts {
        fn part(&self, id: &str) -> Option<Arc<SchemaNode>> {
            (id == "real")
                .then(|| Arc::new(schema(json!({ "type": "PartBody", "props": { "x": 1 } }))))
        }
    }
    let node = schema(json!({ "type": "Column", "children": [
        { "type": "$part", "props": { "id": "real" } },
        { "type": "$part", "props": { "id": "missing" } }
    ]}));
    let locals = LocalState::new();
    let bag = Arc::new(StoreBag::new());
    let mut rt =
        Runtime::new(node, "test", bag.clone(), locals.clone()).with_sources(None, Arc::new(Parts));
    let mut host = StaticHost::new(bag, locals);
    let screen = screen("/");
    let root = rt.frame(&mut host, &screen).clone();
    let mut tys = Vec::new();
    types(&root, &mut tys);
    assert!(tys.iter().any(|t| t == "PartBody"), "{tys:?}");
    let placeholder = find_ty(&root, "$part").expect("missing part placeholder");
    assert!(placeholder
        .props
        .get("id")
        .is_some_and(|v| v.strict_eq(&Value::Str("missing".into()))));
}

#[test]
fn agent_binds_the_profile_from_profilestore() {
    let node = schema(json!({ "type": "Column", "children": [
        { "type": "$agent", "props": { "did": "did:a", "as": "who" },
          "children": [{ "type": "we-text", "props": { "text": { "$": "who.name" } } }] },
        { "type": "$agent", "props": { "did": "did:ghost" },
          "children": [{ "type": "we-text", "props": { "text": { "$": "agent.did" } } }] },
        { "type": "$agent", "props": { "did": { "$": "nothing" } },
          "children": [{ "type": "Never" }] }
    ]}));
    let bag = snapshot(json!({
        "profileStore": { "profiles": { "did:a": { "did": "did:a", "name": "Ana" } } }
    }));
    let (mut rt, mut host, screen) = rig(node, bag, "/");
    let root = rt.frame(&mut host, &screen).clone();
    let mut texts = Vec::new();
    fn texts_of(n: &ResolvedNode, out: &mut Vec<Value>) {
        if let Some(Value::Str(s)) = n.props.get("text") {
            out.push(Value::Str(s.clone()));
        }
        for c in &n.children {
            if let ResolvedChild::Node(x) = c {
                texts_of(x, out);
            }
        }
    }
    texts_of(&root, &mut texts);
    assert!(
        texts.iter().any(|v| v.strict_eq(&Value::Str("Ana".into()))),
        "bound profile name missing: {texts:?}"
    );
    // An unknown did still answers `{did}` — templates can name it.
    assert!(
        texts
            .iter()
            .any(|v| v.strict_eq(&Value::Str("did:ghost".into()))),
        "stub did missing: {texts:?}"
    );
    let mut tys = Vec::new();
    types(&root, &mut tys);
    assert!(
        !tys.iter().any(|t| t == "Never"),
        "unresolved did must draw nothing"
    );
}

#[test]
fn animate_gates_children_and_attaches_transition() {
    let node = schema(json!({ "type": "Column", "children": [
        { "type": "$animate", "props": {
            "condition": { "$": "1 == 1" },
            "enterTransition": { "type": "fade", "duration": 200 }
          }, "children": [{ "type": "Shown" }] },
        { "type": "$animate", "props": { "condition": { "$": "false" } },
          "children": [{ "type": "Hidden" }] }
    ]}));
    let (mut rt, mut host, screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let shown = find_ty(&root, "Shown").expect("$animate child missing");
    assert!(
        shown.transition.is_some(),
        "enterTransition must attach to the child"
    );
    assert!(
        find_ty(&root, "Hidden").is_none(),
        "false condition must gate"
    );
}

#[test]
fn record_view_prefers_entity_kind_then_entity() {
    let tmpl = template(
        json!({ "recordViews": {
            "TaskBlock": { "type": "GenericRec" },
            "TaskBlock:detail": { "type": "DetailRec" }
        }}),
        json!({ "type": "Column", "children": [{ "type": "$routes" }] }),
    );

    let (mut rt, mut host, screen) =
        app_rt(None, Some(tmpl.clone()), "/record/TaskBlock?kind=detail");
    let root = rt.frame(&mut host, &screen).clone();
    assert!(
        find_ty(&root, "DetailRec").is_some(),
        "kind-specific view must win"
    );

    let (mut rt, mut host, screen) = app_rt(None, Some(tmpl), "/record/TaskBlock");
    let root = rt.frame(&mut host, &screen).clone();
    assert!(
        find_ty(&root, "GenericRec").is_some(),
        "entity view must answer without a kind"
    );
}

#[test]
fn pool_dedups_only_identical_queries() {
    // Two nodes, same entity, different `where` → two cells. The sabotage
    // this guards: keying on the entity name alone would collide the reads.
    let node = schema(json!({ "type": "Column", "children": [
        { "type": "Row", "$queries": {
            "a": { "entity": "E", "where": { "state": "open" } } },
          "children": [] },
        { "type": "Row", "$queries": {
            "b": { "entity": "E", "where": { "state": "closed" } },
            "c": { "entity": "E", "where": { "state": "open" } } },
          "children": [] }
    ]}));
    let (mut rt, mut host, screen) = rig(node, StoreBag::new(), "/");
    rt.frame(&mut host, &screen);
    assert_eq!(rt.pool().len(), 2, "distinct IRs must not share a cell");
}

#[test]
fn gated_query_field_exists_empty_and_not_loaded() {
    // `when` false / unresolved entity: the field reads `[]`, `<name>Loaded`
    // reads false — the same answer WE gives before the first rows land.
    let node = schema(json!({ "type": "Column",
        "$queries": {
            "gated": { "entity": "E", "when": { "$": "false" } },
            "noEnt": { "where": { "a": 1 } },
            "bound": { "entity": "E", "limit": { "$": "local.missing" } },
            "scoped": { "entity": "E", "scope": { "anchorId": { "$": "local.missing" } } }
        },
        "children": [
            { "type": "we-text", "props": { "text": { "$": "local.gatedLoaded" } } },
            { "type": "we-text", "props": { "text": { "$": "local.noEntLoaded" } } },
            { "type": "we-text", "props": { "text": { "$": "local.boundLoaded" } } },
            { "type": "we-text", "props": { "text": { "$": "local.gated.length" } } }
        ]
    }));
    let (mut rt, mut host, screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let mut texts = Vec::new();
    fn texts_of(n: &ResolvedNode, out: &mut Vec<Value>) {
        if let Some(v) = n.props.get("text") {
            out.push(v.clone());
        }
        for c in &n.children {
            if let ResolvedChild::Node(x) = c {
                texts_of(x, out);
            }
        }
    }
    texts_of(&root, &mut texts);
    let has_false = texts
        .iter()
        .filter(|v| v.strict_eq(&Value::Bool(false)))
        .count();
    assert_eq!(has_false, 3, "all Loaded flags must read false: {texts:?}");
    assert!(
        texts.iter().any(|v| v.strict_eq(&Value::from(0.0))),
        "gated rows must read as an empty list: {texts:?}"
    );
    // A gated query never reaches the pool — no cell, no subscription — but
    // an unanchored scope WIDENS rather than gates: `scoped` compiles to a
    // cell with no scope filter (WE's deliberate asymmetry).
    assert_eq!(
        rt.pool().len(),
        1,
        "the unanchored scope must widen into a plain query, not gate"
    );
}
