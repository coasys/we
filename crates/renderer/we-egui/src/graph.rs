//! `GraphView` — the read-only map of a space.
//!
//! The host installs a [`GraphInstall`] on the egui context. The widget
//! reads `seeds`, `expansion` and `layout` off the resolved node and runs
//! the same build as `we-graph`. It pans, zooms, selects and opens. It
//! does not move nodes or write edges (that is E17).
//!
//! Canvas, the fourth mode, is the stored arrangement. This widget does
//! not draw it.
//!
//! Radial and grid are accepted as layout names and drawn with the force
//! layout. Tree is the breadth-first placement in `we-graph`. Force uses
//! the seeded layout there, not d3's Barnes-Hut positions.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use indexmap::IndexMap;
use we_expr::Value;
use we_graph::{
    layout_force, layout_tree, parse_address, view_from_json, LayoutEdge, LayoutNode, Point,
};
use we_style::Style;
use we_template::{NodeId, ResolvedNode};

use crate::{MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

const BAR: f32 = 32.0;
const ZOOM_STEP: f32 = 1.25;
const FIELD_MAX: usize = 240;

/// The world a `GraphView` draws. The host puts one on the egui context.
/// Offline uses the coasys fixture. `--connect` replaces it after the
/// space's `model_query` rows arrive. Until then the widget paints an
/// empty labelled box, not the fixture.
#[derive(Clone)]
pub struct GraphInstall {
    pub world: Arc<we_graph::World>,
    pub shapes: Arc<[we_graph::Shape]>,
    pub dataset: Arc<str>,
    /// Assigned by [`install_graph`]. A caller may pass 0.
    pub generation: u64,
}

const INSTALL_ID: &str = "we-graph-install";

/// Replace the graph the widgets read. Call this on the UI thread.
///
/// The generation stays when the same world arc is installed again. A new
/// world, including the empty world that `--connect` installs first, gets
/// the next generation. The drawn cache key includes that generation.
pub fn install_graph(ctx: &egui::Context, mut install: GraphInstall) {
    ctx.data_mut(|d| {
        let id = egui::Id::unique(INSTALL_ID);
        install.generation = match d.get_temp::<GraphInstall>(id) {
            Some(old)
                if Arc::ptr_eq(&old.world, &install.world)
                    && Arc::ptr_eq(&old.shapes, &install.shapes)
                    && old.dataset.as_ref() == install.dataset.as_ref() =>
            {
                old.generation
            }
            Some(old) => old.generation.saturating_add(1),
            None => 1,
        };
        d.insert_temp(id, install);
    });
}

fn installed(ctx: &egui::Context) -> Option<GraphInstall> {
    ctx.data(|d| d.get_temp(egui::Id::unique(INSTALL_ID)))
}

/// The coasys fixture (`preview-coasys`). One parse, then an `Arc` clone.
pub fn install_coasys_fixture(ctx: &egui::Context) {
    static INSTALL: OnceLock<GraphInstall> = OnceLock::new();
    let install = INSTALL
        .get_or_init(|| GraphInstall {
            world: Arc::new(we_graph::coasys_world()),
            shapes: we_graph::core_shapes().to_vec().into(),
            dataset: Arc::from(we_graph::FIXTURE_DATASET),
            generation: 0,
        })
        .clone();
    install_graph(ctx, install);
}

pub struct GraphView;

impl Widget for GraphView {
    fn type_name(&self) -> &'static str {
        "GraphView"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }
    fn measure(&self, _cx: &MeasureCx, _n: &ResolvedNode, _s: &Style, avail: Size) -> Size {
        // Taffy offers 0 on a min-content axis. The gallery node has no
        // height, so that offer is the whole question. A view with
        // `height: 100%` arrives as a definite size and fills its parent.
        let w = if avail.x.is_finite() && avail.x > 1.0 {
            avail.x
        } else {
            320.0
        };
        let h = if avail.y.is_finite() && avail.y > 1.0 {
            avail.y
        } else {
            64.0
        };
        Size::new(w, h)
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        let bg = cx.ui.visuals().extreme_bg_color;
        cx.ui.painter().rect_filled(rect, 0.0, bg);
        // The type name stays an AccessKit label, as the placeholder was.
        // Hover only, so it does not take a click from a node.
        cx.label(rect, "GraphView");

        let seeds = prop_json(node, "seeds");
        let expansion = prop_json(node, "expansion");
        let ready = installed(cx.ui.ctx()).zip(view_from_json(&seeds, &expansion));
        let Some((install, spec)) = ready else {
            paint_empty(cx, node, rect);
            return;
        };
        let layout = prop_json(node, "layout");
        let revision = prop_json(node, "revision");
        let edge_rules = prop_json(node, "edgeStyle");
        let canvas = rect.with_max_y((rect.max.y - BAR).max(rect.min.y + 1.0));
        let key = format!(
            "{}|g{}|{revision}|{seeds}|{expansion}|{layout}|{:.0}x{:.0}",
            install.dataset,
            install.generation,
            canvas.width(),
            canvas.height()
        );
        let drawn = drawn_for(cx.ui.ctx(), &node.id, &key, || {
            let graph = we_graph::build(&install.world, &install.shapes, &install.dataset, &spec);
            let nodes: Vec<LayoutNode<'_>> = graph
                .nodes
                .iter()
                .map(|n| LayoutNode { id: &n.id })
                .collect();
            let edges: Vec<LayoutEdge<'_>> = graph
                .edges
                .iter()
                .map(|e| LayoutEdge {
                    source: &e.source,
                    target: &e.target,
                })
                .collect();
            let (tree, gap) = layout_choice(&layout);
            let pos = if tree {
                layout_tree(&nodes, &edges, gap)
            } else {
                layout_force(
                    &nodes,
                    &edges,
                    canvas.width().max(1.0),
                    canvas.height().max(1.0),
                    gap,
                )
            };
            let mut index = HashMap::with_capacity(graph.nodes.len());
            for (i, gnode) in graph.nodes.iter().enumerate() {
                index.insert(gnode.id.clone(), i);
            }
            Drawn {
                key: key.clone(),
                graph,
                pos,
                index,
            }
        });

        let mut cam = cam_for(cx.ui.ctx(), &node.id);
        if cam.key != drawn.key {
            let (origin, fit) = fit_of(&drawn.pos, canvas);
            cam = Cam {
                key: drawn.key.clone(),
                user_zoom: 1.0,
                pan: egui::Vec2::ZERO,
                selected: cam
                    .selected
                    .filter(|id| drawn.graph.nodes.iter().any(|n| &n.id == id)),
                origin,
                fit,
                press_on_node: false,
            };
        }

        let zoom = cam.fit * cam.user_zoom;
        let mut screen: Vec<(usize, egui::Pos2)> = Vec::with_capacity(drawn.pos.len());
        let mut by_id: std::collections::HashMap<&str, egui::Pos2> =
            std::collections::HashMap::new();
        for (id, p) in &drawn.pos {
            let at = to_screen(*p, &cam, canvas, zoom);
            by_id.insert(id.as_str(), at);
            if let Some(&i) = drawn.index.get(id) {
                screen.push((i, at));
            }
        }
        let hyperlink = cx.ui.visuals().hyperlink_color;
        let weak = cx.ui.visuals().weak_text_color();
        let text_color = cx.ui.visuals().text_color();
        let sel_stroke = cx.ui.visuals().selection.stroke.color;
        {
            let painter = cx.ui.painter_at(canvas);
            for edge in &drawn.graph.edges {
                let (Some(&a), Some(&b)) = (
                    by_id.get(edge.source.as_str()),
                    by_id.get(edge.target.as_str()),
                ) else {
                    continue;
                };
                let relates = edge.ty == "relates";
                let color = if relates { hyperlink } else { weak };
                let width = if relates { 2.0 } else { 1.0 };
                painter.line_segment([a, b], egui::Stroke::new(width, color));
                if edge_wants_arrow(edge, &edge_rules) {
                    arrow(&painter, a, b, color);
                }
                if let Some(label) = &edge.label {
                    painter.text(
                        a.lerp(b, 0.5),
                        egui::Align2::CENTER_CENTER,
                        label,
                        egui::FontId::proportional(9.0),
                        weak,
                    );
                }
            }
            for (i, at) in &screen {
                let gnode = &drawn.graph.nodes[*i];
                let r = node_radius(gnode);
                let color = if gnode.kind == "literal" || gnode.unresolved {
                    weak
                } else if gnode.ty == "CollectionBlock" || gnode.ty == "$schema" {
                    hyperlink
                } else {
                    text_color
                };
                if gnode.kind == "literal" || gnode.ty == "$schema" {
                    let box_rect = egui::Rect::from_center_size(*at, egui::vec2(r * 2.0, r * 1.4));
                    painter.rect_filled(box_rect, 2.0, color);
                } else {
                    painter.circle_filled(*at, r, color);
                }
                if cam.selected.as_deref() == Some(gnode.id.as_str()) {
                    painter.circle_stroke(*at, r + 3.0, egui::Stroke::new(2.0, sel_stroke));
                }
                let label = node_label(gnode);
                painter.text(
                    *at + egui::vec2(0.0, r + 2.0),
                    egui::Align2::CENTER_TOP,
                    label,
                    egui::FontId::proportional(10.0),
                    text_color,
                );
            }
        }

        // The canvas is the pan target. Register it before the nodes.
        // egui gives a tie to the last widget, so a node stays on top.
        let canvas_id = cx.ui.scope_id().with(("graph-canvas", node.id.as_str()));
        let canvas_hit = cx
            .ui
            .interact(canvas, canvas_id, egui::Sense::click_and_drag());

        let pointer = cx.ui.input(|i| i.pointer.interact_pos());
        let just_pressed = cx.ui.input(|i| i.pointer.primary_pressed());
        let mut hit_press = false;
        let mut node_clicked: Option<usize> = None;
        for (i, at) in &screen {
            let gnode = &drawn.graph.nodes[*i];
            let r = node_radius(gnode);
            let hit = egui::Rect::from_center_size(*at, egui::vec2(r * 2.0 + 8.0, r * 2.0 + 16.0));
            if just_pressed && pointer.is_some_and(|p| hit.contains(p)) {
                hit_press = true;
            }
            let selected = cam.selected.as_deref() == Some(gnode.id.as_str());
            let response = cx.interact_label(
                hit,
                node_label(gnode),
                egui::Role::Button,
                &node.id,
                &gnode.id,
                true,
                Some(selected),
            );
            if response.clicked() {
                node_clicked = Some(*i);
            }
        }

        let down = cx.ui.input(|i| i.pointer.primary_down());
        if just_pressed {
            cam.press_on_node = hit_press;
        }
        if !down {
            cam.press_on_node = false;
        }
        if canvas_hit.dragged() && !cam.press_on_node {
            cam.pan += canvas_hit.drag_delta();
        }

        if let Some(i) = node_clicked {
            let gnode = &drawn.graph.nodes[i];
            cam.selected = Some(gnode.id.clone());
            let value = node_value(gnode, true);
            cx.emit(&node.id, "onNodeClick", value);
            cx.emit(
                &node.id,
                "onSelectionChange",
                id_list(std::slice::from_ref(&gnode.id)),
            );
        } else if canvas_hit.clicked() && cam.selected.is_some() {
            cam.selected = None;
            cx.emit(&node.id, "onSelectionChange", id_list(&[]));
        }

        let bar = egui::Rect::from_min_max(egui::pos2(rect.min.x, canvas.max.y), rect.max);
        paint_bar(cx, node, &drawn, bar, &mut cam);
        save_cam(cx.ui.ctx(), &node.id, &cam);
    }
}

