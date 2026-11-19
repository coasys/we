//! Slice 4, live (`EXECUTOR_PATH`; skipped without it): the supervisor runs
//! a real `ad4m-executor` in a temporary data folder on a free loopback
//! port with `--run-holochain false`, and ends it on drop.
#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use we_ad4m::supervisor::{Agent, Lifecycle, Supervisor, SupervisorConfig};
use we_ad4m::testkit as kit;

const ADMIN: &str = "s4-live-admin";

fn seed() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("testdata/bootstrapSeed.json")
}

fn config(binary: PathBuf, data: &Path) -> SupervisorConfig {
    let mut config = SupervisorConfig::new(binary, data.to_path_buf());
    config.seed = Some(seed());
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
    config
}

fn wait_for(sup: &Supervisor, what: &str, secs: u64, done: impl Fn(&Lifecycle) -> bool) {
    let start = Instant::now();
    loop {
        let state = sup.state();
        if done(&state) {
            return;
        }
        assert!(
            start.elapsed() < Duration::from_secs(secs),
            "timed out waiting for {what}; state {state:?}"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(Stdio::null())
        .status()
        .unwrap()
        .success()
}

/// Acceptance, real executor: starting → ready (no agent yet: reported as
/// none, not as a password request) → the agent made → ready, unlocked →
/// stopped from outside → stopped, not failed to start → started again,
/// once → ready with the agent **locked**, as the executor says → dropped:
/// the process is gone.
#[test]
fn the_owned_executor_lifecycle() {
    let Some(binary) = kit::require_binary() else {
        return;
    };
    let data = tempfile::tempdir().unwrap();
    let rt = we_ad4m::Runtime::new().unwrap();
    let sup = Supervisor::new(config(binary, &data.path().join("executor")), rt.handle());
    assert!(sup.start());
    assert_eq!(sup.state(), Lifecycle::Starting);
    wait_for(&sup, "ready", 120, |s| matches!(s, Lifecycle::Ready { .. }));
    assert_eq!(sup.state(), Lifecycle::Ready { agent: None });
    let url = sup.url().unwrap();
    assert!(url.starts_with("http://127.0.0.1:"), "{url}");

    let admin = kit::connect_as(&rt, &url, ADMIN);
    rt.block_on(admin.client().agent.generate("passphrase".into()))
        .unwrap();
    drop(admin);
    sup.refresh();
    wait_for(&sup, "unlocked", 30, |s| {
        *s == Lifecycle::Ready {
            agent: Some(Agent::Unlocked),
        }
    });

    let pid = sup.pid().unwrap();
    let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    wait_for(&sup, "stopped", 30, |s| {
        matches!(s, Lifecycle::Failed { .. })
    });
    assert!(
        matches!(sup.state(), Lifecycle::Failed { stopped: true, .. }),
        "{:?}",
        sup.state()
    );

    assert!(sup.start());
    assert!(!sup.start());
    wait_for(&sup, "ready again", 120, |s| {
        matches!(s, Lifecycle::Ready { .. })
    });
    assert_eq!(
        sup.state(),
        Lifecycle::Ready {
            agent: Some(Agent::Locked)
        },
        "a restarted agent is locked; the supervisor says so"
    );
    assert_eq!(sup.starts(), 2);
    let pid = sup.pid().unwrap();
    drop(sup);
    assert!(!alive(pid), "the executor outlived its supervisor");
}

/// An executor started outside the supervisor (here: by this test) on the
/// same data folder. The supervisor's start fails (exit 79) with that
/// reason, never stopped; dropping the supervisor leaves the other running.
#[test]
fn an_outside_executor_on_the_data_folder_is_not_ours() {
    let Some(binary) = kit::require_binary() else {
        return;
    };
    let data = tempfile::tempdir().unwrap();
    let folder = data.path().join("executor");
    let init = Command::new(&binary)
        .args(["init", "--data-path"])
        .arg(&folder)
        .arg("--network-bootstrap-seed")
        .arg(seed())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap();
    assert!(init.success());
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let mut outside: Child = Command::new(&binary)
        .arg("run")
        .arg("--app-data-path")
        .arg(&folder)
        .args(["--port", &port.to_string()])
        .args([
            "--run-holochain",
            "false",
            "--language-language-only",
            "true",
        ])
        .args(["--run-dapp-server", "false", "--exit-with-parent", "true"])
        .env("AD4M_ADMIN_CREDENTIAL", "outside")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let rt = we_ad4m::Runtime::new().unwrap();
    let outside_url = format!("http://127.0.0.1:{port}");
    drop(kit::connect_as(&rt, &outside_url, "outside"));

    let sup = Supervisor::new(config(binary, &folder), rt.handle());
    sup.start();
    wait_for(&sup, "failed", 60, |s| {
        matches!(s, Lifecycle::Failed { .. })
    });
    let Lifecycle::Failed { reason, stopped } = sup.state() else {
        unreachable!()
    };
    assert!(!stopped, "{reason}");
    assert!(reason.contains("Another executor"), "{reason}");
    drop(sup);
    assert!(
        outside.try_wait().unwrap().is_none(),
        "the outside executor was stopped"
    );
    drop(kit::connect_as(&rt, &outside_url, "outside"));
    let _ = outside.kill();
    let _ = outside.wait();
}

/// Slice 5, real executor: the identity read. With no agent yet it fails
/// (unknown, not empty). Once the agent is made, the executor answers that
/// it speaks for no identity: a known empty identity, with this computer's
/// store trust and no devices. Nothing of a key is kept.
#[test]
fn the_identity_read_of_the_owned_executor() {
    let Some(binary) = kit::require_binary() else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let rt = we_ad4m::Runtime::new().unwrap();
    let sup = Supervisor::new(config(binary, &dir.path().join("data")), rt.handle());
    sup.start();
    wait_for(&sup, "ready", 120, |s| matches!(s, Lifecycle::Ready { .. }));
    let before = sup.identity();
    assert!(before.is_err(), "read with no agent: {before:?}");
    let admin = kit::connect_as(&rt, &sup.url().unwrap(), ADMIN);
    kit::new_space(&rt, &admin, "s5-identity");
    drop(admin);
    let identity = sup.identity().expect("the agent's identity");
    assert_eq!(identity.did, None, "a fresh agent speaks for an identity");
    assert!(identity.devices.is_empty());
    eprintln!("identity read: {identity:?}; with no agent: {before:?}");
    let pid = sup.pid().unwrap();
    drop(sup);
    assert!(!alive(pid), "the executor outlived its supervisor");
}
