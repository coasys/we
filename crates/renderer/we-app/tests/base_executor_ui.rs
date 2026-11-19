//! Slice 4, drawn: the executor this window runs. A stand-in executor
//! (no process) for the screens and the start button; a stand-in process
//! for "run it only without `--executor-url`". The real executor is in
//! `e7_owned.rs`.

#[path = "support/gpu.rs"]
mod gpu;

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use egui_kittest::kittest::Queryable;
use we_ad4m::connect::{ConnectSettings, GrantScope};
use we_ad4m::supervisor::SupervisorConfig;
use we_app::connected::{ConnectArgs, ConnectedApp};
use we_app::OwnedExecutor;
use we_session::{AgentState, ExecutorState};

const BUNDLE: &str = include_str!("../../../../bundles/coasys.bundle.json");

type H<'a> = egui_kittest::Harness<'a, Option<ConnectedApp>>;

type Waker = Arc<dyn Fn() + Send + Sync>;

/// An executor that is whatever the test says. `start` counts and says
/// "starting", as a supervisor would.
struct Stand {
    state: Mutex<ExecutorState>,
    changes: AtomicU64,
    starts: AtomicU64,
    refreshes: AtomicU64,
    url: Mutex<Option<String>>,
    waker: Mutex<Option<Waker>>,
}

impl Stand {
    fn new(state: ExecutorState) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(state),
            changes: AtomicU64::new(0),
            starts: AtomicU64::new(0),
            refreshes: AtomicU64::new(0),
            url: Mutex::new(None),
            waker: Mutex::new(None),
        })
    }

    fn set(&self, state: ExecutorState) {
        *self.state.lock().unwrap() = state;
        self.changes.fetch_add(1, Ordering::SeqCst);
        if let Some(waker) = self.waker.lock().unwrap().clone() {
            waker();
        }
    }
}

impl OwnedExecutor for Stand {
    fn state(&self) -> ExecutorState {
        self.state.lock().unwrap().clone()
    }

    fn changes(&self) -> u64 {
        self.changes.load(Ordering::SeqCst)
    }

    fn start(&self) -> bool {
        self.starts.fetch_add(1, Ordering::SeqCst);
        self.set(ExecutorState::Starting);
        true
    }

    fn refresh(&self) {
        self.refreshes.fetch_add(1, Ordering::SeqCst);
    }

    fn url(&self) -> Option<String> {
        self.url.lock().unwrap().clone()
    }

    fn set_waker(&self, waker: Waker) {
        *self.waker.lock().unwrap() = Some(waker);
    }

    fn starts(&self) -> u64 {
        self.starts.load(Ordering::SeqCst)
    }

    fn pid(&self) -> Option<u32> {
        None
    }

    fn approve(&self, _request_id: &str, _scope: &GrantScope) -> Result<String, String> {
        Err("a stand-in approves nothing".into())
    }
}

fn args(tokens: &Path, url: Option<String>, executor: Option<SupervisorConfig>) -> ConnectArgs {
    ConnectArgs {
        settings: ConnectSettings {
            url,
            token_dir: Some(tokens.to_path_buf()),
            port_file: Some(tokens.join("no-port-file")),
            ..ConnectSettings::default()
        },
        space: None,
        theme: "dark".into(),
        data: Default::default(),
        access: we_ad4m::Access::ReadOnly,
        remember: None,
        executor,
    }
}

