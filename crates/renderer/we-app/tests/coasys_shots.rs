//! M1 shots: the Coasys app rendered by Rust, next to the web version.
//!
//! For each of the ten routes C2a recorded (`fixtures/coasys/snapshot.json`)
//! and each of the six themes, this renders the full app root
//! (`Runtime::app` over `OfflineData::from_route`, exactly as
//! `we-data/tests/real_snapshot.rs` resolves it) through `RendererApp` at
//! 1280x800, scale 1, and writes:
//!
//! - `target/coasys-rust/<route>-<theme>.png` — the Rust frame;
//! - `target/coasys-compare/<route>-<theme>.png` — web left, Rust right,
//!   under a label bar naming route, theme and score;
//! - `target/coasys-compare/index.md` — the score table, what each route
//!   resolved to (unknown widgets, `$todo` stubs, resolve warnings, missed
//!   or loading queries, an empty main area) and the observed differences
//!   kept in `coasys_shots.observations.md` beside this file.
//!
//! `target/` is `crates/renderer/target`, whatever `CARGO_TARGET_DIR` says.
//!
//! It needs a wgpu adapter and the web PNGs, so it is `#[ignore]`d and the
//! normal gate never runs it. Run it with
//!
//! ```sh
//! WE_COASYS_WEB=/path/to/crates/renderer/target/coasys-web \
//!   cargo test --release -p we-app --test coasys_shots -- --ignored --nocapture
//! ```
//!
//! `WE_COASYS_WEB` defaults to `crates/renderer/target/coasys-web`, where
//! `scripts/record-coasys.sh` writes them. `WE_SHOTS_ROUTES=index,call` and
//! `WE_SHOTS_THEMES=light,dark` narrow the run while iterating.
//!
//! A test rather than a `we-app shots` subcommand: the headless wgpu
//! renderer is `egui_kittest`, a dev-dependency, and the binary should not
//! carry it (or a PNG encoder) to take pictures nobody ships.
use std::collections::BTreeSet;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use egui::Vec2;
use egui_kittest::Harness;
use image::{Rgba, RgbaImage};
use serde_json::Value as Json;
use we_app::gallery::{load_theme_set, THEME_ORDER};
use we_app::RendererApp;
use we_data::{OfflineData, StoreMap};
use we_egui::Registry;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{
    AppSpec, Bundle, LocalState, NoParts, QueryState, ResolvedChild, ResolvedNode, Runtime,
    SchemaNode, StaticHost,
};

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));
const SNAPSHOT: &str = include_str!("../../fixtures/coasys/snapshot.json");
const SEED_MAP: &str = include_str!("../../we-data/data/storemap-offline.json");
const OBSERVATIONS: &str = include_str!("coasys_shots.observations.md");

/// The ten routes C2a recorded, in the recording's order.
const ROUTES: [&str; 10] = [
    "index",
    "workflows",
    "channels",
    "channel-design",
    "calls",
    "call",
    "people",
    "dna",
    "person",
    "about",
];

