//! `we-app`: the binary — egui/eframe, the window, OS integration.
//!
//! Native: `we-app --offline --snapshot tests/data/tree-snapshot.json
//! --route /space/demo` renders the bundle's tree panel in a side panel,
//! backed by the snapshot's stores. `--bundle` points at another bundle
//! file; `--route` sets the initial routeStore path.
//!
//! `--offline` is the default. `--connect` (E7) talks to a live AD4M
//! executor instead: it finds the executor (or takes `--executor-url`),
//! asks for access once (approved in the AD4M launcher), lists the agent's
//! spaces and renders the chosen one (`--space` skips the list) from live
//! data, read-only. `--write --space <perspective uuid>` (E11) asks for a
//! grant that may also change that one space, and the space's edit and
//! delete controls then write through the validated write RPC.
#![forbid(unsafe_code)]

#[cfg(not(target_arch = "wasm32"))]
use std::sync::Arc;

#[cfg(not(target_arch = "wasm32"))]
use serde::Deserialize;

#[cfg(not(target_arch = "wasm32"))]
use we_app::{RendererApp, Shell};
#[cfg(not(target_arch = "wasm32"))]
use we_egui::Registry;
#[cfg(not(target_arch = "wasm32"))]
use we_screen::{ScreenSchema, ScreenState};
#[cfg(not(target_arch = "wasm32"))]
use we_template::{Bundle, StoreBag};

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
    /// `dump` — resolve once, print the normal-form tree, exit.
    dump: bool,
    /// `--theme` — which recorded theme to paint with.
    theme: String,
    /// `--coasys <route>` — the whole app root at one recorded C2a route,
    /// set up the way `tests/coasys_shots.rs` sets it up.
    coasys: Option<String>,
    /// `--viewport` — the width the dump reports the host surfaces at.
    viewport: f32,
    /// `--connect` — a live executor instead of the recording.
    connect: bool,
    /// `--executor-url`, `--space`, `--email` — what `--connect` uses.
    executor_url: Option<String>,
    space: Option<String>,
    email: Option<String>,
    /// `--demo-recorded` — the recording under a live space.
    demo_recorded: bool,
    /// `--write` — with `--connect --space <uuid>`: ask for the write grant
    /// on that space and let the window change it.
    write: bool,
}

/// Which `--gallery` showcase to open (`none` → render the bundle).
/// `style` is the token showcase, `widgets` the themed E5a set,
/// `inputs` E5b's batch-2 showcase with its live event log.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Default, PartialEq)]
enum Gallery {
    #[default]
    None,
    Style,
    Widgets,
    Inputs,
}

#[cfg(not(target_arch = "wasm32"))]
fn parse_args() -> Args {
    parse_args_from(std::env::args().skip(1)).unwrap_or_else(|e| {
        eprintln!("we-app: {e}");
        std::process::exit(2)
    })
}

/// What `--write` says when it has no perspective uuid to name.
#[cfg(not(target_arch = "wasm32"))]
const WRITE_NEEDS_SPACE: &str =
    "--write needs --space <perspective uuid>: the grant names the one space it may change";

/// A perspective uuid: `8-4-4-4-12` hex digits.
#[cfg(not(target_arch = "wasm32"))]
fn is_uuid(s: &str) -> bool {
    let groups: Vec<&str> = s.split('-').collect();
    groups.len() == 5
        && groups
            .iter()
            .zip([8, 4, 4, 4, 12])
            .all(|(g, n)| g.len() == n && g.chars().all(|c| c.is_ascii_hexdigit()))
}

