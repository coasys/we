//! The `--connect` window, driven through egui (`EXECUTOR_PATH`; skipped
//! without it): the connect screen reaches a local executor, the window
//! opens the seeded space with no picker, and a call created elsewhere
//! shows up in it.
use std::time::{Duration, Instant};

use egui_kittest::kittest::{NodeT, Queryable};
use we_ad4m::connect::ConnectSettings;
use we_ad4m::testkit as kit;
use we_app::connected::{ConnectArgs, ConnectedApp};

const BUNDLE: &str = include_str!("../../../../bundles/coasys.bundle.json");

type H<'a> = egui_kittest::Harness<'a, Option<ConnectedApp>>;

/// Step frames until `done`, sleeping a little between them: the adapter
/// answers on its own threads and wakes egui.
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

fn tree_text(h: &mut H) -> String {
    let live = h.state_mut().as_mut().unwrap().live_space().unwrap();
    we_template::normal_form(&live.app.session.resolve()).to_string()
}

#[test]
fn connect_and_render() {
    let Some(executor) = kit::start_executor() else {
        return;
    };
    let rt = we_ad4m::Runtime::new().unwrap();
    let writer = kit::connect(&rt, &executor.url);
    let uuid = kit::seed_space(&rt, &writer, "e7-ui");
    let tokens = tempfile::tempdir().unwrap();
    let args = ConnectArgs {
        settings: ConnectSettings {
            url: Some(executor.url.clone()),
            token_dir: Some(tokens.path().to_path_buf()),
            port_file: Some(tokens.path().join("no-port-file")),
            ..ConnectSettings::default()
        },
        space: Some("e7-ui".into()),
        theme: "dark".into(),
        data: Default::default(),
        access: we_ad4m::Access::ReadOnly,
    };
    let bundle = we_template::Bundle::parse(BUNDLE).unwrap();
    let mut h = egui_kittest::Harness::builder()
        .with_size(egui::vec2(1280.0, 800.0))
        .build_ui_state(
            move |ui, app: &mut Option<ConnectedApp>| {
                app.get_or_insert_with(|| {
                    // What `main` does in eframe's creation callback.
                    we_app::init_host(ui.ctx());
                    ConnectedApp::new(ui.ctx().clone(), bundle.clone(), args.clone())
                })
                .ui(ui)
            },
            None,
        );

    step_until(&mut h, "the space", Duration::from_secs(60), |h| {
        assert_ne!(
            h.state().as_ref().map(|a| a.stage()),
            Some("pick"),
            "the picker is gone"
        );
        h.state().as_ref().is_some_and(|a| a.stage() == "space")
            && h.query_by_label("e7-ui").is_some()
    });
    assert!(h.query_by_label("Open a space").is_none());
    // The sidebar lists the space's sections; calls are on their own page.
    step_until(&mut h, "the sidebar", Duration::from_secs(30), |h| {
        tree_text(h).contains("Social DNA")
    });
    // The status bar names the space. The rail button is exactly "e7-ui",
    // so a contains-query of the bare name matches both and refuses.
    assert!(h.query_by_label_contains("  ·  e7-ui").is_some());

    let live = h.state_mut().as_mut().unwrap().live_space().unwrap();
    live.app
        .session
        .apply_screen(we_screen::ScreenOp::Navigate {
            to: "~/calls".into(),
            query: None,
            base_depth: None,
            replace: false,
        });
    step_until(&mut h, "the empty state", Duration::from_secs(30), |h| {
        tree_text(h).contains("No calls yet.")
    });

    kit::create_collection(&rt, &writer, &uuid, "call", "A call from elsewhere");
    step_until(&mut h, "the new call", Duration::from_secs(2), |h| {
        tree_text(h).contains("A call from elsewhere")
    });

    // Back on the space's own page, the sidebar's Calls group lists it too
    // — once the first screen is drawn (`spaceStore.firstScreenOpen`, which
    // the host opens after its first frame).
    let live = h.state_mut().as_mut().unwrap().live_space().unwrap();
    live.app
        .session
        .apply_screen(we_screen::ScreenOp::Navigate {
            to: "~/".into(),
            query: None,
            base_depth: None,
            replace: false,
        });
    step_until(
        &mut h,
        "the call in the sidebar",
        Duration::from_secs(10),
        |h| {
            let text = tree_text(h);
            text.contains("A call from elsewhere") && !text.contains("No calls yet.")
        },
    );
}

fn app_for(url: &str, tokens: &std::path::Path, space: Option<&str>) -> H<'static> {
    let args = ConnectArgs {
        settings: ConnectSettings {
            url: Some(url.to_string()),
            token_dir: Some(tokens.to_path_buf()),
            port_file: Some(tokens.join("no-port-file")),
            ..ConnectSettings::default()
        },
        space: space.map(str::to_string),
        theme: "dark".into(),
        data: Default::default(),
        access: we_ad4m::Access::ReadOnly,
    };
    let bundle = we_template::Bundle::parse(BUNDLE).unwrap();
    egui_kittest::Harness::builder()
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

fn stage(h: &H) -> &'static str {
    h.state().as_ref().map_or("none", |a| a.stage())
}