/// Zoom chrome for a graph that has no world yet. The gallery lists
/// `GraphView` with no seeds, and the bar is what shows the widget is real.
fn paint_empty(cx: &mut PaintCx, node: &ResolvedNode, rect: Rect) {
    let mut cam = cam_for(cx.ui.ctx(), &node.id);
    let top = (rect.max.y - BAR).max(rect.min.y);
    let bar = egui::Rect::from_min_max(egui::pos2(rect.min.x, top), rect.max);
    let empty = Drawn {
        key: String::new(),
        graph: we_graph::Graph {
            nodes: Vec::new(),
            edges: Vec::new(),
        },
        pos: Vec::new(),
        index: HashMap::new(),
    };
    paint_bar(cx, node, &empty, bar, &mut cam);
    save_cam(cx.ui.ctx(), &node.id, &cam);
}

fn paint_bar(cx: &mut PaintCx, node: &ResolvedNode, drawn: &Drawn, bar: Rect, cam: &mut Cam) {
    let fill = cx.ui.visuals().panel_fill;
    cx.ui.painter().rect_filled(bar, 0.0, fill);
    let mut x = bar.min.x + 6.0;
    let y = bar.center().y;
    let button = |cx: &mut PaintCx, x: &mut f32, text: &str, part: &str| -> bool {
        let width = 18.0 + text.len() as f32 * 6.0;
        let rect =
            egui::Rect::from_center_size(egui::pos2(*x + width / 2.0, y), egui::vec2(width, 22.0));
        *x += width + 6.0;
        cx.ui
            .painter()
            .rect_filled(rect, 4.0, cx.ui.visuals().widgets.inactive.bg_fill);
        cx.ui.painter().text(
            rect.center(),
            egui::Align2::CENTER_CENTER,
            text,
            egui::FontId::proportional(11.0),
            cx.ui.visuals().text_color(),
        );
        cx.interact_label(rect, text, egui::Role::Button, &node.id, part, true, None)
            .clicked()
    };
    if button(cx, &mut x, "Zoom in", "zoom-in") {
        cam.user_zoom = (cam.user_zoom * ZOOM_STEP).clamp(0.25, 4.0);
    }
    if button(cx, &mut x, "Zoom out", "zoom-out") {
        cam.user_zoom = (cam.user_zoom / ZOOM_STEP).clamp(0.25, 4.0);
    }
    if button(cx, &mut x, "Fit", "fit") {
        cam.user_zoom = 1.0;
        cam.pan = egui::Vec2::ZERO;
    }
    let pct = (cam.user_zoom * 100.0).round() as i32;
    let zoom_text = format!("zoom {pct}%");
    let zoom_rect = egui::Rect::from_center_size(egui::pos2(x + 36.0, y), egui::vec2(72.0, 22.0));
    cx.ui.painter().text(
        zoom_rect.center(),
        egui::Align2::CENTER_CENTER,
        &zoom_text,
        egui::FontId::proportional(11.0),
        cx.ui.visuals().weak_text_color(),
    );
    cx.label(zoom_rect, &zoom_text);

    if let Some(id) = cam.selected.clone() {
        if let Some(gnode) = drawn.graph.nodes.iter().find(|n| n.id == id) {
            x = bar.max.x - 70.0;
            if button(cx, &mut x, "Open", "open") {
                cx.emit(&node.id, "onNodeDoubleClick", node_value(gnode, false));
            }
        }
    }
}

