//! Totality property tests: `parse` never panics on arbitrary bytes, and
//! `eval` never panics on parsed expressions of arbitrary shape (the
//! evaluator's input is a parse tree, so a random *source* at bounded depth
//! covers the same space as a random AST).
//!
//! Expression sources are generated from a `u64` seed with a tiny LCG —
//! one seed per proptest case gives a different random tree of depth ≤ 6.
use proptest::prelude::*;
use we_expr::{eval, parse, MapEnv};

/// A small env so identifier lookups hit real values sometimes.
fn env() -> MapEnv {
    MapEnv::new()
        .with_root("n", 42.0)
        .with_root("s", "text")
        .with_root("l", vec![1.0.into(), 2.0.into()])
        .with_root(
            "o",
            [("a".into(), 1.0.into()), ("b".into(), "x".into())]
                .into_iter()
                .collect::<indexmap::IndexMap<std::sync::Arc<str>, we_expr::Value>>(),
        )
        .with_function("hostFn", |args| {
            args.first().cloned().unwrap_or(we_expr::Value::Undefined)
        })
}

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 33
    }
}

const LEAVES: &[&str] = &[
    "1",
    "-0",
    "3.14",
    "1e3",
    "0x10",
    "'x'",
    "'a\\nb'",
    "\"y\"",
    "true",
    "false",
    "null",
    "n",
    "s",
    "l",
    "o",
    "missing",
    "undefined",
    "Infinity",
];
const BINOPS: &[&str] = &[
    "+", "-", "*", "/", "%", "==", "!=", "<", ">", "<=", ">=", "in", "&&", "||", "??",
];
const CALLS: &[&str] = &[
    "count", "upper", "lower", "sum", "distinct", "join", "split", "pick", "find", "hostFn",
];
const MACROS: &[&str] = &["map", "filter", "find", "exists", "all"];

/// A random expression source of depth ≤ `depth`.
fn gen_source(rng: &mut Rng, depth: u32) -> String {
    if depth == 0 {
        return LEAVES[(rng.next() as usize) % LEAVES.len()].to_string();
    }
    match rng.next() % 10 {
        0 | 1 => LEAVES[(rng.next() as usize) % LEAVES.len()].to_string(),
        2 => {
            let a = gen_source(rng, depth - 1);
            let b = gen_source(rng, depth - 1);
            format!("{a} {} {b}", BINOPS[(rng.next() as usize) % BINOPS.len()])
        }
        3 => format!(
            "{}({})",
            CALLS[(rng.next() as usize) % CALLS.len()],
            gen_source(rng, depth - 1)
        ),
        4 => {
            let a = gen_source(rng, depth - 1);
            let b = gen_source(rng, depth - 1);
            let c = gen_source(rng, depth - 1);
            format!("{a} ? {b} : {c}")
        }
        5 => format!(
            "{}.{}(i, i)",
            gen_source(rng, depth - 1),
            MACROS[(rng.next() as usize) % MACROS.len()]
        ),
        6 => format!("{}{}", "-", gen_source(rng, depth - 1)),
        7 => format!("![{}]", gen_source(rng, depth - 1)),
        8 => format!("{{ k: {} }}.k", gen_source(rng, depth - 1)),
        _ => format!("`t{}e`", gen_source(rng, depth - 1)),
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    /// Arbitrary bytes must never panic the parser — `Err` is fine.
    #[test]
    fn parse_never_panics(bytes in prop::collection::vec(any::<u8>(), 0..256)) {
        if let Ok(s) = String::from_utf8(bytes) {
            let _ = parse(&s);
        }
    }

    /// Lossy UTF-8 too — arbitrary byte soup, not just valid strings.
    #[test]
    fn parse_never_panics_lossy(bytes in prop::collection::vec(any::<u8>(), 0..256)) {
        let _ = parse(&String::from_utf8_lossy(&bytes));
    }

    /// Evaluation of a random parsed expression against a small env never
    /// panics — totality is the contract (missing names → `Undefined`).
    #[test]
    fn eval_never_panics(seed in any::<u64>()) {
        let src = gen_source(&mut Rng(seed), 6);
        if let Ok(expr) = parse(&src) {
            let _ = eval(&expr, &env());
        }
    }
}