/// The executor goes away under an open space (Lal F5): the window says
/// the connection is lost and offers to reconnect, instead of a green dot
/// over rows that no longer update.
#[test]
fn a_dead_executor_is_shown() {
    let Some(executor) = kit::start_executor() else {
        return;
    };
    let rt = we_ad4m::Runtime::new().unwrap();
    let writer = kit::connect(&rt, &executor.url);
    kit::seed_space(&rt, &writer, "e7-dies");
    let tokens = tempfile::tempdir().unwrap();
    let mut h = app_for(&executor.url, tokens.path(), Some("e7-dies"));
    step_until(&mut h, "the space", Duration::from_secs(60), |h| {
        stage(h) == "space" && h.query_by_label("e7-dies").is_some()
    });
    assert!(h.query_by_label_contains("Connection lost").is_none());

    drop(executor);
    step_until(
        &mut h,
        "the lost connection",
        Duration::from_secs(30),
        |h| h.query_by_label_contains("Connection lost").is_some(),
    );
    assert!(h.query_by_label("Reconnect").is_some());
}

/// The grant is removed in the launcher while a space is open (Lal F5):
/// the window goes back to the connect screen and says why.
#[test]
fn a_revoked_grant_returns_to_the_connect_screen() {
    let Some(executor) = kit::start_executor_with_admin("e7-admin") else {
        return;
    };
    let rt = we_ad4m::Runtime::new().unwrap();
    let admin = kit::connect_as(&rt, &executor.url, "e7-admin");
    rt.block_on(admin.client().agent.generate("passphrase".into()))
        .unwrap();
    kit::seed_space_as(&rt, &admin, "e7-revoked");
    let tokens = tempfile::tempdir().unwrap();
    let mut h = app_for(&executor.url, tokens.path(), Some("e7-revoked"));

    // The request, as the connect screen shows it.
    let mut request_id = String::new();
    step_until(
        &mut h,
        "the capability request",
        Duration::from_secs(60),
        |h| {
            let Some(node) = h.query_by_label_contains("(request ") else {
                return false;
            };
            // A label widget carries its text as the node's value.
            let label = node.accesskit_node().value().unwrap_or_default();
            let start = label.find("(request ").unwrap() + "(request ".len();
            request_id = label[start..].split(')').next().unwrap().to_string();
            true
        },
    );
    let app = we_ad4m::connect::app_info(&we_ad4m::connect::GrantScope::ReadOnly);
    let auth = serde_json::json!({
        "requestId": request_id,
        "auth": { "appName": app.name, "appDesc": app.description, "capabilities": app.capabilities },
    })
    .to_string();
    let code: String = rt
        .block_on(admin.ws().call(
            "agent.permitCapability",
            serde_json::json!({ "auth": auth }),
        ))
        .unwrap();
    h.get_by_role(egui::accesskit::Role::PasswordInput)
        .type_text(&code);
    h.step();
    h.get_by_label("Continue").click();
    step_until(&mut h, "the space", Duration::from_secs(60), |h| {
        stage(h) == "space" && h.query_by_label("e7-revoked").is_some()
    });

    // The launcher removes the app.
    let _: serde_json::Value = rt
        .block_on(
            admin
                .ws()
                .call("agent.removeApp", serde_json::json!({ "id": request_id })),
        )
        .unwrap();
    step_until(&mut h, "the connect screen", Duration::from_secs(30), |h| {
        stage(h) == "connect" && h.query_by_label_contains("refused").is_some()
    });
}

/// B1, through the real window: with the data panel open (F11) the page is
/// laid out in the room the panel leaves, so its right-hand controls are not
/// under it. (`panel_layout.rs` covers `frame_body_in` alone; this is the
/// wiring in `connected.rs`.)
#[test]
fn the_page_lays_out_beside_the_data_panel() {
    let Some(executor) = kit::start_executor() else {
        return;
    };
    let rt = we_ad4m::Runtime::new().unwrap();
    let writer = kit::connect(&rt, &executor.url);
    let _uuid = kit::seed_space(&rt, &writer, "b1-ui");
    let tokens = tempfile::tempdir().unwrap();
    let mut h = app_for(&executor.url, tokens.path(), Some("b1-ui"));

    step_until(&mut h, "the space", Duration::from_secs(60), |h| {
        h.state().as_ref().is_some_and(|a| a.stage() == "space")
            && h.query_by_label("b1-ui").is_some()
    });
    step_until(&mut h, "the page's header", Duration::from_secs(30), |h| {
        h.query_by_label("Canvas").is_some()
    });
    let before = h.get_by_label("Canvas").rect().right();

    h.key_press(egui::Key::F11);
    step_until(&mut h, "the data panel", Duration::from_secs(10), |h| {
        h.query_by_label("Where the data comes from").is_some()
    });
    // A few frames for the page to lay out in what is left.
    for _ in 0..10 {
        h.step();
    }
    let panel = h.get_by_label("Where the data comes from").rect();
    let canvas = h.get_by_label("Canvas").rect();
    assert!(
        canvas.right() <= panel.left(),
        "the page's right edge {} is under the data panel, which starts at {} (it was {before} without it)",
        canvas.right(),
        panel.left()
    );
}
