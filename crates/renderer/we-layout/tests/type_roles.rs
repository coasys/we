//! A theme's type roles reach the components that take them: helpers.ts
//! gives each component a `typeRole` (`we-text`'s heading variants are
//! `heading`, `label`/`overline` their own; `we-button`, `we-tab`,
//! `we-menu-item` are `control`; `we-badge`/`we-tag` `badge`; the fields
//! `body`) and writes `var(--we-type-<role>-<key>, <the element's own
//! default>)` for every key the author did not set. Glow parity: Coasys
//! Glow's headings are weight 300 and its controls 600, and Rust drew every
//! heading bold (the People title, the section headings).
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_layout::defaults::{style_of, StyleCx};
use we_style::{Style, TokenTable};
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
        surfaces: Default::default(),
    }
}

fn table(pairs: &[(&str, &str)]) -> TokenTable {
    TokenTable::new(
        pairs
            .iter()
            .map(|(k, v)| (Arc::from(*k), Arc::from(*v)))
            .collect::<IndexMap<Arc<str>, Arc<str>>>(),
    )
}

fn glow() -> TokenTable {
    table(&[
        ("--we-font-weight-bold", "700"),
        ("--we-font-weight-medium", "500"),
        ("--we-font-size-100", "12px"),
        ("--we-font-size-500", "20px"),
        ("--we-type-heading-weight", "300"),
        ("--we-type-heading-letter-spacing", "-0.16px"),
        ("--we-type-control-weight", "600"),
        ("--we-type-overline-size", "14px"),
        ("--we-type-overline-weight", "700"),
        ("--we-type-overline-color", "rgb(148, 151, 186)"),
    ])
}

fn style(t: &TokenTable, n: &ResolvedNode) -> Style {
    let scx = StyleCx {
        tokens: t,
        ..StyleCx::empty()
    };
    style_of(n, &scx)
}

#[test]
fn a_heading_takes_the_themes_heading_weight() {
    let t = glow();
    let h = node("we-text", &[("variant", Value::from("heading-sm"))]);
    let s = style(&t, &h);
    assert_eq!(s.text.font_weight, Some(300.0));
    assert!(
        format!("{:?}", s.text.letter_spacing).contains("-0.16"),
        "{:?}",
        s.text.letter_spacing
    );
    // The heading role takes no size: the variant's own stands.
    assert!(format!("{:?}", s.text.font_size).contains("20"));
    // Without a theme opinion the variant's bold stands.
    let plain = table(&[("--we-font-weight-bold", "700")]);
    assert_eq!(style(&plain, &h).text.font_weight, Some(700.0));
    // An authored weight is the narrowest statement and wins.
    let authored = node(
        "we-text",
        &[
            ("variant", Value::from("heading-sm")),
            ("fontWeight", Value::from("bold")),
        ],
    );
    assert_eq!(style(&t, &authored).text.font_weight, Some(700.0));
}

#[test]
fn plain_text_takes_no_role() {
    let t = glow();
    let s = style(&t, &node("we-text", &[]));
    assert_eq!(s.text.font_weight, None);
}

#[test]
fn a_button_takes_the_control_role() {
    let t = glow();
    let s = style(&t, &node("we-button", &[]));
    assert_eq!(s.text.font_weight, Some(600.0));
}

#[test]
fn an_overline_takes_the_overline_role() {
    let t = glow();
    let s = style(
        &t,
        &node("we-text", &[("variant", Value::from("overline"))]),
    );
    assert!(
        format!("{:?}", s.text.font_size).contains("14"),
        "{:?}",
        s.text.font_size
    );
    assert_eq!(s.text.font_weight, Some(700.0));
    let c = s.text.color.expect("overline colour");
    assert!((c.r - 148.0 / 255.0).abs() < 0.01, "{c:?}");
}
