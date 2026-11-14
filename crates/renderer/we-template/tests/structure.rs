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
    let child = find_ty(&first, "we-text")
        .expect("child must mount")
        .id
        .clone();
    locals.set(&child, "draft", Value::from("half-typed"));

    bag.set_root("open", Value::Bool(false));
    let closed = rt.frame(&mut host, &screen).clone();
    let closed_child = find_ty(&closed, "we-text").expect("closed child stays mounted");
    assert_eq!(
        closed_child.id, child,
        "the child's identity survives closing"
    );
    assert_eq!(
        closed_child.transition.as_ref().and_then(|t| t.open),
        Some(false)
    );
    assert!(
        locals
            .get(&child, "draft")
            .strict_eq(&Value::from("half-typed")),
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

    let (mut rt, mut host, screen) =
        app_rt(None, Some(tmpl.clone()), "/space/demo/settings/profile");
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
fn a_nested_route_redirect_propagates_to_a_navigate_op() {
    // R4: a `redirect` on a NESTED route completes the match — and in
    // buildRoutes the `Navigate` mounts as the matched layout's child, so
    // (a) a non-`.` target composes over the parent's full path —
    // `/new-home` under `/app` means `/app/new-home`, not the root — and
    // (b) the layout stays mounted around the empty outlet, so a local
    // inside it survives the frame the redirect fires and the landing.
    // The pre-R4 assertions (`to == "/new-home"`, chrome absent) pinned
    // the opposite of both.
    let tmpl: BundleTemplate = serde_json::from_value(json!({
        "id": "t", "meta": {}, "type": "Column",
        "routes": [
            { "path": "/app",
              "children": [
                  { "type": "AppChrome",
                    "$localState": { "draft": { "type": "string", "initial": "" } } },
                  { "type": "$routes" }
              ],
              "routes": [
                  { "path": "/old", "redirect": "/new-home" },
                  { "path": "/new-home", "children": [ { "type": "Home" } ] },
                  { "path": "/page", "children": [ { "type": "Page" } ] }
              ] },
            { "path": "/landing", "children": [ { "type": "Landing" } ] }
        ],
        "children": [{ "type": "$routes" }]
    }))
    .unwrap();

    let (mut rt, mut host, mut screen) = app_rt(None, Some(tmpl), "/space/demo/app/old");
    let root = rt.frame(&mut host, &screen).clone();
    let ops = rt.take_ops();
    let nav = ops.iter().find_map(|op| match op {
        we_screen::ScreenOp::Navigate { to, replace, .. } => Some((to.clone(), *replace)),
        _ => None,
    });
    assert_eq!(
        nav,
        Some(("/app/new-home".to_string(), true)),
        "a nested redirect composes over the parent's path — ops: {ops:?}"
    );
    let chrome = find_ty(&root, "AppChrome")
        .expect("the matched layout stays mounted while its child redirects");
    assert!(
        find_ty(&root, "Home").is_none(),
        "the outlet the redirect fires in is empty until the navigation lands"
    );
    rt.locals().set(&chrome.id, "draft", Value::from("edited"));
    for op in ops {
        screen.apply(op);
    }
    let root = rt.frame(&mut host, &screen).clone();
    assert_eq!(
        find_ty(&root, "AppChrome").map(|n| n.id.clone()),
        Some(chrome.id.clone()),
        "the layout is still mounted after the redirect lands"
    );
    assert!(
        find_ty(&root, "Home").is_some(),
        "the redirect's target renders in the outlet"
    );
    assert!(
        rt.locals()
            .get(&chrome.id, "draft")
            .strict_eq(&Value::from("edited")),
        "a layout-local edit survives routing between its children"
    );
}

#[test]
fn a_nested_relative_redirect_climbs_from_the_route() {
    // R4: `./`/`../` redirects pass through verbatim — the router resolves
    // them from the matched route's own path (`resolvePath`'s `from`), so
    // `../new-home` on `/app/rel` lands a segment up, at `/app/new-home`.
    let tmpl: BundleTemplate = serde_json::from_value(json!({
        "id": "t", "meta": {}, "type": "Column",
        "routes": [
            { "path": "/app",
              "children": [ { "type": "AppChrome" }, { "type": "$routes" } ],
              "routes": [
                  { "path": "/rel", "redirect": "../new-home" },
                  { "path": "/new-home", "children": [ { "type": "Home" } ] }
              ] }
        ],
        "children": [{ "type": "$routes" }]
    }))
    .unwrap();

    let (mut rt, mut host, mut screen) = app_rt(None, Some(tmpl), "/space/demo/app/rel");
    let root = rt.frame(&mut host, &screen).clone();
    let ops = rt.take_ops();
    let nav = ops.iter().find_map(|op| match op {
        we_screen::ScreenOp::Navigate {
            to,
            base_depth,
            replace,
            ..
        } => Some((to.clone(), *base_depth, *replace)),
        _ => None,
    });
    assert_eq!(
        nav,
        Some(("../new-home".to_string(), Some(4), true)),
        "the op keeps the relative target verbatim, based at the route's \
         own matched depth (`/space/demo/app/rel` — 4) — ops: {ops:?}"
    );
    assert!(
        find_ty(&root, "AppChrome").is_some(),
        "the layout still mounts around a relative redirect"
    );
    for op in ops {
        screen.apply(op);
    }
    assert_eq!(
        screen.nav.current_path(),
        "/space/demo/app/new-home",
        "`../new-home` resolves from the route's own matched path"
    );
    let root = rt.frame(&mut host, &screen).clone();
    assert!(find_ty(&root, "Home").is_some());
    assert!(find_ty(&root, "AppChrome").is_some());
}

#[test]
fn wildcard_and_index_redirects_compose_over_the_parent() {
    // R4: a `*` catch-all and an index (`path: "/"`) child redirect obey
    // the same rule — the target composes over the matched parent's path.
    let tmpl: BundleTemplate = serde_json::from_value(json!({
        "id": "t", "meta": {}, "type": "Column",
        "routes": [
            { "path": "/app",
              "children": [ { "type": "$routes" } ],
              "routes": [
                  { "path": "/", "redirect": "/start" },
                  { "path": "/start", "children": [ { "type": "Start" } ] },
                  { "path": "/gone", "children": [ { "type": "Gone" } ] },
                  { "path": "*", "redirect": "/gone" }
              ] }
        ],
        "children": [{ "type": "$routes" }]
    }))
    .unwrap();

    // Wildcard: an unmatched deep address takes the `*` redirect — nested
    // under `/app`, so `/gone` means `/app/gone`.
    let (mut rt, mut host, mut screen) =
        app_rt(None, Some(tmpl.clone()), "/space/demo/app/anything/deep");
    let _ = rt.frame(&mut host, &screen).clone();
    let ops = rt.take_ops();
    let nav = ops.iter().find_map(|op| match op {
        we_screen::ScreenOp::Navigate { to, .. } => Some(to.clone()),
        _ => None,
    });
    assert_eq!(
        nav,
        Some("/app/gone".to_string()),
        "a wildcard redirect composes over the parent's path — ops: {ops:?}"
    );
    for op in ops {
        screen.apply(op);
    }
    let root = rt.frame(&mut host, &screen).clone();
    assert!(
        find_ty(&root, "Gone").is_some(),
        "the wildcard redirect lands on the nested target"
    );

    // Index child: `/app` with no child segment takes the `/` redirect.
    let (mut rt, mut host, mut screen) = app_rt(None, Some(tmpl), "/space/demo/app");
    let _ = rt.frame(&mut host, &screen).clone();
    let ops = rt.take_ops();
    let nav = ops.iter().find_map(|op| match op {
        we_screen::ScreenOp::Navigate { to, .. } => Some(to.clone()),
        _ => None,
    });
    assert_eq!(
        nav,
        Some("/app/start".to_string()),
        "an index-child redirect composes over the parent's path — ops: {ops:?}"
    );
    for op in ops {
        screen.apply(op);
    }
    let root = rt.frame(&mut host, &screen).clone();
    assert!(
        find_ty(&root, "Start").is_some(),
        "the index redirect lands on the nested target"
    );
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

#[test]
fn two_mounts_of_one_part_have_independent_identities() {
    // B6: the mount's call site belongs in the part root — two instances of
    // `editor` must not share NodeIds or local state.
    struct Parts;
    impl PartSource for Parts {
        fn part(&self, id: &str) -> Option<Arc<SchemaNode>> {
            (id == "editor").then(|| {
                Arc::new(schema(json!({
                    "type": "PartBody",
                    "$localState": { "draft": { "initial": "seed" } },
                    "children": [{ "type": "Text", "props": { "t": { "$": "local.draft" } } }]
                })))
            })
        }
    }
    let node = schema(json!({ "type": "Column", "children": [
        { "type": "$part", "props": { "id": "editor" } },
        { "type": "$part", "props": { "id": "editor" } }
    ]}));
    let locals = LocalState::new();
    let bag = Arc::new(StoreBag::new());
    let mut rt =
        Runtime::new(node, "test", bag.clone(), locals.clone()).with_sources(None, Arc::new(Parts));
    let mut host = StaticHost::new(bag, locals.clone());
    let screen = screen("/");

    let root = rt.frame(&mut host, &screen).clone();
    let mut bodies = Vec::new();
    find_all_ty(&root, "PartBody", &mut bodies);
    assert_eq!(bodies.len(), 2);
    assert_ne!(
        bodies[0].id, bodies[1].id,
        "two mounts of one part must not share a root id"
    );

    // Editing one mount's local must leave the other mount's alone.
    locals.set(&bodies[0].id, "draft", Value::from("A"));
    let root = rt.frame(&mut host, &screen).clone();
    let mut bodies = Vec::new();
    find_all_ty(&root, "PartBody", &mut bodies);
    let read = |b: &ResolvedNode| match &b.children[0] {
        ResolvedChild::Node(t) => t.props.get("t").cloned().unwrap_or(Value::Undefined),
        _ => Value::Undefined,
    };
    assert!(read(bodies[0]).strict_eq(&Value::from("A")));
    assert!(read(bodies[1]).strict_eq(&Value::from("seed")));
}

#[test]
fn surface_keeps_its_node_and_binds_the_measured_box() {
    // B7: `$surface` is a real resolved node whose children read the
    // measured box — `{width, tier}` — under `as` or the default key
    // (SurfaceRenderer + createSurface's initial `{0, "base"}`).
    let node = schema(json!({ "type": "Column", "children": [{
        "type": "$surface",
        "children": [{ "type": "Label", "props": {
            "t": { "$": "surface.tier" },
            "w": { "$": "surface.width" }
        } }, {
            "type": "$surface",
            "props": { "as": "inner" },
            "children": [{ "type": "Tag", "props": { "t": { "$": "inner.tier" } } }]
        }]
    }]}));
    let (mut rt, mut host, mut screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();

    let outer = find_ty(&root, "$surface").expect("the surface node stays in the tree");
    let label = find_ty(&root, "Label").expect("children resolve inside it");
    assert!(label
        .props
        .get("t")
        .is_some_and(|v| v.strict_eq(&Value::from("base"))));
    assert!(label
        .props
        .get("w")
        .is_some_and(|v| v.strict_eq(&Value::from(0.0))));

    // The measured box arrives through the op and the next frame reads it.
    screen.apply(we_screen::ScreenOp::SetSurface {
        id: outer.id.as_str().to_string(),
        width: 840.0,
        tier: "lg".into(),
    });
    let root = rt.frame(&mut host, &screen).clone();
    let label = find_ty(&root, "Label").unwrap();
    assert!(label
        .props
        .get("t")
        .is_some_and(|v| v.strict_eq(&Value::from("lg"))));
    assert!(label
        .props
        .get("w")
        .is_some_and(|v| v.strict_eq(&Value::from(840.0))));

    // `as` names the key — the inner surface binds `inner`.
    let mut surfaces = Vec::new();
    find_all_ty(&root, "$surface", &mut surfaces);
    let inner_id = surfaces[1].id.as_str().to_string();
    screen.apply(we_screen::ScreenOp::SetSurface {
        id: inner_id,
        width: 200.0,
        tier: "sm".into(),
    });
    let root = rt.frame(&mut host, &screen).clone();
    let tag = find_ty(&root, "Tag").unwrap();
    assert!(tag
        .props
        .get("t")
        .is_some_and(|v| v.strict_eq(&Value::from("sm"))));
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
fn inline_query_tokens_flow_through_the_pool() {
    // B11: `{items: {$query: ...}}` on `$each` and `{$query: ...}` as a prop
    // value compile into the pool like a named query — TS's
    // `hasToken($query)` prop path and `$each` branch share it. Two sites
    // asking the same thing share one cell.
    struct Tasks;
    impl we_template::QuerySource for Tasks {
        fn rows(
            &self,
            _key: &we_template::QueryKey,
            _ir: &we_template::QueryIr,
        ) -> we_template::QueryState {
            we_template::QueryState::Rows(Arc::new(vec![
                Value::from_json(&json!({ "id": "t1", "name": "one" })),
                Value::from_json(&json!({ "id": "t2", "name": "two" })),
            ]))
        }
    }
    let node = schema(json!({ "type": "Column", "children": [
        { "type": "$each",
          "props": { "items": { "$query": { "entity": "Task" } } },
          "children": [{ "type": "TaskRow", "props": { "t": { "$": "item.name" } } }] },
        { "type": "List", "props": { "rows": { "$query": { "entity": "Task" } } } }
    ]}));
    let locals = LocalState::new();
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::new(node, "test", bag.clone(), locals.clone())
        .with_sources(Some(Arc::new(Tasks)), Arc::new(we_template::NoParts));
    let mut host = StaticHost::new(bag, locals);
    let screen = screen("/");

    let root = rt.frame(&mut host, &screen).clone();
    let mut rows = Vec::new();
    find_all_ty(&root, "TaskRow", &mut rows);
    assert_eq!(rows.len(), 2, "the $each drew one row per query row");
    let list = find_ty(&root, "List").unwrap();
    let rows_prop = list.props.get("rows").expect("the rows prop resolved");
    match rows_prop {
        Value::List(items) => assert_eq!(items.len(), 2, "the prop is the query's rows"),
        other => panic!("rows prop must be a list, got {other:?}"),
    }
    assert_eq!(
        rt.pool().len(),
        1,
        "the prop and the $each asked the same thing — one cell"
    );
}

#[test]
fn a_deep_query_chain_settles_past_the_round_cap() {
    // F3: five queries in order, each anchored on the next — qN asks
    // `first(local.qN+1).kind`, q5 asks Task. With the Task cell already
    // filled, a fresh resolve's slots climb one level per compile round;
    // a chain deeper than the round count left the last query gated
    // forever, and the runtime cached the partial tree.
    struct Tasks;
    impl we_template::QuerySource for Tasks {
        fn rows(
            &self,
            _key: &we_template::QueryKey,
            _ir: &we_template::QueryIr,
        ) -> we_template::QueryState {
            we_template::QueryState::Rows(Arc::new(vec![Value::from_json(
                &json!({ "kind": "Task" }),
            )]))
        }
    }
    let node = schema(json!({ "type": "Column",
        "$localState": { "kick": { "type": "string", "initial": "a" } },
        "$queries": {
            "q1": { "entity": { "$": "first(local.q2).kind" } },
            "q2": { "entity": { "$": "first(local.q3).kind" } },
            "q3": { "entity": { "$": "first(local.q4).kind" } },
            "q4": { "entity": { "$": "first(local.q5).kind" } },
            "q5": { "entity": "Task" }
        },
        "children": [
            { "type": "we-text", "props": { "text": { "$": "local.q1.length" } } }
        ]
    }));
    let locals = LocalState::new();
    let bag = Arc::new(StoreBag::new());
    let mut rt = Runtime::new(node, "test", bag.clone(), locals.clone())
        .with_sources(Some(Arc::new(Tasks)), Arc::new(we_template::NoParts));
    let mut host = StaticHost::new(bag, locals.clone());
    let screen = screen("/");

    rt.frame(&mut host, &screen); // Task cell fills; the lower chain binds
                                  // A new resolve — same state, fresh slots — must climb the whole
                                  // chain: `local.q1` reads the one Task row, not the gated [].
    let root_id = rt.resolved().unwrap().id.clone();
    locals.set(&root_id, "kick", Value::from("b"));
    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned()
        .unwrap_or(Value::Undefined);
    assert!(
        text.strict_eq(&Value::from(1.0)),
        "q1 must settle to the Task rows — got {text:?}"
    );
}

#[test]
fn a_mutual_query_cycle_settles_as_gated_not_hung() {
    // F3's other half: a dependency cycle must not spin. `qa` reads `qb`,
    // `qb` reads `qa` — each sees the other's `[]` and gates, the same
    // answer TS's forward accessors give.
    let node = schema(json!({ "type": "Column",
        "$queries": {
            "qa": { "entity": { "$": "first(local.qb).kind" } },
            "qb": { "entity": { "$": "first(local.qa).kind" } }
        },
        "children": [
            { "type": "we-text", "props": { "text": { "$": "local.qa.length" } } }
        ]
    }));
    let (mut rt, mut host, screen) = rig(node, StoreBag::new(), "/");
    let root = rt.frame(&mut host, &screen).clone();
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned()
        .unwrap_or(Value::Undefined);
    assert!(
        text.strict_eq(&Value::from(0.0)),
        "a mutual cycle gates to [] like TS's forward reads — got {text:?}"
    );
    assert!(rt.pool().is_empty(), "gated queries never reach the pool");
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
