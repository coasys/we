//! Slice 5, drawn: the first run from the identity the executor this
//! window runs reports. A stand-in executor (no process) answers the
//! identity read. The real executor is in `e7_owned.rs`.

#[path = "support/gpu.rs"]
mod gpu;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use egui_kittest::kittest::Queryable;
use we_ad4m::connect::{ConnectSettings, GrantScope};
use we_ad4m::identity::Identity;
use we_app::connected::{ConnectArgs, ConnectedApp};
use we_app::OwnedExecutor;
use we_session::{AgentState, ExecutorState};

const BUNDLE: &str = include_str!("../../../../bundles/coasys.bundle.json");

type H<'a> = egui_kittest::Harness<'a, Option<ConnectedApp>>;

type Waker = Arc<dyn Fn() + Send + Sync>;

/// A ready executor whose identity read answers what the test says.
struct Stand {
    identity: Mutex<Result<Identity, String>>,
    reads: AtomicU64,
    waker: Mutex<Option<Waker>>,
}

impl Stand {
    fn new(identity: Result<Identity, String>) -> Arc<Self> {
        Arc::new(Self {
            identity: Mutex::new(identity),
            reads: AtomicU64::new(0),
            waker: Mutex::new(None),
        })
    }
}

impl OwnedExecutor for Stand {
    fn state(&self) -> ExecutorState {
        ExecutorState::Ready {
            agent: Some(AgentState::Unlocked),
        }
    }

    fn changes(&self) -> u64 {
        1
    }

    fn start(&self) -> bool {
        false
    }

    fn refresh(&self) {}

    fn url(&self) -> Option<String> {
        None
    }

    fn set_waker(&self, waker: Waker) {
        *self.waker.lock().unwrap() = Some(waker);
    }

    fn starts(&self) -> u64 {
        1
    }

    fn pid(&self) -> Option<u32> {
        None
    }

    fn approve(&self, _request_id: &str, _scope: &GrantScope) -> Result<String, String> {
        Err("a stand-in approves nothing".into())
    }

    fn incarnation(&self) -> u64 {
        1
    }

    fn identity(&self) -> Result<Identity, String> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        self.identity.lock().unwrap().clone()
    }
}

fn args(tokens: &Path, remember: Option<PathBuf>) -> ConnectArgs {
    ConnectArgs {
        settings: ConnectSettings {
            url: None,
            token_dir: Some(tokens.to_path_buf()),
            port_file: Some(tokens.join("no-port-file")),
            ..ConnectSettings::default()
        },
        space: None,
        theme: "dark".into(),
        data: Default::default(),
        access: we_ad4m::Access::ReadOnly,
        remember,
        executor: None,
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

fn empty() -> Identity {
    Identity {
        did: None,
        store_trusted: true,
        devices: vec![],
    }
}

fn shows(h: &H, words: &str) -> bool {
    h.query_by_label_contains(words).is_some()
}

/// Acceptance: the window reads the identity of the executor it runs, and
/// a known empty identity draws B's first run, doors closed with why.
#[test]
fn a_known_empty_identity_draws_the_first_run() {
    let tokens = tempfile::tempdir().unwrap();
    let stand = Stand::new(Ok(empty()));
    let mut h = harness(args(tokens.path(), None), Some(stand.clone()));
    step_until(&mut h, "the first run", Duration::from_secs(10), |h| {
        shows(h, "Set up Coasys")
    });
    for words in [
        "Create new identity",
        "Link to another device",
        "Restore with recovery phrase",
        "Skip for now",
        "Not available in this app yet.",
    ] {
        assert!(shows(&h, words), "{words} not drawn");
    }
    assert!(
        !shows(&h, "This computer"),
        "the list is drawn under the first run"
    );
    assert!(stand.reads.load(Ordering::SeqCst) >= 1);
    save_shot(&mut h, "first-run-standin.png");
}

/// Acceptance: a read that failed draws the list with the reason, never
/// the first run.
#[test]
fn a_read_failure_draws_the_list_not_the_first_run() {
    let tokens = tempfile::tempdir().unwrap();
    let stand = Stand::new(Err("the executor did not answer".into()));
    let mut h = harness(args(tokens.path(), None), Some(stand.clone()));
    step_until(&mut h, "the list", Duration::from_secs(15), |h| {
        shows(h, "Couldn't read your identity")
    });
    assert!(shows(&h, "This computer"));
    assert!(!shows(&h, "Set up Coasys"));
}

/// Acceptance: "Skip for now" is kept in the base file. The next window on
/// the same file, with still no identity, draws the list.
#[test]
fn skip_is_kept_in_the_base_file() {
    let tokens = tempfile::tempdir().unwrap();
    let base = tokens.path().join("base.json");
    let stand = Stand::new(Ok(empty()));
    let mut h = harness(args(tokens.path(), Some(base.clone())), Some(stand));
    step_until(&mut h, "the first run", Duration::from_secs(10), |h| {
        shows(h, "Skip for now")
    });
    h.get_by_label_contains("Skip for now").click();
    step_until(&mut h, "the list", Duration::from_secs(10), |h| {
        shows(h, "This computer")
    });
    drop(h);

    let stand = Stand::new(Ok(empty()));
    let mut h = harness(args(tokens.path(), Some(base)), Some(stand.clone()));
    let start = Instant::now();
    step_until(&mut h, "the list again", Duration::from_secs(10), |h| {
        assert!(!shows(h, "Set up Coasys"), "the first run came back");
        shows(h, "This computer") && stand.reads.load(Ordering::SeqCst) >= 1
    });
    // A few more frames: the answer is applied, and it is still the list.
    while start.elapsed() < Duration::from_millis(500) {
        h.step();
        assert!(!shows(&h, "Set up Coasys"), "the first run came back");
    }
}

/// With `--executor-url` the window runs no executor and keeps no identity
/// source: no first run (S:359). A pin: true before slice 5 too.
#[test]
fn an_attached_executor_has_no_first_run() {
    let tokens = tempfile::tempdir().unwrap();
    let mut a = args(tokens.path(), None);
    a.settings.url = Some("http://127.0.0.1:9".into());
    let mut h = harness(a, None);
    step_until(&mut h, "the list", Duration::from_secs(10), |h| {
        shows(h, "This computer") || shows(h, "Coasys isn't responding")
    });
    assert!(!shows(&h, "Set up Coasys"));
}
