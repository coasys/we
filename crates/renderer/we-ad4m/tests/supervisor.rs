//! Slice 4: the supervisor of the executor this app runs, against stand-in
//! executors (shell scripts) and a stand-in `/health`. The live executor
//! runs are in `live_supervisor.rs`.
//!
//! A stand-in `run` waits on its stdin, as `--watch-stdin true` does, so it
//! ends when the supervisor closes the pipe. The `/health` answer comes
//! from a listener in this test on the port the supervisor is given.
#![cfg(unix)]

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use we_ad4m::supervisor::{
    agent_from_status, Agent, AgentReader, Lifecycle, Supervisor, SupervisorConfig,
};

const ADMIN: &str = "s4-test-admin-credential";

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
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    port
}

/// A port nothing listens on.
fn closed_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// The executor's line once its API listener is bound, as the stand-ins
/// print it on stderr for the port in `<dir>/port` (if that file exists).
const LISTENING: &str =
    "echo \"[2026-11-19T00:00:00Z INFO  rust_executor::api] API server starting on http://127.0.0.1:$PORT/api/v1\" >&2";

/// Write an executable stand-in at `path`. The text is copied in by `cp`,
/// so no file handle open for writing on `path` is ever in this process:
/// a child another test forks meanwhile would inherit it, and running
/// `path` would then fail with "Text file busy" (ETXTBSY).
fn executable(path: &Path, text: impl AsRef<[u8]>) {
    use std::os::unix::fs::PermissionsExt;
    let source = path.with_extension("text");
    std::fs::write(&source, text).unwrap();
    let copied = std::process::Command::new("cp")
        .arg(&source)
        .arg(path)
        .status()
        .unwrap();
    assert!(copied.success(), "cp {}", path.display());
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// A stand-in executor: `init` succeeds; `run` says it listens on the port
/// in `<dir>/port` (when there is one), then runs `body`.
fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
    let path = dir.join(name);
    executable(
        &path,
        format!(
            "#!/bin/sh\nif [ \"$1\" = --version ]; then \
             cat \"$(dirname \"$0\")/version\" 2>/dev/null || echo 'ad4m 0.13.1-staging.13'; exit 0; fi\n\
             if [ \"$1\" = init ]; then exit 0; fi\n\
             PORT=$(cat \"$(dirname \"$0\")/port\" 2>/dev/null)\n\
             if [ -n \"$PORT\" ]; then {LISTENING}; fi\n{body}\n"
        ),
    );
    path
}

/// Waits on stdin (the supervisor's pipe), as `--watch-stdin true` does.
fn waits_on_stdin(dir: &Path) -> PathBuf {
    let args = dir.join("args");
    let env = dir.join("env");
    script(
        dir,
        "executor",
        &format!(
            "echo \"$@\" > '{}'\necho \"$AD4M_ADMIN_CREDENTIAL\" > '{}'\ncat > /dev/null\nexit 0",
            args.display(),
            env.display()
        ),
    )
}

/// One queued answer: an optional gate to wait on, then the answer.
type Answer = (Option<mpsc::Receiver<()>>, Result<Option<Agent>, String>);

/// Answers each read from a queue; a gated answer waits for its release.
#[derive(Default)]
struct Reader {
    answers: Mutex<VecDeque<Answer>>,
    calls: Mutex<Vec<(String, String)>>,
}

impl Reader {
    fn answer(&self, agent: Result<Option<Agent>, String>) {
        self.answers.lock().unwrap().push_back((None, agent));
    }

    /// An answer given only once the returned sender sends.
    fn gated(&self, agent: Result<Option<Agent>, String>) -> mpsc::Sender<()> {
        let (tx, rx) = mpsc::channel();
        self.answers.lock().unwrap().push_back((Some(rx), agent));
        tx
    }

