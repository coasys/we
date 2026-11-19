//! The connect screen, drawn. No executor: a closed port, or no click at all.
//! The live executor path stays in `e7_connect_ui.rs`.

#[path = "support/gpu.rs"]
mod gpu;

use std::time::{Duration, Instant};

use egui_kittest::kittest::Queryable;
use we_ad4m::connect::ConnectSettings;
use we_app::connected::{ConnectArgs, ConnectedApp};

const BUNDLE: &str = include_str!("../../../../bundles/coasys.bundle.json");

type H<'a> = egui_kittest::Harness<'a, Option<ConnectedApp>>;

fn harness(settings: ConnectSettings) -> H<'static> {
    harness_remembering(settings, None)
}

fn harness_remembering(
    settings: ConnectSettings,
    remember: Option<std::path::PathBuf>,
) -> H<'static> {
    let args = ConnectArgs {
        settings,
        space: None,
        theme: "dark".into(),
        data: Default::default(),
        access: we_ad4m::Access::ReadOnly,
        remember,
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

/// Render-and-export smoke test. It checks the accessible names and the
/// stage, then writes a PNG under the cargo target tmp dir. It does not
/// compare pixels or a golden image.
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
    let shot = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("connect-screen.png");
    image.save(&shot).expect("write the connect screenshot");
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

fn closed_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    port
}

/// Acceptance: the last-used tag survives a restart. The second start goes
/// to the remembered place without a click; "Choose another" shows the
/// list with that place tagged.
#[test]
fn the_last_used_tag_survives_a_restart() {
    let port = closed_port();
    let (tokens, settings) = isolated(Some(format!("http://127.0.0.1:{port}")));
    let file = tokens.path().join("we").join("base.json");
    {
        let mut h = harness_remembering(settings.clone(), Some(file.clone()));
        step_until(&mut h, "the connect screen", Duration::from_secs(10), |h| {
            h.query_by_label_contains("This computer").is_some()
        });
        assert!(h.query_by_label_contains("Last used").is_none());
        h.get_by_label_contains("This computer").click();
        step_until(&mut h, "the offline reason", Duration::from_secs(60), |h| {
            h.query_by_label_contains("isn't responding").is_some()
        });
    }
    let kept = std::fs::read_to_string(&file).expect("the choice is kept");
    assert!(kept.contains("this-device"), "{kept}");
    assert!(!kept.contains("127.0.0.1"), "an address was kept: {kept}");

    let mut h = harness_remembering(settings, Some(file));
    step_until(
        &mut h,
        "the resumed place's reason",
        Duration::from_secs(60),
        |h| h.query_by_label_contains("isn't responding").is_some(),
    );
    h.get_by_label_contains("Choose another").click();
    step_until(&mut h, "the list", Duration::from_secs(10), |h| {
        h.query_by_label_contains("Where to keep your spaces")
            .is_some()
    });
    assert!(
        h.query_by_label_contains("Last used").is_some(),
        "the tag did not survive the restart"
    );
}

/// A kept server is listed, labelled as a server, and choosing it says why
/// it cannot be opened. Nothing is dialed: a listener at its address sees
/// no connection.
#[test]
fn a_kept_server_explains_the_refusal() {
    let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    server.set_nonblocking(true).unwrap();
    let address = format!("127.0.0.1:{}", server.local_addr().unwrap().port());
    let (tokens, settings) = isolated(Some(format!("http://127.0.0.1:{}", closed_port())));
    let file = tokens.path().join("base.json");
    std::fs::write(
        &file,
        serde_json::json!({ "servers": [{ "name": "Lab box", "address": address }] }).to_string(),
    )
    .unwrap();
    let mut h = harness_remembering(settings, Some(file));
    step_until(&mut h, "the server row", Duration::from_secs(10), |h| {
        h.query_by_label_contains("Lab box").is_some()
    });
    assert!(h.query_by_label_contains("Coming soon").is_some());
    h.get_by_label_contains("Lab box").click();
    step_until(&mut h, "the refusal", Duration::from_secs(10), |h| {
        h.query_by_label_contains("Can't open Lab box from this app yet")
            .is_some()
    });
    h.run_steps(5);
    assert!(h.query_by_label_contains("isn't responding").is_none());
    assert!(server.accept().is_err(), "the server address was dialed");
}
