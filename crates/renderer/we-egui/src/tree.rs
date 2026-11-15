//! `we-tree` + `we-tree-item` — the tree panel's pair.
//!
//! A `we-tree-item` is WE's accordion row: a `row` part holding the caret,
//! the `icon` slot, the default-slot children and the `actions` slot, over a
//! `children` part (the `slot="children"` nodes) that exists only while
//! `open` is truthy — `open` is controlled state like the TS primitive;
//! toggling goes through `onOpenChange`, which the schema wires to
//! `$setLocal`/`$toggleLocal`. Clicking the row emits `onSelect` with
//! `{detail: {value}}`.
//!
//! The tree's `selected`/`caret`/`lead` props shape every item — layout
//! handles `caret`/`lead` (it sees the ancestor); `selected` gets stamped
//! onto each item's scratch (`_tree_sel`) by the tree's paint so the row can
//! compare `value` against it.
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_style::Style;
use we_template::{NodeId, ResolvedChild, ResolvedNode};

use crate::props;
use crate::{
    Direction, MeasureCx, PaintCx, PartSpec, PartsSpec, Pick, Rect, Size, Widget, WidgetKind,
};

/// Row height + caret width — WE's compact tree row.
const ROW_H: f32 = 24.0;
const CARET_W: f32 = 16.0;
const INDENT: f32 = 16.0;

/// The scratch key the tree stamps its `selected` value under.
const SEL_KEY: &str = "_tree_sel";

/// `we-tree` — a plain container whose children are `we-tree-item`s.
#[derive(Debug, Default)]
pub struct Tree;

impl Tree {
    /// Stamp `selected` on every descendant `we-tree-item` — the paint walk
    /// is the only place both trees and items meet a live `EditState`.
    fn stamp(edit: &mut crate::EditState, node: &ResolvedNode, sel: &Value) {
        for child in &node.children {
            if let ResolvedChild::Node(n) = child {
                if n.ty.as_ref() == "we-tree-item" {
                    props::scratch_set(&mut edit.data, &n.id, SEL_KEY, sel.clone());
                }
                Self::stamp(edit, n, sel);
            }
        }
    }
}

impl Widget for Tree {
    fn type_name(&self) -> &'static str {
        "we-tree"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Container
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        Size::ZERO
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        crate::containers::paint_container(cx, node, style, rect);
        if let Some(sel) = node.props.get("selected") {
            Self::stamp(cx.edit, node, sel);
        }
        cx.label(rect, "we-tree");
    }
}

/// `we-tree-item` — the accordion row. [`Widget::parts_spec`] lays out
/// `row` (caret + icon + default children + actions) over `children`
/// (slotted kids) when the item is open.
#[derive(Debug, Default)]
pub struct TreeItem;

impl TreeItem {
    /// `node`'s children with `slot="children"` — the nested items.
    fn has_nested(node: &ResolvedNode) -> bool {
        node.children.iter().any(|c| match c {
            ResolvedChild::Node(n) => n.slot.as_deref() == Some("children"),
            _ => false,
        })
    }

    fn has_slot(node: &ResolvedNode, slot: &str) -> bool {
        node.children.iter().any(|c| match c {
            ResolvedChild::Node(n) => n.slot.as_deref() == Some(slot),
            _ => false,
        })
    }

    /// The caret shows for nested items and `expandable` ones — a row can
    /// force the disclosure affordance without children.
    fn expandable(node: &ResolvedNode) -> bool {
        Self::has_nested(node) || props::prop_bool(node, "expandable")
    }

    fn open(node: &ResolvedNode) -> bool {
        node.props.get("open").is_some_and(|v| v.truthy())
    }

    fn value(node: &ResolvedNode) -> Value {
        node.props.get("value").cloned().unwrap_or(Value::Null)
    }

    /// The tree's `selected` == this item's `value` → the selected row.
    fn selected(cx: &PaintCx, node: &ResolvedNode) -> bool {
        props::scratch(&cx.edit.data, &node.id, SEL_KEY)
            .is_some_and(|sel| sel.strict_eq(&Self::value(node)))
    }

    /// A label for tests: the item's `label`/`value`, else its type.
    fn label_text(node: &ResolvedNode) -> String {
        for key in ["label", "value"] {
            if let Some(v) = node.props.get(key) {
                let s = v.to_text();
                if !s.is_empty() {
                    return s.to_string();
                }
            }
        }
        "we-tree-item".to_string()
    }
}

