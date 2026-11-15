//! E3c-4: the real Coasys snapshot source answers a named `$queries` site
//! and an inline `$each.items` site in the first frame — `commit → drain`
//! inside the pass loop — and a dependent query stranded provisional while
//! its sibling loaded is sent narrow once the rows land, never wide.
//!
//! The source is the route's own [`RouteQuerySource`](we_data::RouteQuerySource):
//! captures answer by request identity, so an anonymous inline claim (no
//! `name_hint`) is answered exactly as a named one.

use std::sync::Arc;

use serde_json::json;
use we_data::OfflineData;
use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{
    LocalState, ResolvedChild, ResolvedNode, Runtime, SchemaNode, StaticHost,
};

const SNAPSHOT: &str = include_str!("../../fixtures/coasys/snapshot.json");

fn schema(v: serde_json::Value) -> SchemaNode {
    serde_json::from_value(v).unwrap()
}

fn screen(href: &str) -> ScreenState {
    ScreenState::desktop(ScreenSchema::default(), href)
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

fn find_all_ty(node: &ResolvedNode, ty: &str, out: &mut Vec<ResolvedNode>) {
    if node.ty.as_ref() == ty {
        out.push(node.clone());
    }
    for c in &node.children {
        if let ResolvedChild::Node(n) = c {
            find_all_ty(n, ty, out);
        }
    }
}

#[test]
fn coasys_named_and_inline_queries_settle_in_one_frame() {
    let data = OfflineData::from_route(
        &serde_json::from_str(SNAPSHOT).unwrap(),
        "index",
        None,
    )
    .expect("the index route loads");
    // The index route's captures, verbatim: `calls` is the tree's 12-row
    // page, the bare `SignalType` request is the inspector's capture, and
    // `callDetail` reads `first(local.calls).id` — provisional until the
    // calls rows land, narrow after.
    let node = schema(json!({ "type": "Column",
        "$queries": {
            "calls": { "entity": "CollectionBlock", "limit": 12,
                       "order": { "createdAt": "desc" }, "where": { "kind": "call" } },
            "callDetail": { "entity": "CollectionBlock", "limit": 1,
                       "where": { "id": { "$": "first(local.calls).id" } } }
        },
        "children": [
            { "type": "we-text",
              "props": { "text": { "$": "local.callsLoaded" } } },
            { "type": "$each",
              "props": { "items": { "$query": { "entity": "SignalType" } }, "as": "sig" },
              "children": [{ "type": "SigRow",
                             "props": { "n": { "$": "item.name" } } }] }
        ]
    }));
    let bag = data.bag.clone();
    let mut rt = Runtime::new(node, "test", bag.clone(), LocalState::new())
        .with_sources(Some(data.source()), Arc::new(we_template::NoParts));
    let mut host = StaticHost::new(bag);
    let screen = screen("/");

    let root = rt.frame(&mut host, &screen).clone();

    // One frame: the named site settled on its capture.
    let text = find_ty(&root, "we-text")
        .and_then(|n| n.props.get("text"))
        .cloned();
    assert!(
        matches!(&text, Some(v) if v.strict_eq(&Value::Bool(true))),
        "callsLoaded is true after the first frame: {text:?}"
    );
    // …and so did the inline $each.items site — three captured signal
    // types drew three rows.
    let mut rows = Vec::new();
    find_all_ty(&root, "SigRow", &mut rows);
    assert_eq!(rows.len(), 3, "the inline claim drew the captured rows");

    // The dependent query never sent its wide shape: a held
    // `limit: 1` CollectionBlock request must carry the `id` filter the
    // rows produced (or it never opened — provisional stays unclaimed).
    let mut wide = Vec::new();
    for cell in rt.hub().cells() {
        let ir = cell.request.ir_json();
        let limit_one = ir.get("limit") == Some(&json!(1));
        let has_id = ir
            .get("where")
            .and_then(|w| w.get("id"))
            .is_some_and(|id| !id.is_null());
        if cell
            .request
            .classes
            .iter()
            .any(|c| c.as_ref() == "CollectionBlock")
            && limit_one
            && !has_id
        {
            wide.push(cell.key.as_str().to_string());
        }
    }
    assert!(wide.is_empty(), "no wide dependent request was opened: {wide:?}");
    assert_eq!(rt.stats().resolves, 1, "one frame, one resolve");
}
