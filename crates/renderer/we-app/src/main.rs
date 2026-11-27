//! `we-app`: the binary — egui/eframe, the window, OS integration.
//!
//! Native: `cargo run -p we-app -- --offline` opens the scaffold window titled
//! with the bundle's `name` (`--bundle` points it at another file).
//! `--offline` is the stage's default; there is no executor yet.

#[cfg(not(target_arch = "wasm32"))]
use we_template::Bundle;

/// Where the app looks for a bundle when `--bundle` is not given:
/// `crates/renderer/we-app/../../../bundles/coasys.bundle.json` — the repo's
/// `bundles/` beside `crates/`.
#[cfg(not(target_arch = "wasm32"))]
const DEFAULT_BUNDLE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
);

#[cfg(not(target_arch = "wasm32"))]
struct ScaffoldApp;

#[cfg(not(target_arch = "wasm32"))]
impl eframe::App for ScaffoldApp {
    fn ui(&mut self, ui: &mut eframe::egui::Ui, _frame: &mut eframe::Frame) {
        eframe::egui::CentralPanel::default().show(ui, |ui| {
            ui.centered_and_justified(|ui| {
                ui.label("renderer scaffold");
            });
        });
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn run_native(bundle_path: &str) -> eframe::Result<()> {
    let text = std::fs::read_to_string(bundle_path)
        .unwrap_or_else(|e| panic!("cannot read bundle {bundle_path}: {e}"));
    let bundle = Bundle::parse(&text).unwrap_or_else(|e| panic!("bundle did not parse: {e}"));
    if !bundle.is_supported() {
        panic!(
            "unsupported bundle format {} v{}",
            bundle.format, bundle.format_version
        );
    }
    let title = bundle.name.clone();

    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_title(&title)
            .with_inner_size([640.0, 480.0]),
        ..Default::default()
    };
    eframe::run_native(&title, options, Box::new(|_cc| Ok(Box::new(ScaffoldApp))))
}

#[cfg(not(target_arch = "wasm32"))]
fn main() -> eframe::Result<()> {
    // Two flags by hand: `--bundle <path>` and `--offline` (the only mode this
    // stage has). No clap for this.
    let mut bundle = DEFAULT_BUNDLE.to_string();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--bundle" => {
                bundle = args
                    .next()
                    .unwrap_or_else(|| panic!("--bundle needs a path"));
            }
            "--offline" => {}
            "--help" | "-h" => {
                eprintln!(
                    "usage: we-app [--bundle <path>] [--offline]\n\n\
                     --bundle <path>  bundle to render (default: the repo's bundles/coasys.bundle.json)\n\
                     --offline        run with no executor — the only mode this stage has"
                );
                return Ok(());
            }
            other => panic!("unknown flag {other:?}"),
        }
    }
    run_native(&bundle)
}

#[cfg(target_arch = "wasm32")]
fn main() {}