#[derive(Clone)]
struct Drawn {
    key: String,
    graph: we_graph::Graph,
    pos: Vec<(String, Point)>,
    index: HashMap<String, usize>,
}

#[derive(Clone)]
struct Cam {
    key: String,
    user_zoom: f32,
    pan: egui::Vec2,
    selected: Option<String>,
    origin: Point,
    fit: f32,
    press_on_node: bool,
}

impl Default for Cam {
    fn default() -> Self {
        Self {
            key: String::new(),
            user_zoom: 1.0,
            pan: egui::Vec2::ZERO,
            selected: None,
            origin: Point { x: 0.0, y: 0.0 },
            fit: 1.0,
            press_on_node: false,
        }
    }
}

fn drawn_for(
    ctx: &egui::Context,
    node: &NodeId,
    key: &str,
    build: impl FnOnce() -> Drawn,
) -> Drawn {
    let id = egui::Id::unique(("we-graph-drawn", node.as_str()));
    if let Some(existing) = ctx.data(|d| d.get_temp::<Drawn>(id)) {
        if existing.key == key {
            return existing;
        }
    }
    let built = build();
    ctx.data_mut(|d| d.insert_temp(id, built.clone()));
    built
}

fn cam_for(ctx: &egui::Context, node: &NodeId) -> Cam {
    let id = egui::Id::unique(("we-graph-cam", node.as_str()));
    ctx.data(|d| d.get_temp(id)).unwrap_or_default()
}