    fn calls(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
}

impl AgentReader for Reader {
    fn read(&self, url: &str, admin: &str) -> Result<Option<Agent>, String> {
        self.calls
            .lock()
            .unwrap()
            .push((url.to_string(), admin.to_string()));
        let next = self.answers.lock().unwrap().pop_front();
        match next {
            Some((gate, answer)) => {
                if let Some(gate) = gate {
                    let _ = gate.recv_timeout(Duration::from_secs(30));
                }
                answer
            }
            None => Ok(Some(Agent::Unlocked)),
        }
    }
}

/// The stand-in in `dir` will say it listens on `port`.
fn config(dir: &Path, binary: PathBuf, port: u16) -> SupervisorConfig {
    std::fs::write(dir.join("port"), port.to_string()).unwrap();
    silent(dir, binary)
}

/// A stand-in that never says where it listens.
fn silent(dir: &Path, binary: PathBuf) -> SupervisorConfig {
    let mut config = SupervisorConfig::new(binary, dir.join("data"));
    config.admin_credential = Some(ADMIN.to_string());
    config.ready_timeout = Duration::from_secs(10);
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
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn alive(pid: u32) -> bool {
    // A reaped child no longer answers; a zombie still would, so this also
    // checks that the supervisor waited for its own child.
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap()
        .success()
}

fn kill_9(pid: u32) {
    let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
}

#[test]
fn the_agent_state_is_read_not_guessed() {
    assert_eq!(agent_from_status(true, false), Some(Agent::Locked));
    assert_eq!(agent_from_status(true, true), Some(Agent::Unlocked));
    assert_eq!(agent_from_status(false, false), None);
}

/// Acceptance (starting → ready): ready once `/health` answers, with the
/// agent read through the admin credential. The credential reaches the
/// executor in its environment, never on its command line.
#[test]
fn ready_after_health_with_the_agent_read() {
    let dir = tempfile::tempdir().unwrap();
    let port = health();
    let reader = Arc::new(Reader::default());
    reader.answer(Ok(Some(Agent::Locked)));
    let sup = Supervisor::with_reader(
        config(dir.path(), waits_on_stdin(dir.path()), port),
        reader.clone(),
    );
    assert_eq!(sup.state(), Lifecycle::Starting);
    assert!(sup.start(), "the first start");
    wait_for(&sup, "ready", 10, |s| matches!(s, Lifecycle::Ready { .. }));
    assert_eq!(
        sup.state(),
        Lifecycle::Ready {
            agent: Some(Agent::Locked)
        }
    );
    assert_eq!(
        sup.url().as_deref(),
        Some(&*format!("http://127.0.0.1:{port}"))
    );
    let calls = reader.calls.lock().unwrap().clone();
    assert_eq!(calls[0].0, format!("http://127.0.0.1:{port}"));
    assert_eq!(calls[0].1, ADMIN);
    let args = std::fs::read_to_string(dir.path().join("args")).unwrap();
    assert!(
        !args.contains(ADMIN),
        "the credential is on the command line: {args}"
    );
    assert!(args.contains("--watch-stdin true"), "{args}");
    assert!(
        args.contains("--port 0"),
        "the child chose no port of its own: {args}"
    );
    let env = std::fs::read_to_string(dir.path().join("env")).unwrap();
    assert_eq!(env.trim(), ADMIN);
}

/// Acceptance (retry starts once): a second start while one runs starts
/// nothing.
#[test]
fn a_start_while_one_runs_starts_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let sup = Supervisor::with_reader(
        config(dir.path(), waits_on_stdin(dir.path()), health()),
        Arc::new(Reader::default()),
    );
    assert!(sup.start());
    assert!(!sup.start(), "a second start while starting");
    wait_for(&sup, "ready", 10, |s| matches!(s, Lifecycle::Ready { .. }));
    assert!(!sup.start(), "a second start while ready");
    assert_eq!(sup.starts(), 1);
}

/// Acceptance (stopped): it ran, then something outside the app ended it:
/// failed with `stopped`, not failed to start. A start then runs it again,
/// once.
#[test]
fn an_executor_that_ran_and_ended_is_stopped() {
    let dir = tempfile::tempdir().unwrap();
    let sup = Supervisor::with_reader(
        config(dir.path(), waits_on_stdin(dir.path()), health()),
        Arc::new(Reader::default()),
    );
    sup.start();
    wait_for(&sup, "ready", 10, |s| matches!(s, Lifecycle::Ready { .. }));
    let pid = sup.pid().expect("a running child");
    kill_9(pid);
    wait_for(&sup, "stopped", 10, |s| {
        matches!(s, Lifecycle::Failed { .. })
    });
    let Lifecycle::Failed { reason, stopped } = sup.state() else {
        unreachable!()
    };
    assert!(
        stopped,
        "a stop after ready read as a failed start: {reason}"
    );
    assert!(!reason.is_empty());
    assert!(sup.pid().is_none());

    assert!(sup.start(), "start again after a stop");
    assert!(!sup.start());
    wait_for(&sup, "ready again", 10, |s| {
        matches!(s, Lifecycle::Ready { .. })
    });
    assert_eq!(sup.starts(), 2);
}

/// Acceptance (failure): an executor that exits before it is ready failed
/// to start; it is not "stopped".
#[test]
fn an_exit_before_ready_failed_to_start() {
    let dir = tempfile::tempdir().unwrap();
    let binary = script(
        dir.path(),
        "executor",
        "echo 'the store is corrupt' >&2\nexit 3",
    );
    let sup = Supervisor::with_reader(
        config(dir.path(), binary, closed_port()),
        Arc::new(Reader::default()),
    );
    sup.start();
    wait_for(&sup, "failed", 10, |s| {
        matches!(s, Lifecycle::Failed { .. })
    });
    let Lifecycle::Failed { reason, stopped } = sup.state() else {
        unreachable!()
    };
    assert!(!stopped, "a failed start read as stopped: {reason}");
    assert!(reason.contains("before it was ready"), "{reason}");
    assert!(reason.contains("the store is corrupt"), "{reason}");
}

/// Acceptance (failure): no answer within the ready timeout → failed to
/// start, and the child the supervisor started is ended, not left running.
#[test]
fn no_answer_in_time_failed_to_start_and_ends_the_child() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = config(dir.path(), waits_on_stdin(dir.path()), closed_port());
    config.ready_timeout = Duration::from_secs(1);
    let sup = Supervisor::with_reader(config, Arc::new(Reader::default()));
    sup.start();
    wait_for(&sup, "a pid", 5, |_| true);
    let start = Instant::now();
    let pid = loop {
        if let Some(pid) = sup.pid() {
            break pid;
        }
        assert!(start.elapsed() < Duration::from_secs(5), "no child");
        std::thread::sleep(Duration::from_millis(10));
    };
    wait_for(&sup, "failed", 10, |s| {
        matches!(s, Lifecycle::Failed { .. })
    });
    let Lifecycle::Failed { reason, stopped } = sup.state() else {
        unreachable!()
    };
    assert!(!stopped);
    assert!(reason.contains("didn't respond"), "{reason}");
    assert!(!alive(pid), "the child that never answered still runs");
}

