//! The box containers: `Row`, `Column`, `Grid`, `Card`, `div`, `$lane`.
//!
//! A container's own paint is its [`Style`] box — background, borders,
//! radius, shadows, opacity — plus its AccessKit label. Children paint on
//! top, walked by the frame.
use we_expr::Value;
use we_style::Style;
use we_template::ResolvedNode;

use crate::defaults::view_of;
use crate::props;
use crate::{MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

/// The shared container paint: box chrome + label. `label`/`data-we-id`
/// name it when authored; the type name is the fallback.
pub(crate) fn paint_container(cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
    let view = view_of(cx.ui.ctx());
    props::paint_box(
        cx.ui.painter(),
        rect,
        style,
        props::text_color(style, cx.ui),
        view,
    );
    let name = props::prop_text(node, "label")
        .or_else(|| props::prop_text(node, "data-we-id"))
        .map(|s| s.to_string())
        .unwrap_or_else(|| node.ty.to_string());
    cx.label(rect, &name);
    container_events(cx, node, rect);
}

/// Authored pointer handlers — createLayoutComponent forwards
/// onClick/onMouseEnter/onMouseLeave to the element, so the box answers
/// them. `onClick` reads the pointer itself rather than egui's widget
/// hit-test: DOM clicks bubble — a press landing on a child fires the
/// child's handler AND the container's. `mouseenter`/`mouseleave` fire on
/// the boundary transition (the children inside the box don't re-enter).
fn container_events(cx: &mut PaintCx, node: &ResolvedNode, rect: Rect) {
    // Covered by a raised box painted over it (the hover-expanded rail
    // over the main view), the pointer is the cover's, not this box's.
    let inside = cx.ui.rect_contains_pointer(rect) && !cx.occluded(&node.id);
    // A primary-button release in the box is a DOM click somewhere in
    // this subtree: record the propagation path. The frame emits the
    // authored onClick after the descendants paint — child-first, like
    // the bubble — and only for the primary button (a secondary click
    // is contextmenu, never click). Records run even with no handlers:
    // the path still carries every ancestor for a deeper target.
    if inside
        && cx
            .ui
            .input(|i| i.pointer.button_clicked(egui::PointerButton::Primary))
    {
        cx.clicks.paths.push(
            cx.ancestors
                .iter()
                .cloned()
                .chain(std::iter::once(node.id.clone()))
                .collect(),
        );
    }
    let wants = |k: &str| node.handlers.contains_key(k);
    if !(wants("onClick") || wants("onMouseEnter") || wants("onMouseLeave")) {
        return;
    }
    if wants("onMouseEnter") || wants("onMouseLeave") {
        let was = props::scratch(&cx.edit.data, &node.id, "_hover").is_some_and(|v| v.truthy());
        if inside != was {
            props::scratch_set(&mut cx.edit.data, &node.id, "_hover", Value::Bool(inside));
            let name = if inside {
                "onMouseEnter"
            } else {
                "onMouseLeave"
            };
            if wants(name) {
                cx.emit(&node.id, name, props::detail([]));
            }
        }
    }
}

macro_rules! container {
    ($name:ident, $ty:literal) => {
        #[derive(Debug, Default)]
        pub struct $name;
        impl Widget for $name {
            fn type_name(&self) -> &'static str {
                $ty
            }
            fn kind(&self) -> WidgetKind {
                WidgetKind::Container
            }
            fn measure(
                &self,
                _cx: &MeasureCx,
                _node: &ResolvedNode,
                _style: &Style,
                _avail: Size,
            ) -> Size {
                Size::ZERO
            }
            fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
                paint_container(cx, node, style, rect);
            }
        }
    };
}

container!(Row, "Row");
container!(Column, "Column");
container!(Grid, "Grid");
container!(Card, "Card");
container!(Div, "div");

/// `$lane` — a home lane. `collapsed` folds it away to nothing. `resize`
/// (`start` | `end`) puts a drag handle on that edge alone — `end` for a
/// column on the left, `start` for one on the right — and a drag emits
/// `onResize` with the new width, measured from the width at the press
/// (so a frame the layout lags does not lose pointer travel) and clamped
/// to the bounds layout measured ([`we_layout::lane::lane_bounds`]: its
/// `minWidth`, `maxWidth`, and its row less the other lanes and
/// [`we_layout::LANE_LEAVES_PX`]). The resolver wires `onResize` to
/// `shellStore.setLaneWidth`, and layout reads the stored width back
/// (`laneWidth`) under the same bounds, as `PanelLane` does.
#[derive(Debug, Default)]
pub struct Lane;