fn save_cam(ctx: &egui::Context, node: &NodeId, cam: &Cam) {
    let id = egui::Id::unique(("we-graph-cam", node.as_str()));
    ctx.data_mut(|d| d.insert_temp(id, cam.clone()));
}

fn fit_of(pos: &[(String, Point)], canvas: Rect) -> (Point, f32) {
    if pos.is_empty() {
        return (Point { x: 0.0, y: 0.0 }, 1.0);
    }
    let mut min_x = f32::MAX;
    let mut min_y = f32::MAX;
    let mut max_x = f32::MIN;
    let mut max_y = f32::MIN;
    for (_, p) in pos {
        min_x = min_x.min(p.x);
        min_y = min_y.min(p.y);
        max_x = max_x.max(p.x);
        max_y = max_y.max(p.y);
    }
    let bw = (max_x - min_x).max(1.0);
    let bh = (max_y - min_y).max(1.0);
    let pad = 36.0;
    let zx = (canvas.width() - pad * 2.0).max(1.0) / bw;
    let zy = (canvas.height() - pad * 2.0).max(1.0) / bh;
    let fit = zx.min(zy).clamp(0.05, 2.0);
    (
        Point {
            x: (min_x + max_x) / 2.0,
            y: (min_y + max_y) / 2.0,
        },
        fit,
    )
}