fn harness(args: ConnectArgs, owned: Option<Arc<dyn OwnedExecutor>>) -> H<'static> {
    let bundle = we_template::Bundle::parse(BUNDLE).unwrap();
    egui_kittest::Harness::builder()
        .renderer(gpu::serial())
        .with_accessibility_check(false)
        .with_size(egui::vec2(1280.0, 800.0))
        .build_ui_state(
            move |ui, app: &mut Option<ConnectedApp>| {
                app.get_or_insert_with(|| {
                    we_app::init_host(ui.ctx());
                    match owned.clone() {
                        Some(owned) => ConnectedApp::with_executor(
                            ui.ctx().clone(),
                            bundle.clone(),
                            args.clone(),
                            Some(owned),
                        ),
                        None => ConnectedApp::new(ui.ctx().clone(), bundle.clone(), args.clone()),
                    }
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

fn save_shot(h: &mut H, name: &str) {
    let image = h.render().expect("wgpu render of the window");
    let shot = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    image.save(&shot).expect("write the screenshot");
}

fn closed_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// Acceptance: starting, failed to start, stopped and ready each draw B's
/// own screen in the window.
#[test]
fn the_executor_states_draw_the_base_screens() {
    let tokens = tempfile::tempdir().unwrap();
    let stand = Stand::new(ExecutorState::Starting);
    let mut h = harness(args(tokens.path(), None, None), Some(stand.clone()));
    step_until(
        &mut h,
        "the starting screen",
        Duration::from_secs(10),
        |h| h.query_by_label_contains("Starting Coasys").is_some(),
    );
    assert!(h.query_by_label_contains("This computer").is_none());
    save_shot(&mut h, "owned-starting.png");

    stand.set(ExecutorState::Failed {
        reason: "It stopped before it was ready (exit 3).".into(),
        stopped: false,
    });
    step_until(&mut h, "the failed screen", Duration::from_secs(10), |h| {
        h.query_by_label_contains("Coasys couldn’t start").is_some()
            && h.query_by_label_contains("It stopped before it was ready (exit 3).")
                .is_some()
            && h.query_by_label("Try again").is_some()
    });
    assert!(h.query_by_label_contains("Coasys stopped").is_none());
    save_shot(&mut h, "owned-failed.png");

    stand.set(ExecutorState::Failed {
        reason: "Another program stopped it.".into(),
        stopped: true,
    });
    step_until(&mut h, "the stopped screen", Duration::from_secs(10), |h| {
        h.query_by_label_contains("Coasys stopped").is_some()
            && h.query_by_label("Start Coasys").is_some()
    });
    assert!(h.query_by_label_contains("couldn’t start").is_none());
    save_shot(&mut h, "owned-stopped.png");

    stand.set(ExecutorState::Ready {
        agent: Some(AgentState::Unlocked),
    });
    step_until(&mut h, "the list", Duration::from_secs(10), |h| {
        h.query_by_label_contains("Where to keep your spaces")
            .is_some()
            && h.query_by_label_contains("This computer").is_some()
    });
}

/// Acceptance: retry starts once. Two clicks on "Start Coasys" in one
/// frame start the executor once.
#[test]
fn start_coasys_starts_it_once() {
    let tokens = tempfile::tempdir().unwrap();
    let stand = Stand::new(ExecutorState::Failed {
        reason: "Another program stopped it.".into(),
        stopped: true,
    });
    let mut h = harness(args(tokens.path(), None, None), Some(stand.clone()));
    step_until(&mut h, "the stopped screen", Duration::from_secs(10), |h| {
        h.query_by_label("Start Coasys").is_some()
    });
    h.get_by_label("Start Coasys").click();
    h.get_by_label("Start Coasys").click();
    step_until(
        &mut h,
        "the starting screen",
        Duration::from_secs(10),
        |h| h.query_by_label_contains("Starting Coasys").is_some(),
    );
    h.run_steps(3);
    assert_eq!(stand.starts(), 1, "two clicks, two starts");
}

/// This computer is the executor the window runs, at the address it
/// listens on now: the click dials there.
#[test]
fn this_computer_dials_the_executor_the_window_runs() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(AtomicUsize::new(0));
    let counted = seen.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            counted.fetch_add(1, Ordering::SeqCst);
            drop(stream);
        }
    });
    let tokens = tempfile::tempdir().unwrap();
    let stand = Stand::new(ExecutorState::Ready {
        agent: Some(AgentState::Unlocked),
    });
    *stand.url.lock().unwrap() = Some(format!("http://127.0.0.1:{port}"));
    let mut h = harness(args(tokens.path(), None, None), Some(stand.clone()));
    step_until(&mut h, "the list", Duration::from_secs(10), |h| {
        h.query_by_label_contains("This computer").is_some()
    });
    h.get_by_label_contains("This computer").click();
    step_until(
        &mut h,
        "a dial to the owned port",
        Duration::from_secs(15),
        |_| seen.load(Ordering::SeqCst) > 0,
    );
}

/// A `/health` that answers `{"status":"ok"}`, on a free loopback port.
fn health() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf);
            let body = r#"{"status":"ok"}"#;
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    port
}

/// A stand-in executor process that records that it ran and waits on its
/// stdin, as `--watch-stdin true` does.
#[cfg(unix)]
fn stand_in(dir: &Path) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join("executor");
    std::fs::write(
        &path,
        format!(
            "#!/bin/sh\nif [ \"$1\" = init ]; then exit 0; fi\necho $$ >> '{}'\ncat > /dev/null\n",
            dir.join("ran").display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

/// Acceptance (an externally attached executor is never claimed): with
/// `--executor-url` the window attaches and runs nothing, even when it is
/// also given an executor binary. Pin: this held before the change.
#[cfg(unix)]
#[test]
fn with_an_executor_url_the_window_runs_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = SupervisorConfig::new(stand_in(dir.path()), dir.path().join("data"));
    config.port = Some(health());
    let url = format!("http://127.0.0.1:{}", closed_port());
    let mut h = harness(args(dir.path(), Some(url), Some(config)), None);
    step_until(&mut h, "the list", Duration::from_secs(10), |h| {
        h.query_by_label_contains("This computer").is_some()
    });
    h.run_steps(5);
    assert!(h.state().as_ref().unwrap().owned().is_none());
    assert!(h.query_by_label_contains("Starting Coasys").is_none());
    assert!(!dir.path().join("ran").exists(), "an executor was started");
}

/// Without `--executor-url` and with a binary, the window runs the
/// executor: starting, then the list once it answers; closing the window
/// ends the process it started.
#[cfg(unix)]
#[test]
fn with_a_binary_and_no_url_the_window_runs_it() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = SupervisorConfig::new(stand_in(dir.path()), dir.path().join("data"));
    config.port = Some(health());
    let mut h = harness(args(dir.path(), None, Some(config)), None);
    step_until(&mut h, "the list", Duration::from_secs(20), |h| {
        h.query_by_label_contains("This computer").is_some()
    });
    let owned = h.state().as_ref().unwrap().owned().cloned();
    let owned = owned.expect("the window runs an executor");
    assert_eq!(owned.starts(), 1);
    let pid = owned.pid().expect("its process");
    drop(owned);
    let ran = std::fs::read_to_string(dir.path().join("ran")).unwrap();
    assert_eq!(ran.trim(), pid.to_string());
    drop(h);
    let alive = std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap()
        .success();
    assert!(!alive, "the executor outlived the window");
}
