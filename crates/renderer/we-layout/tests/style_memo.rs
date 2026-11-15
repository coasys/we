//! `style_of` keeps each answer under a hash of everything it reads, so a
//! frame that re-lays out an unchanged tree looks styles up instead of
//! resolving them — and a change to any input resolves afresh.
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_layout::counters;
use we_layout::defaults::{style_of, StyleCx};
use we_style::TokenTable;
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

fn scx(tokens: &TokenTable) -> StyleCx<'_> {
    StyleCx {
        tokens,
        ..StyleCx::empty()
    }
}

#[test]
fn the_same_node_in_the_same_context_resolves_once() {
    let t = table(&[("--we-role-surface", "rgb(1, 2, 3)")]);
    let n = node("Column", &[("bg", Value::from("surface"))]);
    counters::take();
    let a = style_of(&n, &scx(&t));
    // A fresh node with the same contents — a re-resolved tree's — and a
    // fresh table with the same contents hit too.
    let b = style_of(&n.clone(), &scx(&t.clone()));
    assert_eq!(counters::take().style_resolves, 1);
    assert_eq!(a.paint.bg, b.paint.bg);
}

#[test]
fn a_changed_prop_token_or_scope_resolves_afresh() {
    let t = table(&[("--we-role-surface", "rgb(1, 2, 3)")]);
    let n = node("Column", &[("bg", Value::from("surface"))]);
    let before = style_of(&n, &scx(&t));
    counters::take();

    let other = table(&[("--we-role-surface", "rgb(9, 9, 9)")]);
    let repainted = style_of(&n, &scx(&other));
    assert_ne!(repainted.paint.bg, before.paint.bg, "the table's value");

    let wider = node(
        "Column",
        &[("bg", Value::from("surface")), ("width", Value::Num(300.0))],
    );
    let w = style_of(&wider, &scx(&t));
    assert_ne!(w.layout.width, before.layout.width, "the node's own prop");

    let scope: IndexMap<Arc<str>, Arc<str>> =
        [(Arc::from("--we-role-surface"), Arc::from("rgb(4, 5, 6)"))]
            .into_iter()
            .collect();
    let scoped = style_of(
        &n,
        &StyleCx {
            scope: &scope,
            ..scx(&t)
        },
    );
    assert_ne!(scoped.paint.bg, before.paint.bg, "an ancestor's scope");

    assert_eq!(counters::take().style_resolves, 3);
}
