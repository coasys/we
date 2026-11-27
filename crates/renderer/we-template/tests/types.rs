//! Schema-node, handler-token and normal-form behaviour.
use indexmap::IndexMap;
use serde_json::json;
use std::sync::Arc;
use we_expr::Value;
use we_template::{
    normal_form, HandlerRef, HandlerToken, NodeId, ResolvedChild, ResolvedNode, SchemaChild,
    SchemaNode, Scope,
};

#[test]
fn a_node_keeps_undeclared_keys() {
    // The `extra` catch-all is load-bearing: a node carrying a key this build
    // does not name must come back out with it. Removing `#[serde(flatten)]`
    // turns this red.
    let node: SchemaNode = serde_json::from_value(json!({
        "type": "Column",
        "props": {"gap": "300"},
        "x-future-key": {"nested": [1, 2]}
    }))
    .unwrap();
    let back = serde_json::to_value(&node).unwrap();
    assert_eq!(
        back,
        json!({"type": "Column", "props": {"gap": "300"}, "x-future-key": {"nested": [1, 2]}})
    );
}

#[test]
fn expression_token_children() {
    // `{ "$": "…" }` in a children list is an expression token, read back out
    // through `extra` byte-for-byte.
    let node: SchemaNode = serde_json::from_value(json!({
        "type": "we-text",
        "children": ["plain ", {"$": "local.name"}, {"type": "we-icon", "props": {"name": "x"}}]
    }))
    .unwrap();
    let children = node.children.as_ref().unwrap();
    assert!(matches!(&children[0], SchemaChild::Text(t) if t == "plain "));
    let SchemaChild::Node(token) = &children[1] else {
        panic!("expected a node");
    };
    assert_eq!(token.expression_token(), Some("local.name"));
    let SchemaChild::Node(icon) = &children[2] else {
        panic!("expected a node");
    };
    assert_eq!(icon.ty.as_deref(), Some("we-icon"));
    assert_eq!(icon.expression_token(), None);
    assert_eq!(
        serde_json::to_value(&node).unwrap(),
        json!({"type": "we-text", "children": ["plain ", {"$": "local.name"}, {"type": "we-icon", "props": {"name": "x"}}]})
    );
}

#[test]
fn handler_tokens_round_trip() {
    let cases = [
        json!({"$invoke": "spaceStore.create", "args": [{"$": "local.name"}], "onSuccess": [{"$setLocal": "ok", "value": true}], "onFinally": [{"$touch": "form"}]}),
        json!({"$setLocal": "expanded", "value": true}),
        json!({"$setLocal": "form", "merge": {"name": {"$": "event.name"}}}),
        json!({"$toggleLocal": "open"}),
        json!({"$toggleLocalIn": "openRows", "value": {"$": "row.id"}}),
        json!({"$callLocal": "save"}),
        json!({"$touch": "email"}),
        json!({"$resetLocal": "form"}),
        json!({"$if": {"condition": {"$": "local.ok"}, "then": [{"$invoke": "a"}], "else": {"$setLocal": "e", "value": 1}}}),
        // a verb this build does not know is still data
        json!({"$futureVerb": {"a": 1}}),
    ];
    for case in cases {
        let token = HandlerToken::from_json(case.clone());
        assert_eq!(token.to_json(), case, "token lost a field");
        // and through the serde impls
        let via_serde: HandlerToken = serde_json::from_value(case.clone()).unwrap();
        assert_eq!(serde_json::to_value(&via_serde).unwrap(), case);
    }
    let token = HandlerToken::from_json(json!({"$invoke": "x", "args": [1]}));
    match token {
        HandlerToken::Invoke { target, args, .. } => {
            assert_eq!(target, "x");
            assert_eq!(args.unwrap(), json!([1]));
        }
        other => panic!("expected Invoke, got {other:?}"),
    }
}

#[test]
fn normal_form_writes_the_spec_shape() {
    // `{ type, props, on, children }` — `Undefined` and callable props dropped,
    // `on` sorted, `id`/`slot`/`transition` absent.
    let mut props = IndexMap::new();
    props.insert(Arc::from("label"), Value::from("Save"));
    props.insert(Arc::from("missing"), Value::Undefined);
    props.insert(
        Arc::from("cb"),
        Value::from(we_expr::CallableRef::named("save")),
    );
    let mut handlers = IndexMap::new();
    handlers.insert(
        Arc::from("onClick"),
        HandlerRef {
            tokens: vec![HandlerToken::from_json(json!({"$invoke": "s.m"}))],
            scope: Scope::default(),
        },
    );
    handlers.insert(
        Arc::from("onBlur"),
        HandlerRef {
            tokens: vec![],
            scope: Scope::default(),
        },
    );
    let node = ResolvedNode {
        id: NodeId::from("root/0"),
        ty: "we-button".into(),
        props,
        handlers,
        slot: Some("top".into()),
        children: vec![
            ResolvedChild::Text("hello".into()),
            ResolvedChild::Node(Box::new(ResolvedNode {
                id: NodeId::from("root/0/0"),
                ty: "we-icon".into(),
                props: IndexMap::new(),
                handlers: IndexMap::new(),
                slot: None,
                children: vec![],
                transition: None,
            })),
        ],
        transition: None,
    };
    assert_eq!(
        normal_form(&node),
        json!({
            "type": "we-button",
            "props": {"label": "Save"},
            "on": ["onBlur", "onClick"],
            "children": [{"text": "hello"}, {"type": "we-icon"}]
        })
    );
}
