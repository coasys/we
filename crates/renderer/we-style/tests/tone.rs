//! `tone` scoping: the element's own `--we-*` re-pointings must win for the
//! `var()`s its declarations resolve — `bg: accent-soft` under
//! `tone: "danger"` is `danger-soft`, on the base decls and on state bags
//! alike. Plus the DOM's number-on-a-length-prop rule (`maxWidth: 300` is
//! `300px`).

use std::path::PathBuf;
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_style::{eval_color, resolve, Bag, Color, Dimension, Direction, StyleInput, TokenTable};

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

/// The table value `var(--we-role-<name>)` holds, as a `Color`.
fn role(tokens: &TokenTable, name: &str) -> Color {
    eval_color(tokens.get(&format!("--we-role-{name}")).unwrap()).unwrap()
}

#[test]
fn tone_repoints_accent_roles() {
    let tokens = tokens();
    let input = StyleInput::new(&tokens, Direction::Row);

    // The untoned baseline: `accent-*` means the accent family.
    let plain = resolve(
        &bag(&[("bg", s("accent-soft")), ("color", s("accent-text"))]),
        &input,
    );
    assert_eq!(plain.paint.bg, Some(role(&tokens, "accent-soft")));
    assert_eq!(plain.text.color, Some(role(&tokens, "accent-text")));

    // Under `tone: danger` the same decls answer the danger family — the
    // element's `--we-role-accent-*` re-pointings scope its own `var()`s.
    let danger = resolve(
        &bag(&[
            ("tone", s("danger")),
            ("bg", s("accent-soft")),
            ("color", s("accent-text")),
        ]),
        &input,
    );
    assert_eq!(
        danger.paint.bg,
        Some(role(&tokens, "danger-soft")),
        "tone: danger must re-point accent-soft to danger-soft"
    );
    assert_eq!(
        danger.text.color,
        Some(role(&tokens, "danger-text")),
        "tone: danger must re-point accent-text to danger-text"
    );
    assert_ne!(danger.paint.bg, plain.paint.bg);
}

#[test]
fn state_bags_resolve_in_the_tone_scope() {
    let tokens = tokens();
    let input = StyleInput::new(&tokens, Direction::Row);
    let style = resolve(
        &bag(&[
            ("tone", s("danger")),
            (
                "hoverProps",
                Value::Obj(Arc::new(
                    [("bg", s("accent-soft"))]
                        .into_iter()
                        .map(|(k, v)| (Arc::from(k), v))
                        .collect(),
                )),
            ),
        ]),
        &input,
    );
    let hover = style.hover.expect("hoverProps produced a patch");
    assert_eq!(
        hover.paint.bg,
        Some(role(&tokens, "danger-soft")),
        "a state bag's accent-soft resolves in the element's tone scope"
    );
}

#[test]
fn number_on_a_length_prop_is_px() {
    let tokens = tokens();
    let input = StyleInput::new(&tokens, Direction::Row);
    // `style.maxWidth = 300` — the DOM coerces a bare number to px.
    let style = resolve(&bag(&[("maxWidth", Value::Num(300.0))]), &input);
    assert_eq!(style.layout.max_width, Some(Dimension::Px(300.0)));
}
