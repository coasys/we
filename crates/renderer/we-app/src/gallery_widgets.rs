//! `--gallery widgets` — the E5b widget showcase: every batch-2 type
//! painted through the real `layout`/`paint` path, one row each, in a dark
//! theme. The same [`widgets_ui`] runs inside the `egui_kittest` snapshots.
use std::sync::Arc;

use indexmap::IndexMap;
use we_egui::{layout, paint, EditState, MeasureCx, Registry, StyleCx, WidgetEvent};
use we_expr::Value;
use we_template::{NodeId, ResolvedChild, ResolvedNode};

fn props(list: &[(&str, Value)]) -> IndexMap<Arc<str>, Value> {
    list.iter()
        .map(|(k, v)| (Arc::from(*k), v.clone()))
        .collect()
}

fn node(
    ty: &str,
    id: &str,
    props: IndexMap<Arc<str>, Value>,
    kids: Vec<ResolvedChild>,
) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from(id),
        ty: Arc::from(ty),
        props,
        handlers: IndexMap::new(),
        slot: None,
        children: kids,
        transition: None,
    }
}

fn s(v: &str) -> Value {
    Value::Str(Arc::from(v))
}
fn n(v: f64) -> Value {
    Value::Num(v)
}
fn b(v: bool) -> Value {
    Value::Bool(v)
}

fn btn(id: &str, label: &str) -> ResolvedChild {
    ResolvedChild::Node(Box::new(node(
        "we-button",
        id,
        props(&[("label", s(label))]),
        vec![],
    )))
}

fn leaf(ty: &str, id: &str, list: &[(&str, Value)]) -> ResolvedChild {
    ResolvedChild::Node(Box::new(node(ty, id, props(list), vec![])))
}

/// The showcase tree — `open` drives the modal's `open` prop so the two
/// snapshots show a resting page and one with the dialog up. The popover
/// and menu open from their own internal state (they stay closed here).
pub fn widgets_tree(open: bool) -> ResolvedNode {
    let ff = node(
        "we-form-field",
        "g/ff",
        props(&[
            ("label", s("Display name")),
            ("description", s("Shown in menus")),
        ]),
        vec![leaf("we-input", "g/ff/in", &[("value", s("Ada"))])],
    );

    let mut body_node = node(
        "we-button",
        "g/pop/body",
        props(&[("label", s("Popover body"))]),
        vec![],
    );
    body_node.slot = Some(Arc::from("content"));
    let mut pop = node("we-popover", "g/pop", props(&[]), vec![]);
    pop.children = vec![
        btn("g/pop/trig", "Popover"),
        ResolvedChild::Node(Box::new(body_node)),
    ];

    let menu = node(
        "DropdownMenu",
        "g/menu",
        props(&[(
            "items",
            Value::List(Arc::new(vec![
                Value::Obj(Arc::new(props(&[("id", s("a")), ("label", s("Alpha"))]))),
                Value::Obj(Arc::new(props(&[("id", s("b")), ("label", s("Beta"))]))),
            ])),
        )]),
        vec![btn("g/menu/trig", "Menu")],
    );

    let modal = node(
        "we-modal",
        "g/modal",
        props(&[("open", b(open)), ("title", s("Example modal"))]),
        vec![btn("g/modal/in", "Inside the modal")],
    );

    let mut sort = node("we-sortable", "g/sort", props(&[]), vec![]);
    for (i, id) in ["x", "y", "z"].iter().enumerate() {
        sort.children.push(ResolvedChild::Node(Box::new(node(
            "we-button",
            &format!("g/sort/{i}"),
            props(&[("weId", s(id)), ("label", s(&format!("Row {id}")))]),
            vec![],
        ))));
    }

    node(
        "Column",
        "g",
        props(&[("gap", s("300")), ("p", s("400"))]),
        vec![
            leaf(
                "we-input",
                "g/input",
                &[
                    ("label", s("Text input")),
                    ("value", s("")),
                    ("placeholder", s("type here")),
                ],
            ),
            leaf(
                "we-textarea",
                "g/textarea",
                &[("label", s("Textarea")), ("value", s("two\nlines"))],
            ),
            leaf(
                "we-select",
                "g/select",
                &[
                    ("label", s("Select")),
                    ("value", s("b")),
                    (
                        "options",
                        Value::List(Arc::new(vec![
                            Value::Obj(Arc::new(props(&[
                                ("value", s("a")),
                                ("label", s("Alpha")),
                            ]))),
                            Value::Obj(Arc::new(props(&[("value", s("b")), ("label", s("Beta"))]))),
                        ])),
                    ),
                ],
            ),
            leaf(
                "we-switch",
                "g/switch",
                &[("label", s("Switch")), ("checked", b(true))],
            ),
            leaf(
                "we-slider",
                "g/slider",
                &[
                    ("label", s("Slider")),
                    ("value", n(35.0)),
                    ("showValue", b(true)),
                ],
            ),
            leaf(
                "we-number-input",
                "g/num",
                &[("label", s("Number")), ("value", n(3.0))],
            ),
            ResolvedChild::Node(Box::new(ff)),
            leaf(
                "we-date-picker",
                "g/date",
                &[("label", s("Date")), ("value", s("2026-01-15"))],
            ),
            leaf(
                "we-color-picker",
                "g/color",
                &[("label", s("Color")), ("value", s("#3b82f6"))],
            ),
            leaf(
                "we-icon-picker",
                "g/icon",
                &[("label", s("Icon")), ("value", s("rocket"))],
            ),
            ResolvedChild::Node(Box::new(sort)),
            ResolvedChild::Node(Box::new(pop)),
            ResolvedChild::Node(Box::new(menu)),
            ResolvedChild::Node(Box::new(modal)),
        ],
    )
}

