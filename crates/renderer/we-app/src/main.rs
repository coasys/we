//! `we-app`: the binary — egui/eframe, the window, OS integration.
//!
//! Native: `we-app --offline --snapshot tests/data/tree-snapshot.json
//! --route /space/demo` renders the bundle's tree panel in a side panel,
//! backed by the snapshot's stores. `--bundle` points at another bundle
//! file; `--route` sets the initial routeStore path.
//!
//! `--offline` is the stage's default; there is no executor yet.
#![forbid(unsafe_code)]

#[cfg(not(target_arch = "wasm32"))]
use std::sync::Arc;

#[cfg(not(target_arch = "wasm32"))]
use serde::Deserialize;

#[cfg(not(target_arch = "wasm32"))]
use we_app::{RendererApp, Shell};
#[cfg(not(target_arch = "wasm32"))]
use we_template::{Bundle, RouteState, StoreBag};
#[cfg(not(target_arch = "wasm32"))]
use we_widgets::Registry;

/// Where the app looks for a bundle when `--bundle` is not given:
/// `crates/renderer/we-app/../../../bundles/coasys.bundle.json` — the repo's
/// `bundles/` beside `crates/`.
#[cfg(not(target_arch = "wasm32"))]
const DEFAULT_BUNDLE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
);

#[cfg(not(target_arch = "wasm32"))]
struct Args {
    bundle: String,
    snapshot: Option<String>,
    route: String,
    gallery: Gallery,
}

/// Which `--gallery` showcase to open (`none` → render the bundle).
#[cfg(not(target_arch = "wasm32"))]
#[derive(Default, PartialEq)]
enum Gallery {
    #[default]
    None,
    Style,
    Widgets,
}

#[cfg(not(target_arch = "wasm32"))]
fn parse_args() -> Args {
    let mut args = Args {
        bundle: DEFAULT_BUNDLE.to_string(),
        snapshot: None,
        route: "/".to_string(),
        gallery: Gallery::None,
    };
    let mut rest = std::env::args().skip(1);
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "--bundle" => {
                args.bundle = rest
                    .next()
                    .unwrap_or_else(|| panic!("--bundle needs a path"));
            }
            "--snapshot" => {
                args.snapshot = Some(
                    rest.next()
                        .unwrap_or_else(|| panic!("--snapshot needs a path")),
                );
            }
            "--route" => {
                args.route = rest
                    .next()
                    .unwrap_or_else(|| panic!("--route needs a path"));
            }
            "--gallery" => match rest.next().as_deref() {
                Some("style") => args.gallery = Gallery::Style,
                Some("widgets") => args.gallery = Gallery::Widgets,
                other => panic!("--gallery needs a target (`style` or `widgets`): {other:?}"),
            },
            "--offline" => {}
            "--help" | "-h" => {
                eprintln!(
                    "usage: we-app [--bundle <path>] [--snapshot <path>] [--route <href>] [--offline] [--gallery style|widgets]\n\n\
                     --bundle <path>    bundle to render (default: the repo's bundles/coasys.bundle.json)\n\
                     --snapshot <path>  offline data: stores/queries/invokes as JSON\n\
                     --route <href>     initial routeStore path (default /)\n\
                     --offline          run with no executor — the only mode this stage has\n\
                     --gallery style    design-system showcase: roles, scales, radii, shadows\n\
                     --gallery widgets  the E5b widget showcase, painted through layout+paint"
                );
                std::process::exit(0);
            }
            other => panic!("unknown flag {other:?}"),
        }
    }
    args
}

#[cfg(not(target_arch = "wasm32"))]
fn load_bundle(path: &str) -> Bundle {
    let text =
        std::fs::read_to_string(path).unwrap_or_else(|e| panic!("cannot read bundle {path}: {e}"));
    let bundle = Bundle::parse(&text).unwrap_or_else(|e| panic!("bundle did not parse: {e}"));
    if !bundle.is_supported() {
        panic!(
            "unsupported bundle format {} v{}",
            bundle.format, bundle.format_version
        );
    }
    bundle
}

#[cfg(not(target_arch = "wasm32"))]
fn run_native(args: Args) -> eframe::Result<()> {
    let bundle = load_bundle(&args.bundle);
    let title = bundle.name.clone();

    // The tree panel — `templates[0].meta.panels[*]` holds the panel schemas
    // (id "tree" is the space tree). Missing → panic: nothing to render.
    let schema = bundle
        .templates
        .as_deref()
        .unwrap_or_default()
        .first()
        .and_then(|t| t.meta.get("panels"))
        .and_then(|panels| panels.as_array())
        .and_then(|panels| {
            panels
                .iter()
                .find(|p| p.get("id").and_then(|i| i.as_str()) == Some("tree"))
                .or_else(|| panels.first())
        })
        .and_then(|panel| we_template::SchemaNode::deserialize(panel.get("node").cloned()?).ok())
        .unwrap_or_else(|| panic!("bundle has no panels to render"));

    let bag = match &args.snapshot {
        Some(path) => {
            let text = std::fs::read_to_string(path)
                .unwrap_or_else(|e| panic!("cannot read snapshot {path}: {e}"));
            let json: serde_json::Value =
                serde_json::from_str(&text).unwrap_or_else(|e| panic!("snapshot parse: {e}"));
            StoreBag::from_snapshot(&json).unwrap_or_else(|e| panic!("snapshot: {e}"))
        }
        None => StoreBag::new(),
    };
    let route = RouteState::new(&args.route);
    let shell = Shell {
        panel: RendererApp::new(
            schema,
            "tree",
            Arc::new(bag),
            route,
            Registry::with_builtins(),
        ),
    };

    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_title(&title)
            .with_inner_size([1024.0, 640.0]),
        ..Default::default()
    };
    eframe::run_native(
        &title,
        options,
        Box::new(move |_cc| {
            Ok(Box::new(App {
                shell: std::cell::RefCell::new(shell),
            }))
        }),
    )
}

#[cfg(not(target_arch = "wasm32"))]
struct App {
    /// `ui()` hands us `&mut self` — the RefCell only exists so the eframe
    /// closure can move `shell` in.
    shell: std::cell::RefCell<Shell>,
}

#[cfg(not(target_arch = "wasm32"))]
impl eframe::App for App {
    fn ui(&mut self, ui: &mut eframe::egui::Ui, _frame: &mut eframe::Frame) {
        self.shell.get_mut().frame_body(ui);
    }
}

/// `we-app --gallery <style|widgets>` — the showcases: the style token
/// table with its theme picker, or the E5b widget page painted live.
#[cfg(not(target_arch = "wasm32"))]
fn run_gallery(kind: Gallery) -> eframe::Result<()> {
    let (title, app): (&str, Box<dyn eframe::App>) = match kind {
        Gallery::Style => (
            "we gallery — style",
            Box::new(we_app::gallery::GalleryApp::new()),
        ),
        Gallery::Widgets => (
            "we gallery — widgets",
            Box::new(we_app::gallery_widgets::WidgetsGalleryApp::new()),
        ),
        Gallery::None => unreachable!(),
    };
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_title(title)
            .with_inner_size([720.0, 900.0]),
        ..Default::default()
    };
    eframe::run_native(title, options, Box::new(|_cc| Ok(app)))
}

#[cfg(not(target_arch = "wasm32"))]
fn main() -> eframe::Result<()> {
    let args = parse_args();
    if args.gallery != Gallery::None {
        return run_gallery(args.gallery);
    }
    run_native(args)
}

#[cfg(target_arch = "wasm32")]
fn main() {}
