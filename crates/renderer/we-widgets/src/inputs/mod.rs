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

/// The text a controlled input shows this frame, honouring the rule "the
/// prop wins": a draft typed against an older `value` prop is dropped the
/// moment the prop moves.
pub(crate) fn shown_text(edit: &EditState, node: &ResolvedNode) -> String {
    let prop = props::prop(node, "value");
    let seen = edit.seen_prop(&node.id);
    if !seen.is_undefined() && !seen.strict_eq(prop) {
        return prop.js_string();
    }
    match edit.draft(&node.id) {
        Some(draft) => draft,
        None => prop.js_string(),
    }
}

/// Clear a stale draft (called before painting when the prop moved).
pub(crate) fn reconcile_draft(edit: &mut EditState, node: &ResolvedNode) {
    let seen = edit.seen_prop(&node.id);
    if !seen.is_undefined() && !seen.strict_eq(props::prop(node, "value")) {
        edit.clear_draft(&node.id);
    }
}

/// `true` while a `disabled` prop is truthy.
pub(crate) fn disabled(node: &ResolvedNode) -> bool {
    props::prop_bool(node, "disabled").unwrap_or(false)
}

/// The AccessKit label a `we-form-field` parent asked us to carry, else the
/// node's own `label`/`placeholder`.
pub(crate) fn access_label(cx: &PaintCx, node: &ResolvedNode) -> String {
    if let we_expr::Value::Str(s) = cx.edit.field(&node.id, "aria_label") {
        if !s.is_empty() {
            return s.to_string();
        }
    }
    props::prop_str(node, "label")
        .or_else(|| props::prop_str(node, "placeholder"))
        .unwrap_or_else(|| node.ty.to_string())
}
