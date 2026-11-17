//! An avatar's corners are the theme's avatar radius, round by default:
//! helpers.ts gives `avatar` `radiusGroup: --we-theme-avatar-radius,
//! radiusDefault: 50%`. Glow parity: every Coasys avatar without an
//! authored `r` (the rail's faces, People's cards, the tree's people) was a
//! square; the web's are circles (`avatarRadius: 999px`).
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_layout::defaults::{style_of, StyleCx};
use we_style::TokenTable;
use we_template::{NodeId, ResolvedNode};

fn avatar(props: &[(&str, Value)]) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from("a"),
        ty: Arc::from("we-avatar"),
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

fn radius(table: &TokenTable, props: &[(&str, Value)]) -> String {
    let scx = StyleCx {
        tokens: table,
        ..StyleCx::empty()
    };
    format!("{:?}", style_of(&avatar(props), &scx).paint.radius.top)
}

#[test]
fn an_avatar_takes_the_themes_avatar_radius() {
    let glow = TokenTable::new(
        [
            ("--we-theme-avatar-radius", "999px"),
            ("--we-radius-600", "24px"),
        ]
        .iter()
        .map(|(k, v)| (Arc::from(*k), Arc::from(*v)))
        .collect::<IndexMap<Arc<str>, Arc<str>>>(),
    );
    assert!(radius(&glow, &[]).contains("999"), "{}", radius(&glow, &[]));
    // An authored `r` still wins (the space header's rounded square).
    let r600 = radius(&glow, &[("r", Value::from("600"))]);
    assert!(r600.contains("24"), "{r600}");
    // No theme opinion: a circle.
    let none = TokenTable::new(IndexMap::new());
    assert_eq!(radius(&none, &[]), "Some(Percent(0.5))");
}