/// The edge a lane's handle sits on — `None` without a `resize` prop.
fn lane_handle_edge(node: &ResolvedNode) -> Option<bool> {
    match props::prop_text(node, "resize") {
        Some("start") => Some(true),
        Some("end") => Some(false),
        _ => None,
    }
}

impl Widget for Lane {
    fn type_name(&self) -> &'static str {
        "$lane"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Container
    }
    fn measure(&self, _cx: &MeasureCx, node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        let w = props::prop_num(node, "laneWidth")
            .or_else(|| props::prop_num(node, "width"))
            .unwrap_or(240.0) as f32;
        Size::new(w, 0.0)
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let collapsed = props::prop_bool(node, "collapsed");
        if collapsed {
            // Folded away: layout gives it no width and nothing of it shows
            // (`PanelLane`'s `visibility: hidden`).
            return;
        }
        paint_container(cx, node, style, rect);
        cx.label(rect, "lane");
        let Some(start) = lane_handle_edge(node) else {
            return;
        };
        // An 8px handle straddling the edge (`PanelLane`: `left|right: -4px`).
        let x = if start { rect.min.x } else { rect.max.x };
        let handle = egui::Rect::from_min_max(
            egui::pos2(x - 4.0, rect.min.y),
            egui::pos2(x + 4.0, rect.max.y),
        );
        let id = cx.ui.scope_id().with(("lane-resize", node.id.as_str()));
        let r = cx.ui.interact(handle, id, egui::Sense::drag());
        if r.hovered() || r.dragged() {
            cx.ui
                .ctx()
                .set_cursor_icon(egui::CursorIcon::ResizeHorizontal);
        }
        // The width and the pointer at the press, kept for the whole drag:
        // egui forgets the press origin on the release frame.
        let start_key = "_resizeStart";
        let origin_key = "_resizeOrigin";
        if r.drag_started() {
            let origin = cx
                .ui
                .input(|i| i.pointer.press_origin().or(i.pointer.interact_pos()))
                .map_or(x, |p| p.x);
            props::scratch_set(
                &mut cx.edit.data,
                &node.id,
                start_key,
                Value::Num(rect.width() as f64),
            );
            props::scratch_set(
                &mut cx.edit.data,
                &node.id,
                origin_key,
                Value::Num(origin as f64),
            );
        }
        // The release frame counts too: where frames lag the pointer, the
        // last `dragged()` frame saw only part of the travel, and the width
        // the handle was let go at is the one somebody chose.
        let num = |key| match props::scratch(&cx.edit.data, &node.id, key) {
            Some(Value::Num(v)) => Some(*v as f32),
            _ => None,
        };
        // Where the button went up, on the release frame — not where the
        // pointer is by the time the frame runs, which on a slow frame is
        // wherever it moved after letting go.
        let released_at = r
            .drag_stopped()
            .then(|| {
                cx.ui.input(|i| {
                    i.events.iter().rev().find_map(|e| match e {
                        egui::Event::PointerButton {
                            pos,
                            button: egui::PointerButton::Primary,
                            pressed: false,
                            ..
                        } => Some(*pos),
                        _ => None,
                    })
                })
            })
            .flatten();
        let pointer = released_at.or_else(|| {
            cx.ui
                .input(|i| i.pointer.interact_pos().or(i.pointer.latest_pos()))
        });
        if let (true, Some(from), Some(origin), Some(pointer)) = (
            r.dragged() || r.drag_stopped(),
            num(start_key),
            num(origin_key),
            pointer,
        ) {
            let travel = pointer.x - origin;
            let wanted = from + if start { -travel } else { travel };
            // The bounds layout measured — none for a lane laid out
            // somewhere they were not (a hand-built test context).
            let bounds = cx.lane.unwrap_or(we_layout::LaneBounds {
                min: 0.0,
                max: f32::INFINITY,
            });
            let width = bounds.clamp(wanted).round();
            // A kept width drawn narrower than it is (the room shrank) is
            // replaced by the width let go at, even where that is the
            // width already drawn — `PanelLane` writes on release.
            let kept = props::prop_num(node, "laneWidth").map(|k| k as f32);
            if (width - rect.width()).abs() >= 0.5 || kept.is_some_and(|k| (k - width).abs() >= 0.5)
            {
                cx.emit(
                    &node.id,
                    "onResize",
                    props::detail([("width", Value::Num(width as f64))]),
                );
            }
        }
    }
}