/// Acceptance (never claim another's executor): exit 79 — another executor
/// holds the data folder. Failed to start, with that reason; nothing of it
/// is ours to stop.
#[test]
fn a_data_folder_held_by_another_executor_is_not_ours() {
    let dir = tempfile::tempdir().unwrap();
    let binary = script(
        dir.path(),
        "executor",
        "echo 'Refusing to start: another executor uses the data folder' >&2\nexit 79",
    );
    let sup = Supervisor::with_reader(
        config(dir.path(), binary, closed_port()),
        Arc::new(Reader::default()),
    );
    sup.start();
    wait_for(&sup, "failed", 10, |s| {
        matches!(s, Lifecycle::Failed { .. })
    });
    let Lifecycle::Failed { reason, stopped } = sup.state() else {
        unreachable!()
    };
    assert!(!stopped);
    assert!(reason.contains("Another executor"), "{reason}");
    assert!(sup.pid().is_none());
}

/// Acceptance (a late refresh cannot overwrite newer state): a refresh is
/// asked, the executor stops before it answers, then the answer arrives.
/// The stop stays.
#[test]
fn a_late_refresh_does_not_overwrite_a_stop() {
    let dir = tempfile::tempdir().unwrap();
    let reader = Arc::new(Reader::default());
    reader.answer(Ok(Some(Agent::Unlocked)));
    let release = reader.gated(Ok(Some(Agent::Unlocked)));
    let sup = Supervisor::with_reader(
        config(dir.path(), waits_on_stdin(dir.path()), health()),
        reader.clone(),
    );
    sup.start();
    wait_for(&sup, "ready", 10, |s| matches!(s, Lifecycle::Ready { .. }));
    sup.refresh();
    let start = Instant::now();
    while reader.calls() < 2 {
        assert!(start.elapsed() < Duration::from_secs(10), "no refresh read");
        std::thread::sleep(Duration::from_millis(10));
    }
    kill_9(sup.pid().unwrap());
    wait_for(&sup, "stopped", 10, |s| {
        matches!(s, Lifecycle::Failed { .. })
    });
    let changes = sup.changes();
    release.send(()).unwrap();
    std::thread::sleep(Duration::from_millis(300));
    assert!(
        matches!(sup.state(), Lifecycle::Failed { stopped: true, .. }),
        "the late refresh replaced the stop: {:?}",
        sup.state()
    );
    assert_eq!(sup.changes(), changes, "the late refresh published");
}

/// A refresh with nothing newer in between is applied (so the test above
/// is not passing because refresh does nothing); one that cannot answer
/// leaves the state as it was.
#[test]
fn a_refresh_reads_the_agent_again_or_keeps_the_state() {
    let dir = tempfile::tempdir().unwrap();
    let reader = Arc::new(Reader::default());
    reader.answer(Ok(Some(Agent::Unlocked)));
    reader.answer(Ok(Some(Agent::Locked)));
    reader.answer(Err("no answer".into()));
    let sup = Supervisor::with_reader(
        config(dir.path(), waits_on_stdin(dir.path()), health()),
        reader.clone(),
    );
    sup.start();
    wait_for(&sup, "ready", 10, |s| {
        *s == Lifecycle::Ready {
            agent: Some(Agent::Unlocked),
        }
    });
    sup.refresh();
    wait_for(&sup, "locked", 10, |s| {
        *s == Lifecycle::Ready {
            agent: Some(Agent::Locked),
        }
    });
    let changes = sup.changes();
    sup.refresh();
    let start = Instant::now();
    while reader.calls() < 3 {
        assert!(start.elapsed() < Duration::from_secs(10), "no refresh read");
        std::thread::sleep(Duration::from_millis(10));
    }
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(
        sup.state(),
        Lifecycle::Ready {
            agent: Some(Agent::Locked)
        }
    );
    assert_eq!(sup.changes(), changes);
}

/// The supervisor ends only the child it started: dropping it ends that
/// child (and waits for it), and an unrelated process keeps running.
#[test]
fn drop_ends_our_child_only() {
    let dir = tempfile::tempdir().unwrap();
    let mut other = Command::new("sleep").arg("300").spawn().unwrap();
    let sup = Supervisor::with_reader(
        config(dir.path(), waits_on_stdin(dir.path()), health()),
        Arc::new(Reader::default()),
    );
    sup.start();
    wait_for(&sup, "ready", 10, |s| matches!(s, Lifecycle::Ready { .. }));
    let pid = sup.pid().unwrap();
    drop(sup);
    assert!(!alive(pid), "our child outlived the supervisor");
    assert!(
        other.try_wait().unwrap().is_none(),
        "an unrelated process ended"
    );
    let _ = other.kill();
    let _ = other.wait();
}

