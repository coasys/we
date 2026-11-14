//! `we-app`'s render loop, as a type tests can drive without a window.
//!
//! [`RendererApp`] owns the [`Runtime`], the [`StaticHost`], the [`Registry`]
//! and the cached [`Layout`]. One [`RendererApp::frame_body`] call = one
//! frame: `frame` (re-resolve iff a revision moved) → layout (cached on
//! resolve count + rect) → paint → drain events → `dispatch`. F12 toggles
//! the debug overlay — resolve count, last resolve time, node count, unknown
//! types, dropped calls.
#![forbid(unsafe_code)]

use std::collections::BTreeSet;
use std::sync::Arc;

use egui::{vec2, Color32, Rect, RichText, Vec2};
use we_template::{ResolvedNode, RouteState, Runtime, SchemaNode, StaticHost, StoreBag};
use we_widgets::{layout, paint, EditState, Layout, MeasureCx, Registry, WidgetEvent};

/// One frame's plumbing: the app wires host ↔ runtime ↔ registry; tests drive
/// `frame_body` through `egui_kittest::Harness::new_ui`.
pub struct RendererApp {
    pub runtime: Runtime,
    pub host: StaticHost,
    pub registry: Registry,
    edit: EditState,
    layout: Option<Layout>,
    /// (resolve count, width, height) the cached layout was computed for.
    layout_key: Option<(u64, f32, f32)>,
    /// F12 — the resolve/paint counters overlay.
    pub debug: bool,
}

impl RendererApp {
    /// `schema` under `template_id`, against `bag`/`route`, with the builtin
    /// widget set.
    pub fn new(
        schema: SchemaNode,
        template_id: impl Into<Arc<str>>,
        bag: Arc<StoreBag>,
        route: RouteState,
        registry: Registry,
    ) -> Self {
        let locals = we_template::LocalState::new();
        let bag_for_host = bag.clone();
        let route_for_rev = route.clone();
        let runtime = Runtime::new(schema, template_id, bag, locals.clone(), move || {
            route_for_rev.version()
        });
        let host = StaticHost::new(route, bag_for_host, locals);
        Self {
            runtime,
            host,
            registry,
            edit: EditState::default(),
            layout: None,
            layout_key: None,
            debug: false,
        }
    }

    /// What a frame draws: resolve (cached) → layout (cached) → paint →
    /// dispatch the events it produced.
    pub fn frame_body(&mut self, ui: &mut egui::Ui) {
        if ui.input(|i| i.key_pressed(egui::Key::F12)) {
            self.debug = !self.debug;
        }

        let resolved = self.runtime.frame(&mut self.host).clone();
        let stats = self.runtime.stats().clone();

        egui::ScrollArea::vertical()
            .auto_shrink([false, true])
            .show(ui, |ui| {
                let width = ui.available_width();
                let rect = Rect::from_min_size(ui.cursor().min, vec2(width, 0.0));
                let key = (stats.resolves, width, rect.min.y);
                if self.layout_key != Some(key) || self.layout.is_none() {
                    let mcx = MeasureCx::new(ui.ctx());
                    self.layout = Some(layout(&mcx, &self.registry, &resolved, rect));
                    self.layout_key = Some(key);
                }
                let l = self.layout.as_ref().unwrap();
                ui.allocate_space(Vec2::new(width, l.size.y.max(1.0)));
                let mut events = Vec::new();
                paint(
                    ui,
                    &self.registry,
                    &resolved,
                    l,
                    &mut events,
                    &mut self.edit,
                    ui.input(|i| i.time),
                );
                self.drain(events);
            });

        if self.debug {
            self.overlay(ui.ctx(), &stats, &resolved);
        }
    }

    /// Run the events a paint produced — `onSelect`, `onOpenChange`, …
    fn drain(&mut self, events: Vec<WidgetEvent>) {
        for WidgetEvent {
            node,
            handler,
            value,
        } in events
        {
            self.runtime.dispatch(&mut self.host, &node, &handler, value);
        }
    }

    /// The F12 overlay — frame counters, node and unknown counts.
    fn overlay(&self, ctx: &egui::Context, stats: &we_template::Stats, root: &ResolvedNode) {
        let mut unknown = BTreeSet::new();
        count_unknown(root, &self.registry, &mut unknown);
        egui::Area::new(egui::Id::unique("we-debug-overlay"))
            .order(egui::Order::Foreground)
            .anchor(egui::Align2::LEFT_TOP, vec2(8.0, 8.0))
            .show(ctx, |ui| {
                egui::Frame::popup(ui.style()).show(ui, |ui| {
                    ui.label(
                        RichText::new(format!(
                            "resolves {}  ·  last {:.1?}  ·  nodes {}  ·  unknown {}  ·  dropped {}",
                            stats.resolves,
                            stats.last_resolve,
                            stats.nodes,
                            unknown.len(),
                            self.host.dropped.len(),
                        ))
                        .monospace()
                        .size(11.0),
                    );
                    if !unknown.is_empty() {
                        ui.label(
                            RichText::new(format!("unknown: {}", unknown.iter().cloned().collect::<Vec<_>>().join(", ")))
                                .monospace()
                                .size(10.0)
                                .color(Color32::LIGHT_RED),
                        );
                    }
                    if !stats.warnings.is_empty() {
                        ui.label(
                            RichText::new(format!("warnings {}", stats.warnings.len()))
                                .monospace()
                                .size(10.0),
                        );
                    }
                });
            });
    }
}

/// Types in the tree the registry has no widget for.
fn count_unknown(node: &ResolvedNode, registry: &Registry, out: &mut BTreeSet<String>) {
    if registry.widget_for(&node.ty).type_name() == "__unknown__" {
        out.insert(node.ty.to_string());
    }
    for child in &node.children {
        if let we_template::ResolvedChild::Node(n) = child {
            count_unknown(n, registry, out);
        }
    }
}

/// Side-panel chrome: the tree in a fixed-width strip, the rest of the
/// window a placeholder until E3b's page views.
pub struct Shell {
    pub panel: RendererApp,
}

impl Shell {
    pub fn frame_body(&mut self, ui: &mut egui::Ui) {
        egui::Panel::left("we-tree-panel")
            .exact_size(280.0)
            .resizable(false)
            .show(ui, |ui| {
                ui.add_space(4.0);
                self.panel.frame_body(ui);
            });
        egui::CentralPanel::default().show(ui, |ui| {
            let route = self.panel.host.route.path();
            ui.centered_and_justified(|ui| {
                ui.label(format!("view: {route}"));
            });
        });
    }
}