fn to_screen(p: Point, cam: &Cam, canvas: Rect, zoom: f32) -> egui::Pos2 {
    let c = canvas.center();
    egui::pos2(
        c.x + (p.x - cam.origin.x) * zoom + cam.pan.x,
        c.y + (p.y - cam.origin.y) * zoom + cam.pan.y,
    )
}

/// `tree` uses `levelGap` (default 200). Anything else is force with
/// `distance` (default 130, the space view's override of d3's 90).
fn layout_choice(layout: &serde_json::Value) -> (bool, f32) {
    let obj = layout.as_object();
    let kind = obj
        .and_then(|o| o.get("type"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("force");
    let options = obj
        .and_then(|o| o.get("options"))
        .and_then(|o| o.as_object());
    if kind == "tree" {
        let gap = options
            .and_then(|o| o.get("levelGap"))
            .and_then(serde_json::Value::as_f64)
            .unwrap_or(200.0);
        (true, gap as f32)
    } else {
        let distance = options
            .and_then(|o| o.get("distance"))
            .and_then(serde_json::Value::as_f64)
            .unwrap_or(130.0);
        (false, distance as f32)
    }
}

fn node_label(node: &we_graph::Node) -> &str {
    if node.label.is_empty() {
        node.ty.as_str()
    } else {
        node.label.as_str()
    }
}

fn node_radius(node: &we_graph::Node) -> f32 {
    match node.kind.as_str() {
        "literal" => 5.0,
        "property" => 6.0,
        _ if node.ty == "$schema" => 9.0,
        _ if node.ty == "CollectionBlock" => 10.0,
        _ => 7.0,
    }
}

fn arrow(painter: &egui::Painter, from: egui::Pos2, to: egui::Pos2, color: egui::Color32) {
    let d = to - from;
    let len = d.length();
    if len < 8.0 {
        return;
    }
    let dir = d / len;
    let side = egui::vec2(-dir.y, dir.x);
    let tip = to - dir * 8.0;
    let back = tip - dir * 7.0;
    painter.add(egui::Shape::convex_polygon(
        vec![tip, back + side * 3.5, back - side * 3.5],
        color,
        egui::Stroke::NONE,
    ));
}

fn prop_json(node: &ResolvedNode, key: &str) -> serde_json::Value {
    node.props
        .get(key)
        .map(Value::to_json)
        .unwrap_or(serde_json::Value::Null)
}

fn id_list(ids: &[String]) -> Value {
    Value::List(Arc::new(
        ids.iter().map(|id| Value::from(id.as_str())).collect(),
    ))
}

/// The click payload `GraphView.solid.tsx` builds: the node, `recordId`
/// and `recordType` when the address is a real entity (not `$schema`),
/// and `fields` for a single click.
fn node_value(node: &we_graph::Node, with_fields: bool) -> Value {
    let mut map: IndexMap<Arc<str>, Value> = IndexMap::new();
    map.insert(Arc::from("id"), Value::from(node.id.as_str()));
    map.insert(Arc::from("kind"), Value::from(node.kind.as_str()));
    map.insert(Arc::from("type"), Value::from(node.ty.as_str()));
    map.insert(Arc::from("label"), Value::from(node.label.as_str()));
    map.insert(Arc::from("source"), Value::from(node.source.as_str()));
    if node.unresolved {
        map.insert(Arc::from("unresolved"), Value::from(true));
    }
    if let Some(data) = &node.data {
        let obj: IndexMap<Arc<str>, Value> = data
            .iter()
            .map(|(k, v)| (Arc::from(k.as_str()), json_to_expr(v)))
            .collect();
        map.insert(Arc::from("data"), Value::from(obj));
    }
    if let Some(parsed) = parse_address(&node.id) {
        if parsed.kind == "entity" && !parsed.ty.starts_with('$') {
            map.insert(Arc::from("recordId"), Value::from(parsed.id.as_str()));
            map.insert(Arc::from("recordType"), Value::from(parsed.ty.as_str()));
        }
    }
    if with_fields {
        map.insert(
            Arc::from("fields"),
            Value::List(Arc::new(readable_fields(node))),
        );
    }
    Value::from(map)
}

fn readable_fields(node: &we_graph::Node) -> Vec<Value> {
    let Some(data) = &node.data else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (name, value) in data {
        let Some(text) = scalar_text(value) else {
            continue;
        };
        if text.is_empty() || text.starts_with("data:") {
            continue;
        }
        let shown = clip_chars(&text, FIELD_MAX);
        out.push(expr_obj(&[
            ("name", Value::from(name.as_str())),
            ("value", Value::from(shown.as_str())),
        ]));
    }
    out
}

fn scalar_text(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => None,
    }
}

fn clip_chars(text: &str, max: usize) -> String {
    let count = text.chars().count();
    if count <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max - 1).collect();
    out.push('\u{2026}');
    out
}

