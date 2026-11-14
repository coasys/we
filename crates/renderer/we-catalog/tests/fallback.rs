//! The role text fallbacks: video → link, colour picker → token list,
//! rich text → its plain text, input → its value.
use std::sync::Arc;

use indexmap::IndexMap;
use we_catalog::{ControlState, Semantics};
use we_expr::Value;
use we_template::{NodeId, ResolvedChild, ResolvedNode};

fn node(ty: &str, props: &[(&str, Value)]) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from("n"),
        ty: Arc::from(ty),
        props: props
            .iter()
            .map(|(k, v)| (Arc::from(*k), v.clone()))
            .collect::<IndexMap<Arc<str>, Value>>(),
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        transition: None,
    }
}

fn obj(fields: &[(&str, Value)]) -> Value {
    Value::Obj(Arc::new(
        fields
            .iter()
            .map(|(k, v)| (Arc::from(*k), v.clone()))
            .collect::<IndexMap<Arc<str>, Value>>(),
    ))
}

fn list(items: Vec<Value>) -> Value {
    Value::List(Arc::new(items))
}

fn fallback(n: &ResolvedNode) -> String {
    we_catalog::text_fallback(n)
}

#[test]
fn video_falls_back_to_a_link() {
    let n = node("we-video", &[("src", Value::from("https://x/v.mp4"))]);
    assert_eq!(fallback(&n), "video: https://x/v.mp4");
}

#[test]
fn colour_picker_lists_tokens() {
    let n = node(
        "we-color-picker",
        &[(
            "tokens",
            list(vec![Value::from("surface"), Value::from("accent")]),
        )],
    );
    assert_eq!(fallback(&n), "colours: surface, accent");
}

#[test]
fn rich_text_gives_its_plain_text() {
    let n = node("we-text", &[("text", Value::from("hello world"))]);
    assert_eq!(fallback(&n), "hello world");
}

#[test]
fn input_gives_its_value() {
    let n = node(
        "we-input",
        &[
            ("value", Value::from("typed text")),
            ("placeholder", Value::from("ph")),
        ],
    );
    assert_eq!(fallback(&n), "typed text");
}

// --- S5: actual control state and structured content ---

#[test]
fn switch_reports_checked_state() {
    let on = node(
        "we-switch",
        &[
            ("label", Value::from("Mute")),
            ("checked", Value::Bool(true)),
        ],
    );
    let off = node(
        "we-switch",
        &[
            ("label", Value::from("Mute")),
            ("checked", Value::Bool(false)),
        ],
    );
    assert_eq!(fallback(&on), "Mute: on");
    assert_eq!(fallback(&off), "Mute: off");
    // The typed state is in the descriptor, not just the string.
    let Semantics { state, .. } = we_catalog::describe(&on);
    assert_eq!(state, Some(ControlState::Flag(true)));
}

#[test]
fn slider_and_number_input_emit_numeric_values() {
    let s = node(
        "we-slider",
        &[
            ("label", Value::from("Volume")),
            ("value", Value::Num(7.0)),
            ("min", Value::Num(0.0)),
            ("max", Value::Num(100.0)),
        ],
    );
    assert_eq!(fallback(&s), "Volume: 7");
    assert_eq!(
        we_catalog::describe(&s).state,
        Some(ControlState::Number(7.0))
    );

    let n = node(
        "we-number-input",
        &[
            ("label", Value::from("Port")),
            ("value", Value::Num(8080.0)),
        ],
    );
    assert_eq!(fallback(&n), "Port: 8080");
}

#[test]
fn select_shows_the_chosen_option_label() {
    let n = node(
        "we-select",
        &[
            ("label", Value::from("Fruit")),
            (
                "options",
                list(vec![
                    obj(&[("value", Value::from("a")), ("label", Value::from("Apple"))]),
                    obj(&[
                        ("value", Value::from("b")),
                        ("label", Value::from("Banana")),
                    ]),
                ]),
            ),
            ("value", Value::from("b")),
        ],
    );
    assert_eq!(fallback(&n), "Fruit: Banana");
}

