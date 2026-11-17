//! `style_of` keeps each answer under a hash of everything it reads, so a
//! frame that re-lays out an unchanged tree looks styles up instead of
//! resolving them — and a change to any input resolves afresh.
//!
//! One test per input `style_key` hashes: change only that input and the
//! style must be resolved again (the resolve counter moves). Where the
//! style really depends on the input, the test also asserts the answer
//! differs. Viewport and metrics are hashed although no style reads them
//! today (lengths keep their units until layout), so for those the miss is
//! the whole assertion: a style that starts reading them must not be
//! served from a key that ignores them.
use std::sync::{Arc, Mutex, MutexGuard};

use indexmap::IndexMap;
use we_expr::Value;
use we_layout::counters;
use we_layout::defaults::{style_of, StyleCx};
use we_style::{Style, TokenTable};
use we_template::{NodeId, ResolvedNode};

/// Installing a sheet moves a process-wide generation every memo key
/// includes, so a test that installs one would make another's lookups miss.
/// The tests here take turns.
fn serial() -> MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

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

fn scope(pairs: &[(&str, &str)]) -> IndexMap<Arc<str>, Arc<str>> {
    pairs
        .iter()
        .map(|(k, v)| (Arc::from(*k), Arc::from(*v)))
        .collect()
}

/// `a` then `b`, each resolved twice (the second must be a hit), and how
/// many resolves the four calls cost: 2 when the key told them apart.
fn pair(a: (&ResolvedNode, &StyleCx), b: (&ResolvedNode, &StyleCx)) -> (Style, Style, u64) {
    let sa = style_of(a.0, a.1);
    let sb = style_of(b.0, b.1);
    counters::take();
    // Fresh lookups of both, after both are cached: the memo serves each
    // its own answer only if the key tells them apart. Dropping the input
    // from the key makes the second insert overwrite the first, so `a`
    // comes back as `b`'s answer, or misses.
    let sa2 = style_of(a.0, a.1);
    let sb2 = style_of(b.0, b.1);
    let after = counters::take().style_resolves;
    assert_eq!(
        format!("{sa:?}"),
        format!("{sa2:?}"),
        "a is served its own style"
    );
    assert_eq!(
        format!("{sb:?}"),
        format!("{sb2:?}"),
        "b is served its own style"
    );
    (sa, sb, after)
}

/// Both resolved once, then each looked up again: 0 resolves when the key
/// separates them.
fn separates(a: (&ResolvedNode, &StyleCx), b: (&ResolvedNode, &StyleCx)) -> (Style, Style) {
    counters::take();
    let first = style_of(a.0, a.1);
    let second = style_of(b.0, b.1);
    assert_eq!(
        counters::take().style_resolves,
        2,
        "changing only this input resolves again"
    );
    let (_, _, again) = pair(a, b);
    assert_eq!(again, 0, "and each is kept under its own key");
    (first, second)
}

fn base(t: &TokenTable) -> StyleCx<'_> {
    StyleCx {
        tokens: t,
        ..StyleCx::empty()
    }
}

#[test]
fn the_same_node_in_the_same_context_resolves_once() {
    let _s = serial();
    let t = table(&[("--we-role-surface", "rgb(1, 2, 3)")]);
    let n = node("Column", &[("bg", Value::from("surface"))]);
    counters::take();
    let a = style_of(&n, &base(&t));
    // A fresh node with the same contents — a re-resolved tree's — and a
    // fresh table with the same contents hit too.
    let b = style_of(&n.clone(), &base(&t.clone()));
    assert_eq!(counters::take().style_resolves, 1);
    assert_eq!(a.paint.bg, b.paint.bg);
}

#[test]
fn the_type() {
    let _s = serial();
    let t = table(&[]);
    let (a, b) = separates(
        (&node("Row", &[]), &base(&t)),
        (&node("Column", &[]), &base(&t)),
    );
    assert_ne!(a.layout.direction, b.layout.direction);
}

#[test]
fn a_props_name() {
    let _s = serial();
    let t = table(&[]);
    let w = node("Column", &[("width", Value::from("10px"))]);
    let h = node("Column", &[("height", Value::from("10px"))]);
    let (a, b) = separates((&w, &base(&t)), (&h, &base(&t)));
    assert_ne!(a.layout.width, b.layout.width);
}

#[test]
fn a_props_value() {
    let _s = serial();
    let t = table(&[]);
    let ten = node("Column", &[("width", Value::from("10px"))]);
    let twenty = node("Column", &[("width", Value::from("20px"))]);
    let (a, b) = separates((&ten, &base(&t)), (&twenty, &base(&t)));
    assert_ne!(a.layout.width, b.layout.width);
}

#[test]
fn a_nested_props_value() {
    let _s = serial();
    let t = table(&[]);
    let styles = |w: &str| {
        Value::Obj(Arc::new(
            [(Arc::<str>::from("width"), Value::from(w))]
                .into_iter()
                .collect(),
        ))
    };
    let ten = node("Column", &[("styles", styles("10px"))]);
    let twenty = node("Column", &[("styles", styles("20px"))]);
    let (a, b) = separates((&ten, &base(&t)), (&twenty, &base(&t)));
    assert_ne!(a.layout.width, b.layout.width);
}

#[test]
fn the_token_table() {
    let _s = serial();
    let red = table(&[("--we-role-surface", "rgb(255, 0, 0)")]);
    let blue = table(&[("--we-role-surface", "rgb(0, 0, 255)")]);
    let n = node("Column", &[("bg", Value::from("surface"))]);
    let (a, b) = separates((&n, &base(&red)), (&n, &base(&blue)));
    assert_ne!(a.paint.bg, b.paint.bg);
}

