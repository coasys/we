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
///
/// While a drag is held, [`lane_drags`] asks for the width before the
/// frame resolves, so the frame the pointer moved on draws it; paint then
/// finds the lane already that wide and emits nothing. Paint still owns
/// the press and the release.
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
        if r.drag_started() {
            let origin = cx
                .ui
                .input(|i| i.pointer.press_origin().or(i.pointer.interact_pos()))
                .map_or(x, |p| p.x);
            props::scratch_set(
                &mut cx.edit.data,
                &node.id,
                START_KEY,
                Value::Num(rect.width() as f64),
            );
            props::scratch_set(
                &mut cx.edit.data,
                &node.id,
                ORIGIN_KEY,
                Value::Num(origin as f64),
            );
            props::scratch_set(&mut cx.edit.data, &node.id, HELD_KEY, Value::Bool(true));
            props::scratch_set(&mut cx.edit.data, &node.id, ASKED_KEY, Value::Null);
            props::scratch_set(
                &mut cx.edit.data,
                &node.id,
                DRAG_ID_KEY,
                Value::Str(id.value().to_string().into()),
            );
        }
        if r.drag_stopped() {
            props::scratch_set(&mut cx.edit.data, &node.id, HELD_KEY, Value::Bool(false));
        }
        // The release frame counts too: where frames lag the pointer, the
        // last `dragged()` frame saw only part of the travel, and the width
        // the handle was let go at is the one somebody chose.
        //
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
        if !(r.dragged() || r.drag_stopped()) {
            return;
        }
        let Some(pointer) = pointer else { return };
        // The bounds layout measured — none for a lane laid out somewhere
        // they were not (a hand-built test context).
        let bounds = cx.lane.unwrap_or(we_layout::LaneBounds {
            min: 0.0,
            max: f32::INFINITY,
        });
        let Some(width) = drag_width(&cx.edit.data, node, start, bounds, pointer.x) else {
            return;
        };
        // A kept width drawn narrower than it is (the room shrank) is
        // replaced by the width let go at, even where that is the width
        // already drawn — `PanelLane` writes on release.
        let kept = props::prop_num(node, "laneWidth").map(|k| k as f32);
        let differs =
            (width - rect.width()).abs() >= 0.5 || kept.is_some_and(|k| (k - width).abs() >= 0.5);
        if differs && ask(&mut cx.edit.data, node, width) {
            cx.emit(
                &node.id,
                "onResize",
                props::detail([("width", Value::Num(width as f64))]),
            );
        }
    }
}

/// The scratch fields a lane drag keeps: the width and the pointer `x` at
/// the press, and whether the drag is still held.
const START_KEY: &str = "_resizeStart";
const ORIGIN_KEY: &str = "_resizeOrigin";
const HELD_KEY: &str = "_resizeHeld";
/// The egui id of the handle that was pressed, as text (a `u64` does not
/// survive an `f64`).
const DRAG_ID_KEY: &str = "_resizeDragId";
/// The last width this drag asked `onResize` for.
const ASKED_KEY: &str = "_resizeAsked";

/// Whether `width` is a width this drag has not asked for yet — and if so,
/// it is now the last asked. A handler that does not make the lane the
/// width it was asked for (it snaps, refuses or defers) leaves the drawn
/// width short of it, so every path that compares against the drawn width
/// — the drag before the resolve, paint, the release — would ask again,
/// in the same frame and on every frame after. Each width reaches the
/// handler once per drag instead.
fn ask(
    data: &mut std::collections::HashMap<we_template::NodeId, Value>,
    node: &ResolvedNode,
    width: f32,
) -> bool {
    if let Some(Value::Num(last)) = props::scratch(data, &node.id, ASKED_KEY) {
        if (*last as f32 - width).abs() < 0.5 {
            return false;
        }
    }
    props::scratch_set(data, &node.id, ASKED_KEY, Value::Num(width as f64));
    true
}