#[test]
fn block_composer_flattens_its_document() {
    let n = node(
        "BlockComposer",
        &[(
            "blocks",
            list(vec![
                obj(&[
                    ("_type", Value::from("block")),
                    ("text", Value::from("Hello world")),
                    (
                        "marks",
                        list(vec![obj(&[
                            ("type", Value::from("strong")),
                            ("start", Value::Num(0.0)),
                            ("end", Value::Num(5.0)),
                        ])]),
                    ),
                ]),
                obj(&[
                    ("_type", Value::from("block")),
                    (
                        "children",
                        list(vec![
                            obj(&[
                                ("_type", Value::from("span")),
                                ("text", Value::from("Second ")),
                            ]),
                            obj(&[
                                ("_type", Value::from("span")),
                                ("text", Value::from("para")),
                                ("marks", list(vec![Value::from("em")])),
                            ]),
                        ]),
                    ),
                ]),
                // A real nested collection — the fixture verbatim from
                // converter.test.ts ("nests a collection as a node with
                // children"). Canonical shape: `content`, not `children`.
                obj(&[
                    ("_type", Value::from("collection")),
                    ("_key", Value::from("c")),
                    ("layout", Value::from("row")),
                    ("columnCount", Value::Num(3.0)),
                    (
                        "content",
                        list(vec![
                            obj(&[
                                ("_type", Value::from("block")),
                                ("_key", Value::from("x")),
                                ("style", Value::from("normal")),
                                ("text", Value::from("inside")),
                            ]),
                            obj(&[
                                ("_type", Value::from("image")),
                                ("_key", Value::from("y")),
                                ("src", Value::from("z")),
                            ]),
                        ]),
                    ),
                ]),
                obj(&[
                    ("_type", Value::from("image")),
                    ("alt", Value::from("a diagram")),
                ]),
            ]),
        )],
    );
    assert_eq!(
        fallback(&n),
        "Hello world\nSecond para\n  inside\n  [image]\n[image] a diagram"
    );
}

#[test]
fn block_composer_reads_a_document_wrapper() {
    // The prop the composer actually reads is `editorState`
    // (types.ts:22-24), and a `ContentDocument` wrapper —
    // `{_type:'document', blocks:[…]}` — is what `onSave` hands back
    // (content.ts:74-77); `decodeEditorState` accepts it (utils.ts:62).
    let n = node(
        "BlockComposer",
        &[(
            "editorState",
            obj(&[
                ("_type", Value::from("document")),
                (
                    "blocks",
                    list(vec![
                        obj(&[
                            ("_type", Value::from("block")),
                            ("text", Value::from("Doc body")),
                        ]),
                        obj(&[
                            ("_type", Value::from("collection")),
                            (
                                "content",
                                list(vec![obj(&[
                                    ("_type", Value::from("block")),
                                    ("text", Value::from("deep")),
                                ])]),
                            ),
                        ]),
                    ]),
                ),
            ]),
        )],
    );
    assert_eq!(fallback(&n), "Doc body\n  deep");
}

#[test]
fn block_composer_decodes_a_stored_editor_state() {
    // What a resolved file field actually reads as: the Portable Text
    // projection under a `data:…;base64` URI (the decodeEditorState
    // string form — utils.ts:41-55). This URI was produced by the real
    // `toPortableText` (content.ts) over
    //   [block "Stored post",
    //    collection{content: [block "archived words"]}]
    // — spans and a nested canonical collection.
    let n = node(
        "BlockComposer",
        &[(
            "editorState",
            Value::from(
                "data:application/json;base64,W3siX3R5cGUiOiJibG9jayIsInRleHQiOiJTdG9yZWQgcG9zdCIsIl9rZXkiOiJiMSIsInN0eWxlIjoibm9ybWFsIiwiY2hpbGRyZW4iOlt7Il90eXBlIjoic3BhbiIsIl9rZXkiOiJzMSIsInRleHQiOiJTdG9yZWQgcG9zdCIsIm1hcmtzIjpbXX1dLCJtYXJrRGVmcyI6W119LHsiX3R5cGUiOiJjb2xsZWN0aW9uIiwiX2tleSI6ImsiLCJsYXlvdXQiOiJncmlkIiwiY29udGVudCI6W3siX3R5cGUiOiJibG9jayIsInRleHQiOiJhcmNoaXZlZCB3b3JkcyIsIl9rZXkiOiJiMSIsInN0eWxlIjoibm9ybWFsIiwiY2hpbGRyZW4iOlt7Il90eXBlIjoic3BhbiIsIl9rZXkiOiJzMSIsInRleHQiOiJhcmNoaXZlZCB3b3JkcyIsIm1hcmtzIjpbXX1dLCJtYXJrRGVmcyI6W119XX1d",
            ),
        )],
    );
    assert_eq!(fallback(&n), "Stored post\n  archived words");
}