fn expr_obj(pairs: &[(&str, Value)]) -> Value {
    Value::from(
        pairs
            .iter()
            .map(|(k, v)| (Arc::<str>::from(*k), v.clone()))
            .collect::<IndexMap<Arc<str>, Value>>(),
    )
}

/// `edgeVisual` draws a target arrow when the merged style omits `arrow`.
/// Rules apply in order. A nested list is one `$map` group, flattened once.
/// `arrow: "none"` is the undirected relationship kind.
fn edge_wants_arrow(edge: &we_graph::Edge, rules: &serde_json::Value) -> bool {
    let mut arrow = "target";
    let Some(items) = rules.as_array() else {
        return true;
    };
    for rule in flatten_style_rules(items) {
        let Some(obj) = rule.as_object() else {
            continue;
        };
        if obj.len() == 1 && obj.contains_key("$") {
            continue;
        }
        if !style_when_matches(edge, obj.get("when")) {
            continue;
        }
        if let Some(next) = obj
            .get("style")
            .and_then(|style| style.as_object())
            .and_then(|style| style.get("arrow"))
            .and_then(|value| value.as_str())
        {
            arrow = next;
        }
    }
    arrow != "none"
}

fn flatten_style_rules(items: &[serde_json::Value]) -> Vec<&serde_json::Value> {
    let mut out = Vec::new();
    for item in items {
        if let Some(inner) = item.as_array() {
            out.extend(inner);
        } else {
            out.push(item);
        }
    }
    out
}

