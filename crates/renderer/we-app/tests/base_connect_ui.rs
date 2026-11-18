//! The connect screen, drawn. No executor: a closed port, or no click at all.
//! The live executor path stays in `e7_connect_ui.rs`.

#[path = "support/gpu.rs"]
mod gpu;

use std::time::{Duration, Instant};

use egui_kittest::kittest::Queryable;
use we_ad4m::connect::ConnectSettings;
use we_app::connected::{ConnectArgs, ConnectedApp};

const BUNDLE: &str = include_str!("../../../../bundles/coasys.bundle.json");
const SHOT: &str = "/home/marvin/.openclaw/workspace/agent-runs/we-egui-connect/connect-screen.png";

type H<'a> = egui_kittest::Harness<'a, Option<ConnectedApp>>;

fn harness(settings: ConnectSettings) -> H<'static> {
    let args = ConnectArgs {
        settings,
        space: None,
        theme: "dark".into(),
        data: Default::default(),
        access: we_ad4m::Access::ReadOnly,
    };
    let bundle = we_template::Bundle::parse(BUNDLE).unwrap();
    egui_kittest::Harness::builder()
        .renderer(gpu::serial())
        .with_accessibility_check(false)
        .with_size(egui::vec2(1280.0, 800.0))
        .build_ui_state(
            move |ui, app: &mut Option<ConnectedApp>| {
                app.get_or_insert_with(|| {
                    we_app::init_host(ui.ctx());
                    ConnectedApp::new(ui.ctx().clone(), bundle.clone(), args.clone())
                })
                .ui(ui)
            },
            None,
        )
}

fn step_until(h: &mut H, what: &str, limit: Duration, mut done: impl FnMut(&mut H) -> bool) {
    let start = Instant::now();
    loop {
        h.step();
        if done(h) {
            return;
        }
        assert!(start.elapsed() < limit, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn isolated(url: Option<String>) -> (tempfile::TempDir, ConnectSettings) {
    let tokens = tempfile::tempdir().unwrap();
    let settings = ConnectSettings {
        url,
        token_dir: Some(tokens.path().to_path_buf()),
        port_file: Some(tokens.path().join("no-port-file")),
        ..ConnectSettings::default()
    };
    (tokens, settings)
}

#[test]
fn this_computer_uses_the_same_words() {
    let row = we_session::ConnectionRow::this_computer();
    let offer = we_ad4m::base::this_computer();
    assert_eq!(row.id.as_ref(), offer.id);
    assert_eq!(row.kind.as_ref(), offer.kind);
    assert_eq!(row.icon.as_ref(), offer.icon);
    assert_eq!(row.label.as_ref(), offer.label);
    assert_eq!(row.detail.as_ref(), offer.detail);
}

/// The first screen, with no click, so nothing dials.
#[test]
fn the_connect_screen_shows_where_to_keep_your_spaces() {
    let (_tokens, settings) = isolated(None);
    let mut h = harness(settings);
    h.run_steps(3);
    assert!(h
        .query_by_label_contains("Where to keep your spaces")
        .is_some());
    assert!(h.query_by_label_contains("This computer").is_some());
    assert!(h
        .query_by_label_contains("Available while this computer is on")
        .is_some());
    assert!(h
        .state()
        .as_ref()
        .is_some_and(|app| app.stage() == "connect"));
    assert!(h.query_by_label_contains("Opening your spaces").is_none());
    let image = h.render().expect("wgpu render of the connect screen");
    image.save(SHOT).expect("write the connect screenshot");
}

/// A closed loopback port. The click must not read `~/.ad4m`.
#[test]
fn a_closed_localhost_shows_the_reason() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let (_tokens, settings) = isolated(Some(format!("http://127.0.0.1:{port}")));
    let mut h = harness(settings);
    step_until(&mut h, "the connect screen", Duration::from_secs(10), |h| {
        h.query_by_label_contains("This computer").is_some()
    });
    h.get_by_label_contains("This computer").click();
    step_until(&mut h, "the offline reason", Duration::from_secs(60), |h| {
        h.query_by_label_contains("isn't responding").is_some()
            && h.query_by_label_contains("Try again").is_some()
    });
    assert!(h
        .state()
        .as_ref()
        .is_some_and(|app| app.stage() == "connect"));
}
