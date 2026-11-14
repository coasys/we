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
        }
        if Self::has_slot(node, "icon") {
            row_parts.push(
                PartSpec::group("icon", Pick::Named("icon".into()), Direction::Row)
                    .aligned(we_style::ItemAlign::Center),
            );
        }
        row_parts.push(
            PartSpec::group("label", Pick::Default, Direction::Row)
                .aligned(we_style::ItemAlign::Center),
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
        let response = cx.interact_label(row, &label, egui::Role::Button, &node.id, "row");
        let visuals = cx.ui.visuals().clone();
        let selected = Self::selected(cx, node);
        if selected {
            let fill = props::tone_color(style, "soft", visuals.selection.bg_fill);
            cx.ui.painter().rect_filled(row, 4.0, fill);
        } else if response.hovered() {
            cx.ui
                .painter()
                .rect_filled(row, 4.0, visuals.widgets.hovered.bg_fill);
        }
        // The `label`/`value` prop is the row text when the default slot
        // holds no children (real content children paint in the label part).
        let has_default_children = node.children.iter().any(|c| match c {
            ResolvedChild::Node(n) => n.slot.is_none(),
            ResolvedChild::Text(_) => true,
        });
        if !has_default_children {
            if let Some(label_rect) = cx.parts.get(&(node.id.clone(), "label")).copied() {
                // The empty label group has no width — the text runs to the
                // row's end, unwrapped (the caret part leads it).
                let wrap = (row.max.x - label_rect.min.x).max(1.0);
                let g = crate::text::text_job(&label, style, cx.ui.ctx(), wrap, true, None);
                cx.ui.painter().galley(
                    egui::pos2(label_rect.min.x, label_rect.center().y - g.size().y / 2.0),
                    g,
                    props::text_color(style, cx.ui.ctx()),
                );
            }
        }
        if Self::expandable(node) {
            // The caret — ▸ closed / ▾ open; its own click toggles open.
            if let Some(caret) = cx.parts.get(&(node.id.clone(), "caret")).copied() {
                let caret_label = if Self::open(node) {
                    "collapse"
                } else {
                    "expand"
                };
                let caret_response =
                    cx.interact_label(caret, caret_label, egui::Role::Button, &node.id, "caret");
                // A triangle, not a glyph — the kittest font set has no ▸/▾.
                let c = caret.center();
                let (w, h) = (3.0, 4.0);
                let points = if Self::open(node) {
                    // Down-pointing.
                    vec![
                        c + egui::vec2(-w - 1.0, -h / 2.0),
                        c + egui::vec2(w + 1.0, -h / 2.0),
                        c + egui::vec2(0.0, h / 2.0 + 2.0),
                    ]
                } else {
                    // Right-pointing.
                    vec![
                        c + egui::vec2(-w / 2.0, -h),
                        c + egui::vec2(-w / 2.0, h),
                        c + egui::vec2(w / 2.0 + 2.0, 0.0),
                    ]
                };
                cx.ui.painter().add(egui::Shape::convex_polygon(
                    points,
                    visuals.weak_text_color(),
                    egui::Stroke::NONE,
                ));
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
