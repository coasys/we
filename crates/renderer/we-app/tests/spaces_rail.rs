//! The left rail lists every non-system space from a fixture executor
//! (`EXECUTOR_PATH`; skipped without it). Clicking one opens it. There is
//! no picker. The first edit of a personal space asks for the write grant
//! through the inspector, and Cancel leaves the session read-only.
#[path = "support/find.rs"]
mod find;

use std::time::{Duration, Instant};

use egui_kittest::kittest::{NodeT, Queryable};
use find::{find, prop_str};
use serde_json::json;
use we_ad4m::connect::ConnectSettings;
use we_ad4m::testkit as kit;
use we_app::connected::{ConnectArgs, ConnectedApp};
use we_expr::Value;
use we_screen::ScreenOp;
use we_template::{NodeId, ResolvedNode};

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

fn harness(args: ConnectArgs) -> H<'static> {
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

fn args(url: &str, tokens: &std::path::Path, space: &str) -> ConnectArgs {
    ConnectArgs {
        settings: ConnectSettings {
            url: Some(url.to_string()),
            token_dir: Some(tokens.to_path_buf()),
            port_file: Some(tokens.join("no-port-file")),
            ..ConnectSettings::default()
        },
        space: Some(space.into()),
        theme: "dark".into(),
        data: Default::default(),
        access: we_ad4m::Access::ReadOnly,
    }
}

/// Two seeded spaces are both on the rail, and so is a `we-` name that is
/// not a system perspective. `we-root`, `we-personal` and `we-test` are
/// not. The window opens the one `--space` names, and a click on another
/// switches to it.
#[test]
fn the_rail_lists_every_space_and_a_click_opens_it() {
    let Some(executor) = kit::start_executor() else {
        return;
    };
    let rt = we_ad4m::Runtime::new().unwrap();
    let writer = kit::connect(&rt, &executor.url);
    // `seed_space` mints the agent. A second call would ask again and the
    // executor answers 409, so the next spaces are added on the same agent.
    kit::seed_space(&rt, &writer, "rail-alpha");
    for name in [
        "we-root",
        "we-personal",
        "we-test",
        "we-custom",
        "rail-beta",
    ] {
        kit::seed_space_as(&rt, &writer, name);
    }
    let tokens = tempfile::tempdir().unwrap();
    let mut h = harness(args(&executor.url, tokens.path(), "rail-alpha"));

    step_until(
        &mut h,
        "the agent spaces on the rail",
        Duration::from_secs(60),
        |h| {
            assert_ne!(stage(h), "pick", "the picker is gone");
            assert!(h.query_by_label("Open a space").is_none());
            stage(h) == "space"
                && h.query_by_label("rail-alpha").is_some()
                && h.query_by_label("rail-beta").is_some()
                && h.query_by_label("we-custom").is_some()
        },
    );
    assert_eq!(open_name(&mut h), "rail-alpha");
    assert!(h.query_by_label("Switch space").is_none());
    assert_system_spaces_absent(&h);

    h.get_by_label("rail-beta").click();
    step_until(&mut h, "rail-beta", Duration::from_secs(30), |h| {
        assert_ne!(stage(h), "pick");
        open_name(h) == "rail-beta"
    });
    assert_eq!(stage(&h), "space");
    assert!(h.query_by_label("Open a space").is_none());
    assert!(h.query_by_label("rail-alpha").is_some());
    assert!(h.query_by_label("rail-beta").is_some());
    assert!(h.query_by_label("we-custom").is_some());
    assert_system_spaces_absent(&h);
}

