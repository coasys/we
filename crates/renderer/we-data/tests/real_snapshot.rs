//! C2a's recorded Coasys snapshot (`crates/renderer/fixtures/coasys/snapshot.json`,
//! `meta.format: "we-snapshot@2"`): every recorded route resolves the full app
//! root (`Runtime::app`, as `we-app/tests/routes.rs` does) from that route's own
//! state — `OfflineData::from_route`, queries answered by dataset + request — and
//! shows content taken from the recording.
//!
//! The expectations are read from the true recording; the state is read from the
//! document under test. So the gate fails on `{}`, on a document whose routes
//! carry rows for an unused query only, and when one route's state is swapped for
//! another's — each checked below, not assumed.
use std::sync::Arc;

use serde_json::{json, Value as Json};
use we_data::{OfflineData, StoreMap};
use we_screen::{ScreenSchema, ScreenState};
use we_template::{
    AppSpec, Bundle, HandlerToken, LocalState, NoParts, QueryState, ResolvedChild, ResolvedNode,
    Runtime, StaticHost,
};

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));
const SNAPSHOT: &str = include_str!("../../fixtures/coasys/snapshot.json");
const SEED_MAP: &str = include_str!("../data/storemap-offline.json");

/// The ten routes C2a recorded.
const ROUTES: [&str; 10] = [
    "index",
    "workflows",
    "channels",
    "channel-design",
    "calls",
    "call",
    "people",
    "dna",
    "person",
    "about",
];

fn truth() -> Json {
    serde_json::from_str(SNAPSHOT).expect("snapshot parses")
}

/// What a resolved route shows: the text of the whole tree, the text inside the
/// route outlet (nodes under a `/r:<route>` id), the `$todo` stubs, and every
/// `$invoke` target a handler carries.
#[derive(Default)]
struct Shown {
    all: Vec<String>,
    outlet: Vec<String>,
    todo: Vec<String>,
    invokes: Vec<String>,
}

fn collect(node: &ResolvedNode, in_outlet: bool, out: &mut Shown) {
    let in_outlet = in_outlet || node.id.to_string().contains("/r:");
    if node.ty.starts_with("$todo") {
        out.todo.push(node.ty.to_string());
    }
    for handler in node.handlers.values() {
        for token in &handler.tokens {
            if let HandlerToken::Invoke { target, .. } = token {
                out.invokes.push(target.clone());
            }
        }
    }
    let push = |out: &mut Shown, s: &str| {
        out.all.push(s.to_string());
        if in_outlet {
            out.outlet.push(s.to_string());
        }
    };
    for (key, value) in &node.props {
        if let we_expr::Value::Str(s) = value {
            if matches!(
                key.as_ref(),
                "text" | "label" | "title" | "content" | "value"
            ) {
                push(out, s);
            }
        }
    }
    for child in &node.children {
        match child {
            ResolvedChild::Text(t) => push(out, t),
            ResolvedChild::Node(n) => collect(n, in_outlet, out),
        }
    }
}

/// The rows a route recorded for the declaration `name @ scope`.
fn rows<'a>(route: &'a Json, name: &str, scope: &str) -> &'a [Json] {
    route["queries"]
        .as_array()
        .and_then(|qs| qs.iter().find(|q| q["name"] == name && q["scope"] == scope))
        .and_then(|q| q["rows"].as_array())
        .map(Vec::as_slice)
        .unwrap_or_else(|| panic!("the recording has no answered {name} @ {scope}"))
}

