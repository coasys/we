//! `we-app`'s render loop, as a type tests can drive without a window.
//!
//! [`RendererApp`] owns the [`Session`] (runtime, the offline [`StaticHost`], the
//! [`ScreenState`]), the [`Registry`] and the cached [`Layout`]. One
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
use we_template::{
    MountCx, ResolvedChild, ResolvedNode, RootSpec, SchemaNode, StaticHost, StoreBag, SurfaceTag,
};

/// Every input a cached [`Layout`] resolved against: the resolve count,
/// the offered rect, and everything `style_of` reads — theme id (the
/// `[data-we-theme]` selectors `theme_css` matches), the token table's
/// contents (every `var(--we-*)`, including the `--we-font-size-300` the
/// unit metrics fold over `scx.metrics`), the configured metrics and the
/// viewport. A theme swap that moves none of the first three still
/// repaints into stale rects without the rest.
#[derive(PartialEq)]
struct LayoutKey {
    resolves: u64,
    width: f32,
    y: f32,
    theme: Arc<str>,
    tokens: u64,
    metrics: we_metrics::UnitMetrics,
    viewport: we_style::Size,
}

/// A content hash of the table — the gallery swaps the whole
/// `Arc<TokenTable>` on a theme pick, but the contents are what
/// `style_of` folds, so pointer identity would miss an in-place rewrite.
fn token_hash(tokens: &we_style::TokenTable) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for (k, v) in tokens.iter() {
        k.hash(&mut h);
        v.hash(&mut h);
    }
    h.finish()
}

