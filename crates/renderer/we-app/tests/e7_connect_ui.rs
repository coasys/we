//! The `--connect` window, driven through egui (`EXECUTOR_PATH`; skipped
//! without it): the connect screen reaches a local executor, the picker
//! lists the agent's perspectives, a click opens one as the Coasys app, and
//! a call created elsewhere shows up in it.
use std::time::{Duration, Instant};

use egui_kittest::kittest::Queryable;
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