/// One theme's (pixel, structural) score, or why it has none.
type Cell = Result<(f64, f64), String>;
/// A route's resolve report and its main-area ink per theme.
type Report = (&'static str, Resolved, Vec<(String, f64)>);

const W: u32 = 1280;
const H: u32 = 800;
/// Height of the label strip above each side-by-side.
const BAR: u32 = 28;
/// The app chrome's right edge in the web shots (rail + tree); right of it
/// is the route's main area.
const MAIN_X: u32 = 352;

fn renderer_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn list_env(name: &str, all: &[&'static str]) -> Vec<&'static str> {
    match std::env::var(name) {
        Ok(v) if !v.trim().is_empty() => {
            let wanted: BTreeSet<&str> = v.split(',').map(str::trim).collect();
            for w in &wanted {
                assert!(all.contains(w), "{name}: unknown {w:?} (known: {all:?})");
            }
            all.iter().copied().filter(|x| wanted.contains(x)).collect()
        }
        _ => all.to_vec(),
    }
}

/// What resolving a route produced, beyond the pixels.
#[derive(Default)]
struct Resolved {
    path: String,
    nodes: usize,
    unknown: BTreeSet<String>,
    todo: BTreeSet<String>,
    warnings: Vec<String>,
    missed: Vec<String>,
    loading: usize,
    outlet_nodes: usize,
    outlet_text: usize,
    error: Option<String>,
}

fn walk(node: &ResolvedNode, registry: &Registry, in_outlet: bool, out: &mut Resolved) {
    let in_outlet = in_outlet || node.id.to_string().contains("/r:");
    out.nodes += 1;
    if in_outlet {
        out.outlet_nodes += 1;
    }
    if node.ty.starts_with("$todo") {
        out.todo.insert(node.ty.to_string());
    } else if registry.widget_for(&node.ty).type_name() == "__unknown__" {
        out.unknown.insert(node.ty.to_string());
    }
    for child in &node.children {
        match child {
            ResolvedChild::Text(t) => {
                if in_outlet && !t.trim().is_empty() {
                    out.outlet_text += 1;
                }
            }
            ResolvedChild::Node(n) => walk(n, registry, in_outlet, out),
        }
    }
}

/// The app for route `id`: the bundle's whole app root, resolving against the
/// route's own recorded state, at the route's recorded Rust path.
fn app_for(truth: &Json, id: &str, theme: &we_style::Theme) -> Result<RendererApp, String> {
    let map = StoreMap::parse(SEED_MAP).map_err(|e| format!("seed map: {e}"))?;
    let data = OfflineData::from_route(truth, id, Some(&map))?;
    let bundle = Bundle::parse(BUNDLE).map_err(|e| format!("bundle: {e}"))?;
    let spec = AppSpec {
        app: bundle.app.as_ref().map(|t| t.node.clone()),
        template: bundle.templates.as_deref().and_then(|t| t.first()).cloned(),
        pages: bundle.pages.clone().unwrap_or_default(),
        boot: bundle.boot_screen.clone(),
    };
    let path = truth["routes"][id]["rust"]
        .as_str()
        .ok_or_else(|| format!("routes.{id}.rust is not a path"))?;
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
    // `RendererApp::new` builds a single-schema session; the app root needs
    // `Runtime::app` with the route's query source, so swap the session's
    // runtime and host for the ones `real_snapshot.rs` builds — same
    // `$`-type gate `RendererApp::new` sets.
    let placeholder: SchemaNode =
        serde_json::from_value(serde_json::json!({ "type": "Column" })).unwrap();
    let registry = Registry::with_builtins();
    let types: std::collections::HashSet<&'static str> = registry.type_names().collect();
    let mut app = RendererApp::new(placeholder, "coasys", data.bag.clone(), screen, registry);
    let locals = LocalState::new();
    app.session.runtime = Runtime::app(spec, data.bag.clone(), locals.clone())
        .with_sources(Some(data.source()), Arc::new(NoParts))
        .with_dollar_types(move |ty| types.contains(ty));
    app.session.host = StaticHost::new(data.bag.clone(), locals);
    app.theme = theme.clone();
    // Keep the captures alive for the miss report: `data` drops here, the
    // source it handed out holds its own `Arc`.
    Ok(app)
}

fn inspect(truth: &Json, id: &str, app: &RendererApp) -> Resolved {
    let mut r = Resolved {
        path: truth["routes"][id]["rust"]
            .as_str()
            .unwrap_or("?")
            .to_string(),
        ..Resolved::default()
    };
    let Some(root) = app.session.runtime.resolved() else {
        r.error = Some("no resolved tree".into());
        return r;
    };
    walk(&root.clone(), &app.registry, false, &mut r);
    r.warnings = app
        .session
        .stats()
        .warnings
        .iter()
        .map(|w| w.to_string())
        .collect();
    r.loading = app
        .session
        .runtime
        .pool()
        .cells()
        .iter()
        .filter(|c| matches!(c.state(), QueryState::Loading))
        .count();
    r
}

/// Queries the route mounted that none of its captures answered — read from a
/// fresh `OfflineData`, resolved once headless, as `real_snapshot.rs` does.
fn missed_captures(truth: &Json, id: &str) -> Vec<String> {
    let Ok(map) = StoreMap::parse(SEED_MAP) else {
        return vec!["seed map does not parse".into()];
    };
    let Ok(data) = OfflineData::from_route(truth, id, Some(&map)) else {
        return vec!["route does not load".into()];
    };
    let bundle = Bundle::parse(BUNDLE).unwrap();
    let spec = AppSpec {
        app: bundle.app.as_ref().map(|t| t.node.clone()),
        template: bundle.templates.as_deref().and_then(|t| t.first()).cloned(),
        pages: bundle.pages.clone().unwrap_or_default(),
        boot: bundle.boot_screen.clone(),
    };
    let locals = LocalState::new();
    let mut rt = Runtime::app(spec, data.bag.clone(), locals.clone())
        .with_sources(Some(data.source()), Arc::new(NoParts));
    let mut host = StaticHost::new(data.bag.clone(), locals);
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
        truth["routes"][id]["rust"].as_str().unwrap_or("/"),
    );
    rt.frame(&mut host, &screen);
    data.captures()
        .map(|c| c.missed().to_vec())
        .unwrap_or_default()
}

/// Render `app` at 1280x800 after the frame settles: a few steps for
/// redirects and animations, then until images stop decoding.
fn render(app: RendererApp) -> (RgbaImage, RendererApp) {
    let mut harness = Harness::builder()
        .with_size(Vec2::new(W as f32, H as f32))
        .with_pixels_per_point(1.0)
        .with_context_setup(we_egui::install_media)
        // The accessibility check panics on the first unnamed button; these
        // are pictures, so it is off here (findings are in NOTES-m1.md).
        .with_accessibility_check(false)
        .build_ui_state(|ui, app: &mut RendererApp| app.frame_body(ui), app);
    harness.run_steps(6);
    for _ in 0..150 {
        if !harness.ctx.has_pending_images() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
        harness.step();
    }
    harness.run_steps(2);
    let image = harness.render().expect("wgpu render");
    // `Harness` owns the state; take it back for inspection.
    let app = harness.into_state();
    (image, app)
}

/// Mean per-pixel RGB difference, 0–100 (the score `theme_compare` used), and
/// the same on 8px-block luminance — shape-level, blind to colour-only and
/// single-pixel deltas.
fn score(a: &RgbaImage, b: &RgbaImage) -> (f64, f64) {
    let (w, h) = (a.width().min(b.width()), a.height().min(b.height()));
    let mut sum = 0.0;
    for y in 0..h {
        for x in 0..w {
            let (p, q) = (a.get_pixel(x, y).0, b.get_pixel(x, y).0);
            sum += (0..3)
                .map(|c| (p[c] as f64 - q[c] as f64).abs())
                .sum::<f64>()
                / (3.0 * 255.0);
        }
    }
    let lum = |p: [u8; 4]| p[0] as f64 * 0.299 + p[1] as f64 * 0.587 + p[2] as f64 * 0.114;
    let (mut bsum, mut bn) = (0.0f64, 0.0f64);
    for by in (0..h).step_by(8) {
        for bx in (0..w).step_by(8) {
            let (mut la, mut lb, mut n) = (0.0, 0.0, 0.0);
            for y in by..(by + 8).min(h) {
                for x in bx..(bx + 8).min(w) {
                    la += lum(a.get_pixel(x, y).0);
                    lb += lum(b.get_pixel(x, y).0);
                    n += 1.0;
                }
            }
            bsum += ((la - lb) / n).abs() / 255.0;
            bn += 1.0;
        }
    }
    (
        100.0 * sum / (w as f64 * h as f64),
        100.0 * bsum / bn.max(1.0),
    )
}

/// Share of the main area (right of the chrome) that differs from its most
/// common colour, in percent. Near zero means nothing was drawn there.
fn main_area_ink(img: &RgbaImage) -> f64 {
    let mut counts = std::collections::HashMap::new();
    let mut total = 0u64;
    for y in 0..img.height() {
        for x in MAIN_X.min(img.width())..img.width() {
            *counts.entry(img.get_pixel(x, y).0).or_insert(0u64) += 1;
            total += 1;
        }
    }
    let modal = counts.values().copied().max().unwrap_or(0);
    100.0 * (total - modal) as f64 / total.max(1) as f64
}

/// The label strip, drawn by egui so it needs no font rasteriser of its own.
fn label_bar(text: &str, warn: bool) -> RgbaImage {
    let text = text.to_string();
    let mut harness = Harness::builder()
        .with_size(Vec2::new((2 * W) as f32, BAR as f32))
        .with_pixels_per_point(1.0)
        .build_ui(move |ui| {
            let rect = ui.max_rect();
            let bg = if warn {
                egui::Color32::from_rgb(90, 24, 24)
            } else {
                egui::Color32::from_rgb(32, 32, 36)
            };
            ui.painter().rect_filled(rect, 0.0, bg);
            ui.painter().text(
                rect.left_center() + egui::vec2(8.0, 0.0),
                egui::Align2::LEFT_CENTER,
                &text,
                egui::FontId::monospace(14.0),
                egui::Color32::WHITE,
            );
            ui.painter().text(
                rect.center() + egui::vec2(8.0, 0.0),
                egui::Align2::LEFT_CENTER,
                "rust →",
                egui::FontId::monospace(14.0),
                egui::Color32::LIGHT_GRAY,
            );
        });
    harness.run();
    harness.render().expect("label render")
}

fn side_by_side(web: &RgbaImage, rust: &RgbaImage, label: &str, warn: bool) -> RgbaImage {
    let mut out = RgbaImage::from_pixel(2 * W, H + BAR, Rgba([0, 0, 0, 255]));
    image::imageops::overlay(&mut out, &label_bar(label, warn), 0, 0);
    image::imageops::overlay(&mut out, web, 0, BAR as i64);
    image::imageops::overlay(&mut out, rust, W as i64, BAR as i64);
    // A 1px divider between the halves.
    for y in BAR..H + BAR {
        out.put_pixel(W, y, Rgba([255, 0, 255, 255]));
    }
    out
}

fn load_web(dir: &Path, route: &str, theme: &str) -> Result<RgbaImage, String> {
    let path = dir.join(format!("{route}-{theme}.png"));
    let img = image::open(&path)
        .map_err(|e| format!("{}: {e}", path.display()))?
        .to_rgba8();
    if img.dimensions() != (W, H) {
        return Err(format!(
            "{}: {}x{}, expected {W}x{H}",
            path.display(),
            img.width(),
            img.height()
        ));
    }
    Ok(img)
}

#[test]
#[ignore = "needs a wgpu adapter and the C2a web PNGs; see the module docs for the command"]
fn coasys_shots() {
    let started = std::time::Instant::now();
    let web_dir = std::env::var_os("WE_COASYS_WEB")
        .map(PathBuf::from)
        .unwrap_or_else(|| renderer_dir().join("target/coasys-web"));
    assert!(
        web_dir.is_dir(),
        "web shots not found at {} — set WE_COASYS_WEB to C2a's target/coasys-web",
        web_dir.display()
    );
    let rust_dir = renderer_dir().join("target/coasys-rust");
    let cmp_dir = renderer_dir().join("target/coasys-compare");
    std::fs::create_dir_all(&rust_dir).unwrap();
    std::fs::create_dir_all(&cmp_dir).unwrap();

    let truth: Json = serde_json::from_str(SNAPSHOT).expect("snapshot parses");
    assert_eq!(truth["meta"]["format"], "we-snapshot@2");
    let set = load_theme_set();
    assert_eq!(set.len(), 6, "all six token tables must load");

    let routes = list_env("WE_SHOTS_ROUTES", &ROUTES);
    let themes = list_env("WE_SHOTS_THEMES", THEME_ORDER);

    // route -> theme -> (pixel, structural) or the error that stopped it.
    let mut scores: Vec<(&str, Vec<Cell>)> = Vec::new();
    let mut reports: Vec<Report> = Vec::new();
    let mut problems: Vec<String> = Vec::new();

    for route in &routes {
        let mut row = Vec::new();
        let mut report = None;
        let mut inks = Vec::new();
        for theme_id in &themes {
            let (theme, fell_back) = set.theme(theme_id);
            assert!(!fell_back, "theme {theme_id} has no token table");
            let app = match app_for(&truth, route, theme) {
                Ok(app) => app,
                Err(e) => {
                    problems.push(format!("{route}-{theme_id}: does not load: {e}"));
                    row.push(Err(e));
                    continue;
                }
            };
            let (rust, app) = render(app);
            rust.save(rust_dir.join(format!("{route}-{theme_id}.png")))
                .expect("write rust png");
            let ink = main_area_ink(&rust);
            inks.push((theme_id.to_string(), ink));
            if report.is_none() {
                let mut r = inspect(&truth, route, &app);
                r.missed = missed_captures(&truth, route);
                report = Some(r);
            }
            let r = report.as_ref().unwrap();
            let flagged =
                !r.unknown.is_empty() || !r.todo.is_empty() || r.error.is_some() || ink < 1.0;
            match load_web(&web_dir, route, theme_id) {
                Ok(web) => {
                    let (px, st) = score(&web, &rust);
                    let label = format!(
                        "{route} · {theme_id} · pixel {px:.2} · struct {st:.2}{}",
                        if flagged {
                            " · FLAGGED (see index.md)"
                        } else {
                            ""
                        }
                    );
                    side_by_side(&web, &rust, &label, flagged)
                        .save(cmp_dir.join(format!("{route}-{theme_id}.png")))
                        .expect("write compare png");
                    println!("{route}-{theme_id}: pixel {px:.2} struct {st:.2} ink {ink:.1}%");
                    row.push(Ok((px, st)));
                }
                Err(e) => {
                    problems.push(format!("{route}-{theme_id}: no web shot: {e}"));
                    row.push(Err(e));
                }
            }
        }
        let r = report.unwrap_or_default();
        if !r.unknown.is_empty() {
            problems.push(format!("{route}: unknown widgets {:?}", r.unknown));
        }
        if !r.todo.is_empty() {
            problems.push(format!("{route}: $todo stubs {:?}", r.todo));
        }
        if let Some(e) = &r.error {
            problems.push(format!("{route}: {e}"));
        }
        if r.loading > 0 {
            problems.push(format!("{route}: {} queries still Loading", r.loading));
        }
        if !r.missed.is_empty() {
            problems.push(format!(
                "{route}: {} mounted queries no capture answered",
                r.missed.len()
            ));
        }
        for (t, ink) in &inks {
            if *ink < 1.0 {
                problems.push(format!(
                    "{route}-{t}: main area empty ({ink:.2}% of it differs from its background)"
                ));
            }
        }
        scores.push((route, row));
        reports.push((route, r, inks));
    }

    let elapsed = started.elapsed();
    let mut md = String::new();
    writeln!(md, "# Coasys — web (left) vs Rust (right)\n").unwrap();
    writeln!(
        md,
        "Generated by `we-app/tests/coasys_shots.rs` in {:.1?}. Web shots: `{}`.\n",
        elapsed,
        web_dir.display()
    )
    .unwrap();
    writeln!(
        md,
        "Score: mean per-pixel RGB difference in percent (0 = identical), then the same on 8px-block \
         luminance (`struct`, shape-level). Lower is closer. Each cell links its side-by-side.\n"
    )
    .unwrap();
    write!(md, "| route |").unwrap();
    for t in &themes {
        write!(md, " {t} |").unwrap();
    }
    writeln!(md).unwrap();
    write!(md, "|---|").unwrap();
    for _ in &themes {
        write!(md, "---|").unwrap();
    }
    writeln!(md).unwrap();
    for (route, row) in &scores {
        write!(md, "| {route} |").unwrap();
        for (t, cell) in themes.iter().zip(row) {
            match cell {
                Ok((px, st)) => write!(md, " [{px:.1} / {st:.1}]({route}-{t}.png) |").unwrap(),
                Err(_) => write!(md, " **error** |").unwrap(),
            }
        }
        writeln!(md).unwrap();
    }

    writeln!(md, "\n## Failures\n").unwrap();
    if problems.is_empty() {
        writeln!(md, "None: every route loaded, resolved with no unknown widget or `$todo` stub, answered every mounted query, and drew something in its main area.").unwrap();
    } else {
        for p in &problems {
            writeln!(md, "- {p}").unwrap();
        }
    }

    writeln!(md, "\n## What each route resolved to\n").unwrap();
    writeln!(
        md,
        "| route | path | nodes | outlet nodes / texts | unknown | `$todo` | warnings | loading | missed | main-area ink % (per theme) |"
    )
    .unwrap();
    writeln!(md, "|---|---|---|---|---|---|---|---|---|---|").unwrap();
    for (route, r, inks) in &reports {
        let inks: Vec<String> = inks.iter().map(|(t, i)| format!("{t} {i:.0}")).collect();
        writeln!(
            md,
            "| {route} | `{}` | {} | {} / {} | {} | {} | {} | {} | {} | {} |",
            r.path,
            r.nodes,
            r.outlet_nodes,
            r.outlet_text,
            if r.unknown.is_empty() {
                "—".into()
            } else {
                r.unknown.iter().cloned().collect::<Vec<_>>().join(", ")
            },
            if r.todo.is_empty() {
                "—".into()
            } else {
                r.todo.iter().cloned().collect::<Vec<_>>().join(", ")
            },
            r.warnings.len(),
            r.loading,
            r.missed.len(),
            inks.join(", ")
        )
        .unwrap();
    }
    let warned: Vec<_> = reports
        .iter()
        .filter(|(_, r, _)| !r.warnings.is_empty())
        .collect();
    if !warned.is_empty() {
        writeln!(md, "\n### Resolve warnings\n").unwrap();
        for (route, r, _) in warned {
            let distinct: BTreeSet<&str> = r.warnings.iter().map(String::as_str).collect();
            writeln!(
                md,
                "- **{route}** ({} warnings, {} distinct):",
                r.warnings.len(),
                distinct.len()
            )
            .unwrap();
            for w in distinct.iter().take(12) {
                writeln!(md, "  - `{w}`").unwrap();
            }
            if distinct.len() > 12 {
                writeln!(md, "  - … {} more", distinct.len() - 12).unwrap();
            }
        }
    }

    writeln!(md, "\n{OBSERVATIONS}").unwrap();
    std::fs::write(cmp_dir.join("index.md"), md).expect("write index.md");
    println!(
        "wrote {} and {} in {:.1?}; {} problem(s) listed in index.md",
        rust_dir.display(),
        cmp_dir.display(),
        elapsed,
        problems.len()
    );
}
