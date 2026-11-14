//! The mini evaluator, one case per raw CSS form the bundle and vectors
//! actually use ("verify first" #2): `var()`, `calc()`, nested `max()`,
//! `color-mix()`, `rgba()`, named colours, viewport units, the glow shadow's
//! chained percentage. A small synthetic table makes the vars resolvable —
//! expectations are the computed values, not the emitted text.

use std::sync::Arc;

use indexmap::IndexMap;
use we_style::{eval_color, eval_dimension, Calc, Color, Dimension, Size, TokenTable};

fn table() -> TokenTable {
    TokenTable::new(
        [
            ("--we-space-200", "8px"),
            ("--we-space-300", "12px"),
            ("--we-space-500", "20px"),
            ("--we-avatar-size-sm", "40px"),
            ("--we-scrollbar-thumb-inset", "2px"),
            ("--we-scrollbar-width", "10px"),
            ("--we-role-accent", "oklch(0.553 0.15998 288)"),
            ("--we-role-border", "oklch(0.845 0.0115171 288)"),
            ("--we-role-border-strong", "oklch(0.7 0.04 288)"),
        ]
        .iter()
        .map(|(k, v)| (Arc::from(*k), Arc::from(*v)))
        .collect::<IndexMap<Arc<str>, Arc<str>>>(),
    )
}

fn dim(text: &str) -> Option<Dimension> {
    eval_dimension(&table().substitute(text))
}

fn px(v: f32) -> Option<Dimension> {
    Some(Dimension::Px(v))
}

#[test]
fn bare_units() {
    assert_eq!(dim("24px"), px(24.0));
    assert_eq!(dim("-60px"), px(-60.0));
    assert_eq!(dim("0"), px(0.0));
    assert_eq!(dim("auto"), Some(Dimension::Auto));
    assert_eq!(dim("55%"), Some(Dimension::Percent(0.55)));
    assert_eq!(dim("100%"), Some(Dimension::Percent(1.0)));
    assert_eq!(dim("12rem"), Some(Dimension::Rem(12.0)));
    assert_eq!(dim("1rem"), Some(Dimension::Rem(1.0)));
    assert_eq!(dim("-0.01em"), Some(Dimension::Em(-0.01)));
    assert_eq!(dim("100vw"), Some(Dimension::Vw(100.0)));
    assert_eq!(dim("100dvh"), Some(Dimension::Vh(100.0)));
    assert_eq!(dim("1lh"), Some(Dimension::Lh(1.0)));
    // a bare non-zero number is a scale step, not a length
    assert_eq!(dim("300"), None);
}

#[test]
fn calc_forms() {
    // `calc((72px - 28px) / 2)` — parenthesised arithmetic
    assert_eq!(dim("calc((72px - 28px) / 2)"), px(22.0));
    // `calc(var(--we-avatar-size-sm) * 0.125)` — a var times a scalar
    assert_eq!(dim("calc(var(--we-avatar-size-sm) * 0.125)"), px(5.0));
    // `calc(var(--we-space-500) + var(--we-covered-bottom, 0px))` —
    // the fallback honours an undeclared var
    assert_eq!(
        dim("calc(var(--we-space-500) + var(--we-covered-bottom, 0px))"),
        px(20.0)
    );
    // negative multiplier — `calc(var(--we-avatar-size-sm) * -0.1348)`
    assert_eq!(dim("calc(var(--we-avatar-size-sm) * -0.1348)"), px(-5.392));
    // nested max — `calc(max(0px, calc(3px - var(--we-scrollbar-thumb-inset))) - var(--we-space-300))`
    // = max(0, 3-2) - 12 = 1 - 12 = -11
    assert_eq!(
        dim("calc(max(0px, calc(3px - var(--we-scrollbar-thumb-inset))) - var(--we-space-300))"),
        px(-11.0)
    );
    // `max(0px, calc(12 - max(0, 3-2) - 10))` = max(0, 1) = 1
    assert_eq!(
        dim("max(0px, calc(var(--we-space-300) - max(0px, calc(3px - var(--we-scrollbar-thumb-inset))) - var(--we-scrollbar-width)))"),
        px(1.0)
    );
}