/// The width a lane drag asks for with the pointer at `x`: the width at
/// the press plus the travel since (minus, for a handle on the start
/// edge), held to `bounds` and rounded — `None` before a press recorded
/// where it started.
fn drag_width(
    data: &std::collections::HashMap<we_template::NodeId, Value>,
    node: &ResolvedNode,
    start_edge: bool,
    bounds: we_layout::LaneBounds,
    x: f32,
) -> Option<f32> {
    let num = |key| match props::scratch(data, &node.id, key) {
        Some(Value::Num(v)) => Some(*v as f32),
        _ => None,
    };
    let (from, origin) = (num(START_KEY)?, num(ORIGIN_KEY)?);
    let travel = x - origin;
    let wanted = from + if start_edge { -travel } else { travel };
    Some(bounds.clamp(wanted).round())
}

/// The `onResize` every held lane drag asks for at the pointer's current
/// position, worked out before the frame resolves — so the width lands in
/// this frame's resolve and layout and is drawn on the frame the pointer
/// moved, rather than emitted by paint, dispatched after it, and drawn a
/// frame later. `root` and `layout` are the last frame's: the bounds and
/// the drawn width a drag compares against are the ones on screen.
///
/// Only while the button is held: a press and a release stay paint's, as
/// they need egui's response for the handle (the release frame finds the
/// position the button went up at).
pub fn lane_drags(
    ctx: &egui::Context,
    edit: &mut crate::EditState,
    layout: &crate::Layout,
    root: &ResolvedNode,
) -> Vec<crate::WidgetEvent> {
    let mut out = Vec::new();
    let x = ctx.input(|i| {
        i.pointer
            .primary_down()
            .then(|| i.pointer.interact_pos().or(i.pointer.latest_pos()))
            .flatten()
    });
    // With the button up nothing is dragged, so every held flag clears.
    let dragged = x
        .and_then(|_| ctx.dragged_id())
        .map(|id| id.value().to_string());
    fn walk(
        node: &ResolvedNode,
        x: Option<f32>,
        dragged: &Option<String>,
        edit: &mut crate::EditState,
        layout: &crate::Layout,
        out: &mut Vec<crate::WidgetEvent>,
    ) {
        let held = node.ty.as_ref() == "$lane"
            && matches!(
                props::scratch(&edit.data, &node.id, HELD_KEY),
                Some(Value::Bool(true))
            );
        // Held only while egui is still dragging the handle that was
        // pressed. A lane folded away or taken out of the tree mid-drag
        // is not painted, so its handle never sees the release and paint
        // never clears the flag; egui drops a drag whose widget was not
        // drawn, and the flag goes with it — or a later press anywhere
        // would drag the lane from the old press.
        let owner = matches!(
            props::scratch(&edit.data, &node.id, DRAG_ID_KEY),
            Some(Value::Str(id)) if dragged.as_deref() == Some(id.as_ref())
        );
        if held && !owner {
            props::scratch_set(&mut edit.data, &node.id, HELD_KEY, Value::Bool(false));
        }
        if held && owner && !props::prop_bool(node, "collapsed") {
            if let (Some(start), Some(rect)) = (lane_handle_edge(node), layout.rects.get(&node.id))
            {
                let bounds = layout
                    .lanes
                    .get(&node.id)
                    .copied()
                    .unwrap_or(we_layout::LaneBounds {
                        min: 0.0,
                        max: f32::INFINITY,
                    });
                if let Some(width) = x.and_then(|x| drag_width(&edit.data, node, start, bounds, x))
                {
                    if (width - rect.width()).abs() >= 0.5 && ask(&mut edit.data, node, width) {
                        out.push(crate::WidgetEvent {
                            node: node.id.clone(),
                            handler: "onResize".into(),
                            value: props::detail([("width", Value::Num(width as f64))]),
                        });
                    }
                }
            }
        }
        for child in &node.children {
            if let we_template::ResolvedChild::Node(n) = child {
                walk(n, x, dragged, edit, layout, out);
            }
        }
    }
    walk(root, x.map(|p| p.x), &dragged, edit, layout, &mut out);
    out
}