fn assert_system_spaces_absent(h: &H) {
    for name in ["we-root", "we-personal", "we-test"] {
        assert!(h.query_by_label(name).is_none(), "{name} is on the rail");
    }
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

struct EditRig {
    _executor: kit::Executor,
    rt: we_ad4m::Runtime,
    admin: we_ad4m::Connection,
    uuid: String,
    task: String,
    _tokens: tempfile::TempDir,
    args: ConnectArgs,
}

fn edit_rig() -> Option<EditRig> {
    let executor = kit::start_executor_with_admin("rail-admin")?;
    let rt = we_ad4m::Runtime::new().unwrap();
    let admin = kit::connect_as(&rt, &executor.url, "rail-admin");
    rt.block_on(admin.client().agent.generate("passphrase".into()))
        .unwrap();
    let uuid = kit::seed_space_as(&rt, &admin, "rail-edit");
    kit::add_class(&rt, &admin, &uuid, "TaskBlock", kit::TASK_SDNA);
    let task = kit::create_task(&rt, &admin, &uuid, "Rail task");
    let tokens = tempfile::tempdir().unwrap();
    let args = args(&executor.url, tokens.path(), "rail-edit");
    Some(EditRig {
        _executor: executor,
        rt,
        admin,
        uuid,
        task,
        _tokens: tokens,
        args,
    })
}

fn title_of(rig: &EditRig) -> Option<String> {
    kit::query_rows(&rig.rt, &rig.admin, &rig.uuid, "TaskBlock")
        .into_iter()
        .find(|r| r["id"] == json!(rig.task))
        .and_then(|r| r["title"].as_str().map(str::to_string))
}

fn root_of(h: &mut H) -> std::sync::Arc<ResolvedNode> {
    h.state_mut()
        .as_mut()
        .unwrap()
        .live_space()
        .unwrap()
        .app
        .session
        .resolve()
}

fn tree_text(root: &ResolvedNode) -> String {
    we_template::normal_form(root).to_string()
}

fn notice_has(h: &mut H, text: &str) -> bool {
    h.state_mut()
        .as_mut()
        .and_then(|a| {
            a.live_space()
                .map(|l| l.notices().iter().any(|n| n.text.contains(text)))
        })
        .unwrap_or(false)
}

fn dispatch(h: &mut H, node: &NodeId, handler: &str, event: Value) {
    h.state_mut()
        .as_mut()
        .unwrap()
        .live_space()
        .unwrap()
        .app
        .session
        .dispatch(node, handler, event);
}

fn detail(text: &str) -> Value {
    Value::from_json(&json!({ "detail": text }))
}

fn is_text_input(n: &ResolvedNode) -> bool {
    matches!(n.ty.as_ref(), "we-input" | "we-textarea") && n.handlers.contains_key("onChange")
}

fn edit_button(r: &ResolvedNode) -> Option<NodeId> {
    let tip = find(r, |n| {
        n.ty.as_ref() == "we-tooltip" && prop_str(n, "content") == Some("Edit this record")
    })?;
    find(tip, |n| n.ty.as_ref() == "we-button").map(|b| b.id.clone())
}

fn open_inspector(h: &mut H, card: &str) {
    {
        let session = &mut h
            .state_mut()
            .as_mut()
            .unwrap()
            .live_space()
            .unwrap()
            .app
            .session;
        for (name, value) in [("cardType", "TaskBlock"), ("card", card)] {
            session.apply_screen(ScreenOp::SetParam {
                name: name.into(),
                value: Some(value.into()),
                push: None,
            });
        }
        session.apply_screen(ScreenOp::OpenTemplatePanel {
            id: "inspector".into(),
        });
    }
    step_until(h, "the task", Duration::from_secs(45), |h| {
        let root = root_of(h);
        tree_text(&root).contains("Rail task")
    });
}

fn start_editing(h: &mut H) {
    step_until(h, "the Edit button", Duration::from_secs(20), |h| {
        let root = root_of(h);
        edit_button(&root).is_some()
    });
    let root = root_of(h);
    let edit = edit_button(&root).unwrap_or_else(|| {
        panic!(
            "no Edit button: {}",
            tree_text(&root).chars().take(2000).collect::<String>()
        )
    });
    dispatch(h, &edit, "onClick", Value::Null);
    step_until(h, "the title field", Duration::from_secs(10), |h| {
        let root = root_of(h);
        find(&root, is_text_input).is_some()
    });
}

fn change_open_title(h: &mut H, to: &str) {
    let root = root_of(h);
    let title = find(&root, |n| {
        is_text_input(n)
            && prop_str(n, "value").is_some_and(|v| v.contains("Rail") || v.contains("Renamed"))
    })
    .or_else(|| find(&root, is_text_input))
    .unwrap_or_else(|| {
        panic!(
            "no title field: {}",
            tree_text(&root).chars().take(2000).collect::<String>()
        )
    })
    .id
    .clone();
    dispatch(h, &title, "onChange", detail(to));
}

fn connect_read_only(h: &mut H, rig: &EditRig) {
    approve(
        h,
        &rig.rt,
        &rig.admin,
        &we_ad4m::connect::GrantScope::ReadOnly,
    );
    step_until(h, "the space", Duration::from_secs(60), |h| {
        assert_ne!(stage(h), "pick");
        stage(h) == "space" && h.query_by_label("rail-edit").is_some()
    });
    assert!(h.query_by_label("read-only").is_some());
    assert!(h.query_by_label("Open a space").is_none());
}

fn ask_with_an_edit(h: &mut H, rig: &EditRig) -> String {
    open_inspector(h, &rig.task);
    start_editing(h);
    change_open_title(h, "Renamed rail task");
    let start = Instant::now();
    while start.elapsed() < Duration::from_millis(400) {
        assert_eq!(
            title_of(rig).as_deref(),
            Some("Rail task"),
            "the refused edit was written"
        );
        assert!(
            !notice_has(h, "Could not save"),
            "the edit reached the executor before the grant"
        );
        std::thread::sleep(Duration::from_millis(40));
    }
    let sentence = format!("change one space ({})", rig.uuid);
    step_until(h, "the write grant", Duration::from_secs(60), |h| {
        assert_eq!(stage(h), "space");
        h.query_by_label_contains(&sentence).is_some()
    });
    assert!(notice_has(h, "read-only"), "{:?}", {
        h.state_mut()
            .as_mut()
            .unwrap()
            .live_space()
            .unwrap()
            .notices()
    });
    sentence
}

/// The first edit of a personal space asks for that space's write grant.
/// The edit goes through the inspector's dispatch path. It is not sent.
/// Approving the code makes the window able to write. The next edit is
/// not refused locally.
#[test]
fn the_first_edit_asks_for_the_write_grant() {
    let Some(rig) = edit_rig() else {
        return;
    };
    let mut h = harness(rig.args.clone());
    connect_read_only(&mut h, &rig);
    let sentence = ask_with_an_edit(&mut h, &rig);

    approve(
        &mut h,
        &rig.rt,
        &rig.admin,
        &we_ad4m::connect::GrantScope::Write {
            space: rig.uuid.clone(),
        },
    );
    step_until(
        &mut h,
        "the write grant applied",
        Duration::from_secs(60),
        |h| stage(h) == "space" && h.query_by_label_contains("writes:").is_some(),
    );
    assert!(h.query_by_label_contains(&sentence).is_none());
    let live = h.state_mut().as_mut().unwrap().live_space().unwrap();
    assert!(live.access.writes(&rig.uuid), "{:?}", live.access);
    assert_eq!(live.space.name, "rail-edit");

    // The grant reopens the space, so the inspector is gone. Drive the
    // next edit the same way. This executor pin has no
    // `perspective.instanceUpdate`, so the sent edit fails in a notice.
    // It must not ask for the grant again.
    open_inspector(&mut h, &rig.task);
    start_editing(&mut h);
    change_open_title(&mut h, "Renamed rail task");
    step_until(
        &mut h,
        "the second edit leaves the grant",
        Duration::from_secs(20),
        |h| {
            assert!(
                h.query_by_label_contains(&sentence).is_none(),
                "the grant came back"
            );
            notice_has(h, "Could not save")
                || title_of(&rig).as_deref() == Some("Renamed rail task")
        },
    );
}

/// Cancel on the write grant drops the ask. The session stays read-only,
/// the rail stays, and a later edit asks again.
#[test]
fn cancelling_the_write_grant_stays_read_only() {
    let Some(rig) = edit_rig() else {
        return;
    };
    let mut h = harness(rig.args.clone());
    connect_read_only(&mut h, &rig);
    let sentence = ask_with_an_edit(&mut h, &rig);

    h.get_by_label("Cancel").click();
    step_until(
        &mut h,
        "the grant dismissed",
        Duration::from_secs(10),
        |h| h.query_by_label_contains(&sentence).is_none(),
    );
    assert!(h.query_by_label("read-only").is_some());
    assert!(h.query_by_label("rail-edit").is_some());
    assert_eq!(title_of(&rig).as_deref(), Some("Rail task"));
    assert!(!notice_has(&mut h, "Could not save"));

    change_open_title(&mut h, "Renamed again");
    step_until(
        &mut h,
        "the grant asked again",
        Duration::from_secs(60),
        |h| {
            assert_eq!(stage(h), "space");
            h.query_by_label_contains(&sentence).is_some()
        },
    );
    assert!(h.query_by_label("read-only").is_some());
    assert_eq!(title_of(&rig).as_deref(), Some("Rail task"));
    assert!(!notice_has(&mut h, "Could not save"));
}
