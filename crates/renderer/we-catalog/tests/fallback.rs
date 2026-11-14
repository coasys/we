//! The role text fallbacks: video → link, colour picker → token list,
//! rich text → its plain text, input → its value.
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_template::{NodeId, ResolvedNode};

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

#[test]
fn video_falls_back_to_a_link() {
    let n = node("we-video", &[("src", Value::from("https://x/v.mp4"))]);
    let e = we_catalog::entry("we-video").unwrap();
    assert_eq!(we_catalog::text_fallback(e, &n), "video: https://x/v.mp4");
}

#[test]
fn colour_picker_lists_tokens() {
    let n = node(
        "we-color-picker",
        &[(
            "tokens",
            Value::List(Arc::new(vec![
                Value::from("surface"),
                Value::from("accent"),
            ])),
        )],
    );
    let e = we_catalog::entry("we-color-picker").unwrap();
    assert_eq!(we_catalog::text_fallback(e, &n), "colours: surface, accent");
}

#[test]
fn rich_text_gives_its_plain_text() {
    let n = node("we-text", &[("text", Value::from("hello world"))]);
    let e = we_catalog::entry("we-text").unwrap();
    assert_eq!(we_catalog::text_fallback(e, &n), "hello world");
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
    let e = we_catalog::entry("we-input").unwrap();
    assert_eq!(we_catalog::text_fallback(e, &n), "typed text");
}
