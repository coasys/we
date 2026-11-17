//! Finding nodes in a resolved tree, for tests that drive a real template.
#![allow(dead_code)]

use we_template::{ResolvedChild, ResolvedNode};

/// The first node, depth first, that `pred` accepts.
pub fn find(root: &ResolvedNode, pred: impl Fn(&ResolvedNode) -> bool) -> Option<&ResolvedNode> {
    fn walk<'a>(
        n: &'a ResolvedNode,
        pred: &dyn Fn(&ResolvedNode) -> bool,
    ) -> Option<&'a ResolvedNode> {
        if pred(n) {
            return Some(n);
        }
        n.children.iter().find_map(|c| match c {
            ResolvedChild::Node(c) => walk(c, pred),
            ResolvedChild::Text(_) => None,
        })
    }
    walk(root, &pred)
}

/// A prop's text, when it is a string.
pub fn prop_str<'a>(node: &'a ResolvedNode, key: &str) -> Option<&'a str> {
    match node.props.get(key) {
        Some(we_expr::Value::Str(s)) => Some(s),
        _ => None,
    }
}

/// Every text run below `node`, joined.
pub fn text_of(node: &ResolvedNode) -> String {
    let mut out = String::new();
    fn walk(n: &ResolvedNode, out: &mut String) {
        for c in &n.children {
            match c {
                ResolvedChild::Text(t) => {
                    out.push_str(t);
                    out.push(' ');
                }
                ResolvedChild::Node(c) => walk(c, out),
            }
        }
    }
    walk(node, &mut out);
    out
}
