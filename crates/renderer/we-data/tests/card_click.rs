//! B4: a record card on a list page opens its record in the inspector the
//! way the tree row does. The click writes `cardType` and `card` into the
//! address, and the inspector reads both; `cardType` written as the text of
//! an expression (`"{ signal: 'SignalType' }['signal']"`) names no entity, so
//! the inspector found nothing and said so.
//!
//! Every `routeStore.setParam("cardType", …)` a recorded route's tree
//! carries must pass an expression or a plain entity name.
use std::sync::Arc;

use serde_json::Value as Json;
use we_data::{OfflineData, StoreMap};
use we_screen::{ScreenSchema, ScreenState};
use we_template::{
    AppSpec, Bundle, HandlerToken, LocalState, NoParts, ResolvedChild, ResolvedNode, Runtime,
    StaticHost,
};

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));
const SNAPSHOT: &str = include_str!("../../fixtures/coasys/snapshot.json");
const SEED_MAP: &str = include_str!("../data/storemap-offline.json");

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

/// Every `cardType` argument a handler in the tree carries.
fn card_types(node: &ResolvedNode, out: &mut Vec<Json>) {
    for handler in node.handlers.values() {
        collect(&handler.tokens, out);
    }
    for child in &node.children {
        if let ResolvedChild::Node(n) = child {
            card_types(n, out);
        }
    }
}

fn collect(tokens: &[HandlerToken], out: &mut Vec<Json>) {
    for token in tokens {
        match token {
            HandlerToken::Invoke { target, args, .. } if target == "routeStore.setParam" => {
                if let Some([name, value]) =
                    args.as_ref().and_then(|a| a.as_array()).map(Vec::as_slice)
                {
                    if name == "cardType" {
                        out.push(value.clone());
                    }
                }
            }
            _ => {}
        }
    }
}

/// The handlers of the page body, resolved from the route's recorded state.
fn card_types_on(truth: &Json, id: &str) -> Vec<Json> {
    let map = StoreMap::parse(SEED_MAP).expect("seed parses");
    let data = OfflineData::from_route(truth, id, Some(&map)).expect("route loads");
    let bundle = Bundle::parse(BUNDLE).expect("bundle parses");
    let spec = AppSpec {
        bundle: bundle.name.clone().into(),
        app: bundle.app.clone(),
        template: bundle.templates.as_deref().and_then(|t| t.first()).cloned(),
        pages: bundle.pages.clone().unwrap_or_default(),
        boot: bundle.boot_screen.clone(),
    };
    let mut runtime = Runtime::app(spec, data.bag.clone(), LocalState::new())
        .with_sources(Some(data.source()), Arc::new(NoParts));
    let bindings = we_legacy::LegacyBindings::install(runtime.layer(), runtime.view());
    runtime.set_bindings(Arc::new(bindings));
    let mut host = StaticHost::new(data.bag.clone());
    let path = truth["routes"][id]["rust"].as_str().expect("route path");
    let screen = ScreenState::desktop(ScreenSchema::default(), path);
    let root = runtime.frame(&mut host, &screen).clone();
    let mut out = Vec::new();
    card_types(&root, &mut out);
    out
}

/// A name an entity goes by: what a literal `cardType` may be.
fn is_entity_name(s: &str) -> bool {
    s.chars().next().is_some_and(|c| c.is_ascii_uppercase())
        && s.chars().all(|c| c.is_ascii_alphanumeric())
}

#[test]
fn a_card_names_its_record_type_as_an_expression_or_an_entity() {
    let truth: Json = serde_json::from_str(SNAPSHOT).unwrap();
    let mut seen = 0;
    let mut bad = Vec::new();
    for id in ROUTES {
        for value in card_types_on(&truth, id) {
            seen += 1;
            match &value {
                Json::String(s) if !is_entity_name(s) => bad.push((id, s.clone())),
                Json::String(_) | Json::Object(_) => {}
                other => bad.push((id, other.to_string())),
            }
        }
    }
    assert!(
        seen > 0,
        "no card handler was found: the test looks at nothing"
    );
    assert!(bad.is_empty(), "cardType written as text: {bad:#?}");
}