fn style_when_matches(edge: &we_graph::Edge, when: Option<&serde_json::Value>) -> bool {
    let Some(when) = when.filter(|value| !value.is_null()) else {
        return true;
    };
    let Some(obj) = when.as_object() else {
        return false;
    };
    obj.iter().all(|(key, expected)| {
        if expected.is_object() {
            return false;
        }
        edge_field(edge, key) == *expected
    })
}

fn edge_field(edge: &we_graph::Edge, key: &str) -> serde_json::Value {
    if key == "type" {
        return serde_json::Value::String(edge.ty.clone());
    }
    if let Some(rest) = key.strip_prefix("data.") {
        return edge
            .data
            .as_ref()
            .and_then(|data| data.get(rest))
            .cloned()
            .unwrap_or(serde_json::Value::Null);
    }
    serde_json::Value::Null
}

fn json_to_expr(value: &serde_json::Value) -> Value {
    match value {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::from(*b),
        serde_json::Value::Number(n) => Value::from(n.as_f64().unwrap_or(f64::NAN)),
        serde_json::Value::String(s) => Value::from(s.as_str()),
        serde_json::Value::Array(items) => {
            Value::List(Arc::new(items.iter().map(json_to_expr).collect()))
        }
        serde_json::Value::Object(map) => expr_obj(
            &map.iter()
                .map(|(k, v)| (k.as_str(), json_to_expr(v)))
                .collect::<Vec<_>>(),
        ),
    }
}

#[cfg(test)]
mod arrow_style {
    use super::edge_wants_arrow;
    use serde_json::json;

    fn relates(kind: &str) -> we_graph::Edge {
        let mut data = serde_json::Map::new();
        data.insert(
            "relationshipTypeId".into(),
            serde_json::Value::String(kind.into()),
        );
        we_graph::Edge {
            id: format!("e-{kind}"),
            source: "a".into(),
            target: "b".into(),
            ty: "relates".into(),
            label: None,
            data: Some(data),
            reified_as: None,
        }
    }

    fn rules() -> serde_json::Value {
        // The knowledge template, after `$map` flattens one level.
        json!([
            { "style": { "curve": "arc", "arrow": "target" } },
            { "when": { "type": "relates" }, "style": { "showLabel": true, "width": 2 } },
            [
                {
                    "when": { "data.relationshipTypeId": "related-to" },
                    "style": { "arrow": "none" }
                },
                {
                    "when": { "data.relationshipTypeId": "contradicts" },
                    "style": { "arrow": "target" }
                }
            ]
        ])
    }

    #[test]
    fn undirected_relationship_kind_has_no_arrow() {
        let rules = rules();
        assert!(
            !edge_wants_arrow(&relates("related-to"), &rules),
            "an undirected relationship kind must not draw an arrow"
        );
        assert!(edge_wants_arrow(&relates("contradicts"), &rules));
        let content = json!([{ "style": { "curve": "step", "color": "neutral-200" } }]);
        assert!(
            edge_wants_arrow(&relates("related-to"), &content),
            "a style that omits arrow still defaults to target"
        );
    }
}
