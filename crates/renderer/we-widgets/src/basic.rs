//! The E3a six: `Row`, `Column`, `we-text`, `we-icon`, `we-button`. Enough
//! of the registry for the tree panel; E5a/E5b fill in the rest.
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_style::Style;
use we_template::ResolvedNode;

use crate::{MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

/// A `label`/`text`/`name` prop as display text.
fn text_of(node: &ResolvedNode, keys: &[&str]) -> String {
    for key in keys {
        if let Some(v) = node.props.get(*key) {
            let s = v.to_text();
            if !s.is_empty() {
                return s.to_string();
            }
        }
    }
    String::new()
}

/// `Row` / `Column` — a plain flex container. All it paints is an
/// accessibility label; the frame paints its children.
#[derive(Debug, Default)]
pub struct Row;

impl Widget for Row {
    fn type_name(&self) -> &'static str {
        "Row"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Container
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        Size::ZERO
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        cx.label(rect, "Row");
        let _ = node;
    }
}

/// `Column` — the default stack direction.
#[derive(Debug, Default)]
pub struct Column;

impl Widget for Column {
    fn type_name(&self) -> &'static str {
        "Column"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Container
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        Size::ZERO
    }

    fn paint(&self, cx: &mut PaintCx, _node: &ResolvedNode, _style: &Style, rect: Rect) {
        cx.label(rect, "Column");
    }
}

/// `we-text` — a label. `text` prop (or `label`) is drawn and is the
/// AccessKit name tests query.
#[derive(Debug, Default)]
pub struct Text;

impl Text {
    fn content(node: &ResolvedNode) -> String {
        let prop = text_of(node, &["text", "label", "value"]);
        if !prop.is_empty() {
            return prop;
        }
        // The text lives in the children — `children: ["Feed"]`.
        node.children
            .iter()
            .filter_map(|c| match c {
                we_template::ResolvedChild::Text(t) => Some(t.as_ref()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("")
    }
}

impl Widget for Text {
    fn type_name(&self) -> &'static str {
        "we-text"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }

    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        let galley = cx.ctx.fonts_mut(|f| {
            f.layout_no_wrap(
                Self::content(node),
                egui::FontId::default(),
                egui::Color32::WHITE,
            )
        });
        galley.size()
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        let text = Self::content(node);
        cx.ui.painter().text(
            rect.min,
            egui::Align2::LEFT_TOP,
            &text,
            egui::FontId::default(),
            cx.ui.visuals().text_color(),
        );
        cx.label(rect, &text);
    }
}

/// `we-icon` — E3a draws the icon name as text (the icon font arrives with
/// E5a's asset work); `name` is the AccessKit label.
#[derive(Debug, Default)]
pub struct Icon;

impl Widget for Icon {
    fn type_name(&self) -> &'static str {
        "we-icon"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }

    fn measure(&self, _cx: &MeasureCx, node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        // Icon square — `size` prop in px when authored.
        let side = match node.props.get("size") {
            Some(Value::Num(n)) => *n as f32,
            Some(Value::Str(s)) => s.trim_end_matches("px").parse().unwrap_or(16.0),
            _ => 16.0,
        };
        Size::splat(side)
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        let name = text_of(node, &["name", "icon"]);
        cx.ui.painter().rect_stroke(
            rect,
            2.0,
            egui::Stroke::new(1.0, cx.ui.visuals().weak_text_color()),
            egui::StrokeKind::Inside,
        );
        cx.label(rect, &name);
    }
}

/// `we-avatar` — a colored circle with initials (E5a draws the real avatar).
#[derive(Debug, Default)]
pub struct Avatar;

impl Widget for Avatar {
    fn type_name(&self) -> &'static str {
        "we-avatar"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        Size::splat(20.0)
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        cx.ui.painter().circle_filled(
            rect.center(),
            rect.width().min(rect.height()) / 2.0,
            cx.ui.visuals().widgets.inactive.bg_fill,
        );
        cx.label(rect, &text_of(node, &["name", "alt"]));
    }
}

/// `we-badge` — a small pill; children (the count text) paint inside.
#[derive(Debug, Default)]
pub struct Badge;

impl Widget for Badge {
    fn type_name(&self) -> &'static str {
        "we-badge"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Container
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        Size::new(18.0, 16.0)
    }

    fn paint(&self, cx: &mut PaintCx, _node: &ResolvedNode, _style: &Style, rect: Rect) {
        cx.ui.painter().rect_filled(
            rect,
            rect.height() / 2.0,
            cx.ui.visuals().widgets.inactive.bg_fill,
        );
        cx.label(rect, "we-badge");
    }
}

/// `we-tooltip` — a passthrough container (the tip itself is a hover layer,
/// E5a's overlay work).
#[derive(Debug, Default)]
pub struct Tooltip;

impl Widget for Tooltip {
    fn type_name(&self) -> &'static str {
        "we-tooltip"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Container
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        Size::ZERO
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        cx.label(rect, &text_of(node, &["label", "text"]));
    }
}

/// `we-animated-icon` — static icon stand-in.
#[derive(Debug, Default)]
pub struct AnimatedIcon;

impl Widget for AnimatedIcon {
    fn type_name(&self) -> &'static str {
        "we-animated-icon"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        Size::splat(14.0)
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        cx.ui.painter().circle_stroke(
            rect.center(),
            rect.width().min(rect.height()) / 2.0,
            egui::Stroke::new(1.5, cx.ui.visuals().text_color()),
        );
        cx.label(rect, &text_of(node, &["name", "icon"]));
    }
}

/// `we-timestamp` — its `value` rendered as text.
#[derive(Debug, Default)]
pub struct Timestamp;

impl Widget for Timestamp {
    fn type_name(&self) -> &'static str {
        "we-timestamp"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }

    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        let galley = cx.ctx.fonts_mut(|f| {
            f.layout_no_wrap(
                text_of(node, &["value"]),
                egui::FontId::proportional(10.0),
                egui::Color32::WHITE,
            )
        });
        galley.size()
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        let text = text_of(node, &["value"]);
        cx.ui.painter().text(
            rect.min,
            egui::Align2::LEFT_TOP,
            &text,
            egui::FontId::proportional(10.0),
            cx.ui.visuals().weak_text_color(),
        );
        cx.label(rect, &text);
    }
}

/// `we-button` — `label` text, a click emits `onClick` with `{detail:{}}`
/// (WE buttons carry no payload; the handler reads `local`/`event`).
#[derive(Debug, Default)]
pub struct Button;

impl Widget for Button {
    fn type_name(&self) -> &'static str {
        "we-button"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }

    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        let galley = cx.ctx.fonts_mut(|f| {
            f.layout_no_wrap(
                text_of(node, &["label", "text"]),
                egui::FontId::default(),
                egui::Color32::WHITE,
            )
        });
        galley.size() + egui::vec2(24.0, 12.0)
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        let label = text_of(node, &["label", "text"]);
        let response = cx.interact_label(rect, &label, egui::Role::Button, &node.id, "button");
        let visuals = cx.ui.visuals();
        let fill = if response.hovered() {
            visuals.widgets.hovered.bg_fill
        } else {
            visuals.widgets.inactive.bg_fill
        };
        cx.ui.painter().rect_filled(rect, 4.0, fill);
        cx.ui.painter().text(
            rect.center(),
            egui::Align2::CENTER_CENTER,
            &label,
            egui::FontId::default(),
            visuals.text_color(),
        );
        if response.clicked() {
            cx.emit(&node.id, "onClick", Value::Obj(Arc::new(IndexMap::new())));
        }
    }
}