/// Exit 75: the executor asked to be started again (`runtime.restart`).
/// It runs again on the same port, without a failed state.
#[test]
fn exit_75_runs_it_again() {
    let dir = tempfile::tempdir().unwrap();
    let mark = dir.path().join("ran-once");
    let binary = script(
        dir.path(),
        "executor",
        &format!(
            "if [ ! -e '{m}' ]; then touch '{m}'; sleep 0.3; exit 75; fi\ncat > /dev/null\nexit 0",
            m = mark.display()
        ),
    );
    let port = health();
    let sup = Supervisor::with_reader(
        config(dir.path(), binary, port),
        Arc::new(Reader::default()),
    );
    sup.start();
    let start = Instant::now();
    while sup.starts() < 2 {
        assert!(
            !matches!(sup.state(), Lifecycle::Failed { .. }),
            "exit 75 failed: {:?}",
            sup.state()
        );
        assert!(start.elapsed() < Duration::from_secs(10), "not run again");
        std::thread::sleep(Duration::from_millis(10));
    }
    // The second run's URL, from its own listening line.
    let start = Instant::now();
    while sup.url().is_none() {
        assert!(start.elapsed() < Duration::from_secs(10), "no URL");
        std::thread::sleep(Duration::from_millis(10));
    }
    wait_for(&sup, "ready", 10, |s| matches!(s, Lifecycle::Ready { .. }));
    assert_eq!(
        sup.url().as_deref(),
        Some(&*format!("http://127.0.0.1:{port}"))
    );
}

/// `init` runs for a missing data folder only. A folder that has anything
/// in it is the executor's own to migrate: `init` must not run over it.
#[test]
fn init_runs_only_for_an_empty_data_folder() {
    for existing in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("init-ran");
        let binary = dir.path().join("executor");
        executable(
            &binary,
            format!(
                "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 'ad4m 0.13.1-staging.13'; exit 0; fi\n\
                 if [ \"$1\" = init ]; then touch '{}'; exit 0; fi\nexit 3\n",
                marker.display()
            ),
        );
        if existing {
            std::fs::create_dir(dir.path().join("data")).unwrap();
            std::fs::write(dir.path().join("data").join("agent.json"), "{}").unwrap();
        }
        let sup = Supervisor::with_reader(
            config(dir.path(), binary, closed_port()),
            Arc::new(Reader::default()),
        );
        sup.start();
        wait_for(&sup, "failed", 10, |s| {
            matches!(s, Lifecycle::Failed { .. })
        });
        assert_eq!(
            marker.exists(),
            !existing,
            "existing data folder: {existing}; init ran: {}",
            marker.exists()
        );
    }
}

/// Round 2 (Lal: port ownership): the URL comes only from the child's own
/// stderr. A child that never says where it listens is never Ready, even
/// with something answering `/health` on a loopback port, and the admin
/// credential goes nowhere. The child is asked to bind port 0.
#[test]
fn an_alien_on_a_port_gets_no_token() {
    let dir = tempfile::tempdir().unwrap();
    let alien = health();
    let reader = Arc::new(Reader::default());
    let mut config = silent(dir.path(), waits_on_stdin(dir.path()));
    config.ready_timeout = Duration::from_secs(2);
    let sup = Supervisor::with_reader(config, reader.clone());
    sup.start();
    wait_for(&sup, "failed", 10, |s| {
        matches!(s, Lifecycle::Failed { .. })
    });
    let calls = reader.calls.lock().unwrap().clone();
    assert!(calls.is_empty(), "the admin credential went to {calls:?}");
    assert_ne!(sup.url(), Some(format!("http://127.0.0.1:{alien}")));
    let args = std::fs::read_to_string(dir.path().join("args")).unwrap();
    assert!(args.contains("--port 0"), "{args}");
}

/// The executor's listening line, and only it, gives the port.
#[test]
fn the_port_is_read_from_the_listening_line() {
    use we_ad4m::supervisor::reported_port;
    let line = "[2026-11-19T09:47:12Z INFO  rust_executor::api] API server starting on http://127.0.0.1:45617/api/v1";
    assert_eq!(reported_port(line), Some(45617));
    assert_eq!(
        reported_port("API server starting on http://0.0.0.0:45617/api/v1"),
        None
    );
    assert_eq!(
        reported_port("API server starting on http://127.0.0.1:0/api/v1"),
        None
    );
    assert_eq!(
        reported_port("API server starting on http://127.0.0.1:456178/api/v1"),
        None
    );
    assert_eq!(
        reported_port("SFU event loop started on 127.0.0.1:46113"),
        None
    );
}

/// Round 2 (Lal: the flag contract): an executor older than the first
/// one with `--watch-stdin` (and exit 79) is refused before it runs,
/// with a sentence that names the version needed.
#[test]
fn an_executor_too_old_for_the_stop_contract_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("version"), "ad4m 0.13.1-staging.11\n").unwrap();
    let sup = Supervisor::with_reader(
        config(dir.path(), waits_on_stdin(dir.path()), health()),
        Arc::new(Reader::default()),
    );
    sup.start();
    wait_for(&sup, "failed", 10, |s| {
        matches!(s, Lifecycle::Failed { .. })
    });
    let Lifecycle::Failed { reason, stopped } = sup.state() else {
        unreachable!()
    };
    assert!(!stopped);
    assert!(reason.contains("0.13.1-staging.11"), "{reason}");
    assert!(reason.contains("0.13.1-staging.12 or newer"), "{reason}");
    assert!(
        !dir.path().join("args").exists(),
        "the old executor was run"
    );
}

#[test]
fn the_minimum_executor_version() {
    use we_ad4m::supervisor::executor_version_ok;
    for ok in [
        "ad4m 0.13.1-staging.12",
        "ad4m 0.13.1-staging.13\n",
        "ad4m 0.13.1",
        "ad4m 0.13.2",
        "ad4m 0.14.0-rc.1",
        "ad4m 1.0.0",
    ] {
        assert!(executor_version_ok(ok).is_ok(), "{ok}");
    }
    for old in [
        "ad4m 0.13.1-staging.11",
        "ad4m 0.13.1-rc.3",
        "ad4m 0.13.0",
        "ad4m 0.12.9",
        "ad4m",
        "",
        "not an executor",
    ] {
        let said = executor_version_ok(old).unwrap_err();
        assert!(said.contains("0.13.1-staging.12 or newer"), "{old}: {said}");
    }
}

