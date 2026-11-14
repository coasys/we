//! `we-tree` + `we-tree-item` — the tree panel's pair.
//!
//! A `we-tree-item` is WE's accordion row: a `row` part (caret + the
//! default-slot children) over a `children` part (the `slot="children"`
//! nodes) that exists only while `open` is truthy — `open` is controlled
//! state like the TS primitive; toggling goes through `onOpenChange`, which
//! the schema wires to `$setLocal`/`$toggleLocal`. Clicking the row emits
//! `onSelect` with `{detail: {value}}`; WE's tree-item-select carries the
//! item's `value` prop.
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_style::Style;
use we_template::ResolvedNode;

use crate::{
    Direction, MeasureCx, PaintCx, PartSpec, PartsSpec, Pick, Rect, Size, Widget, WidgetKind,
};

/// Row height + caret width — WE's compact tree row.
const ROW_H: f32 = 24.0;
const CARET_W: f32 = 16.0;
const INDENT: f32 = 16.0;

/// `we-tree` — a plain container whose children are `we-tree-item`s.
#[derive(Debug, Default)]
pub struct Tree;

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

    fn paint(&self, cx: &mut PaintCx, _node: &ResolvedNode, _style: &Style, rect: Rect) {
        cx.label(rect, "we-tree");
    }
}

/// `we-tree-item` — the accordion row. [`Widget::parts_spec`] lays out
/// `row` (caret + default children) over `children` (slotted kids) when the
/// item is open.
#[derive(Debug, Default)]
pub struct TreeItem;

impl TreeItem {
    /// `node`'s children with `slot="children"` — the nested items.
    fn has_nested(node: &ResolvedNode) -> bool {
        node.children.iter().any(|c| match c {
            we_template::ResolvedChild::Node(n) => n.slot.as_deref() == Some("children"),
            _ => false,
        })
    }

    fn open(node: &ResolvedNode) -> bool {
        node.props.get("open").is_some_and(|v| v.truthy())
    }

    fn value(node: &ResolvedNode) -> Value {
        node.props.get("value").cloned().unwrap_or(Value::Null)
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
        if Self::has_nested(node) {
            row_parts.push(PartSpec::fixed("caret", CARET_W, ROW_H));
        }
        row_parts.push(PartSpec::group("label", Pick::Default, Direction::Row));
        let mut parts = vec![PartSpec::nested("row", Direction::Row, row_parts)];
        if Self::open(node) {
            parts.push(
                PartSpec::group("children", Pick::Named("children".into()), Direction::Column)
                    .indented(INDENT),
            );
        }
        Some(PartsSpec {
            direction: Direction::Column,
            parts,
        })
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        let label = Self::label_text(node);
        let row = cx
            .parts
            .get(&(node.id.clone(), "row"))
            .copied()
            .unwrap_or(rect);

        // The row: hover + selected fill, click → onSelect {detail:{value}}.
        let response = cx.interact_label(row, &label, egui::Role::Button, &node.id, "row");
        let visuals = cx.ui.visuals().clone();
        if response.hovered() {
            cx.ui
                .painter()
                .rect_filled(row, 4.0, visuals.widgets.hovered.bg_fill);
        }
        if Self::has_nested(node) {
            // The caret — ▸ closed / ▾ open; its own click toggles open.
            if let Some(caret) = cx.parts.get(&(node.id.clone(), "caret")).copied() {
                let caret_label = if Self::open(node) { "collapse" } else { "expand" };
                let caret_response =
                    cx.interact_label(caret, caret_label, egui::Role::Button, &node.id, "caret");
                let glyph = if Self::open(node) { "▾" } else { "▸" };
                cx.ui.painter().text(
                    caret.center(),
                    egui::Align2::CENTER_CENTER,
                    glyph,
                    egui::FontId::default(),
                    visuals.weak_text_color(),
                );
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
