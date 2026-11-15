//! The `--connect` window, driven through egui (`EXECUTOR_PATH`; skipped
//! without it): the connect screen reaches a local executor, the picker
//! lists the agent's perspectives, a click opens one as the Coasys app, and
//! a call created elsewhere shows up in it.
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
fn connect_pick_and_render() {
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
        space: None,
        theme: "dark".into(),
        data: Default::default(),
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

    step_until(&mut h, "the picker", Duration::from_secs(60), |h| {
        h.state().as_ref().is_some_and(|a| a.stage() == "pick")
            && h.query_by_label("e7-ui   (local)").is_some()
    });
    h.get_by_label("e7-ui   (local)").click();
    step_until(&mut h, "the space", Duration::from_secs(10), |h| {
        h.state().as_ref().is_some_and(|a| a.stage() == "space")
    });
    step_until(&mut h, "the empty state", Duration::from_secs(30), |h| {
        tree_text(h).contains("A space starts with ")
    });
    // The status bar names the space.
    assert!(h.query_by_label_contains("e7-ui").is_some());

    kit::create_collection(&rt, &writer, &uuid, "call", "A call from elsewhere");
    step_until(&mut h, "the new call", Duration::from_secs(2), |h| {
        tree_text(h).contains("A call from elsewhere")
    });
}

fn app_for(url: &str, tokens: &std::path::Path) -> H<'static> {
    let args = ConnectArgs {
        settings: ConnectSettings {
            url: Some(url.to_string()),
            token_dir: Some(tokens.to_path_buf()),
            port_file: Some(tokens.join("no-port-file")),
            ..ConnectSettings::default()
        },
        space: None,
        theme: "dark".into(),
        data: Default::default(),
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
    let mut h = app_for(&executor.url, tokens.path());
    step_until(&mut h, "the picker", Duration::from_secs(60), |h| {
        stage(h) == "pick" && h.query_by_label("e7-dies   (local)").is_some()
    });
    h.get_by_label("e7-dies   (local)").click();
    step_until(&mut h, "the space", Duration::from_secs(10), |h| {
        stage(h) == "space"
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
    let mut h = app_for(&executor.url, tokens.path());

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
    let app = we_ad4m::connect::app_info();
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
    step_until(&mut h, "the picker", Duration::from_secs(60), |h| {
        stage(h) == "pick" && h.query_by_label("e7-revoked   (local)").is_some()
    });
    h.get_by_label("e7-revoked   (local)").click();
    step_until(&mut h, "the space", Duration::from_secs(10), |h| {
        stage(h) == "space"
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
