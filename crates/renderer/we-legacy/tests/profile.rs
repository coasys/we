//! `$agent` profiles (moved from `we-template/tests/structure.rs`, Lal
//! F1): `profileStore.profiles` is a legacy store, read by the legacy
//! source's `profile()` — core has no profile store read of its own.
use std::sync::Arc;

use serde_json::json;
use we_expr::Value;
use we_legacy::LegacyBindings;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{
    LocalState, ResolvedChild, ResolvedNode, Runtime, SchemaNode, StaticHost, StoreBag,
};

fn schema(v: serde_json::Value) -> SchemaNode {
    serde_json::from_value(v).unwrap()
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
    let bag = Arc::new(bag);
    let mut rt = Runtime::new(node, "test", bag.clone(), LocalState::new());
    let legacy = LegacyBindings::install(rt.layer(), rt.view());
    rt.set_bindings(Arc::new(legacy));
    let mut host = StaticHost::new(bag);
    let screen = ScreenState::desktop(ScreenSchema::default(), "/");
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
