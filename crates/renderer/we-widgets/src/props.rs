//! Safe prop reads — one helper per type. A prop of the wrong type falls
//! back to the caller's default; nothing panics.
use we_expr::Value;
use we_template::ResolvedNode;

use crate::{PaintCx, Rect};

/// `props[key]` or `Undefined`.
pub fn prop<'a>(node: &'a ResolvedNode, key: &str) -> &'a Value {
    node.props.get(key).unwrap_or(&Value::Undefined)
}

/// A string prop; `Num`/`Bool` coerce through their JS text form the way a
/// DOM attribute would, anything else is `None`.
pub fn prop_str(node: &ResolvedNode, key: &str) -> Option<String> {
    match prop(node, key) {
        Value::Str(s) => Some(s.to_string()),
        Value::Num(_) | Value::Bool(_) => Some(prop(node, key).js_string()),
        _ => None,
    }
}

/// A boolean prop — `Bool` only; a string `"true"` does not coerce (wrong
/// type → default).
pub fn prop_bool(node: &ResolvedNode, key: &str) -> Option<bool> {
    match prop(node, key) {
        Value::Bool(b) => Some(*b),
        _ => None,
    }
}

/// `props[key]` present at all (not `Undefined`) — for "is `open`
/// controlled?" checks.
pub fn prop_present(node: &ResolvedNode, key: &str) -> bool {
    !prop(node, key).is_undefined()
}

/// A number prop; numeric strings coerce ("5" → 5.0) since authored props
/// travel as JSON strings sometimes, anything else is `None`.
pub fn prop_num(node: &ResolvedNode, key: &str) -> Option<f64> {
    match prop(node, key) {
        Value::Num(n) => Some(*n),
        Value::Str(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// A string prop restricted to `choices` — the enum-style props (`size`,
/// `placement`, `type`). An unknown value is `None`, so the caller's
/// default wins.
pub fn prop_enum<'a>(node: &ResolvedNode, key: &str, choices: &[&'a str]) -> Option<&'a str> {
    let Value::Str(s) = prop(node, key) else {
        return None;
    };
    choices.iter().copied().find(|c| *c == s.as_ref())
}

/// A part rect the layout gave `node` (`PaintCx::parts`), or `None`.
pub fn part(cx: &PaintCx, node: &ResolvedNode, name: &'static str) -> Option<Rect> {
    cx.parts.get(&(node.id.clone(), name)).copied()
}

/// The `size` DS prop → control height px (`--we-component-height-*`:
/// xs 24, sm 28, md 34, lg 44, xl 56 — the themes' recorded scale, rounded).
pub fn control_height(node: &ResolvedNode) -> f32 {
    match prop_enum(node, "size", &["xs", "sm", "md", "lg", "xl"]).unwrap_or("md") {
        "xs" => 24.0,
        "sm" => 28.0,
        "lg" => 44.0,
        "xl" => 56.0,
        _ => 34.0,
    }
}