/// Paint the showcase into `ui` — `edit`/`events` are the gallery's own so
/// interactions work live (a popover opens for real).
pub fn widgets_ui(
    ui: &mut egui::Ui,
    tree: &ResolvedNode,
    edit: &mut EditState,
    events: &mut Vec<WidgetEvent>,
    now: f64,
) {
    let reg = Registry::with_builtins();
    let cx = MeasureCx::new(ui.ctx());
    // The page surface covers the whole viewport — the tree itself only
    // paints its widgets, and without this an open modal's backdrop dims
    // a patchwork of transparent and opaque regions.
    ui.painter()
        .rect_filled(ui.ctx().content_rect(), 0.0, ui.visuals().panel_fill);
    let rect = ui.available_rect_before_wrap();
    // The showcase is a dark-theme page — resolve styles against the
    // recorded dark table so authored scales (`p="400"`, …) land on the
    // same pixels a themed app would give them.
    let set = crate::gallery::load_theme_set();
    let (theme, _) = set.theme("dark");
    let scx = StyleCx {
        tokens: theme.tokens.as_ref(),
        viewport: we_style::Size::new(rect.width(), rect.height()),
        container_width: rect.width(),
    };
    let lay = layout(&cx, &scx, &reg, tree, rect);
    paint(ui, &reg, &scx, tree, &lay, events, edit, now);
}

/// The running gallery app: the showcase plus a live event log, so a click
/// shows what the widget would have emitted.
#[cfg(not(target_arch = "wasm32"))]
pub struct WidgetsGalleryApp {
    tree: ResolvedNode,
    edit: EditState,
    events: Vec<WidgetEvent>,
}

#[cfg(not(target_arch = "wasm32"))]
impl Default for WidgetsGalleryApp {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl WidgetsGalleryApp {
    pub fn new() -> Self {
        Self {
            tree: widgets_tree(false),
            edit: EditState::default(),
            events: Vec::new(),
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl eframe::App for WidgetsGalleryApp {
    fn ui(&mut self, ui: &mut eframe::egui::Ui, _frame: &mut eframe::Frame) {
        let mut events = Vec::new();
        widgets_ui(
            ui,
            &self.tree,
            &mut self.edit,
            &mut events,
            ui.input(|i| i.time),
        );
        if !events.is_empty() {
            self.events.splice(0..0, events.into_iter().rev().take(8));
            self.events.truncate(8);
        }
        ui.separator();
        for e in &self.events {
            ui.monospace(format!("{} -> {} {:?}", e.node, e.handler, e.value));
        }
    }
}