/// A stand-in whose `init` writes its pid to `<dir>/init-pid` and then
/// blocks (as a seed path naming a FIFO does).
fn blocking_init(dir: &Path) -> PathBuf {
    let path = dir.join("executor");
    executable(
        &path,
        format!(
            "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 'ad4m 0.13.1-staging.13'; exit 0; fi\n\
             if [ \"$1\" = init ]; then echo $$ > '{}'; exec sleep 60; fi\ncat > /dev/null\n",
            dir.join("init-pid").display()
        ),
    );
    path
}

fn init_pid(dir: &Path) -> u32 {
    let start = Instant::now();
    loop {
        if let Some(pid) = std::fs::read_to_string(dir.join("init-pid"))
            .ok()
            .and_then(|text| text.trim().parse().ok())
        {
            return pid;
        }
        assert!(start.elapsed() < Duration::from_secs(10), "init never ran");
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Round 2 (Lal: init is unsupervised): a stop while `init` runs ends that
/// init at once and returns; nothing of it is left running.
#[test]
fn a_stop_during_init_ends_the_init() {
    let dir = tempfile::tempdir().unwrap();
    let sup = Supervisor::with_reader(
        config(dir.path(), blocking_init(dir.path()), health()),
        Arc::new(Reader::default()),
    );
    sup.start();
    let pid = init_pid(dir.path());
    let asked = Instant::now();
    sup.stop();
    assert!(
        asked.elapsed() < Duration::from_secs(5),
        "the stop waited {:?} for an init it could not reach",
        asked.elapsed()
    );
    assert!(!alive(pid), "the init outlived the stop");
    assert!(
        matches!(sup.state(), Lifecycle::Failed { stopped: true, .. }),
        "{:?}",
        sup.state()
    );
}

/// Round 2: an `init` past `init_timeout` is ended, and the start fails
/// to start (not stopped) with that reason.
#[test]
fn an_init_past_its_deadline_is_ended() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = config(dir.path(), blocking_init(dir.path()), health());
    config.init_timeout = Duration::from_secs(1);
    let sup = Supervisor::with_reader(config, Arc::new(Reader::default()));
    sup.start();
    let pid = init_pid(dir.path());
    wait_for(&sup, "failed", 10, |s| {
        matches!(s, Lifecycle::Failed { .. })
    });
    let Lifecycle::Failed { reason, stopped } = sup.state() else {
        unreachable!()
    };
    assert!(!stopped);
    assert!(
        reason.contains("didn't finish within 1 seconds"),
        "{reason}"
    );
    assert!(!alive(pid), "the init outlived its deadline");
}

/// A stand-in whose `init` does what the executor's does in order: makes
/// the folder and `last-seen-version`, then copies the seed (and fails
/// when the seed is missing). Each init appends a line to `<dir>/inits`.
/// `run` says its port and waits on stdin.
fn seeding_init(dir: &Path, delay: &str) -> PathBuf {
    let path = dir.join("executor");
    executable(
        &path,
        format!(
            "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 'ad4m 0.13.1-staging.13'; exit 0; fi\n\
             if [ \"$1\" = init ]; then echo x >> '{inits}'; sleep {delay}; mkdir -p \"$3\"; \
             echo 0.13.1 > \"$3/last-seen-version\"; [ -f \"$5\" ] || exit 1; \
             cp \"$5\" \"$3/mainnet_seed.seed\"; exit 0; fi\n\
             PORT=$(cat \"$(dirname \"$0\")/port\")\n{LISTENING}\ncat > /dev/null\n",
            inits = dir.join("inits").display()
        ),
    );
    path
}

fn inits(dir: &Path) -> usize {
    std::fs::read_to_string(dir.join("inits"))
        .map(|text| text.lines().count())
        .unwrap_or(0)
}

/// Round 2 (Lal: a failed first init is skipped forever): the first init
/// fails on a missing seed after it made the folder. Once the seed is
/// there, the next start runs init again and the seed is installed.
#[test]
fn a_failed_first_init_runs_again() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = config(dir.path(), seeding_init(dir.path(), "0"), health());
    let seed = dir.path().join("seed.json");
    config.seed = Some(seed.clone());
    let sup = Supervisor::with_reader(config, Arc::new(Reader::default()));
    sup.start();
    wait_for(&sup, "failed", 10, |s| {
        matches!(s, Lifecycle::Failed { .. })
    });
    // Round 3: init runs into a staging folder; a failed init leaves no
    // data folder behind (and no staging folder).
    assert!(!dir.path().join("data").exists(), "a half-made data folder");
    let left: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains("we-init-") && !name.ends_with("-lock"))
        .collect();
    assert!(left.is_empty(), "staging left behind: {left:?}");
    std::fs::write(&seed, "{}").unwrap();
    assert!(sup.start());
    wait_for(&sup, "ready", 10, |s| matches!(s, Lifecycle::Ready { .. }));
    assert_eq!(inits(dir.path()), 2, "init did not run again");
    assert!(
        dir.path().join("data/mainnet_seed.seed").exists(),
        "the executor runs without its seed"
    );
}

