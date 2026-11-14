//! `we-cli` — the headless frontend: load the bundle + snapshot through
//! [`we_session::Session`], resolve, and print the tree as an indented
//! outline. `we-catalog` supplies each node's text fallback — the same
//! words a non-painting frontend would show.
//!
//! usage: we-cli [--bundle <path>] [--snapshot <path>] [--route <href>]
#![forbid(unsafe_code)]

use std::sync::Arc;

use serde::Deserialize;
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{Bundle, ResolvedChild, ResolvedNode, SchemaNode, StoreBag};

const DEFAULT_BUNDLE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
);

fn arg(flag: &str, default: Option<String>) -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        if a == flag {
            return args.next();
        }
    }
    default
}

/// The bundle's `tree` panel schema — the same node `we-app` renders in its
/// side panel.
fn tree_schema(bundle: &Bundle) -> SchemaNode {
    bundle
        .templates
        .as_deref()
        .unwrap_or_default()
        .first()
        .and_then(|t| t.meta.get("panels"))
        .and_then(|panels| panels.as_array())
        .and_then(|panels| {
            panels
                .iter()
                .find(|p| p.get("id").and_then(|i| i.as_str()) == Some("tree"))
                .or_else(|| panels.first())
        })
        .and_then(|panel| SchemaNode::deserialize(panel.get("node").cloned()?).ok())
        .unwrap_or_else(|| panic!("bundle has no panels to render"))
}

/// One resolved child → an indented line (nodes recurse; text children
/// print inline).
fn outline(node: &ResolvedNode, depth: usize, out: &mut String) {
    let label = we_catalog::entry(node.ty.as_ref())
        .map(|e| we_catalog::text_fallback(e, node))
        .unwrap_or_default();
    let label = label.lines().next().unwrap_or("");
    out.push_str(&"  ".repeat(depth));
    out.push_str(node.ty.as_ref());
    if !label.is_empty() {
        out.push_str(&format!("  {label}"));
    }
    out.push('\n');
    for child in &node.children {
        match child {
            ResolvedChild::Node(n) => outline(n, depth + 1, out),
            ResolvedChild::Text(t) => {
                let t = t.trim();
                if !t.is_empty() {
                    out.push_str(&format!("{}\"{t}\"\n", "  ".repeat(depth + 1)));
                }
            }
        }
    }
}

fn main() {
    let bundle_path = arg("--bundle", Some(DEFAULT_BUNDLE.to_string())).unwrap();
    let route = arg("--route", Some("/space/demo".to_string())).unwrap();
    let text = std::fs::read_to_string(&bundle_path)
        .unwrap_or_else(|e| panic!("cannot read bundle {bundle_path}: {e}"));
    let bundle = Bundle::parse(&text).unwrap_or_else(|e| panic!("bundle did not parse: {e}"));

    let bag = match arg("--snapshot", None) {
        Some(path) => {
            let text = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("cannot read snapshot {path}: {e}"));
            let json: serde_json::Value =
                serde_json::from_str(&text).unwrap_or_else(|e| panic!("snapshot parse: {e}"));
            StoreBag::from_snapshot(&json).unwrap_or_else(|e| panic!("snapshot: {e}"))
        }
        None => StoreBag::new(),
    };
    let screen_schema = ScreenSchema {
        pages: bundle
            .pages
            .as_deref()
            .unwrap_or_default()
            .iter()
            .map(|p| p.id.clone())
            .collect(),
        ..ScreenSchema::default()
    };
    let screen = ScreenState::desktop(screen_schema, &route);

    let mut session = Session::new(tree_schema(&bundle), "tree", Arc::new(bag), screen)
        .with_dollar_types(|ty| we_catalog::entry(ty).is_some());
    let root = session.resolve();

    let mut out = String::new();
    outline(&root, 0, &mut out);
    print!("{out}");
    let stats = session.stats();
    eprintln!(
        "resolved: {} nodes in {} resolve(s)",
        stats.nodes, stats.resolves
    );
}