/// The arguments after the program name. A malformed flag still panics
/// with its own message, as before; `--write` without a perspective uuid
/// is an `Err`.
#[cfg(not(target_arch = "wasm32"))]
fn parse_args_from(argv: impl IntoIterator<Item = String>) -> Result<Args, String> {
    let mut args = Args {
        bundle: DEFAULT_BUNDLE.to_string(),
        snapshot: None,
        route: "/".to_string(),
        gallery: Gallery::None,
        dump: false,
        theme: "dark".to_string(),
        coasys: None,
        // The design's headless measure (6.2): the dump reports the
        // mount's host surfaces at 1440 unless `--viewport` says else.
        viewport: 1440.0,
        connect: false,
        executor_url: None,
        space: None,
        email: None,
        demo_recorded: false,
        write: false,
    };
    let mut rest = argv.into_iter().peekable();
    if rest.peek().is_some_and(|a| a == "dump") {
        rest.next();
        args.dump = true;
    }
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
                Some("inputs") => args.gallery = Gallery::Inputs,
                other => {
                    panic!("--gallery needs a target (`style`, `widgets` or `inputs`): {other:?}")
                }
            },
            "--theme" => {
                args.theme = rest
                    .next()
                    .unwrap_or_else(|| panic!("--theme needs a name"));
            }
            "--coasys" => {
                args.coasys = Some(
                    rest.next()
                        .unwrap_or_else(|| panic!("--coasys needs a route: {COASYS_ROUTES:?}")),
                );
            }
            "--viewport" => {
                args.viewport = rest
                    .next()
                    .and_then(|v| v.parse::<f32>().ok())
                    .unwrap_or_else(|| panic!("--viewport needs a pixel width"));
            }
            "--offline" => {}
            "--connect" => args.connect = true,
            "--demo-recorded" => args.demo_recorded = true,
            "--write" => args.write = true,
            "--executor-url" => {
                args.executor_url = Some(
                    rest.next()
                        .unwrap_or_else(|| panic!("--executor-url needs a URL")),
                );
            }
            "--space" => {
                args.space = Some(
                    rest.next()
                        .unwrap_or_else(|| panic!("--space needs a perspective uuid or name")),
                );
            }
            "--email" => {
                args.email = Some(
                    rest.next()
                        .unwrap_or_else(|| panic!("--email needs an address")),
                );
            }
            "--help" | "-h" => {
                eprintln!(
                    "usage: we-app [dump] [--bundle <path>] [--snapshot <path>] [--route <href>] [--offline] [--theme <name>] [--coasys <route>] [--gallery style|widgets|inputs]\n       \
                     we-app --connect [--executor-url <url>] [--space <uuid|name>] [--write] [--email <address>] [--theme <name>] [--demo-recorded]\n\n\
                     dump               resolve the app root once, print the normal-form tree, exit\n\
                     --bundle <path>    bundle to render (default: the repo's bundles/coasys.bundle.json)\n\
                     --snapshot <path>  offline data: stores/queries/invokes as JSON\n\
                     --route <href>     initial routeStore path (default /)\n\
                     --offline          run with no executor, from the recording (the default)\n\
                     --connect          read a live AD4M executor: find it, ask for access once\n\
                                        (approve in the AD4M launcher), pick a space, render it\n\
                     --executor-url <u> the executor to use instead of looking (http://127.0.0.1:12000)\n\
                     --space <id>       open this perspective (uuid or name) without the picker\n\
                     --write            with --connect --space <uuid>: allow changes in that space\n\
                                        (asks for a write grant once)\n\
                     --email <address>  the account on a multi-user executor\n\
                     --demo-recorded    with --connect: show the recorded Coasys data where the\n\
                                        live space has none (a demo mix; off by default)\n\
                     --theme <name>     light, dark, black, retro, cyberpunk or glow (default dark)\n\
                     --coasys <route>   the whole app at a recorded Coasys route, set up as the\n\
                                        coasys_shots screenshots are: index, workflows, channels,\n\
                                        channel-design, calls, call, people, dna, person or about\n\
                     --viewport <px>    the width dump reports the mount surfaces at (default 1440)\n\
                     --gallery style    design-system showcase: roles, scales, radii, shadows\n\
                     --gallery widgets  the E5a widget showcase, themed, schema-driven\n\
                     --gallery inputs   the E5b widget showcase, painted through layout+paint"
                );
                std::process::exit(0);
            }
            other => panic!("unknown flag {other:?}"),
        }
    }
    if args.write && !args.space.as_deref().is_some_and(is_uuid) {
        return Err(WRITE_NEEDS_SPACE.into());
    }
    Ok(args)
}

