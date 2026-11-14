//! `we-app`'s render loop, as a type tests can drive without a window.
//!
//! [`RendererApp`] owns the [`Runtime`], the [`StaticHost`], the
//! [`ScreenState`], the [`Registry`] and the cached [`Layout`]. One
//! [`RendererApp::frame_body`] call = one frame: `frame` (re-resolve iff a
//! revision moved) → apply the ops a route queued → layout (cached on
//! resolve count + rect) → paint → drain events → `dispatch`. F12 toggles
//! the debug overlay — resolve count, last resolve time, node count, unknown
//! types, dropped calls.
//!
//! The gallery mode shares its paint code between the native window
//! (`--gallery style`) and the `egui_kittest` snapshots in `tests/gallery.rs`.
#![forbid(unsafe_code)]

pub mod gallery;
pub mod gallery_widgets;

use std::collections::BTreeSet;
use std::sync::Arc;

use egui::{vec2, Color32, Rect, RichText, Vec2};
use we_egui::{
    install_media, layout, paint, EditState, Layout, MeasureCx, Registry, StyleCx, WidgetEvent,
};
use we_screen::ScreenState;
use we_session::Session;
use we_template::{ResolvedNode, SchemaNode, StoreBag};

/// One frame's plumbing: the app wires host ↔ runtime ↔ registry; tests drive
/// `frame_body` through `egui_kittest::Harness::new_ui`.
pub struct RendererApp {
    /// Runtime + host + screen — the frontend-independent session.
    pub session: Session,
    pub registry: Registry,
    /// The theme `style_of` resolves against — `main` loads `dark` from the
    /// recorded tables; tests default to the empty table.
    pub theme: we_style::Theme,
    edit: EditState,
    layout: Option<Layout>,
    /// (resolve count, width, height) the cached layout was computed for.
    layout_key: Option<(u64, f32, f32)>,
    /// F12 — the resolve/paint counters overlay.
    pub debug: bool,
}

impl RendererApp {
    /// `schema` under `template_id`, against `bag`/`screen`, with the builtin
    /// widget set.
    pub fn new(
        schema: SchemaNode,
        template_id: impl Into<Arc<str>>,
        bag: Arc<StoreBag>,
        screen: ScreenState,
        registry: Registry,
    ) -> Self {
        // `$`-types the registry knows (`$lane`) resolve as components —
        // the resolver asks before it stamps a `$todo:` placeholder.
        let types: std::collections::HashSet<&'static str> = registry.type_names().collect();
        let session = Session::new(schema, template_id, bag, screen)
            .with_dollar_types(move |ty| types.contains(ty));
        Self {
            session,
            registry,
            theme: we_style::Theme::empty("dark", we_style::Polarity::Dark),
            edit: EditState::default(),
            layout: None,
            layout_key: None,
            debug: false,
        }
    }

    /// What a frame draws: resolve (cached) → apply queued route ops →
    /// layout (cached) → paint → dispatch the events it produced.
    pub fn frame_body(&mut self, ui: &mut egui::Ui) {
        if ui.input(|i| i.key_pressed(egui::Key::F12)) {
            self.debug = !self.debug;
        }

        install_media(ui.ctx());
        // The theme's polarity drives egui's visuals so untoned spots
        // (scrollbars, unknown boxes) sit right on a dark theme.
        ui.ctx().set_visuals(match self.theme.polarity {
            we_style::Polarity::Dark => egui::Visuals::dark(),
            we_style::Polarity::Light => egui::Visuals::light(),
        });

        let resolved = self.session.resolve();
        let stats = self.session.stats().clone();

        egui::ScrollArea::vertical()
            .auto_shrink([false, true])
            .show(ui, |ui| {
                let width = ui.available_width();
                let vp = ui.ctx().content_rect().size();
                // The containing block is the viewport: `width` fills it and
                // `vp.y` floors the root (`min-height: 100vh`) so a `bg`
                // covers a short panel's tail.
                let rect = Rect::from_min_size(ui.cursor().min, vec2(width, vp.y));
                let scx = StyleCx {
                    tokens: &self.theme.tokens,
                    viewport: we_style::Size::new(vp.x, vp.y),
                    container_width: width,
                };
                let key = (stats.resolves, width, rect.min.y);
                if self.layout_key != Some(key) || self.layout.is_none() {
                    let mcx = MeasureCx::new(ui.ctx());
                    self.layout = Some(layout(&mcx, &scx, &self.registry, &resolved, rect));
                    self.layout_key = Some(key);
                }
                let l = self.layout.as_ref().unwrap();
                ui.allocate_space(Vec2::new(width, l.size.y.max(1.0)));
                let mut events = Vec::new();
                paint(
                    ui,
                    &self.registry,
                    &scx,
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
            self.session.dispatch(&node, &handler, value);
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
                            self.session.host.dropped.len(),
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
            let route = self.panel.session.screen.nav.current_path();
            ui.centered_and_justified(|ui| {
                ui.label(format!("view: {route}"));
            });
        });
    }
}