fn field(rows: &[Json], key: &str) -> Vec<String> {
    rows.iter()
        .filter_map(|r| r[key].as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

/// What the route must show, read from the TRUE recording: `(in the outlet,
/// anywhere in the tree, invoke targets)`.
fn expected(truth: &Json, id: &str) -> (Vec<String>, Vec<String>, Vec<String>) {
    let route = &truth["routes"][id];
    let members = &route["members"];
    let mut outlet = Vec::new();
    let mut anywhere = Vec::new();
    let mut invokes = Vec::new();
    match id {
        // The landing route is the space's tree: its calls, people and workflows.
        "index" => {
            anywhere.extend(field(
                rows(route, "calls", "template.meta.panels[tree].node"),
                "title",
            ));
            anywhere.extend(field(
                members["spaceStore"]["members"].as_array().unwrap(),
                "name",
            ));
            anywhere.extend(field(
                members["workflowStore"]["workflows"].as_array().unwrap(),
                "label",
            ));
        }
        "workflows" => outlet.extend(field(
            members["workflowStore"]["workflows"].as_array().unwrap(),
            "label",
        )),
        "channels" => outlet.extend(field(
            rows(route, "subChannels", "template.routes[/channels]"),
            "title",
        )),
        "channel-design" => outlet.extend(field(
            rows(route, "channelRecord", "template.routes[/]"),
            "title",
        )),
        "calls" => {
            let calls = rows(route, "calls", "template.routes[/calls]");
            outlet.extend(field(calls, "title"));
            outlet.extend(field(calls, "createdAt"));
        }
        "call" => outlet.extend(field(
            rows(
                route,
                "callRecord",
                "template.meta.recordViews.CollectionBlock:call",
            ),
            "title",
        )),
        "people" => {
            let people = members["spaceStore"]["members"].as_array().unwrap();
            outlet.extend(field(people, "name"));
            outlet.extend(field(people, "handle").into_iter().map(|h| format!("@{h}")));
        }
        "dna" => {
            for name in ["signalTypes", "relationshipTypes", "topics"] {
                let recorded = rows(route, name, "template.routes[/dna]");
                outlet.extend(field(recorded, "name"));
                outlet.extend(field(recorded, "description"));
            }
        }
        "person" => {
            let did = route["params"]["did"].as_str().unwrap();
            let agent = &route["agents"][did];
            outlet.push(agent["bio"].as_str().unwrap().to_string());
            outlet.push(format!("@{}", agent["handle"].as_str().unwrap()));
        }
        // The shell overlay records no members and no queries — what it
        // recorded is the actions its surface declares.
        "about" => invokes.extend(
            route["invokeTargets"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|t| t.as_str())
                .map(str::to_string),
        ),
        other => panic!("no expectation for route {other}"),
    }
    assert!(
        !(outlet.is_empty() && anywhere.is_empty() && invokes.is_empty()),
        "{id}: the recording gave nothing to expect"
    );
    (outlet, anywhere, invokes)
}

/// Resolve route `id` (at the TRUE recording's path) from `doc`'s state and
/// check it against the TRUE recording. `Err` lists what is wrong.
fn check_route(truth: &Json, doc: &Json, id: &str) -> Result<(), String> {
    let map = StoreMap::parse(SEED_MAP).expect("seed parses");
    let data = OfflineData::from_route(doc, id, Some(&map))?;
    let bundle = Bundle::parse(BUNDLE).expect("bundle parses");
    let spec = AppSpec {
        app: bundle.app.clone(),
        template: bundle.templates.as_deref().and_then(|t| t.first()).cloned(),
        pages: bundle.pages.clone().unwrap_or_default(),
        boot: bundle.boot_screen.clone(),
    };
    let locals = LocalState::new();
    let mut runtime = Runtime::app(spec, data.bag.clone(), locals.clone())
        .with_sources(Some(data.source()), Arc::new(NoParts));
    let mut host = StaticHost::new(data.bag.clone(), locals);
    let path = truth["routes"][id]["rust"].as_str().expect("route path");
    let screen = ScreenState::desktop(
        ScreenSchema {
            pages: bundle
                .pages
                .as_deref()
                .unwrap_or_default()
                .iter()
                .map(|p| p.id.clone())
                .collect(),
            ..ScreenSchema::default()
        },
        path,
    );
    let root = runtime.frame(&mut host, &screen).clone();
    let mut shown = Shown::default();
    collect(&root, false, &mut shown);

    let mut wrong = Vec::new();
    if !shown.todo.is_empty() {
        wrong.push(format!("$todo stubs: {:?}", shown.todo));
    }
    // Every query the route mounted was answered by one of its own captures.
    let captures = data.captures().expect("route data carries captures");
    if !captures.missed().is_empty() {
        wrong.push(format!(
            "{} mounted queries no capture of this route answered",
            captures.missed().len()
        ));
    }
    let loading = runtime
        .pool()
        .cells()
        .iter()
        .filter(|c| matches!(c.state(), QueryState::Loading))
        .count();
    if loading > 0 {
        wrong.push(format!("{loading} mounted queries still Loading"));
    }
    let (outlet, anywhere, invokes) = expected(truth, id);
    for text in &outlet {
        if !shown.outlet.contains(text) {
            wrong.push(format!("outlet lacks {text:?}"));
        }
    }
    for text in &anywhere {
        if !shown.all.contains(text) {
            wrong.push(format!("tree lacks {text:?}"));
        }
    }
    for target in &invokes {
        if !shown.invokes.contains(target) {
            wrong.push(format!("no handler invokes {target}"));
        }
    }
    if wrong.is_empty() {
        Ok(())
    } else {
        Err(wrong.join("; "))
    }
}

/// `check_route` on every recorded route — the failures, by route.
fn failures(truth: &Json, doc: &Json) -> Vec<(String, String)> {
    ROUTES
        .iter()
        .filter_map(|id| {
            check_route(truth, doc, id)
                .err()
                .map(|e| (id.to_string(), e))
        })
        .collect()
}

#[test]
fn every_recorded_route_shows_its_recorded_content() {
    let truth = truth();
    assert_eq!(truth["meta"]["format"], "we-snapshot@2");
    let recorded: Vec<&str> = truth["routes"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(recorded, ROUTES, "the routes C2a recorded");
    let failed = failures(&truth, &truth);
    assert!(failed.is_empty(), "routes failing the gate: {failed:#?}");
}

#[test]
fn the_gate_fails_on_an_empty_document() {
    let truth = truth();
    let failed = failures(&truth, &json!({}));
    assert_eq!(failed.len(), ROUTES.len(), "{{}} must fail every route");
}

/// Rows for one unused query plus the chrome (each route keeps its members):
/// every route that mounts a query must fail — its own declarations are no
/// longer answered — and only the overlay, which records none, may pass.
#[test]
fn the_gate_fails_on_rows_for_an_unused_query_only() {
    let truth = truth();
    let mut doc = truth.clone();
    for route in doc["routes"].as_object_mut().unwrap().values_mut() {
        route["queries"] = json!([{
            "name": "unused", "scope": "nowhere", "dataset": "preview-coasys",
            "request": { "entity": "Unused" }, "rows": [{ "id": "x" }]
        }]);
    }
    let failed: Vec<String> = failures(&truth, &doc).into_iter().map(|f| f.0).collect();
    let expect: Vec<&str> = ROUTES.iter().copied().filter(|r| *r != "about").collect();
    assert_eq!(failed, expect);
}

/// One route resolved from another route's state. A swap is caught wherever the
/// two states differ in what the route reads: the route-gated captures (`call`'s
/// callRecord, `channel-design`'s channelRecord) and every space route against
/// the overlay's empty state. The space routes and `person` recorded the same
/// members and captures apart from `routeStore` members the screen owns, so
/// swapping two of them changes nothing to detect — see NOTES-e6.md, Round 3.
#[test]
fn the_gate_fails_when_a_route_state_is_swapped() {
    let truth = truth();
    for (route, other) in [
        ("call", "calls"),
        ("channel-design", "channels"),
        ("index", "about"),
        ("workflows", "about"),
        ("channels", "about"),
        ("calls", "about"),
        ("call", "about"),
        ("people", "about"),
        ("dna", "about"),
        ("person", "about"),
    ] {
        let mut doc = truth.clone();
        doc["routes"][route] = truth["routes"][other].clone();
        let result = check_route(&truth, &doc, route);
        assert!(
            result.is_err(),
            "{route} resolved from {other}'s state passed the gate"
        );
    }
}