#[test]
fn calc_mixed_units() {
    // Metric-resolvable units combine; the terms stay symbolic and `to_px`
    // folds them against the supplied metrics — `calc(72px - 2rem)` is 40px
    // at a 16px root.
    let d = dim("calc(72px - 2rem)").expect("px - rem resolves");
    assert_eq!(
        d.to_px(14.0, 16.0, Size::new(0.0, 0.0)),
        Some(40.0),
        "{d:?}"
    );
    // The bundle's railInset:
    // calc((72px - 1px - 2rem) / 2 - var(--we-space-200)) = (71-32)/2 - 8 = 11.5
    let d = dim("calc((72px - 1px - 2rem) / 2 - var(--we-space-200))").expect("railInset resolves");
    assert_eq!(
        d.to_px(14.0, 16.0, Size::new(0.0, 0.0)),
        Some(11.5),
        "{d:?}"
    );
    // `em` folds against font_px, viewport units against the viewport.
    let d = dim("calc(2em + 4px)").expect("em + px resolves");
    assert_eq!(d.to_px(14.0, 16.0, Size::new(0.0, 0.0)), Some(32.0));
    let d = dim("calc(50vw - 10px)").expect("vw - px resolves");
    assert_eq!(d.to_px(14.0, 16.0, Size::new(200.0, 100.0)), Some(90.0));

    // Percent + length keeps both terms — layout owns the percent's base.
    let d = dim("calc(100% - 2 * var(--we-space-300))").expect("pct - px resolves");
    assert_eq!(
        d,
        Dimension::Calc(Calc {
            percent: 1.0,
            px: -24.0,
            ..Calc::default()
        })
    );
    // ..and the percent term is the part to_px cannot answer.
    assert_eq!(d.to_px(14.0, 16.0, Size::new(200.0, 100.0)), None);
    assert_eq!(
        dim("calc(50% + 1rem)"),
        Some(Dimension::Calc(Calc {
            percent: 0.5,
            rem: 1.0,
            ..Calc::default()
        }))
    );

    // Single-unit results still collapse to the scalar variants.
    assert_eq!(dim("calc(2em * 3)"), Some(Dimension::Em(6.0)));
    assert_eq!(dim("calc(50% * 2)"), Some(Dimension::Percent(1.0)));
    assert_eq!(dim("calc(100% - 50%)"), Some(Dimension::Percent(0.5)));

    // A number and a length do not mix — invalid in CSS too.
    assert_eq!(dim("calc(2 + 3px)"), None);
    // min/max/clamp still require comparable (same-unit) arguments — metrics
    // cannot order mixed units at eval time.
    assert_eq!(dim("max(2rem, 30px)"), None);
}

#[test]
fn clamp_reversed_bounds() {
    // CSS: clamp(min, preferred, max) = max(min, min(preferred, max)) — the
    // minimum wins over a smaller maximum; it is valid CSS, not an error.
    // Rust's f64::clamp would panic on lo > hi.
    assert_eq!(dim("clamp(100px, 50px, 0px)"), px(100.0));
    assert_eq!(dim("clamp(0px, 50px, 100px)"), px(50.0));
    assert_eq!(dim("clamp(0px, 500px, 100px)"), px(100.0));
    // nested expression with reversed bounds
    assert_eq!(
        dim("clamp(calc(80px + 20px), 50px, var(--we-nothing, 0px))"),
        px(100.0)
    );
}

#[test]
fn var_forms() {
    // declared var substitutes
    assert_eq!(dim("var(--we-space-300)"), px(12.0));
    // undeclared without fallback stays a var() — unevaluable, not guessed
    assert_eq!(dim("var(--we-nothing)"), None);
    // fallback honours it
    assert_eq!(dim("var(--we-nothing, 4px)"), px(4.0));
    // nested-var fallback — the recorder's shallow `[^)]*` rule leaves the
    // outer paren for the next round; a declared outer var still wins
    let t = table();
    assert_eq!(
        t.substitute("var(--we-space-300, var(--we-space-500))")
            .as_ref(),
        "12px)"
    );
    // ^ the stray `)` is the recorder's own artefact — documented in tokens.rs
}

#[test]
fn color_forms() {
    let t = table();
    // rgba with a leading-dot alpha
    assert_eq!(
        eval_color("rgba(199,201,220,.3)"),
        Some(Color {
            r: 199.0 / 255.0,
            g: 201.0 / 255.0,
            b: 220.0 / 255.0,
            a: 0.3
        })
    );
    // hex
    assert_eq!(
        eval_color("#1b1e45"),
        Some(Color {
            r: 27.0 / 255.0,
            g: 30.0 / 255.0,
            b: 69.0 / 255.0,
            a: 1.0
        })
    );
    // oklch parses (value checked loosely — it is an oklab conversion)
    assert!(eval_color("oklch(60% 0.15 250)").is_some());
    // named
    assert_eq!(
        eval_color("transparent"),
        Some(Color {
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: 0.0
        })
    );
    assert!(eval_color("cyan").is_some());
    // color-mix with vars — `var(--we-role-border) 65%, var(--we-role-border-strong)`
    let mixed =
        eval_color(&t.substitute(
            "color-mix(in srgb, var(--we-role-border) 65%, var(--we-role-border-strong))",
        ));
    assert!(mixed.is_some(), "color-mix over substituted vars resolves");
    // color-mix with transparent — the ring wash
    let wash =
        eval_color(&t.substitute("color-mix(in srgb, var(--we-role-accent) 18%, transparent)"));
    let c = wash.expect("wash resolves");
    assert!(
        c.a < 0.25 && c.a > 0.1,
        "18% wash keeps a light alpha: {c:?}"
    );
}

#[test]
fn unsupported_forms_stay_unsupported() {
    // things the crate must not guess — they land in `unsupported`
    assert_eq!(dim("var(--we-gradient-hero)"), None);
    assert_eq!(eval_color("var(--we-gradient-hero)"), None);
    assert_eq!(eval_color("light-dark(red, blue)"), None);
    assert_eq!(eval_color("lab(50% 40 59)"), None);
    assert_eq!(eval_color("hwb(240 20% 30%)"), None);
    assert_eq!(eval_color("oklch(from red l c h)"), None);
}