/// The production host's one-time context setup, called from eframe's
/// creation callback: a glyph no installed font has draws as a tofu box —
/// a paint detail, never a crash in front of a user — and the media fonts
/// and loaders go in. The glyph policy lives here, at the host boundary,
/// because `install_media` runs every frame and must stay policy-neutral:
/// a test harness that asks for `Panic` keeps it.
pub fn init_host(ctx: &egui::Context) {
    ctx.set_missing_glyph_policy(egui::MissingGlyphPolicy::Tofu);
    install_media(ctx);
}

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
    /// The inputs the cached layout was computed for — see [`LayoutKey`].
    layout_key: Option<LayoutKey>,
    /// What each surface tag was last reported at — `createSurface`'s
    /// `set` guard at the producer (E3c-13): an unmoved measure does not
    /// re-report, so a steady frame never wakes the session for nothing.
    surface_sent: std::collections::HashMap<SurfaceTag, f32>,
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
        let spec = RootSpec::Single {
            node: Box::new(schema),
            cx: MountCx::explicit(template_id.into() as Arc<str>),
            declared: we_template::Declared::default(),
        };
        let session =
            Session::offline(spec, bag, screen).with_dollar_types(move |ty| types.contains(ty));
        Self {
            session,
            registry,
            theme: we_style::Theme::empty("dark", we_style::Polarity::Dark),
            edit: EditState::default(),
            layout: None,
            layout_key: None,
            surface_sent: std::collections::HashMap::new(),
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
        let mut visuals = match self.theme.polarity {
            we_style::Polarity::Dark => egui::Visuals::dark(),
            we_style::Polarity::Light => egui::Visuals::light(),
        };
        // Text nothing colours is the body colour the web declares where a
        // theme applies (`BODY_TYPE`, 2-themes/themeStyles.ts) — not egui's
        // grey. Every uncoloured fallback reads it through the visuals.
        visuals.override_text_color = body_text_color(&self.theme.tokens);
        ui.ctx().set_visuals(visuals);

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
                    theme: self.theme.id.as_ref(),
                    viewport: we_style::Size::new(vp.x, vp.y),
                    container_width: width,
                    metrics: we_metrics::UnitMetrics::default(),
                    ..StyleCx::empty()
                };
                let key = LayoutKey {
                    resolves: stats.resolves,
                    width,
                    y: rect.min.y,
                    theme: self.theme.id.clone(),
                    tokens: token_hash(&self.theme.tokens),
                    metrics: scx.metrics,
                    viewport: scx.viewport,
                };
                if self.layout_key.as_ref() != Some(&key) || self.layout.is_none() {
                    let mcx = MeasureCx::new(ui.ctx());
                    self.layout = Some(layout(&mcx, &scx, &self.registry, &resolved, rect));
                    self.layout_key = Some(key);
                }
                let l = self.layout.as_ref().unwrap();
                ui.allocate_space(Vec2::new(width, l.size.y.max(1.0)));

                // E3c-13: the `ResizeObserver` walk — the mount's host
                // surfaces report the slot this frame hands the session
                // (the boundary outside the template, so a root sized off
                // `surface.width` never measures itself), and every node
                // tag its node's content-box width (the box
                // `contentBoxSize` answers), once per change. The report
                // rides the session's inbox, so it polls like a measure
                // landing from any other producer.
                let mut reports: Vec<(SurfaceTag, f32)> = self
                    .session
                    .host_surfaces()
                    .iter()
                    .map(|tag| (tag.clone(), width))
                    .collect();
                collect_surface_reports(&resolved, l, &mut reports);
                self.surface_sent
                    .retain(|tag, _| reports.iter().any(|(t, _)| t == tag));
                for (tag, width) in reports {
                    if self.surface_sent.get(&tag) != Some(&width) {
                        self.surface_sent.insert(tag.clone(), width);
                        self.session.report_surface(&tag, width);
                    }
                }

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
                // A handler's effect — `$setLocal` on hover, a lane's new
                // width — lands in the next resolve; without asking for
                // that frame it waits for the next input, so a pointer that
                // enters the rail and stops leaves it drawn collapsed.
                if !events.is_empty() {
                    ui.ctx().request_repaint();
                }
                self.drain(events);
            });

        if self.debug {
            self.overlay(ui.ctx(), &stats, &resolved);
        }
    }

    /// The cached layout, if a frame has laid out — what the rects the
    /// last paint used are. Tests read it; the paint path owns it.
    pub fn layout(&self) -> Option<&Layout> {
        self.layout.as_ref()
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
                            self.session
                                .host_as::<StaticHost>()
                                .map_or(0, |h| h.dropped.len()),
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

/// The bundle's whole app root against one route C2a recorded in
/// `fixtures/coasys/snapshot.json`, at the route's recorded Rust path and
/// painted with `theme_id` — what `we-app --coasys` opens and what
/// `tests/coasys_shots.rs` screenshots. The second value says the theme
/// was not recorded and `dark` stood in.
#[cfg(not(target_arch = "wasm32"))]
pub fn coasys_app(
    bundle: &we_template::Bundle,
    route: &str,
    theme_id: &str,
) -> Result<(RendererApp, bool), String> {
    use we_data::{OfflineData, StoreMap};
    use we_screen::ScreenSchema;
    use we_template::{AppSpec, LocalState, NoParts, Runtime};

    const SNAPSHOT: &str = include_str!("../../fixtures/coasys/snapshot.json");
    const SEED_MAP: &str = include_str!("../../we-data/data/storemap-offline.json");

    let truth: serde_json::Value =
        serde_json::from_str(SNAPSHOT).map_err(|e| format!("snapshot parse: {e}"))?;
    let map = StoreMap::parse(SEED_MAP).map_err(|e| format!("seed map: {e}"))?;
    let data = OfflineData::from_route(&truth, route, Some(&map))
        .map_err(|e| format!("route {route}: {e}"))?;
    let spec = AppSpec {
        bundle: bundle.name.clone().into(),
        app: bundle.app.clone(),
        template: bundle.templates.as_deref().and_then(|t| t.first()).cloned(),
        pages: bundle.pages.clone().unwrap_or_default(),
        boot: bundle.boot_screen.clone(),
    };
    let path = truth["routes"][route]["rust"]
        .as_str()
        .ok_or_else(|| format!("routes.{route}.rust is not a path"))?;
    let screen = ScreenState::desktop(
        ScreenSchema {
            pages: bundle
                .pages
                .as_deref()
                .unwrap_or_default()
                .iter()
                .map(|p| p.id.clone())
                .collect(),
            ..ScreenSchema::default()
        },
        path,
    );
    // `RendererApp::new` builds a single-schema session; swap in the app-root
    // runtime and the offline host, with the same `$`-type gate.
    let placeholder: SchemaNode =
        serde_json::from_value(serde_json::json!({ "type": "Column" })).unwrap();
    let registry = Registry::with_builtins();
    let types: std::collections::HashSet<&'static str> = registry.type_names().collect();
    let mut app = RendererApp::new(placeholder, "coasys", data.bag.clone(), screen, registry);
    // `set_runtime`, not a field write: the bag's legacy faces must read
    // this runtime's `screen` view, not the one the session built.
    app.session.set_runtime(
        Runtime::app(spec, data.bag.clone(), LocalState::new())
            .with_sources(Some(data.source()), Arc::new(NoParts))
            .with_dollar_types(move |ty| types.contains(ty)),
    );
    app.session.host = Box::new(StaticHost::new(data.bag.clone()));
    let set = gallery::load_theme_set();
    let (theme, fell_back) = set.theme(theme_id);
    app.theme = theme.clone();
    Ok((app, fell_back))
}

/// One pass over the resolved tree collecting `(tag, content-box width)`
/// for every surface — the box `ResizeObserver.contentBoxSize` answers
/// (`createSurface.ts:47`). A node with no laid-out box reports nothing.
fn collect_surface_reports(node: &ResolvedNode, layout: &Layout, out: &mut Vec<(SurfaceTag, f32)>) {
    if !node.surfaces.is_empty() {
        if let Some(content) = layout.content_boxes.get(&node.id) {
            for tag in &node.surfaces {
                out.push((tag.clone(), content.x));
            }
        }
    }
    for child in &node.children {
        if let ResolvedChild::Node(n) = child {
            collect_surface_reports(n, layout, out);
        }
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
            let route = self.panel.session.screen().nav.current_path();
            ui.centered_and_justified(|ui| {
                ui.label(format!("view: {route}"));
            });
        });
    }
}

/// `color: var(--we-type-body-color, var(--we-role-text))` against the
/// theme's tokens — `None` on a theme that records neither.
fn body_text_color(tokens: &we_style::TokenTable) -> Option<egui::Color32> {
    let css = tokens.substitute_nested("var(--we-type-body-color, var(--we-role-text))");
    let [r, g, b, a] = we_style::eval_color(&css)?.to_premultiplied();
    Some(egui::Color32::from_rgba_premultiplied(
        (r * 255.0) as u8,
        (g * 255.0) as u8,
        (b * 255.0) as u8,
        (a * 255.0) as u8,
    ))
}
