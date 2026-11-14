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
fn animate_mounts_children_and_marks_open_state() {
    // Rewritten to the TS contract (AnimateRenderer.tsx): `$animate` never
    // controls presence — the child is always mounted; `condition` only
    // drives open/hidden visual state, and no transitions is a transparent
    // pass-through. The previous version of this test asserted the child
    // unmounts on `condition: false` — the opposite of the contract.
    let node = schema(json!({ "type": "Column", "children": [
        { "type": "$animate", "props": {
            "condition": { "$": "1 == 1" },
            "enterTransition": { "type": "fade", "duration": 200 }
          }, "children": [{ "type": "Shown" }] },
        { "type": "$animate", "props": {
            "condition": { "$": "false" },
            "exitTransition": { "type": "fade", "duration": 100 }
          }, "children": [{ "type": "Hidden" }] },
        { "type": "$animate", "children": [{ "type": "Bare" }] }
    ]}));
    let (mut rt, mut host, screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let shown = find_ty(&root, "Shown").expect("$animate child must mount");
    assert_eq!(
        shown.transition.as_ref().and_then(|t| t.open),
        Some(true),
        "open condition reads as open"
    );
    let hidden = find_ty(&root, "Hidden").expect("condition:false must still mount the child");
    assert_eq!(
        hidden.transition.as_ref().and_then(|t| t.open),
        Some(false),
        "the painter reads open:false — hidden, but present"
    );
    let bare = find_ty(&root, "Bare").expect("no transitions is a pass-through");
    assert!(bare.transition.is_none());
}

#[test]
fn animate_keeps_locals_across_close_and_reopen() {
    // The half-typed field: closing the condition must not drop the
    // subtree's ids or locals — there is nothing to reopen into otherwise.
    let node = schema(json!({ "type": "Column", "children": [
        { "type": "$animate", "props": {
            "condition": { "$": "open" },
            "enterTransition": { "type": "fade" }
          }, "children": [{
            "type": "we-text",
            "$localState": { "draft": { "type": "string", "initial": "start" } },
            "props": { "text": { "$": "local.draft" } }
          }] }
    ]}));
    let bag = Arc::new(StoreBag::new());
    bag.set_root("open", Value::Bool(true));
    let locals = LocalState::new();
    let mut rt = Runtime::new(node, "test", bag.clone(), locals.clone());
    let mut host = StaticHost::new(bag.clone(), locals.clone());
    let screen = screen("/");

    let first = rt.frame(&mut host, &screen).clone();
    let child = find_ty(&first, "we-text").expect("child must mount").id.clone();
    locals.set(&child, "draft", Value::from("half-typed"));

    bag.set_root("open", Value::Bool(false));
    let closed = rt.frame(&mut host, &screen).clone();
    let closed_child = find_ty(&closed, "we-text").expect("closed child stays mounted");
    assert_eq!(closed_child.id, child, "the child's identity survives closing");
    assert_eq!(
        closed_child.transition.as_ref().and_then(|t| t.open),
        Some(false)
    );
    assert!(
        locals.get(&child, "draft").strict_eq(&Value::from("half-typed")),
        "locals survive while closed"
    );

    bag.set_root("open", Value::Bool(true));
    let reopened = rt.frame(&mut host, &screen).clone();
    let reopened_child = find_ty(&reopened, "we-text").expect("child remounts open");
    assert_eq!(reopened_child.id, child);
    assert!(locals
        .get(&child, "draft")
        .strict_eq(&Value::from("half-typed")));
}

#[test]
fn nested_routes_render_layout_ancestors_and_the_leaf() {
    // B4: buildRoutes renders each matched layout with its `$routes` outlet
    // holding the next level — a leaf match alone must not drop the chrome.
    let tmpl: BundleTemplate = serde_json::from_value(json!({
        "id": "t", "meta": {}, "type": "Column",
        "routes": [
            { "path": "/settings",
              "children": [ { "type": "Header" }, { "type": "$routes" } ],
              "routes": [ { "path": "/profile", "children": [ { "type": "ProfileForm" } ] } ] },
            { "path": "/a",
              "children": [ { "type": "AChrome" }, { "type": "$routes" } ],
              "routes": [ { "path": "/detail", "children": [ { "type": "DetailPage" } ] } ] },
            { "path": "/b",
              "children": [ { "type": "BChrome" }, { "type": "$routes" } ],
              "routes": [ { "path": "/detail", "children": [ { "type": "DetailPage" } ] } ] }
        ],
        "children": [{ "type": "$routes" }]
    }))
    .unwrap();

    let (mut rt, mut host, screen) = app_rt(None, Some(tmpl.clone()), "/space/demo/settings/profile");
    let root = rt.frame(&mut host, &screen).clone();
    assert!(
        find_ty(&root, "Header").is_some(),
        "the layout's own chrome must render"
    );
    let leaf = find_ty(&root, "ProfileForm").expect("the leaf route renders");
    assert!(
        leaf.id.as_str().contains("r:settings"),
        "the leaf's identity carries the full matched path: {}",
        leaf.id.as_str()
    );

    // Same leaf name under two layouts → distinct identities, no aliasing.
    let (mut rt, mut host, screen) = app_rt(None, Some(tmpl.clone()), "/space/demo/a/detail");
    let root_a = rt.frame(&mut host, &screen).clone();
    let id_a = find_ty(&root_a, "DetailPage").unwrap().id.clone();
    assert!(find_ty(&root_a, "AChrome").is_some());

    let (mut rt, mut host, screen) = app_rt(None, Some(tmpl), "/space/demo/b/detail");
    let root_b = rt.frame(&mut host, &screen).clone();
    let id_b = find_ty(&root_b, "DetailPage").unwrap().id.clone();
    assert!(find_ty(&root_b, "BChrome").is_some());
    assert_ne!(id_a, id_b, "/a/detail and /b/detail must not share an id");
}

#[test]
fn a_route_relative_navigate_uses_its_own_base_depth() {
    // B4: `routeStore.navigate` from inside a route resolves `..` against
    // the route's depth (`$nav.baseDepth` merged at call time), not the
    // template root — `../wall` from /settings/profile is a sibling route.
    let tmpl: BundleTemplate = serde_json::from_value(json!({
        "id": "t", "meta": {}, "type": "Column",
        "routes": [
            { "path": "/settings",
              "children": [ { "type": "$routes" } ],
              "routes": [ { "path": "/profile", "children": [{
                  "type": "ProfileForm",
                  "props": { "onTap": { "$invoke": "routeStore.navigate", "args": ["../wall"] } }
              }] } ] }
        ],
        "children": [{ "type": "$routes" }]
    }))
    .unwrap();
    let (mut rt, mut host, mut screen) = app_rt(None, Some(tmpl), "/space/demo/settings/profile");
    let root = rt.frame(&mut host, &screen).clone();
    let form = find_ty(&root, "ProfileForm").unwrap().id.clone();
    rt.dispatch(&mut host, &mut screen, &form, "onTap", Value::Null);
    assert_eq!(
        screen.nav.current_path(),
        "/space/demo/settings/wall",
        "../ climbs one route level — not to the template root"
    );
}

#[test]
fn navigate_options_pass_through() {
    // The second arg's `query` and `replace` reach the op, and `$nav` still
    // merges the base — the call TS makes is `(to, options)`.
    let tmpl: BundleTemplate = serde_json::from_value(json!({
        "id": "t", "meta": {}, "type": "Column",
        "routes": [
            { "path": "/home", "children": [{
                "type": "Home",
                "props": { "onTap": { "$invoke": "routeStore.navigate",
                    "args": ["./detail", { "query": { "id": "42" }, "replace": true }] } }
            }] }
        ],
        "children": [{ "type": "$routes" }]
    }))
    .unwrap();
    let (mut rt, mut host, mut screen) = app_rt(None, Some(tmpl), "/space/demo/home");
    let root = rt.frame(&mut host, &screen).clone();
    let home = find_ty(&root, "Home").unwrap().id.clone();
    rt.dispatch(&mut host, &mut screen, &home, "onTap", Value::Null);
    assert_eq!(
        screen.nav.param("id"),
        Some("42"),
        "the options' query must be written for the target"
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
fn a_query_reads_the_same_nodes_local_fields() {
    // B1: a descriptor compiles against the node's effective scope —
    // `local.kind` is a declared name, so `entity: {"$": "local.kind"}`
    // compiles instead of gating forever.
    let node = schema(json!({ "type": "Column",
        "$localState": { "kind": { "type": "string", "initial": "Task" } },
        "$queries": { "q": { "entity": { "$": "local.kind" } } },
        "children": []
    }));
    let (mut rt, mut host, screen) = rig(node, StoreBag::new(), "/");
    rt.frame(&mut host, &screen);
    assert_eq!(
        rt.pool().len(),
        1,
        "the query must compile against same-node locals, not gate"
    );
    let cell = rt.pool().cells().into_iter().next().unwrap();
    assert!(
        cell.key.as_str().contains("Task"),
        "the compiled entity must be the local's value: {}",
        cell.key.as_str()
    );
}

#[test]
fn a_query_reads_a_sibling_query_whichever_order() {
    // B1: `cards` anchors on `first(local.board).gathers`. Declared before
    // `board` on purpose — WE's forward accessors make order irrelevant:
    // first read `[]` (wide), and once `board` lands the anchor narrows.
    let node = schema(json!({ "type": "Column",
        "$queries": {
            "cards": { "entity": "Card", "scope": { "anchorId": { "$": "first(local.board).gathers" } } },
            "board": { "entity": "Board" }
        },
        "children": []
    }));
    let bag = StoreBag::from_snapshot(&json!({
        "stores": {},
        "queries": { "board": [{ "id": "b1", "gathers": "g1" }] },
        "invokes": {}
    }))
    .unwrap();
    let (mut rt, mut host, screen) = rig(node, bag, "/");
    rt.frame(&mut host, &screen); // board fills; cards compiled wide
    rt.frame(&mut host, &screen); // cards re-resolves against board's rows
    let anchored = rt.pool().cells().into_iter().any(|cell| {
        cell.ir
            .scope
            .as_ref()
            .and_then(|s| s.get("anchorId"))
            .is_some_and(|a| a == &json!("g1"))
    });
    assert!(
        anchored,
        "cards must anchor to first(local.board).gathers once board lands: {:?}",
        rt.pool()
            .cells()
            .iter()
            .map(|c| c.key.as_str().to_string())
            .collect::<Vec<_>>()
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
            // `bound` asks a different entity than `scoped` — an un-gated
            // bound would compile to the same empty IR as the widened scope
            // and dedup into its cell, hiding the sabotage in pool.len().
            "bound": { "entity": "B", "limit": { "$": "local.missing" } },
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
        "gated queries add no cells; the widened scope adds exactly one"
    );
}
