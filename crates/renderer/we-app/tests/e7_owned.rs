//! Slice 4, live (`EXECUTOR_PATH`; skipped without it): the window runs
//! this computer's executor (a temporary data folder, a free loopback port,
//! `--run-holochain false`; it ends with the window).
#![cfg(unix)]
#[path = "support/gpu.rs"]
mod gpu;

use std::path::PathBuf;
use std::time::{Duration, Instant};

use egui_kittest::kittest::{NodeT, Queryable};
use we_ad4m::connect::ConnectSettings;
use we_ad4m::supervisor::SupervisorConfig;
use we_ad4m::testkit as kit;
use we_app::connected::{ConnectArgs, ConnectedApp};

const BUNDLE: &str = include_str!("../../../../bundles/coasys.bundle.json");
const ADMIN: &str = "e7-owned-admin";

type H<'a> = egui_kittest::Harness<'a, Option<ConnectedApp>>;

fn step_until(h: &mut H, what: &str, limit: Duration, mut done: impl FnMut(&mut H) -> bool) {
    let start = Instant::now();
    loop {
        h.step();
        if done(h) {
            return;
        }
        if start.elapsed() >= limit {
            let mut labels = Vec::new();
            collect_labels(h.root(), &mut labels);
            panic!(
                "timed out waiting for {what}; stage {}; labels: {labels:?}",
                stage(h)
            );
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn collect_labels(node: egui_kittest::Node<'_>, out: &mut Vec<String>) {
    if let Some(label) = node.accesskit_node().label() {
        if !label.trim().is_empty() {
            out.push(label);
        }
    }
    for child in node.children() {
        collect_labels(child, out);
    }
}

fn stage(h: &H) -> &'static str {
    h.state().as_ref().map_or("none", |a| a.stage())
}

fn save_shot(h: &mut H, name: &str) {
    let image = h.render().expect("wgpu render of the window");
    let shot = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    image.save(&shot).expect("write the screenshot");
}

fn owned_url(h: &H) -> String {
    h.state()
        .as_ref()
        .and_then(|app| app.owned())
        .and_then(|owned| owned.url())
        .expect("the window runs an executor that listens")
}

fn owned_pid(h: &H) -> u32 {
    h.state()
        .as_ref()
        .and_then(|app| app.owned())
        .and_then(|owned| owned.pid())
        .expect("the window's executor runs")
}

fn owned_starts(h: &H) -> u64 {
    h.state()
        .as_ref()
        .and_then(|app| app.owned())
        .map(|owned| owned.starts())
        .unwrap_or(0)
}

/// Acceptance, end to end: the app starts the executor (B's starting
/// screen), opens a space, the executor is stopped from outside (B's
/// stopped screen takes the window back from the space), "Start Coasys"
/// (clicked twice) starts it once, and the restarted agent's lock is said
/// as it is — not as a password request. Unlocked, the space opens again.
#[test]
fn the_window_runs_its_executor_and_takes_back_a_stop() {
    let Some(binary) = kit::require_binary() else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let mut config = SupervisorConfig::new(binary, dir.path().join("executor"));
    config.seed = Some(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../we-ad4m/testdata/bootstrapSeed.json"),
    );
    config.admin_credential = Some(ADMIN.into());
    config.extra_args = [
        "--run-holochain",
        "false",
        "--language-language-only",
        "true",
    ]
    .map(String::from)
    .to_vec();
    config.ready_timeout = Duration::from_secs(120);
    let tokens = dir.path().join("tokens");
    std::fs::create_dir_all(&tokens).unwrap();
    let args = ConnectArgs {
        settings: ConnectSettings {
            url: None,
            token_dir: Some(tokens.clone()),
            port_file: Some(tokens.join("no-port-file")),
            ..ConnectSettings::default()
        },
        space: None,
        theme: "dark".into(),
        data: Default::default(),
        access: we_ad4m::Access::ReadOnly,
        remember: None,
        executor: Some(config),
    };
    let bundle = we_template::Bundle::parse(BUNDLE).unwrap();
    let mut h: H = egui_kittest::Harness::builder()
        .renderer(gpu::serial())
        .with_size(egui::vec2(1280.0, 800.0))
        .with_accessibility_check(false)
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

    // Starting, then the list. Whether a frame catches "Starting Coasys…"
    // depends on timing: the harness build (shared GPU lock, cold debug
    // build) can take longer than the executor's start on a loaded machine.
    // `base_executor_ui::the_executor_states_draw_the_base_screens` checks
    // that screen without timing; here it is only reported.
    let mut saw_starting = false;
    step_until(&mut h, "the list", Duration::from_secs(120), |h| {
        if h.query_by_label_contains("Starting Coasys").is_some() {
            saw_starting = true;
        }
        h.query_by_label_contains("Where to keep your spaces")
            .is_some()
    });
    eprintln!("the starting screen was seen: {saw_starting}");

    // The operator makes the agent and a space (what slices 5-6 will do
    // from the window).
    let rt = we_ad4m::Runtime::new().unwrap();
    let url = owned_url(&h);
    let admin = kit::connect_as(&rt, &url, ADMIN);
    // Makes the agent (passphrase "passphrase"), then the space.
    kit::seed_space(&rt, &admin, "e7-owned");

    h.get_by_label_contains("This computer").click();
    step_until(&mut h, "the picker", Duration::from_secs(60), |h| {
        stage(h) == "pick" && h.query_by_label("e7-owned   (local)").is_some()
    });
    h.get_by_label("e7-owned   (local)").click();
    step_until(&mut h, "the space", Duration::from_secs(20), |h| {
        stage(h) == "space"
    });

    // Stopped from outside: the base takes the window back.
    drop(admin);
    let pid = owned_pid(&h);
    let _ = std::process::Command::new("kill")
        .args(["-9", &pid.to_string()])
        .status();
    let killed = Instant::now();
    step_until(&mut h, "the stopped screen", Duration::from_secs(30), |h| {
        stage(h) == "connect"
            && h.query_by_label_contains("Coasys stopped").is_some()
            && h.query_by_label("Start Coasys").is_some()
    });
    // The supervisor's word takes the window back, not the socket's
    // 2-second grace (slice 3), which would come later.
    assert!(
        killed.elapsed() < Duration::from_millis(1800),
        "the space stayed up {:?} after the executor stopped",
        killed.elapsed()
    );
    assert!(h.query_by_label_contains("couldn’t start").is_none());
    assert!(h.query_by_label_contains("Connection lost").is_none());
    save_shot(&mut h, "owned-session-stopped.png");

    // Start Coasys, twice in one frame: one start.
    h.get_by_label("Start Coasys").click();
    h.get_by_label("Start Coasys").click();
    step_until(
        &mut h,
        "the restarted executor",
        Duration::from_secs(120),
        |h| h.query_by_label_contains("is locked").is_some(),
    );
    assert_eq!(owned_starts(&h), 2, "Start Coasys started more than once");
    // Locked, said as it is: no password stage.
    assert_eq!(stage(&h), "connect");
    assert!(h.query_by_label_contains("password").is_none());
    assert!(h.query_by_label_contains("Password").is_none());
    save_shot(&mut h, "owned-locked.png");

    // Unlocked by the operator: the space list again.
    let url = owned_url(&h);
    let admin = kit::connect_as(&rt, &url, ADMIN);
    rt.block_on(admin.client().agent.unlock("passphrase".into(), false))
        .unwrap();
    drop(admin);
    h.get_by_label_contains("This computer").click();
    step_until(&mut h, "the picker again", Duration::from_secs(60), |h| {
        stage(h) == "pick" && h.query_by_label("e7-owned   (local)").is_some()
    });
    save_shot(&mut h, "owned-reopened.png");
    let pid = owned_pid(&h);
    drop(h);
    let alive = std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap()
        .success();
    assert!(!alive, "the executor outlived the window");
}
