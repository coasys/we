//! Bundle sweep — every prop bag in the shipped bundles resolved against a
//! recorded theme, with the `unsupported` list histogrammed.
//!
//! This is the "does the crate stay honest on real authored input" check:
//! nothing may panic, every state/tier bag must resolve as a patch, and the
//! histogram says which authored values the crate cannot turn into fields —
//! on the recorded tables that means mostly the scales the probe never
//! declared (radius, font-weight, …).

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_style::{Bag, Direction, StyleInput, TokenTable};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn token_table(theme: &str) -> TokenTable {
    let path = repo_root().join(format!(
        "packages/schema-system/conformance/vectors/tokens/{theme}.json"
    ));
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    let json: serde_json::Value = serde_json::from_str(&text).unwrap();
    TokenTable::from_json(&json).unwrap()
}

fn json_to_value(j: &serde_json::Value) -> Value {
    match j {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Bool(*b),
        serde_json::Value::Number(n) => Value::Num(n.as_f64().unwrap_or(0.0)),
        serde_json::Value::String(s) => Value::Str(Arc::from(s.as_str())),
        serde_json::Value::Array(items) => {
            Value::List(Arc::new(items.iter().map(json_to_value).collect()))
        }
        serde_json::Value::Object(map) => Value::Obj(Arc::new(
            map.iter()
                .map(|(k, v)| (Arc::from(k.as_str()), json_to_value(v)))
                .collect::<IndexMap<Arc<str>, Value>>(),
        )),
    }
}

fn walk<'a>(node: &'a serde_json::Value, out: &mut Vec<&'a serde_json::Value>) {
    if !node.is_object() {
        return;
    }
    out.push(node);
    if let Some(children) = node.get("children").and_then(|c| c.as_array()) {
        for c in children {
            walk(c, out);
        }
    }
    if let Some(routes) = node.get("routes").and_then(|r| r.as_object()) {
        for v in routes.values() {
            if let Some(list) = v.as_array() {
                for c in list {
                    walk(c, out);
                }
            } else {
                walk(v, out);
            }
        }
    }
}

fn nodes_of(bundle: &serde_json::Value) -> Vec<&serde_json::Value> {
    let mut out = Vec::new();
    for key in ["templates", "pages"] {
        for t in bundle
            .get(key)
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
        {
            walk(t, &mut out);
        }
    }
    out
}

#[test]
fn bundle_sweep() {
    let bundles = [
        "coasys.bundle.json",
        "field-guide.bundle.json",
        "tool-library.bundle.json",
    ];
    let themes = ["light", "dark", "black", "retro", "cyberpunk", "glow"];
    for theme in themes {
        sweep_under(theme_table(theme), theme, &bundles);
    }
}

fn theme_table(theme: &str) -> TokenTable {
    token_table(theme)
}

/// Every `var(…)` span in an emitted declaration (balanced parens), plus its
/// custom-property name — for the resolve/unresolved token count.
fn var_spans(text: &str) -> Vec<(String, String)> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i + 4 < bytes.len() {
        if &bytes[i..i + 4] != b"var(" {
            i += 1;
            continue;
        }
        let mut j = i + 4;
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        let start = j;
        while j < bytes.len()
            && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_' || bytes[j] == b'-')
        {
            j += 1;
        }
        let name = text[start..j].to_string();
        // the balanced close of this var(, if the text has one
        let mut depth = 1i32;
        let mut k = i + 4;
        while k < bytes.len() {
            match bytes[k] {
                b'(' => depth += 1,
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
                _ => {}
            }
            k += 1;
        }
        let end = if k < bytes.len() { k + 1 } else { bytes.len() };
        out.push((name, text[i..end].to_string()));
        i = end;
    }
    out
}

fn sweep_under(tokens: TokenTable, theme: &str, bundles: &[&str]) {
    let mut histogram: BTreeMap<String, usize> = BTreeMap::new();
    let mut node_count = 0usize;
    let mut prop_bags = 0usize;
    let mut styles_with_patches = 0usize;
    let mut tiered = 0usize;
    // Emitted `var(--we-*)` references vs. the names left after substitution.
    let mut var_refs = 0usize;
    let mut unresolved_vars: BTreeMap<String, usize> = BTreeMap::new();

    for name in bundles {
        let path = repo_root().join("bundles").join(name);
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
        let bundle: serde_json::Value = serde_json::from_str(&text).unwrap();
        for node in nodes_of(&bundle) {
            node_count += 1;
            let Some(props) = node.get("props").and_then(|p| p.as_object()) else {
                continue;
            };
            if props.is_empty() {
                continue;
            }
            prop_bags += 1;
            let bag: Bag = props
                .iter()
                .map(|(k, v)| (Arc::from(k.as_str()), json_to_value(v)))
                .collect();
            for value in we_style::build_layout_decls(&bag, Direction::Column).values() {
                let text = value.text();
                var_refs += var_spans(&text)
                    .iter()
                    .filter(|(n, _)| n.starts_with("--we-"))
                    .count();
                for (_, span) in var_spans(&tokens.substitute_nested(&text)) {
                    *unresolved_vars.entry(span).or_default() += 1;
                }
            }
            // Wide container — the bundle's sm/md/lg bags all get exercised.
            let mut input = StyleInput::new(&tokens, Direction::Column);
            input.container_width = 1400.0;
            let style = we_style::resolve(&bag, &input);
            if style.hover.is_some()
                || style.active.is_some()
                || style.focus.is_some()
                || style.disabled.is_some()
            {
                styles_with_patches += 1;
            }
            if style.pretier.is_some() {
                tiered += 1;
            }
            let mut all: Vec<&str> = style.unsupported.iter().map(|s| s.as_ref()).collect();
            for patch in [
                style.hover.as_deref(),
                style.active.as_deref(),
                style.focus.as_deref(),
                style.disabled.as_deref(),
            ]
            .into_iter()
            .flatten()
            {
                all.extend(patch.unsupported.iter().map(|s| s.as_ref()));
            }
            for entry in all {
                *histogram.entry(entry.to_string()).or_default() += 1;
            }
        }
    }
    eprintln!("[{theme}] nodes={node_count} prop_bags={prop_bags} patched={styles_with_patches} tiered={tiered}");
    eprintln!(
        "  var(--we-*) refs={var_refs} resolved={} unresolved={}",
        var_refs - unresolved_vars.values().sum::<usize>(),
        unresolved_vars.values().sum::<usize>()
    );
    for (k, c) in &unresolved_vars {
        eprintln!("    {c:4} {k}");
    }
    for (k, c) in &histogram {
        eprintln!("  {c:4} {k}");
    }
    assert!(
        node_count > 200,
        "expected the bundles to walk >200 nodes, got {node_count}"
    );
    assert!(styles_with_patches > 0, "no state bag resolved a patch");
    assert!(tiered > 0, "no tier bag applied");
}

