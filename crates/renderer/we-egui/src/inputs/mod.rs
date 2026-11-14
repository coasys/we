//! Input widgets — `we-input`, `we-textarea`, `we-select`, `we-switch`,
//! `we-slider`, `we-number-input`, `we-form-field`. All of them are
//! controlled: the shown value is the `value` prop, typing emits an event
//! through [`crate::PaintCx::emit`], and [`crate::EditState`] holds the
//! in-flight draft so the cursor does not jump between keystroke and
//! re-resolution.
mod form_field;
mod input;
mod number_input;
mod select;
mod slider;
mod switch;
mod textarea;

pub use form_field::FormField;
pub use input::Input;
pub use number_input::NumberInput;
pub use select::Select;
pub use slider::Slider;
pub use switch::Switch;
pub use textarea::Textarea;

use we_template::ResolvedNode;

use crate::props;
use crate::{EditState, PaintCx};

/// `onInput` wired: the `value` prop is fully controlled — it writes the
/// buffer whenever it differs, so a rejecting setter reverts the
/// keystroke. Commit-only (`onChange` without `onInput`): the field keeps
/// its own text like the DOM element — the draft lives while the prop is
/// still the one it was typed against (`seen`), and only a write that
/// moves the prop off `seen` drops it.
fn live(node: &ResolvedNode) -> bool {
    node.handlers.contains_key("onInput")
}

/// The text a controlled input shows this frame. Live inputs follow the
/// prop-writes-the-buffer rule; commit-only inputs keep their draft
/// until an external write moves the prop (see [`live`]).
pub(crate) fn shown_text(edit: &EditState, node: &ResolvedNode) -> String {
    let prop_v = props::prop(node, "value");
    let prop = prop_v.js_string();
    match edit.draft(&node.id) {
        Some(draft) if live(node) => {
            if draft != prop {
                prop
            } else {
                draft
            }
        }
        Some(draft) => {
            let seen = edit.seen_prop(&node.id);
            if !seen.is_undefined() && !seen.strict_eq(prop_v) {
                prop
            } else {
                draft
            }
        }
        None => prop,
    }
}

/// Drop a draft the prop has moved past (see [`shown_text`]).
pub(crate) fn reconcile_draft(edit: &mut EditState, node: &ResolvedNode) {
    let prop = props::prop(node, "value");
    let dead = if live(node) {
        matches!(edit.draft(&node.id), Some(d) if d != prop.js_string())
    } else {
        let seen = edit.seen_prop(&node.id);
        !seen.is_undefined() && !seen.strict_eq(prop)
    };
    if dead {
        edit.clear_draft(&node.id);
    }
}

/// The number input's draft is *validated* text — an invalid string must
/// survive until blur, not die the next frame. It bridges differently: the
/// draft lives while the `value` prop stays the one it was typed against,
/// and an external write (`seen` moved) drops it.
pub(crate) fn shown_num(edit: &EditState, node: &ResolvedNode) -> String {
    let prop = props::prop(node, "value");
    let seen = edit.seen_prop(&node.id);
    if !seen.is_undefined() && !seen.strict_eq(prop) {
        return prop.js_string();
    }
    edit.draft(&node.id).unwrap_or_else(|| prop.js_string())
}

/// Drop a stale number draft when the prop moved (see [`shown_num`]).
pub(crate) fn reconcile_num(edit: &mut EditState, node: &ResolvedNode) {
    let seen = edit.seen_prop(&node.id);
    if !seen.is_undefined() && !seen.strict_eq(props::prop(node, "value")) {
        edit.clear_draft(&node.id);
    }
}

/// `true` while a `disabled` prop is truthy.
pub(crate) fn disabled(node: &ResolvedNode) -> bool {
    props::prop_flag(node, "disabled").unwrap_or(false)
}

/// The AccessKit label a `we-form-field` parent asked us to carry, else the
/// node's own `label`/`placeholder`.
pub(crate) fn access_label(cx: &PaintCx, node: &ResolvedNode) -> String {
    // A `we-form-field` ancestor names us — nearest first.
    for owner in cx.ancestors().iter().rev() {
        if let we_expr::Value::Str(s) = cx.edit.field(owner, "aria_label") {
            if !s.is_empty() {
                return s.to_string();
            }
        }
    }
    if let we_expr::Value::Str(s) = cx.edit.field(&node.id, "aria_label") {
        if !s.is_empty() {
            return s.to_string();
        }
    }
    props::prop_string(node, "label")
        .or_else(|| props::prop_string(node, "placeholder"))
        .unwrap_or_else(|| node.ty.to_string())
}