/// Round 2 (Lal: read_dir errors counted as empty): a data folder path
/// that cannot be read as a folder is an error, not a fresh folder.
#[test]
fn a_data_folder_that_cannot_be_read_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let config = config(dir.path(), seeding_init(dir.path(), "0"), health());
    std::fs::write(dir.path().join("data"), "not a folder").unwrap();
    let sup = Supervisor::with_reader(config, Arc::new(Reader::default()));
    sup.start();
    wait_for(&sup, "failed", 10, |s| {
        matches!(s, Lifecycle::Failed { .. })
    });
    let Lifecycle::Failed { reason, .. } = sup.state() else {
        unreachable!()
    };
    assert!(reason.contains("Couldn't read its data folder"), "{reason}");
    assert_eq!(
        inits(dir.path()),
        0,
        "init ran over a path it could not read"
    );
}

/// Round 2 (Lal: two windows can init at once): two supervisors on one
/// fresh data folder; init runs once.
#[test]
fn two_windows_init_a_fresh_folder_once() {
    let dir = tempfile::tempdir().unwrap();
    let seed = dir.path().join("seed.json");
    std::fs::write(&seed, "{}").unwrap();
    let binary = seeding_init(dir.path(), "1");
    let mut first = config(dir.path(), binary.clone(), health());
    first.seed = Some(seed.clone());
    let second = first.clone();
    let a = Supervisor::with_reader(first, Arc::new(Reader::default()));
    let b = Supervisor::with_reader(second, Arc::new(Reader::default()));
    a.start();
    b.start();
    wait_for(&a, "a ready", 15, |s| matches!(s, Lifecycle::Ready { .. }));
    wait_for(&b, "b ready", 15, |s| matches!(s, Lifecycle::Ready { .. }));
    assert_eq!(inits(dir.path()), 1, "both windows ran init");
}

/// An empty data folder (made by someone, holding nothing) is prepared
/// like a missing one: init runs, and its result takes the folder's place.
#[test]
fn an_empty_data_folder_is_initialised() {
    let dir = tempfile::tempdir().unwrap();
    let seed = dir.path().join("seed.json");
    std::fs::write(&seed, "{}").unwrap();
    std::fs::create_dir(dir.path().join("data")).unwrap();
    let mut config = config(dir.path(), seeding_init(dir.path(), "0"), health());
    config.seed = Some(seed);
    let sup = Supervisor::with_reader(config, Arc::new(Reader::default()));
    sup.start();
    wait_for(&sup, "ready", 10, |s| matches!(s, Lifecycle::Ready { .. }));
    assert_eq!(inits(dir.path()), 1, "init did not run for an empty folder");
    assert!(
        dir.path().join("data").join("mainnet_seed.seed").is_file(),
        "the prepared folder did not take the empty one's place"
    );
    sup.stop();
}

/// Round 2 (Lal: exit 75 keeps Ready): the executor asks to be started
/// again. From its exit until the new child is ready, the state is
/// Starting (not the old run's Ready), and a refresh asked of the old run
/// that answers in between publishes nothing.
#[test]
fn an_exit_75_restart_is_a_new_start() {
    let dir = tempfile::tempdir().unwrap();
    let mark = dir.path().join("ran-once");
    let trigger = dir.path().join("restart-now");
    // Not `script`: its preamble says the port at once. The second run
    // says it only after 2 s, so the restart can be looked at.
    let binary = dir.path().join("executor");
    {
        executable(
            &binary,
            format!(
                "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 'ad4m 0.13.1-staging.13'; exit 0; fi\n\
                 if [ \"$1\" = init ]; then exit 0; fi\n\
                 PORT=$(cat \"$(dirname \"$0\")/port\")\n\
                 if [ ! -e '{m}' ]; then touch '{m}'; {LISTENING}\n\
                 while [ ! -e '{t}' ]; do sleep 0.05; done; exit 75; fi\n\
                 sleep 2\n{LISTENING}\ncat > /dev/null\n",
                m = mark.display(),
                t = trigger.display()
            ),
        );
    }
    let reader = Arc::new(Reader::default());
    reader.answer(Ok(Some(Agent::Unlocked)));
    let release = reader.gated(Ok(Some(Agent::Locked)));
    let sup = Supervisor::with_reader(config(dir.path(), binary, health()), reader.clone());
    sup.start();
    wait_for(&sup, "ready", 10, |s| matches!(s, Lifecycle::Ready { .. }));
    sup.refresh();
    let start = Instant::now();
    while reader.calls() < 2 {
        assert!(start.elapsed() < Duration::from_secs(10), "no refresh read");
        std::thread::sleep(Duration::from_millis(10));
    }
    std::fs::write(&trigger, "").unwrap();
    let start = Instant::now();
    while sup.starts() < 2 {
        assert!(start.elapsed() < Duration::from_secs(10), "not run again");
        std::thread::sleep(Duration::from_millis(10));
    }
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(
        sup.state(),
        Lifecycle::Starting,
        "the old run's state outlived its exit"
    );
    assert_eq!(sup.url(), None, "the old run's address outlived its exit");
    release.send(()).unwrap();
    std::thread::sleep(Duration::from_millis(300));
    assert_ne!(
        sup.state(),
        Lifecycle::Ready {
            agent: Some(Agent::Locked)
        },
        "the old run's refresh was published"
    );
}