#[test]
fn the_theme() {
    let _s = serial();
    we_style::stylesheet::install(
        "memo-theme-a",
        "[data-we-theme='memo-theme-a'] we-badge::part(base) { background: #123456 }",
    );
    let t = table(&[]);
    let n = node("we-badge", &[]);
    let themed = |id: &'static str| StyleCx {
        theme: id,
        ..base(&t)
    };
    let (a, b) = separates((&n, &themed("memo-theme-a")), (&n, &themed("memo-theme-b")));
    assert_ne!(a.paint.bg, b.paint.bg);
    we_style::stylesheet::uninstall("memo-theme-a");
}

#[test]
fn the_installed_sheets() {
    let _s = serial();
    let t = table(&[]);
    let n = node("we-badge", &[]);
    let scx = StyleCx {
        theme: "memo-theme-c",
        ..base(&t)
    };
    we_style::stylesheet::install(
        "memo-theme-c",
        "[data-we-theme='memo-theme-c'] we-badge::part(base) { background: #111111 }",
    );
    let a = style_of(&n, &scx);
    we_style::stylesheet::install(
        "memo-theme-c",
        "[data-we-theme='memo-theme-c'] we-badge::part(base) { background: #222222 }",
    );
    counters::take();
    let b = style_of(&n, &scx);
    assert_eq!(
        counters::take().style_resolves,
        1,
        "a new sheet resolves again"
    );
    assert_ne!(a.paint.bg, b.paint.bg);
    we_style::stylesheet::uninstall("memo-theme-c");
}

#[test]
fn the_container_width() {
    let _s = serial();
    let t = table(&[]);
    let tiered = Value::Obj(Arc::new(
        [(Arc::<str>::from("width"), Value::from("10px"))]
            .into_iter()
            .collect(),
    ));
    let n = node(
        "Column",
        &[("width", Value::from("20px")), ("lgUpProps", tiered)],
    );
    let narrow = StyleCx {
        container_width: 300.0,
        ..base(&t)
    };
    let wide = StyleCx {
        container_width: 2000.0,
        ..base(&t)
    };
    let (a, b) = separates((&n, &narrow), (&n, &wide));
    assert_ne!(
        a.layout.width, b.layout.width,
        "the lg tier applies only wide"
    );
}

#[test]
fn the_viewport_width() {
    let _s = serial();
    let t = table(&[]);
    let n = node("Column", &[("width", Value::from("50vw"))]);
    let a = StyleCx {
        viewport: we_style::Size::new(800.0, 600.0),
        ..base(&t)
    };
    let b = StyleCx {
        viewport: we_style::Size::new(1200.0, 600.0),
        ..base(&t)
    };
    separates((&n, &a), (&n, &b));
}

#[test]
fn the_viewport_height() {
    let _s = serial();
    let t = table(&[]);
    let n = node("Column", &[("height", Value::from("50vh"))]);
    let a = StyleCx {
        viewport: we_style::Size::new(800.0, 600.0),
        ..base(&t)
    };
    let b = StyleCx {
        viewport: we_style::Size::new(800.0, 900.0),
        ..base(&t)
    };
    separates((&n, &a), (&n, &b));
}

/// Each of the five unit metrics, changed alone.
#[test]
fn each_metric() {
    let _s = serial();
    let t = table(&[]);
    let n = node("Column", &[("width", Value::from("2em"))]);
    let bumps: [fn(&mut we_metrics::UnitMetrics); 5] = [
        |m| m.root_px += 1.0,
        |m| m.font_px += 1.0,
        |m| m.ch_em += 0.1,
        |m| m.ex_em += 0.1,
        |m| m.lh_em += 0.1,
    ];
    for (i, bump) in bumps.iter().enumerate() {
        let a = base(&t);
        let mut b = base(&t);
        bump(&mut b.metrics);
        style_of(&n, &a);
        counters::take();
        style_of(&n, &b);
        assert_eq!(
            counters::take().style_resolves,
            1,
            "metric {i} changed alone resolves again"
        );
    }
}

#[test]
fn a_scope_value() {
    let _s = serial();
    let t = table(&[("--we-role-surface", "rgb(1, 2, 3)")]);
    let n = node("Column", &[("bg", Value::from("surface"))]);
    let red = scope(&[("--we-role-surface", "rgb(255, 0, 0)")]);
    let blue = scope(&[("--we-role-surface", "rgb(0, 0, 255)")]);
    let (a, b) = separates(
        (
            &n,
            &StyleCx {
                scope: &red,
                ..base(&t)
            },
        ),
        (
            &n,
            &StyleCx {
                scope: &blue,
                ..base(&t)
            },
        ),
    );
    assert_ne!(a.paint.bg, b.paint.bg);
}

#[test]
fn a_scope_name() {
    let _s = serial();
    let t = table(&[("--we-role-surface", "rgb(1, 2, 3)")]);
    let n = node("Column", &[("bg", Value::from("surface"))]);
    let surface = scope(&[("--we-role-surface", "rgb(255, 0, 0)")]);
    let text = scope(&[("--we-role-text", "rgb(255, 0, 0)")]);
    let (a, b) = separates(
        (
            &n,
            &StyleCx {
                scope: &surface,
                ..base(&t)
            },
        ),
        (
            &n,
            &StyleCx {
                scope: &text,
                ..base(&t)
            },
        ),
    );
    assert_ne!(a.paint.bg, b.paint.bg);
}
