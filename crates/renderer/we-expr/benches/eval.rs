//! Eval time for every `{"$": "…"}` source in the Coasys bundle against an
//! empty env — the bundle is the corpus the renderer will run. Not part of
//! CI; run with `cargo bench -p we-expr`.
use criterion::{criterion_group, criterion_main, Criterion};
use std::path::PathBuf;
use we_expr::{eval, parse, Expr, MapEnv};

fn bundle_exprs() -> Vec<Expr> {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../bundles/coasys.bundle.json");
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).expect("read bundle"))
            .expect("bundle is json");
    let mut sources = Vec::new();
    fn walk(v: &serde_json::Value, out: &mut Vec<String>) {
        match v {
            serde_json::Value::Object(map) => {
                for (k, val) in map {
                    if k == "$" {
                        if let serde_json::Value::String(s) = val {
                            out.push(s.clone());
                        }
                    } else {
                        walk(val, out);
                    }
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    walk(item, out);
                }
            }
            _ => {}
        }
    }
    walk(&json, &mut sources);
    sources
        .iter()
        .map(|s| parse(s).expect("bundle sources all parse"))
        .collect()
}

fn bench_all_bundle_expressions(c: &mut Criterion) {
    let exprs = bundle_exprs();
    let env = MapEnv::new();
    c.bench_function("eval all bundle expressions (empty env)", |b| {
        b.iter(|| {
            for expr in &exprs {
                std::hint::black_box(eval(expr, &env));
            }
        })
    });
}

criterion_group!(benches, bench_all_bundle_expressions);
criterion_main!(benches);