/// Exit-75 restarts farther apart than the restart window never fill it,
/// so an executor that asks for a restart now and then is never stopped
/// for it.
#[test]
fn exit_75_after_a_long_run_starts_the_count_again() {
    let dir = tempfile::tempdir().unwrap();
    let binary = script(dir.path(), "executor", "sleep 0.4\nexit 75");
    let mut config = config(dir.path(), binary, health());
    config.restart_window = Duration::from_millis(200);
    let sup = Supervisor::with_reader(config, Arc::new(Reader::default()));
    sup.start();
    let start = Instant::now();
    while sup.starts() < 6 {
        if let Lifecycle::Failed { reason, .. } = sup.state() {
            panic!("stopped after {} starts: {reason}", sup.starts());
        }
        assert!(start.elapsed() < Duration::from_secs(20), "not run again");
        std::thread::sleep(Duration::from_millis(20));
    }
    sup.stop();
}

/// Round 2: exit 75 again and again is not restarted forever: a fourth
/// restart within the window (60 s) stops the executor, with that reason.
#[test]
fn repeated_exit_75_has_a_budget() {
    let dir = tempfile::tempdir().unwrap();
    let binary = script(dir.path(), "executor", "sleep 0.1\nexit 75");
    let sup = Supervisor::with_reader(
        config(dir.path(), binary, health()),
        Arc::new(Reader::default()),
    );
    sup.start();
    wait_for(&sup, "failed", 15, |s| {
        matches!(s, Lifecycle::Failed { .. })
    });
    let Lifecycle::Failed { reason, stopped } = sup.state() else {
        unreachable!()
    };
    assert!(stopped, "{reason}");
    assert!(reason.contains("restarted"), "{reason}");
    assert_eq!(sup.starts(), 4, "one start and three restarts");
}

/// Round 3 (Lal P2: a pending-marker rerun is destructive): the executor's
/// init cleans a folder whose recorded version it does not support. A
/// folder with real state (here: an agent and a version from elsewhere),
/// beside a stale `started` marker from an old failed init, must not be
/// initialized again; its content stays as it was.
#[test]
fn init_never_runs_over_a_folder_with_state() {
    let dir = tempfile::tempdir().unwrap();
    let seed = dir.path().join("seed.json");
    std::fs::write(&seed, "{}").unwrap();
    let mut config = config(dir.path(), seeding_init(dir.path(), "0"), health());
    config.seed = Some(seed);
    let data = dir.path().join("data");
    std::fs::create_dir(&data).unwrap();
    std::fs::write(data.join("last-seen-version"), "0.99.0").unwrap();
    std::fs::write(data.join("agent.json"), "{\"did\":\"keep\"}").unwrap();
    std::fs::write(dir.path().join(".data.we-init-started"), "").unwrap();
    let sup = Supervisor::with_reader(config, Arc::new(Reader::default()));
    sup.start();
    wait_for(&sup, "ready", 10, |s| matches!(s, Lifecycle::Ready { .. }));
    assert_eq!(inits(dir.path()), 0, "init ran over a folder with state");
    assert_eq!(
        std::fs::read_to_string(data.join("last-seen-version")).unwrap(),
        "0.99.0"
    );
    assert!(data.join("agent.json").exists());
}

/// Round 3 (Lal P3): only the `rust_executor::api` INFO record with
/// exactly that message gives the port. A value the executor echoes in
/// another record (a PID-file path it failed to write, logged before the
/// API starts), a record of another target, or a message with more after
/// `/api/v1` gives none.
#[test]
fn the_port_is_read_only_from_the_api_record() {
    use we_ad4m::supervisor::reported_port;
    let echoed = "[2026-11-19T09:47:12Z ERROR rust_executor] Failed to write PID file \
                  /nonexistent/API server starting on http://127.0.0.1:43210/api/v1: No such file";
    assert_eq!(reported_port(echoed), None);
    let other_target = "[2026-11-19T09:47:12Z INFO  rust_executor] API server starting on http://127.0.0.1:43210/api/v1";
    assert_eq!(reported_port(other_target), None);
    let other_level = "[2026-11-19T09:47:12Z WARN  rust_executor::api] API server starting on http://127.0.0.1:43210/api/v1";
    assert_eq!(reported_port(other_level), None);
    let longer = "[2026-11-19T09:47:12Z INFO  rust_executor::api] API server starting on http://127.0.0.1:43210/api/v1x";
    assert_eq!(reported_port(longer), None);
    let real = "[2026-11-19T09:47:12Z INFO  rust_executor::api] API server starting on http://127.0.0.1:45617/api/v1";
    assert_eq!(reported_port(real), Some(45617));
    assert_eq!(reported_port(&format!("{real}\r")), Some(45617));
}

/// Round 3: a stand-in that echoes the listening text (with an alien's
/// port) in an earlier record, then logs its real record: the admin
/// credential goes to the real port only.
#[test]
fn an_echoed_listening_line_is_not_the_port() {
    let dir = tempfile::tempdir().unwrap();
    let alien = health();
    let real = health();
    let binary = dir.path().join("executor");
    executable(
        &binary,
        format!(
            "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 'ad4m 0.13.1-staging.13'; exit 0; fi\n\
             if [ \"$1\" = init ]; then exit 0; fi\n\
             echo '[2026-11-19T00:00:00Z ERROR rust_executor] Failed to write PID file \
             /x/API server starting on http://127.0.0.1:{alien}/api/v1: denied' >&2\n\
             PORT={real}\n{LISTENING}\ncat > /dev/null\n"
        ),
    );
    let reader = Arc::new(Reader::default());
    let sup = Supervisor::with_reader(silent(dir.path(), binary), reader.clone());
    sup.start();
    wait_for(&sup, "ready", 10, |s| matches!(s, Lifecycle::Ready { .. }));
    let calls = reader.calls.lock().unwrap().clone();
    assert_eq!(calls[0].0, format!("http://127.0.0.1:{real}"), "{calls:?}");
}