impl Widget for TreeItem {
    fn type_name(&self) -> &'static str {
        "we-tree-item"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Container
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        Size::new(0.0, ROW_H)
    }

    fn parts_spec(&self, node: &ResolvedNode) -> Option<PartsSpec> {
        let mut row_parts = Vec::new();
        if Self::expandable(node) {
            row_parts.push(PartSpec::fixed("caret", CARET_W, ROW_H));
        } else {
            // A leaf keeps the caret's room empty so its content lines up;
            // layout drops it when the tree puts the caret at the end.
            row_parts.push(PartSpec::fixed("caret-slot", CARET_W, ROW_H));
        }
        if Self::has_slot(node, "icon") {
            row_parts.push(
                PartSpec::group("icon", Pick::Named("icon".into()), Direction::Row)
                    .aligned(we_style::ItemAlign::Center),
            );
        }
        // `[part='content']`: `flex: 1 1 auto` — the row's own content takes
        // what the caret leaves, so a trailing count docks at the edge.
        row_parts.push(
            PartSpec::group("label", Pick::Default, Direction::Row)
                .aligned(we_style::ItemAlign::Center)
                .growing(1.0),
        );
        if Self::has_slot(node, "actions") {
            row_parts.push(
                PartSpec::group("actions", Pick::Named("actions".into()), Direction::Row)
                    .aligned(we_style::ItemAlign::Center),
            );
        }
        let mut parts = vec![PartSpec::nested("row", Direction::Row, row_parts)
            .aligned(we_style::ItemAlign::Center)
            .min_height(ROW_H)];
        if Self::open(node) {
            parts.push(
                PartSpec::group(
                    "children",
                    Pick::Named("children".into()),
                    Direction::Column,
                )
                // Layout sets the indent from the tree's `caret`/`lead`.
                .indented(INDENT),
            );
        }
        Some(PartsSpec {
            direction: Direction::Column,
            parts,
        })
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let label = Self::label_text(node);
        let row = cx
            .parts
            .get(&(node.id.clone(), "row"))
            .copied()
            .unwrap_or(rect);

        // The row: selected fill under hover fill, click → onSelect.
        let response =
            cx.interact_label(row, &label, egui::Role::Button, &node.id, "row", true, None);
        let visuals = cx.ui.visuals().clone();
        let selected = Self::selected(cx, node);
        // The primitive's row: the tree radius, the theme's `selected`
        // variant (fill, and a leading bar in its border colour and width,
        // square where the bar is), `item-hover` under the pointer.
        let ctx = cx.ui.ctx().clone();
        let px =
            |name: &str| props::token_px(&ctx, name, 16.0, 16.0, we_style::Size::new(0.0, 0.0));
        let radius = px("--we-theme-tree-radius")
            .or_else(|| px("--we-radius-300"))
            .unwrap_or(8.0);
        let bar = if selected {
            px("--we-theme-tree--selected-border-width").unwrap_or(0.0)
        } else {
            0.0
        };
        let lit = if selected {
            Some(
                props::token_color(&ctx, "--we-theme-tree--selected-fill")
                    .or_else(|| props::role_color(&ctx, "selected"))
                    .unwrap_or_else(|| props::tone_color(style, "soft", visuals.selection.bg_fill)),
            )
        } else if response.hovered() {
            Some(props::role_color(&ctx, "item-hover").unwrap_or(visuals.widgets.hovered.bg_fill))
        } else {
            None
        };
        if let Some(fill) = lit {
            let r = radius.round().clamp(0.0, 255.0) as u8;
            let lead = if bar > 0.0 { 0 } else { r };
            let corners = egui::CornerRadius {
                nw: lead,
                sw: lead,
                ne: r,
                se: r,
            };
            cx.ui.painter().rect_filled(row, corners, fill);
        }
        if bar > 0.0 {
            if let Some(color) = props::token_color(&ctx, "--we-theme-tree--selected-border") {
                let strip = egui::Rect::from_min_size(row.min, egui::vec2(bar, row.height()));
                cx.ui.painter().rect_filled(strip, 0.0, color);
            }
        }
        // The web component's row text is the default slot's content alone
        // — `label` is not a property it declares. Slot content paints in
        // the `label` part; a prop-only item is an empty row, as on the web.
        if Self::expandable(node) {
            // The caret — ▸ closed / ▾ open; its own click toggles open.
            if let Some(caret) = cx.parts.get(&(node.id.clone(), "caret")).copied() {
                let caret_label = if Self::open(node) {
                    "collapse"
                } else {
                    "expand"
                };
                let caret_response = cx.interact_label(
                    caret,
                    caret_label,
                    egui::Role::Button,
                    &node.id,
                    "caret",
                    true,
                    None,
                );
                // tree.ts's chevron: `M3 1.5 L7 5 L3 8.5` in a 10px box
                // centred in the caret, stroked 1.5px round in
                // `text-faint`, and turned a quarter (`rotate(90deg)`) when
                // the row is open. At the row's end it is faint (0.6).
                let c = caret.center();
                let quarter = Self::open(node);
                let points = [(-2.0, -3.5), (2.0, 0.0), (-2.0, 3.5)]
                    .map(|(x, y): (f32, f32)| {
                        if quarter {
                            c + egui::vec2(-y, x)
                        } else {
                            c + egui::vec2(x, y)
                        }
                    })
                    .to_vec();
                let mut color = props::role_color(cx.ui.ctx(), "text-faint")
                    .unwrap_or_else(|| visuals.weak_text_color());
                let at_end = cx
                    .parts
                    .get(&(node.id.clone(), "label"))
                    .is_some_and(|label| caret.min.x >= label.max.x);
                if at_end {
                    color = color.gamma_multiply(0.6);
                }
                cx.ui
                    .painter()
                    .add(egui::Shape::line(points, egui::Stroke::new(1.5, color)));
                if caret_response.clicked() {
                    cx.emit(
                        &node.id,
                        "onOpenChange",
                        Value::Obj(Arc::new(IndexMap::from([(
                            "detail".into(),
                            Value::Obj(Arc::new(IndexMap::from([(
                                "open".into(),
                                Value::Bool(!Self::open(node)),
                            )]))),
                        )]))),
                    );
                }
            }
        }
        if response.clicked() {
            cx.emit(&node.id, "onSelect", detail_value(Self::value(node)));
        }
    }
}

/// `{detail: {value}}` — the tree-item-select payload.
fn detail_value(value: Value) -> Value {
    let mut detail = IndexMap::new();
    detail.insert("value".into(), value);
    let mut outer = IndexMap::new();
    outer.insert("detail".into(), Value::Obj(Arc::new(detail)));
    Value::Obj(Arc::new(outer))
}

/// Compile-time guarantee `NodeId` stayed `Clone` — tree-stamping relies on it.
const _: fn(&NodeId) -> NodeId = |n| n.clone();
