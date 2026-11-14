//! Prop reads layout needs — safe accessors over a `ResolvedNode`'s props
//! and one border-side arithmetic helper the taffy style mapping uses.
//!
//! These mirror the helpers the frontend's own prop toolbox re-exports, so a
//! single implementation serves both layout and widget code.
use indexmap::IndexMap;
use we_expr::Value;
use we_style::Size;
use we_template::ResolvedNode;

/// The resolved DS-prop bag style resolution reads — what `props` becomes
/// after the widget's defaults and the `style`/`styles` escape hatches merge.
pub type Bag = IndexMap<std::sync::Arc<str>, Value>;

/// `props[key]` or `Undefined`.
pub fn prop<'a>(node: &'a ResolvedNode, key: &str) -> &'a Value {
    node.props.get(key).unwrap_or(&Value::Undefined)
}

/// `props[key]` as a string — `Str` only; anything else is a wrong type.
pub fn prop_str<'a>(node: &'a ResolvedNode, key: &str) -> Option<&'a str> {
    match prop(node, key) {
        Value::Str(s) => Some(s.as_ref()),
        _ => None,
    }
}

/// `props[key]` as an f64 — `Num` or a numeric `Str` ("12px" loses its unit
/// the way `size="12px"` does on `we-icon`); anything else `None`.
pub fn prop_num(node: &ResolvedNode, key: &str) -> Option<f64> {
    match prop(node, key) {
        Value::Num(n) => Some(*n),
        Value::Str(s) => {
            let s = s.trim();
            s.parse::<f64>()
                .ok()
                .or_else(|| s.strip_suffix("px").and_then(|p| p.parse().ok()))
        }
        _ => None,
    }
}

/// One border side's painted width in the frontend's unit — the inset it
/// adds inside the border box. `none`/`hidden`/absent sides inset 0; a
/// painting side with no width is CSS `medium` (3).
pub fn border_side_px(
    side: &Option<we_style::BorderSide>,
    font_px: f32,
    root_px: f32,
    viewport: Size,
) -> f32 {
    let Some(side) = side else { return 0.0 };
    if matches!(
        side.kind,
        we_style::BorderKind::None | we_style::BorderKind::Hidden
    ) {
        return 0.0;
    }
    side.width
        .as_ref()
        .and_then(|d| d.to_px(font_px, root_px, viewport))
        .unwrap_or(3.0)
}

/// `props[key]` truthy — `Bool` and `Num` read directly; `Str` the way the
/// resolver leaves tokens; anything else `false`.
pub fn prop_bool(node: &ResolvedNode, key: &str) -> bool {
    prop(node, key).truthy()
}

/// `props[key]` as an object (the `style`/`styles` bags).
pub fn prop_obj<'a>(
    node: &'a ResolvedNode,
    key: &str,
) -> Option<&'a IndexMap<std::sync::Arc<str>, Value>> {
    match prop(node, key) {
        Value::Obj(o) => Some(o.as_ref()),
        _ => None,
    }
}
