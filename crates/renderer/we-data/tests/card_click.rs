//! B4: a record card on a list page opens its record in the inspector the
//! way the tree row does. The click writes `cardType` and `card` into the
//! address, and the inspector reads both; `cardType` written as the text of
//! an expression (`"{ signal: 'SignalType' }['signal']"`) names no entity, so
//! the inspector found nothing and said so.
//!
//! The test clicks every definition card on the Social DNA page — all five
//! kinds — and reads the address and the inspector's own read afterwards.
use std::sync::Arc;

use serde_json::Value as Json;
use we_data::{OfflineData, StoreMap};
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{
    AppSpec, Bundle, HandlerToken, LocalState, NoParts, NodeId, ResolvedChild, ResolvedNode,
    Runtime, StaticHost,
};

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));
const SNAPSHOT: &str = include_str!("../../fixtures/coasys/snapshot.json");
const SEED_MAP: &str = include_str!("../data/storemap-offline.json");

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

fn session_on(truth: &Json, id: &str) -> Session {
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
    let path = truth["routes"][id]["rust"].as_str().expect("route path");
    let screen = ScreenState::desktop(ScreenSchema::default(), path);
    Session::from_parts(runtime, Box::new(StaticHost::new(data.bag.clone())), screen)
}

/// The nodes whose click writes a `cardType`, in tree order.
fn card_buttons(node: &ResolvedNode, out: &mut Vec<NodeId>) {
    let writes_card_type = node.handlers.get("onClick").is_some_and(|h| {
        let mut types = Vec::new();
        collect(&h.tokens, &mut types);
        !types.is_empty()
    });
    if writes_card_type {
        out.push(node.id.clone());
    }
    for child in &node.children {
        if let ResolvedChild::Node(n) = child {
            card_buttons(n, out);
        }
    }
}

/// The record type each kind of Social DNA definition is.
const DNA_ENTITIES: [(&str, &str); 5] = [
    ("signal", "SignalType"),
    ("connection", "RelationshipType"),
    ("state", "TaskState"),
    ("involvement", "InvolvementType"),
    ("topic", "Topic"),
];

/// Click every definition card on the Social DNA page and read what the
/// address says afterwards: its kind's record type and its own id — and the
/// inspector, which reads those two, asks for exactly that record.
#[test]
fn a_dna_card_opens_its_record_in_the_inspector() {
    let truth: Json = serde_json::from_str(SNAPSHOT).unwrap();
    let mut first = session_on(&truth, "dna");
    let root = first.resolve();
    let mut buttons = Vec::new();
    card_buttons(&root, &mut buttons);

    let mut opened: Vec<(String, String, String)> = Vec::new();
    for button in &buttons {
        let mut s = session_on(&truth, "dna");
        s.resolve();
        s.dispatch(button, "onClick", we_expr::Value::Undefined);
        let _ = s.resolve();
        let _ = s.resolve();
        let nav = &s.screen().nav;
        let (Some(dna), Some(card_type), Some(card)) =
            (nav.param("dna"), nav.param("cardType"), nav.param("card"))
        else {
            continue;
        };
        let (kind, id) = dna.split_once('|').unwrap_or((dna, ""));
        assert_eq!(card, id, "the card names its own record ({dna})");
        // The inspector asks the backend for that one record.
        let asked = s.runtime().hub().cells().into_iter().any(|c| {
            c.request.classes.iter().any(|e| e.as_ref() == card_type)
                && c.request
                    .ir
                    .where_
                    .as_ref()
                    .is_some_and(|w| w.to_string().contains(card))
        });
        assert!(
            asked,
            "the inspector asks for {card_type} {card}; it asked for {:?}",
            s.runtime()
                .hub()
                .cells()
                .iter()
                .map(|c| (c.request.classes.clone(), c.request.ir.where_.clone()))
                .collect::<Vec<_>>()
        );
        opened.push((kind.to_string(), card_type.to_string(), card.to_string()));
    }

    for (kind, entity) in DNA_ENTITIES {
        let of_kind: Vec<_> = opened.iter().filter(|(k, _, _)| k == kind).collect();
        assert!(!of_kind.is_empty(), "no {kind} card opened a record");
        for (_, card_type, _) in of_kind {
            assert_eq!(card_type, entity, "a {kind} card opens a {entity}");
        }
    }
}
