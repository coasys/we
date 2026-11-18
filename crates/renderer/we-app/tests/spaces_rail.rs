//! The left rail lists every space from a fixture executor (`EXECUTOR_PATH`;
//! skipped without it). Clicking one opens it. There is no picker.
use std::time::{Duration, Instant};

use egui_kittest::kittest::{NodeT, Queryable};
use we_ad4m::connect::ConnectSettings;
use we_ad4m::testkit as kit;
use we_app::connected::{ConnectArgs, ConnectedApp};

const BUNDLE: &str = include_str!("../../../../bundles/coasys.bundle.json");

type H<'a> = egui_kittest::Harness<'a, Option<ConnectedApp>>;

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

fn stage(h: &H) -> &'static str {
    h.state().as_ref().map_or("none", |a| a.stage())
}

fn open_name(h: &mut H) -> String {
    h.state_mut()
        .as_mut()
        .and_then(|a| a.live_space().map(|l| l.space.name.clone()))
        .unwrap_or_default()
}

/// Two seeded spaces are both on the rail. The window opens the one
/// `--space` names, and a click on the other switches to it. The stage is
/// never the picker, and the picker heading is not drawn.
#[test]
fn the_rail_lists_every_space_and_a_click_opens_it() {
    let Some(executor) = kit::start_executor() else {
        return;
    };
    let rt = we_ad4m::Runtime::new().unwrap();
    let writer = kit::connect(&rt, &executor.url);
    // `seed_space` mints the agent. A second call would ask again and the
    // executor answers 409, so the next space is added on the same agent.
    kit::seed_space(&rt, &writer, "rail-alpha");
    kit::seed_space_as(&rt, &writer, "rail-beta");
    let tokens = tempfile::tempdir().unwrap();
    let args = ConnectArgs {
        settings: ConnectSettings {
            url: Some(executor.url.clone()),
            token_dir: Some(tokens.path().to_path_buf()),
            port_file: Some(tokens.path().join("no-port-file")),
            ..ConnectSettings::default()
        },
        space: Some("rail-alpha".into()),
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
                    we_app::init_host(ui.ctx());
                    ConnectedApp::new(ui.ctx().clone(), bundle.clone(), args.clone())
                })
                .ui(ui)
            },
            None,
        );

    step_until(
        &mut h,
        "both spaces on the rail",
        Duration::from_secs(60),
        |h| {
            assert_ne!(stage(h), "pick", "the picker is gone");
            assert!(h.query_by_label("Open a space").is_none());
            stage(h) == "space"
                && h.query_by_label("rail-alpha").is_some()
                && h.query_by_label("rail-beta").is_some()
        },
    );
    assert_eq!(open_name(&mut h), "rail-alpha");
    assert!(h.query_by_label("Switch space").is_none());

    h.get_by_label("rail-beta").click();
    step_until(&mut h, "rail-beta", Duration::from_secs(30), |h| {
        assert_ne!(stage(h), "pick");
        open_name(h) == "rail-beta"
    });
    assert_eq!(stage(&h), "space");
    assert!(h.query_by_label("Open a space").is_none());
    // The rail still lists both after the switch.
    assert!(h.query_by_label("rail-alpha").is_some());
    assert!(h.query_by_label("rail-beta").is_some());
}

/// Approve the capability request the connect screen is showing, as the
/// executor's operator. `scope` is the grant the screen asked for.
fn approve(
    h: &mut H,
    rt: &we_ad4m::Runtime,
    admin: &we_ad4m::Connection,
    scope: &we_ad4m::connect::GrantScope,
) {
    let mut request_id = String::new();
    step_until(h, "the capability request", Duration::from_secs(60), |h| {
        let Some(node) = h.query_by_label_contains("(request ") else {
            return false;
        };
        let label = node.accesskit_node().value().unwrap_or_default();
        let start = label.find("(request ").unwrap() + "(request ".len();
        request_id = label[start..].split(')').next().unwrap().to_string();
        true
    });
    let app = we_ad4m::connect::app_info(scope);
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
}

/// The first edit of a personal space asks for that space's write grant.
/// The window was read-only; approving the code makes it able to write.
/// The edit that asked is not sent.
#[test]
fn the_first_edit_asks_for_the_write_grant() {
    let Some(executor) = kit::start_executor_with_admin("rail-admin") else {
        return;
    };
    let rt = we_ad4m::Runtime::new().unwrap();
    let admin = kit::connect_as(&rt, &executor.url, "rail-admin");
    rt.block_on(admin.client().agent.generate("passphrase".into()))
        .unwrap();
    let uuid = kit::seed_space_as(&rt, &admin, "rail-edit");
    let tokens = tempfile::tempdir().unwrap();
    let args = ConnectArgs {
        settings: ConnectSettings {
            url: Some(executor.url.clone()),
            token_dir: Some(tokens.path().to_path_buf()),
            port_file: Some(tokens.path().join("no-port-file")),
            ..ConnectSettings::default()
        },
        space: Some("rail-edit".into()),
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
                    we_app::init_host(ui.ctx());
                    ConnectedApp::new(ui.ctx().clone(), bundle.clone(), args.clone())
                })
                .ui(ui)
            },
            None,
        );

    approve(&mut h, &rt, &admin, &we_ad4m::connect::GrantScope::ReadOnly);
    step_until(&mut h, "the space", Duration::from_secs(60), |h| {
        assert_ne!(stage(h), "pick");
        stage(h) == "space" && h.query_by_label("rail-edit").is_some()
    });
    assert!(h.query_by_label("read-only").is_some());
    assert!(h.query_by_label("Open a space").is_none());

    // The same gate a write row hits. No template node sends it on.
    h.state_mut()
        .as_mut()
        .unwrap()
        .live_space()
        .unwrap()
        .app
        .session
        .host_mut_as::<we_ad4m::WriteHost>()
        .unwrap()
        .gate_write();
    // The uuid is also its own node (the rail row's id), so a contains
    // query of the bare uuid matches twice and refuses. The sentence is
    // the grant, and it names this space.
    let sentence = format!("change one space ({uuid})");
    step_until(&mut h, "the write grant", Duration::from_secs(60), |h| {
        assert_eq!(stage(h), "space");
        h.query_by_label_contains(&sentence).is_some()
    });
    // The read-only notice is still the one the gate pushed.
    let notices = h
        .state_mut()
        .as_mut()
        .unwrap()
        .live_space()
        .unwrap()
        .notices();
    assert!(
        notices.iter().any(|n| n.text.contains("read-only")),
        "{notices:?}"
    );

    approve(
        &mut h,
        &rt,
        &admin,
        &we_ad4m::connect::GrantScope::Write {
            space: uuid.clone(),
        },
    );
    step_until(
        &mut h,
        "the write grant applied",
        Duration::from_secs(60),
        |h| stage(h) == "space" && h.query_by_label_contains("writes:").is_some(),
    );
    let live = h.state_mut().as_mut().unwrap().live_space().unwrap();
    assert!(live.access.writes(&uuid), "{:?}", live.access);
    assert_eq!(live.space.name, "rail-edit");
}