/// The grant `--connect` asks for, and what the window may do with it.
#[cfg(not(target_arch = "wasm32"))]
fn grant(args: &Args) -> (we_ad4m::connect::GrantScope, we_ad4m::Access) {
    match (&args.space, args.write) {
        (Some(space), true) => (
            we_ad4m::connect::GrantScope::Write {
                space: space.clone(),
            },
            we_ad4m::Access::write(space.as_str()),
        ),
        _ => (
            we_ad4m::connect::GrantScope::ReadOnly,
            we_ad4m::Access::ReadOnly,
        ),
    }
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

/// `we-app dump` — resolve the bundle's app root once against the snapshot
/// and print the normal-form tree. The offline answer to "what did the
/// renderer produce": no window, no executor.
#[cfg(not(target_arch = "wasm32"))]
fn run_dump(args: &Args) {
    use we_session::Session;
    use we_template::{AppSpec, RootSpec};

    let bundle = load_bundle(&args.bundle);
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
    let screen_schema = ScreenSchema {
        pages: bundle
            .pages
            .as_deref()
            .unwrap_or_default()
            .iter()
            .map(|p| p.id.clone())
            .collect(),
        ..ScreenSchema::default()
    };
    let screen = ScreenState::desktop(screen_schema, &args.route);
    let spec = AppSpec {
        bundle: bundle.name.clone().into(),
        app: bundle.app.clone(),
        template: bundle.templates.as_deref().and_then(|t| t.first()).cloned(),
        pages: bundle.pages.clone().unwrap_or_default(),
        boot: bundle.boot_screen.clone(),
    };
    let bag = Arc::new(bag);
    // `$`-types the widget registry knows (`$lane`) resolve as components —
    // the same gate `RendererApp::new` sets, or a dump full of `$todo:`
    // placeholders lies about what the app renders.
    let types: std::collections::HashSet<&'static str> =
        Registry::with_builtins().type_names().collect();
    // The same session the window and the CLI run, with the offline host
    // injected. One frame, exactly as before — plus the viewport measure
    // every frontend reports the mount's host surfaces at (E3c-13): the
    // report rides the inbox, the poll applies it, the dump prints the
    // settled tree.
    let mut session = Session::offline(RootSpec::App(Box::new(spec)), bag, screen)
        .with_dollar_types(move |ty| types.contains(ty));
    let root = session.resolve();
    session.report_host_surfaces(&root, args.viewport);
    let root = session.resolve();
    let stats = session.stats();
    eprintln!(
        "dump: nodes={} resolves={} last_resolve={:?} warnings={}",
        stats.nodes,
        stats.resolves,
        stats.last_resolve,
        stats.warnings.len()
    );
    let out = we_template::normal_form(&root);
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
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
    let screen_schema = ScreenSchema {
        pages: bundle
            .pages
            .as_deref()
            .unwrap_or_default()
            .iter()
            .map(|p| p.id.clone())
            .collect(),
        ..ScreenSchema::default()
    };
    let screen = ScreenState::desktop(screen_schema, &args.route);
    let mut panel = RendererApp::new(
        schema,
        "tree",
        Arc::new(bag),
        screen,
        Registry::with_builtins(),
    );
    // Every recorded table loads; `--theme` picks one, dark by default.
    let set = we_app::gallery::load_theme_set();
    let (theme, fell_back) = set.theme(&args.theme);
    if fell_back {
        eprintln!("no recorded theme {:?}; painting with dark", args.theme);
    }
    panel.theme = theme.clone();
    let shell = Shell { panel };

    let options = we_app::window_options(&title, [1024.0, 640.0]);
    eframe::run_native(
        &title,
        options,
        Box::new(move |cc| {
            we_app::init_host(&cc.egui_ctx);
            let mut shell = shell;
            // The inbox's wake is egui's own "draw again" — a completion
            // or a `set_root` landing off-thread repaints, and the poll
            // that runs then picks it up.
            let ctx = cc.egui_ctx.clone();
            shell
                .panel
                .session
                .set_waker(std::sync::Arc::new(move || ctx.request_repaint()));
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

/// `we-app --gallery <style|widgets|inputs>` — the showcases: the style
/// token table with its theme picker, the themed E5a widget page, or the
/// E5b batch-2 page painted live.
#[cfg(not(target_arch = "wasm32"))]
fn run_gallery(kind: Gallery) -> eframe::Result<()> {
    let (title, size, app): (&str, [f32; 2], Box<dyn eframe::App>) = match kind {
        Gallery::Style => (
            "we gallery — style",
            [720.0, 900.0],
            Box::new(we_app::gallery::GalleryApp::new()),
        ),
        Gallery::Widgets => (
            "we gallery — widgets",
            [900.0, 900.0],
            Box::new(we_app::gallery::WidgetsApp::new()),
        ),
        Gallery::Inputs => (
            "we gallery — inputs",
            [720.0, 900.0],
            Box::new(we_app::gallery_widgets::WidgetsGalleryApp::new()),
        ),
        Gallery::None => unreachable!(),
    };
    let options = we_app::window_options(title, size);
    eframe::run_native(
        title,
        options,
        Box::new(|cc| {
            we_app::init_host(&cc.egui_ctx);
            Ok(app)
        }),
    )
}

#[cfg(not(target_arch = "wasm32"))]
fn main() -> eframe::Result<()> {
    we_app::logging::init();
    let args = parse_args();
    if args.dump {
        run_dump(&args);
        return Ok(());
    }
    if args.gallery != Gallery::None {
        return run_gallery(args.gallery);
    }
    if args.connect {
        return run_connected(args);
    }
    if let Some(route) = &args.coasys {
        return run_coasys(route, &args.theme);
    }
    run_native(args)
}

/// The ten routes C2a recorded in `fixtures/coasys/snapshot.json`.
#[cfg(not(target_arch = "wasm32"))]
const COASYS_ROUTES: [&str; 10] = [
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

/// `we-app --coasys <route>` — the bundle's whole app root against one
/// recorded route, in a window: `Runtime::app` over `OfflineData::from_route`
/// at the route's recorded Rust path, exactly as `tests/coasys_shots.rs`
/// builds the frames it screenshots. Navigating away leaves the route's
/// captures behind, so other pages show what that route did not record.
#[cfg(not(target_arch = "wasm32"))]
fn run_coasys(route: &str, theme_id: &str) -> eframe::Result<()> {
    if !COASYS_ROUTES.contains(&route) {
        panic!("--coasys: no recorded route {route:?}; one of {COASYS_ROUTES:?}");
    }
    let bundle = load_bundle(DEFAULT_BUNDLE);
    let title = format!("{} — {route} ({theme_id})", bundle.name);
    let (mut app, fell_back) =
        we_app::coasys_app(&bundle, route, theme_id).unwrap_or_else(|e| panic!("{e}"));
    if fell_back {
        eprintln!("no recorded theme {theme_id:?}; painting with dark");
    }
    app.frame_log = std::env::var_os("WE_FRAME_LOG").is_some();

    let options = we_app::window_options(&title, [1280.0, 800.0]);
    eframe::run_native(
        &title,
        options,
        Box::new(move |cc| {
            we_app::init_host(&cc.egui_ctx);
            let ctx = cc.egui_ctx.clone();
            app.session
                .set_waker(Arc::new(move || ctx.request_repaint()));
            Ok(Box::new(CoasysApp { app }))
        }),
    )
}

#[cfg(not(target_arch = "wasm32"))]
struct CoasysApp {
    app: RendererApp,
}

#[cfg(not(target_arch = "wasm32"))]
impl eframe::App for CoasysApp {
    fn ui(&mut self, ui: &mut eframe::egui::Ui, _frame: &mut eframe::Frame) {
        self.app.frame_body(ui);
    }
}

/// `we-app --connect` — the Coasys app against a live executor.
#[cfg(not(target_arch = "wasm32"))]
fn run_connected(args: Args) -> eframe::Result<()> {
    use we_app::connected::{ConnectArgs, ConnectedApp};
    let bundle = load_bundle(&args.bundle);
    let title = format!("{} — connected", bundle.name);
    let (scope, access) = grant(&args);
    let connect = ConnectArgs {
        settings: we_ad4m::connect::ConnectSettings {
            url: args.executor_url.clone(),
            email: args.email.clone(),
            scope,
            ..Default::default()
        },
        access,
        space: args.space.clone(),
        theme: args.theme.clone(),
        remember: None,
        data: if args.demo_recorded {
            we_app::live::DataMode::DemoRecorded
        } else {
            we_app::live::DataMode::Live
        },
    };
    let options = we_app::window_options(&title, [1280.0, 800.0]);
    eframe::run_native(
        &title,
        options,
        Box::new(move |cc| {
            we_app::init_host(&cc.egui_ctx);
            Ok(Box::new(Connected(ConnectedApp::new(
                cc.egui_ctx.clone(),
                bundle,
                connect,
            ))))
        }),
    )
}

#[cfg(not(target_arch = "wasm32"))]
struct Connected(we_app::connected::ConnectedApp);

#[cfg(not(target_arch = "wasm32"))]
impl eframe::App for Connected {
    fn ui(&mut self, ui: &mut eframe::egui::Ui, _frame: &mut eframe::Frame) {
        self.0.ui(ui);
    }
}

#[cfg(target_arch = "wasm32")]
fn main() {}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;

    const UUID: &str = "0f8b2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";

    fn parse(argv: &[&str]) -> Result<Args, String> {
        parse_args_from(argv.iter().map(|s| s.to_string()))
    }

    #[test]
    fn write_with_a_perspective_uuid_asks_for_the_write_grant() {
        let args = parse(&["--connect", "--write", "--space", UUID]).unwrap();
        assert!(args.write);
        let (scope, access) = grant(&args);
        assert_eq!(
            scope,
            we_ad4m::connect::GrantScope::Write { space: UUID.into() }
        );
        assert_eq!(access, we_ad4m::Access::write(UUID));
    }

    #[test]
    fn write_without_a_uuid_is_refused() {
        for argv in [
            &["--connect", "--write"][..],
            &["--connect", "--write", "--space", "MySpace"][..],
            &[
                "--connect",
                "--write",
                "--space",
                "0f8b2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5",
            ][..],
        ] {
            let e = parse(argv).err().expect("refused");
            assert!(e.contains("--write needs --space"), "{e}");
        }
    }

    #[test]
    fn connect_alone_stays_read_only() {
        let args = parse(&["--connect", "--space", "MySpace"]).unwrap();
        let (scope, access) = grant(&args);
        assert_eq!(scope, we_ad4m::connect::GrantScope::ReadOnly);
        assert_eq!(access, we_ad4m::Access::ReadOnly);
    }
}
