//! An empty `tone` is no tone: badge.ts picks its table with
//! `this.tone && this.tone !== 'neutral'`, so `tone: ""` is the neutral
//! chip. Glow parity: the Coasys tree's Calls count (`tone: ""`, the
//! schema's "no live call" branch) was accent-tinted; the web's is grey
//! like every other count.
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_layout::defaults::{style_of, StyleCx};
use we_style::TokenTable;
use we_template::{NodeId, ResolvedNode};

fn badge(props: &[(&str, Value)]) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from("b"),
        ty: Arc::from("we-badge"),
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
fn an_empty_tone_draws_the_neutral_badge() {
    let table = TokenTable::new(
        [
            ("--we-role-control-surface", "rgb(10, 10, 10)"),
            ("--we-role-accent-soft", "rgb(0, 200, 100)"),
            ("--we-role-text", "rgb(250, 250, 250)"),
            ("--we-role-accent-text", "rgb(0, 255, 128)"),
        ]
        .iter()
        .map(|(k, v)| (Arc::from(*k), Arc::from(*v)))
        .collect::<IndexMap<Arc<str>, Arc<str>>>(),
    );
    let scx = StyleCx {
        tokens: &table,
        ..StyleCx::empty()
    };
    let soft = ("variant", Value::from("soft"));
    let untoned = style_of(&badge(&[soft.clone()]), &scx);
    let empty = style_of(&badge(&[soft, ("tone", Value::from(""))]), &scx);
    assert_eq!(
        format!("{:?}", empty.paint.bg),
        format!("{:?}", untoned.paint.bg)
    );
    assert_eq!(
        format!("{:?}", empty.text.color),
        format!("{:?}", untoned.text.color)
    );
}
