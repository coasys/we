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

/// A stand-in executor: `init` succeeds, `run` runs `body`.
fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join(name);
    std::fs::write(
        &path,
        format!("#!/bin/sh\nif [ \"$1\" = init ]; then exit 0; fi\n{body}\n"),
    )
    .unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
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

fn config(dir: &Path, binary: PathBuf, port: u16) -> SupervisorConfig {
    let mut config = SupervisorConfig::new(binary, dir.join("data"));
    config.port = Some(port);
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
    assert!(args.contains(&format!("--port {port}")), "{args}");
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
    wait_for(&sup, "ready", 10, |s| matches!(s, Lifecycle::Ready { .. }));
    assert_eq!(
        sup.url().as_deref(),
        Some(&*format!("http://127.0.0.1:{port}"))
    );
}