/// A tier bag at a narrow container must not apply; at a wide one it must —
/// and the boundary is the breakpoint itself, not one pixel below.
#[test]
fn tier_application() {
    let tokens = token_table("dark");
    let bag: Bag = [
        (Arc::from("bg"), Value::Str(Arc::from("surface"))),
        (
            Arc::from("smUpProps"),
            json_to_value(&serde_json::json!({"bg": "chrome", "px": "40px"})),
        ),
    ]
    .into_iter()
    .collect();

    // One pixel below the 640px breakpoint: the tier must not apply.
    let mut input = StyleInput::new(&tokens, Direction::Row);
    input.container_width = 639.0;
    let narrow = we_style::resolve(&bag, &input);
    assert!(narrow.pretier.is_none());

    // Exactly at it: it must.
    let mut input = StyleInput::new(&tokens, Direction::Row);
    input.container_width = 640.0;
    let edge = we_style::resolve(&bag, &input);
    assert!(edge.pretier.is_some());

    let mut input = StyleInput::new(&tokens, Direction::Row);
    input.container_width = 700.0; // sm applies
    let wide = we_style::resolve(&bag, &input);
    assert!(wide.pretier.is_some());
    // the tier bg (chrome) moved the resolved colour off the base (surface)…
    assert_ne!(
        format!("{:?}", wide.paint.bg),
        format!("{:?}", narrow.paint.bg),
        "tier bg should override the base"
    );
    // …and pretier keeps the pre-tier value.
    assert_eq!(
        format!("{:?}", wide.pretier.as_ref().unwrap().paint.bg),
        format!("{:?}", narrow.paint.bg)
    );
}

/// A state bag becomes a patch; applying it changes the resolved fields and
/// leaves everything the bag did not name alone.
#[test]
fn state_patch_behaviour() {
    let tokens = token_table("dark");
    let bag: Bag = [
        (Arc::from("bg"), Value::Str(Arc::from("surface"))),
        (
            Arc::from("hoverProps"),
            json_to_value(&serde_json::json!({"bg": "chrome", "p": "200"})),
        ),
    ]
    .into_iter()
    .collect();
    let input = StyleInput::new(&tokens, Direction::Row);
    let style = we_style::resolve(&bag, &input);
    let hover = style.hover.as_deref().expect("hover patch");
    // the patch resolved `bg` and `p` into fields — under dark they land on
    // the same values the recorder's table gives.
    assert!(hover.paint.bg.is_some(), "hover bg resolved");
    assert!(hover.layout.padding.top.is_some() || !hover.unsupported.is_empty());

    let rested = format!("{:?}", style.paint.bg);
    let hovered = style.with_state(we_style::StateKind::Hover);
    assert_ne!(
        format!("{:?}", hovered.paint.bg),
        rested,
        "hover changes bg"
    );
    // the un-hovered style is untouched
    assert_eq!(format!("{:?}", style.paint.bg), rested);
}

/// Switching a theme is swapping the `TokenTable` — `bg: surface` recolours,
/// `gap: '300'` does not change (both tables carry the same corrupted space
/// values; what changes is which table is read — the *check* is that the
/// resolved outcome matches each table's own `--we-space-300` text).
#[test]
fn theme_switch() {
    let dark = token_table("dark");
    let light = token_table("light");
    let bag: Bag = [
        (Arc::from("bg"), Value::Str(Arc::from("surface"))),
        (Arc::from("gap"), Value::Str(Arc::from("300"))),
        (Arc::from("color"), Value::Str(Arc::from("text"))),
    ]
    .into_iter()
    .collect();
    let d = we_style::resolve(&bag, &StyleInput::new(&dark, Direction::Row));
    let l = we_style::resolve(&bag, &StyleInput::new(&light, Direction::Row));
    assert_ne!(
        format!("{:?}", d.paint.bg),
        format!("{:?}", l.paint.bg),
        "bg: surface recolours across themes"
    );
    assert_ne!(
        format!("{:?}", d.text.color),
        format!("{:?}", l.text.color),
        "color: text recolours across themes"
    );
    // `gap: '300'` reads the same var under both themes — the fields are
    // whatever the shared var evaluates to (identical on these tables).
    assert_eq!(
        format!("{:?}", d.layout.gap),
        format!("{:?}", l.layout.gap),
        "gap: 300 resolves identically"
    );
}