#[test]
fn graph_outlines_named_nodes_and_edges() {
    let n = node(
        "GraphView",
        &[
            (
                "nodes",
                list(vec![
                    obj(&[
                        ("id", Value::from("a")),
                        ("type", Value::from("step")),
                        ("label", Value::from("Draft")),
                    ]),
                    obj(&[
                        ("id", Value::from("b")),
                        ("type", Value::from("step")),
                        ("label", Value::from("Review")),
                    ]),
                    obj(&[
                        ("id", Value::from("c")),
                        ("type", Value::from("step")),
                        ("label", Value::from("Publish")),
                    ]),
                ]),
            ),
            (
                "edges",
                list(vec![
                    obj(&[
                        ("id", Value::from("a-b")),
                        ("source", Value::from("a")),
                        ("target", Value::from("b")),
                        ("type", Value::from("next")),
                    ]),
                    obj(&[
                        ("id", Value::from("b-c")),
                        ("source", Value::from("b")),
                        ("target", Value::from("c")),
                        ("type", Value::from("next")),
                    ]),
                ]),
            ),
        ],
    );
    assert_eq!(
        fallback(&n),
        "3 nodes\n  Draft\n  Review\n  Publish\n2 edges\n  Draft → Review (next)\n  Review → Publish (next)"
    );
}

#[test]
fn graph_reads_a_literal_seed() {
    // The TS widget's `seeds: { literal: true, nodes, edges }` shape.
    let n = node(
        "GraphView",
        &[(
            "seeds",
            obj(&[
                ("literal", Value::Bool(true)),
                (
                    "nodes",
                    list(vec![obj(&[
                        ("id", Value::from("a")),
                        ("label", Value::from("Only")),
                    ])]),
                ),
                ("edges", list(vec![])),
            ]),
        )],
    );
    assert_eq!(fallback(&n), "1 nodes\n  Only");
}

#[test]
fn select_falls_back_to_placeholder_when_nothing_matches() {
    let n = node(
        "we-select",
        &[
            (
                "options",
                list(vec![obj(&[
                    ("value", Value::from("a")),
                    ("label", Value::from("Apple")),
                ])]),
            ),
            ("value", Value::from("b")),
            ("placeholder", Value::from("pick one")),
        ],
    );
    assert_eq!(fallback(&n), "pick one");
}

#[test]
fn tree_item_reports_expanded_state() {
    let n = node(
        "we-tree-item",
        &[
            ("label", Value::from("Channels")),
            ("open", Value::Bool(true)),
        ],
    );
    assert_eq!(fallback(&n), "Channels: expanded");
    let closed = node(
        "we-tree-item",
        &[
            ("label", Value::from("Channels")),
            ("open", Value::Bool(false)),
        ],
    );
    assert_eq!(fallback(&closed), "Channels: collapsed");
}

#[test]
fn unknown_type_still_describes_itself() {
    // No catalog entry — the generic descriptor keeps the label/value
    // content; the caller still prints the `ty` marker itself.
    let n = node("we-widget-9000", &[("label", Value::from("Strange fruit"))]);
    let sem = we_catalog::describe(&n);
    assert_eq!(sem.name.as_deref(), Some("Strange fruit"));
    assert_eq!(fallback(&n), "Strange fruit");

    // A bare `value` announces too (any JSON type, not just strings).
    let n = node("we-mystery", &[("value", Value::Num(42.0))]);
    assert_eq!(fallback(&n), "42");
}

#[test]
fn containers_announce_only_their_name() {
    // Traversal is the frontend's: a Column does not swallow its children
    // into a flat string — its own announcement is its name (none here).
    let mut n = node("Column", &[]);
    n.children = vec![
        ResolvedChild::Text("orphan text".into()),
        ResolvedChild::Node(Box::new(node("we-text", &[("text", Value::from("child"))]))),
    ];
    assert_eq!(fallback(&n), "");

    // A Card announces its title — children still belong to the traversal.
    let mut c = node("Card", &[("title", Value::from("Details"))]);
    c.children = vec![ResolvedChild::Text("body".into())];
    assert_eq!(fallback(&c), "Details");
}
