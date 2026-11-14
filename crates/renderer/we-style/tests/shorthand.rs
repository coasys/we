//! Shorthand atomicity: a guaranteed-invalid `var()` in one slot invalidates
//! the *whole* declaration at computed-value time — `{"r":"card","rtl":"400"}`
//! gives the browser no radius at all, not `8px` on the one valid corner.

use std::path::PathBuf;
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_style::{resolve, Bag, Dimension, Direction, StyleInput, TokenTable};

fn tokens() -> TokenTable {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/schema-system/conformance/vectors/tokens/light.json");
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    TokenTable::from_json(&json).unwrap()
}

fn bag(props: &[(&str, Value)]) -> Bag {
    props
        .iter()
        .map(|(k, v)| (Arc::from(*k), v.clone()))
        .collect::<IndexMap<Arc<str>, Value>>()
}

fn s(v: &str) -> Value {
    Value::Str(Arc::from(v))
}

#[test]
fn missing_var_invalidates_whole_shorthand() {
    let tokens = tokens();
    let input = StyleInput::new(&tokens, Direction::Row);

    // `r: card` is undeclared on every theme; `rtl: 400` wins its corner's
    // chain, so the shorthand mixes one `8px` with three `var(--we-radius-card)`.
    // CSS drops the entire `border-radius` — not just the three bad slots.
    let style = resolve(&bag(&[("r", s("card")), ("rtl", s("400"))]), &input);
    assert_eq!(
        style.paint.radius.top, None,
        "the valid corner must not apply when a sibling slot is guaranteed-invalid"
    );
    assert!(
        style
            .unsupported
            .iter()
            .any(|u| u.contains("border-radius")),
        "the invalid shorthand lands one unsupported entry, got {:?}",
        style.unsupported
    );

    // Same for the padding family — `pl: 300` wins its slot, `p: card` the rest.
    let style = resolve(&bag(&[("p", s("card")), ("pl", s("300"))]), &input);
    assert_eq!(style.layout.padding.left, None);
    assert_eq!(style.layout.padding.top, None);
    assert!(
        style
            .unsupported
            .iter()
            .any(|u| u.contains("padding") && u.contains("--we-space-card")),
        "got {:?}",
        style.unsupported
    );

    // A fully valid shorthand still lands every slot.
    let style = resolve(
        &bag(&[("p", s("300")), ("pl", s("500")), ("r", s("400"))]),
        &input,
    );
    assert_eq!(style.layout.padding.left, Some(Dimension::Px(24.0)));
    assert_eq!(style.layout.padding.top, Some(Dimension::Px(12.0)));
    assert_eq!(style.paint.radius.top, Some(Dimension::Px(8.0)));
}
