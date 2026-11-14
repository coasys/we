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

/// `value` as shown text — TS binds `this.value ?? ''`, so a missing or
/// null value is an empty field, never the text `"undefined"`/`"null"`
/// that `js_string` would print.
fn value_text(node: &ResolvedNode) -> String {
    props::prop(node, "value").to_text().to_string()
}

/// The text a controlled input shows this frame. Live inputs follow the
/// prop-writes-the-buffer rule; commit-only inputs keep their draft
/// until an external write moves the prop (see [`live`]).
pub(crate) fn shown_text(edit: &EditState, node: &ResolvedNode) -> String {
    let prop_v = props::prop(node, "value");
    let prop = value_text(node);
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
        matches!(edit.draft(&node.id), Some(d) if *d != *prop.to_text())
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
        return value_text(node);
    }
    edit.draft(&node.id).unwrap_or_else(|| value_text(node))
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

/// `true` while a `readonly` prop is truthy — the DOM attribute's spell,
/// not `readOnly` (input.ts:237, textarea.ts:214).
pub(crate) fn readonly(node: &ResolvedNode) -> bool {
    props::prop_flag(node, "readonly").unwrap_or(false)
}

/// Whether this node's TextEdit held egui focus last frame — the
/// prediction used before `ui.put`, when the response doesn't exist yet.
/// The widget learns the focused id from its own `has_focus` frame (egui
/// composes it from the ui scope, so remembering beats guessing) and
/// stores it as hex text: `Id::new` re-hashes its input and `Id::value`
/// can exceed 2^53, so neither an `Id` rebuild nor a `Value::Num`
/// round-trips.
pub(crate) fn focused_last_frame(cx: &PaintCx, node: &ResolvedNode) -> bool {
    match cx.edit.field(&node.id, "te_focus_id") {
        we_expr::Value::Str(raw) => u64::from_str_radix(&raw, 16)
            .ok()
            .is_some_and(|raw| cx.ui.memory(|m| m.focused().map(|i| i.value())) == Some(raw)),
        _ => false,
    }
}

/// Store the focused id when this frame's response holds it — the other
/// half of [`focused_last_frame`]. A fresh focus win also logs its rect so
/// an enclosing scroller can bring a Tab-visited field into view.
pub(crate) fn remember_focus(cx: &mut PaintCx, node: &ResolvedNode, response: &egui::Response) {
    if response.has_focus() {
        if let Some(fid) = cx.ui.memory(|m| m.focused()) {
            cx.edit.set_field(
                &node.id,
                "te_focus_id",
                we_expr::Value::Str(format!("{:x}", fid.value()).into()),
            );
        }
    }
    if response.gained_focus() {
        cx.hits.gained.push(response.rect);
    }
}

/// DOM `readonly`: focus, selection and copy stay, edits don't. egui has
/// no read-only flag — `interactive(false)` kills selection too — so the
/// mutating input events are consumed before the TextEdit sees them.
/// `multiline` decides whether Enter inserts a newline to block.
/// Call only when [`focused_last_frame`] is true, or the consume would
/// steal a *different* widget's keys.
pub(crate) fn consume_readonly_edits(cx: &PaintCx, multiline: bool) {
    cx.ui.input_mut(|i| {
        i.events.retain(|e| {
            !match e {
                egui::Event::Text(_)
                | egui::Event::Paste(_)
                | egui::Event::Cut
                | egui::Event::Ime(_) => true,
                egui::Event::Key {
                    key,
                    pressed: true,
                    modifiers,
                    ..
                } => match key {
                    egui::Key::Backspace | egui::Key::Delete => true,
                    egui::Key::Enter => multiline,
                    // Ctrl/Cmd+Z (undo) and +Y (redo) write the buffer too.
                    egui::Key::Z | egui::Key::Y => modifiers.command,
                    _ => false,
                },
                _ => false,
            }
        });
    });
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