/// Round 3 (Lal P3: the budget's name): the restart budget is a rolling
/// window, "at most 3 exit-75 restarts within restart_window". Runs of
/// 0.3 s with a 0.6 s window never put 4 restarts in one window, so the
/// executor keeps being restarted, although every run is shorter than
/// the window (which the old "3 short runs in a row" rule refused).
#[test]
fn the_restart_budget_is_a_rolling_window() {
    let dir = tempfile::tempdir().unwrap();
    let binary = script(dir.path(), "executor", "sleep 0.3\nexit 75");
    let mut config = config(dir.path(), binary, health());
    config.restart_window = Duration::from_millis(600);
    let sup = Supervisor::with_reader(config, Arc::new(Reader::default()));
    sup.start();
    let start = Instant::now();
    while sup.starts() < 7 {
        if let Lifecycle::Failed { reason, .. } = sup.state() {
            panic!("stopped after {} starts: {reason}", sup.starts());
        }
        assert!(start.elapsed() < Duration::from_secs(20), "not run again");
        std::thread::sleep(Duration::from_millis(20));
    }
    sup.stop();
}

/// Round 3 (Lal P3: loose version parsing): versions are read strictly
/// (three numeric core parts), with pre-release and build suffixes
/// handled on purpose: a build suffix (`+…`) never changes the answer; a
/// higher core accepts any pre-release (`-dev`, `-rc.1`); on 0.13.1 only
/// `staging.N` with N ≥ 12 (or no pre-release) passes.
#[test]
fn the_minimum_executor_version_is_read_strictly() {
    use we_ad4m::supervisor::executor_version_ok;
    for ok in [
        "ad4m 0.13.1-staging.13+g1a2b3c",
        "ad4m 0.13.1+20261119",
        "ad4m 0.14.0-dev",
        "ad4m 0.14.0-dev+local",
    ] {
        assert!(
            executor_version_ok(ok).is_ok(),
            "{ok}: {:?}",
            executor_version_ok(ok)
        );
    }
    for refused in [
        "ad4m 0.13.q.1",
        "ad4m 0.13.1.2",
        "ad4m 0.13",
        "ad4m 0.13.1-dev",
        "ad4m 0.13.1-staging.11+g1a2b3c",
        "ad4m 0.13.1-staging.x",
        "ad4m 0.12.99+0.13.1",
    ] {
        assert!(
            executor_version_ok(refused).is_err(),
            "{refused} was accepted"
        );
    }
}

/// Slice-4 leftover (Lal P3 on e14efd725): the child logs without colour
/// codes whatever this process's `RUST_LOG_STYLE` says, so the listening
/// record's header is plain text.
#[test]
fn the_child_logs_without_colour() {
    let dir = tempfile::tempdir().unwrap();
    let style = dir.path().join("style");
    let binary = script(
        dir.path(),
        "executor",
        &format!(
            "echo \"style=$RUST_LOG_STYLE\" > '{}'\ncat > /dev/null\nexit 0",
            style.display()
        ),
    );
    let sup = Supervisor::with_reader(
        config(dir.path(), binary, health()),
        Arc::new(Reader::default()),
    );
    sup.start();
    wait_for(&sup, "ready", 10, |s| matches!(s, Lifecycle::Ready { .. }));
    assert_eq!(
        std::fs::read_to_string(&style).unwrap().trim(),
        "style=never"
    );
}

/// Slice-4 leftover (Lal P3 on e14efd725): an executor that never logged
/// where it listens fails at the ready timeout with the settings that hide
/// that record. One that said its port and then did not answer there does
/// not get them: its record was seen.
#[test]
fn a_start_that_never_said_its_port_names_what_hides_it() {
    let dir = tempfile::tempdir().unwrap();
    let mut quiet = silent(dir.path(), waits_on_stdin(dir.path()));
    quiet.ready_timeout = Duration::from_secs(1);
    let sup = Supervisor::with_reader(quiet, Arc::new(Reader::default()));
    sup.start();
    wait_for(&sup, "failed", 10, |s| {
        matches!(s, Lifecycle::Failed { .. })
    });
    let Lifecycle::Failed { reason, stopped } = sup.state() else {
        unreachable!()
    };
    assert!(!stopped);
    for setting in ["AD4M_LOG_DIR", "RUST_LOG", "AD4M_LOCALHOST=false"] {
        assert!(reason.contains(setting), "{setting} not named: {reason}");
    }

    let dir = tempfile::tempdir().unwrap();
    let mut said = config(dir.path(), waits_on_stdin(dir.path()), closed_port());
    said.ready_timeout = Duration::from_secs(1);
    let sup = Supervisor::with_reader(said, Arc::new(Reader::default()));
    sup.start();
    wait_for(&sup, "failed", 10, |s| {
        matches!(s, Lifecycle::Failed { .. })
    });
    let Lifecycle::Failed { reason, .. } = sup.state() else {
        unreachable!()
    };
    assert!(reason.contains("didn't respond"), "{reason}");
    assert!(!reason.contains("AD4M_LOG_DIR"), "{reason}");
}
