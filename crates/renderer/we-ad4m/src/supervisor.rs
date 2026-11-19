//! This computer's executor, when the app runs it.
//!
//! The Electron shell's supervisor (`apps/we-electron/electron/executorProcess.js`)
//! is the reference; this is its contract in Rust, cut to what the base
//! screen needs (TS `BaseExecutor`: state, subscribe, start, refresh).
//!
//! ## Only our own
//!
//! The supervisor stops only the child it started, through the handle it
//! holds. An executor someone else runs on the same data folder refuses to
//! start beside it (exit 79), and that is a failed start with that reason,
//! not something to stop. A window given `--executor-url` attaches to an
//! executor and has no supervisor at all.
//!
//! ## The child
//!
//! `ad4m-executor run` with `--watch-stdin true` (it stops when the pipe
//! this supervisor holds closes, which the OS also does when the app dies)
//! and `--exit-with-parent true`. The admin credential is fresh for each
//! supervisor and reaches the child in its environment
//! (`AD4M_ADMIN_CREDENTIAL`), never on its command line, where `ps` shows it
//! to every user. Only the supervisor uses it, to read the agent's state.
//! The app's own connection asks for its capability as with any executor.
//! There is no launcher to approve it, so the supervisor, as the operator,
//! approves that one request ([`Supervisor::approve`]): the request id the
//! window's own flow was answered, for the grant that flow asked for, and
//! nothing else. `--auto-permit-cap-requests` is not used: it would grant
//! every app's request, and its code is only printed to the log.
//!
//! ## States
//!
//! - **Starting** from a start until the child has said which port it
//!   bound and `GET /health` answers 200 `{"status":"ok"}` there.
//!
//! ## The port is the child's
//!
//! The child runs with `--port 0`: the OS gives it a free port that only it
//! holds. It logs `API server starting on http://127.0.0.1:<port>/api/v1`
//! once that listener is bound, on its stderr, which is a pipe only this
//! supervisor reads. That line is the only source of the address: no port
//! is guessed (a free port released before the child binds it can be taken
//! by another process), and no `/health` probe or admin call goes anywhere
//! before it. Admin calls (`agent.status`, `agent.permitCapability`) are
//! made only for the current run and only while its child has not exited.
//! A narrow window remains: the child can die between that check and the
//! socket open, and its port be taken in that instant.
//! - **Ready**, with the agent from `agent.status`: `Locked` when it exists
//!   and is locked, `Unlocked`, or none (no agent yet, or no answer). It is
//!   never guessed to want a password.
//! - **Failed**, `stopped: false`: it exited before it was ready, did not
//!   answer in time (the child is then ended), or could not be run.
//! - **Failed**, `stopped: true`: it was ready and then exited (stopped
//!   outside the app, crashed, or stopped by this supervisor).
//!
//! Exit 75 (the executor asked to be started again) runs it again at once.
//! There
//! is no automatic restart after a crash (the Electron shell has one, with
//! a backoff): B's "Start Coasys" starts it again.
//!
//! The stop closes stdin, waits up to ten seconds, then kills the child.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::connect::{app_info, GrantScope};
use crate::Connection;

/// The executor's exit codes: its run contract with a supervisor (ad4m
/// `exit.rs`, as `executorProcess.js` reads them).
const EXIT_RESTART: i32 = 75;
const EXIT_CONFIG_REFUSED: i32 = 78;
const EXIT_DATA_FOLDER_BUSY: i32 = 79;

/// The oldest executor this supervisor runs: the first release with
/// `--watch-stdin` (stop on stdin end) and the data-folder lock (exit 79).
/// `ad4m 0.13.1-staging.11`, the client pin's release, has neither.
pub const MIN_EXECUTOR_VERSION: &str = "0.13.1-staging.12";
/// How long `ad4m-executor --version` may take.
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);

/// Exit 75 restarts in a row allowed (a restart counts in a row when the
/// run before it lasted less than [`SupervisorConfig::restart_window`]);
/// past that, the executor is not started again.
const MAX_RESTARTS: u32 = 3;

/// How long one `/health` probe may take, and how far apart they are.
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);
const PROBE_INTERVAL: Duration = Duration::from_millis(250);
/// How often the supervisor looks whether its child exited.
const EXIT_POLL: Duration = Duration::from_millis(100);
/// The stop: stdin closed, then this long before the child is killed.
const STOP_GRACE: Duration = Duration::from_secs(10);
/// The agent read with the admin credential.
const READ_TIMEOUT: Duration = Duration::from_secs(10);
/// Lines of the child's stderr kept for saying why it stopped.
const TAIL_LINES: usize = 20;

/// How this computer's agent is, from `agent.status`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Agent {
    Unlocked,
    Locked,
}

/// The executor the app runs, as its supervisor last saw it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Lifecycle {
    Starting,
    Ready { agent: Option<Agent> },
    Failed { reason: String, stopped: bool },
}

/// What the supervisor starts.
#[derive(Clone, Debug)]
pub struct SupervisorConfig {
    /// The `ad4m-executor` binary.
    pub binary: PathBuf,
    /// Its data folder (`--app-data-path`). Initialized (`init`) when it is
    /// missing or empty.
    pub data_dir: PathBuf,
    /// `init --network-bootstrap-seed`.
    pub seed: Option<PathBuf>,
    /// The admin credential; `None` makes a fresh random one.
    pub admin_credential: Option<String>,
    /// More `run` arguments (tests: `--run-holochain false`).
    pub extra_args: Vec<String>,
    /// How long a start waits for `/health`.
    pub ready_timeout: Duration,
    /// How long `init` may take before it is ended and the start fails.
    pub init_timeout: Duration,
    /// An exit-75 restart counts in a row when the run before it lasted
    /// less than this; a longer run starts the count again.
    pub restart_window: Duration,
}

impl SupervisorConfig {
    pub fn new(binary: PathBuf, data_dir: PathBuf) -> Self {
        Self {
            binary,
            data_dir,
            seed: None,
            admin_credential: None,
            extra_args: Vec::new(),
            ready_timeout: Duration::from_secs(60),
            init_timeout: Duration::from_secs(120),
            restart_window: Duration::from_secs(60),
        }
    }
}

/// Where the desktop app keeps the executor it runs:
/// `{data}/we-renderer/executor` (`$XDG_DATA_HOME`, else
/// `~/.local/share`).
pub fn default_data_dir() -> PathBuf {
    let mut dir = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute())
        .unwrap_or_else(|| {
            let mut home = std::env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."));
            home.push(".local");
            home.push("share");
            home
        });
    dir.push("we-renderer");
    dir.push("executor");
    dir
}

/// The supervisor's calls with the admin credential.
pub trait AgentReader: Send + Sync {
    /// The agent's state. `Ok(None)`: the executor has no agent yet.
    fn read(&self, url: &str, admin: &str) -> Result<Option<Agent>, String>;

    /// `agent.permitCapability` for `auth` (`{"requestId", "auth"}`):
    /// the code that redeems the request.
    fn permit(&self, url: &str, admin: &str, auth: &str) -> Result<String, String> {
        let _ = (url, admin, auth);
        Err("this reader approves nothing".into())
    }
}

/// Whether `said` (the output of `ad4m-executor --version`, e.g.
/// `ad4m 0.13.1-staging.13`) names an executor this supervisor can run:
/// [`MIN_EXECUTOR_VERSION`] or newer. `Err` is the sentence to show.
pub fn executor_version_ok(said: &str) -> Result<(), String> {
    let need = format!(
        "Coasys needs ad4m {MIN_EXECUTOR_VERSION} or newer (it stops the executor through \
         --watch-stdin)."
    );
    let version = said
        .split_whitespace()
        .find(|word| word.starts_with(|c: char| c.is_ascii_digit()));
    let Some(version) = version else {
        return Err(format!(
            "Couldn't tell which ad4m version this executor is (it said {:?}). {need}",
            said.trim()
        ));
    };
    let (core, pre) = match version.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (version, None),
    };
    let numbers: Vec<u64> = core.split('.').filter_map(|n| n.parse().ok()).collect();
    let too_old = || Err(format!("This executor is ad4m {version}. {need}"));
    let [major, minor, patch] = numbers[..] else {
        return too_old();
    };
    let newer = match (major, minor, patch).cmp(&(0, 13, 1)) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        // 0.13.1 itself, or one of its staging builds from .12 on.
        std::cmp::Ordering::Equal => match pre {
            None => true,
            Some(pre) => pre
                .strip_prefix("staging.")
                .and_then(|n| n.parse::<u64>().ok())
                .is_some_and(|n| n >= 12),
        },
    };
    if newer {
        Ok(())
    } else {
        too_old()
    }
}

/// The agent's state from `agent.status`'s two flags. An agent that does
/// not exist yet is none, not "needs a password".
pub fn agent_from_status(is_initialized: bool, is_unlocked: bool) -> Option<Agent> {
    match (is_initialized, is_unlocked) {
        (_, true) => Some(Agent::Unlocked),
        (true, false) => Some(Agent::Locked),
        (false, false) => None,
    }
}

/// [`AgentReader`] over the executor's RPC (`agent.status`).
struct Ad4mReader {
    handle: tokio::runtime::Handle,
}

impl AgentReader for Ad4mReader {
    fn read(&self, url: &str, admin: &str) -> Result<Option<Agent>, String> {
        let handle = self.handle.clone();
        let (url, admin) = (url.to_string(), admin.to_string());
        let read = async move {
            let conn = Connection::open(handle, &url, &admin).await?;
            let status = conn.client().agent.status().await;
            conn.ws().close().await;
            let status = status?;
            anyhow::Ok(agent_from_status(status.is_initialized, status.is_unlocked))
        };
        self.handle
            .block_on(async { tokio::time::timeout(READ_TIMEOUT, read).await })
            .map_err(|_| "the agent did not answer in time".to_string())?
            .map_err(|e| format!("{e:#}"))
    }

    fn permit(&self, url: &str, admin: &str, auth: &str) -> Result<String, String> {
        let handle = self.handle.clone();
        let (url, admin, auth) = (url.to_string(), admin.to_string(), auth.to_string());
        let permit = async move {
            let conn = Connection::open(handle, &url, &admin).await?;
            let code = conn
                .ws()
                .call::<String>(
                    "agent.permitCapability",
                    serde_json::json!({ "auth": auth }),
                )
                .await;
            conn.ws().close().await;
            anyhow::Ok(code?)
        };
        self.handle
            .block_on(async { tokio::time::timeout(READ_TIMEOUT, permit).await })
            .map_err(|_| "the executor did not answer in time".to_string())?
            .map_err(|e| format!("{e:#}"))
    }
}

type Waker = Arc<dyn Fn() + Send + Sync>;

struct Status {
    lifecycle: Lifecycle,
    /// Grows on every published change. A refresh answer is applied only
    /// if it did not grow since the refresh was asked.
    changes: u64,
    /// A run thread is working (starting, or watching a child).
    running: bool,
    /// The stop was asked; the run ends what it holds.
    stopping: bool,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    /// Where the current run's child said it listens. Set only from that
    /// child's own stderr, so it is that child's port.
    url: Option<String>,
    /// Grows with every child started. Admin calls name the run they are
    /// for and are refused for any other.
    run: u64,
}

struct Shared {
    config: SupervisorConfig,
    admin: String,
    reader: Arc<dyn AgentReader>,
    status: Mutex<Status>,
    waker: Mutex<Option<Waker>>,
    starts: AtomicU64,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, Status> {
        self.status.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn wake(&self) {
        let waker = self.waker.lock().unwrap_or_else(|p| p.into_inner()).clone();
        if let Some(waker) = waker {
            waker();
        }
    }

    /// Publish `lifecycle`, then wake. The lock is released before the
    /// waker runs.
    fn publish(&self, mut status: MutexGuard<'_, Status>, lifecycle: Lifecycle) {
        status.lifecycle = lifecycle;
        status.changes += 1;
        drop(status);
        self.wake();
    }
}

/// The executor this app runs. Dropping it stops the child it started.
pub struct Supervisor {
    shared: Arc<Shared>,
}

impl Supervisor {
    /// Reads the agent over the executor's RPC on `handle`. Does not start.
    pub fn new(config: SupervisorConfig, handle: tokio::runtime::Handle) -> Self {
        Self::with_reader(config, Arc::new(Ad4mReader { handle }))
    }

    /// [`Supervisor::new`] with another way to read the agent (tests).
    pub fn with_reader(config: SupervisorConfig, reader: Arc<dyn AgentReader>) -> Self {
        let admin = config.admin_credential.clone().unwrap_or_else(fresh_secret);
        Self {
            shared: Arc::new(Shared {
                config,
                admin,
                reader,
                status: Mutex::new(Status {
                    lifecycle: Lifecycle::Starting,
                    changes: 0,
                    running: false,
                    stopping: false,
                    child: None,
                    stdin: None,
                    url: None,
                    run: 0,
                }),
                waker: Mutex::new(None),
                starts: AtomicU64::new(0),
            }),
        }
    }

    /// Called after every change, from the supervisor's threads.
    pub fn set_waker(&self, waker: Waker) {
        *self.shared.waker.lock().unwrap_or_else(|p| p.into_inner()) = Some(waker);
    }

    /// Start the executor. `false`, and nothing started, when one already
    /// starts or runs.
    pub fn start(&self) -> bool {
        let mut status = self.shared.lock();
        if status.running {
            return false;
        }
        status.running = true;
        status.stopping = false;
        status.url = None;
        self.shared.publish(status, Lifecycle::Starting);
        let shared = self.shared.clone();
        let spawned = std::thread::Builder::new()
            .name("we-executor".into())
            .spawn(move || run(&shared));
        if let Err(e) = spawned {
            let mut status = self.shared.lock();
            status.running = false;
            let reason = format!("Couldn't start the executor's supervisor: {e}");
            self.shared.publish(
                status,
                Lifecycle::Failed {
                    reason,
                    stopped: false,
                },
            );
        }
        true
    }

    /// Stop the child this supervisor started, and wait until it is gone:
    /// stdin closed, then killed if it has not exited within ten seconds.
    /// Nothing else is stopped.
    pub fn stop(&self) {
        {
            let mut status = self.shared.lock();
            if !status.running {
                return;
            }
            status.stopping = true;
            status.stdin.take();
        }
        let deadline = Instant::now() + STOP_GRACE;
        while self.shared.lock().running {
            if Instant::now() >= deadline {
                if let Some(child) = self.shared.lock().child.as_mut() {
                    let _ = child.kill();
                }
                break;
            }
            std::thread::sleep(EXIT_POLL);
        }
        let deadline = Instant::now() + STOP_GRACE;
        while self.shared.lock().running && Instant::now() < deadline {
            std::thread::sleep(EXIT_POLL);
        }
    }

    /// Approve capability request `request_id` for `scope`, as the
    /// operator, and answer its code. Blocks; call it off the UI thread.
    ///
    /// Only for the request the window's own flow made to this executor:
    /// the caller passes the id that flow was answered and the scope it
    /// asked for. Refused while the executor is not ready.
    pub fn approve(&self, request_id: &str, scope: &GrantScope) -> Result<String, String> {
        let url = {
            let mut status = self.shared.lock();
            let run = status.run;
            if !matches!(status.lifecycle, Lifecycle::Ready { .. }) {
                return Err("the executor is not running".into());
            }
            admin_url(&mut status, run).ok_or("the executor is not running")?
        };
        let app = app_info(scope);
        let auth = serde_json::json!({
            "requestId": request_id,
            "auth": {
                "appName": app.name,
                "appDesc": app.description,
                "capabilities": app.capabilities,
            },
        })
        .to_string();
        self.shared.reader.permit(&url, &self.shared.admin, &auth)
    }

    /// Read the agent again (TS `executor.refresh`), off this thread. The
    /// answer is dropped when anything was published since the refresh was
    /// asked, and a refresh that cannot answer leaves the state as it was.
    pub fn refresh(&self) {
        let (url, asked, run) = {
            let mut status = self.shared.lock();
            if !matches!(status.lifecycle, Lifecycle::Ready { .. }) {
                return;
            }
            let run = status.run;
            let Some(url) = admin_url(&mut status, run) else {
                return;
            };
            (url, status.changes, run)
        };
        let shared = self.shared.clone();
        let _ = std::thread::Builder::new()
            .name("we-executor-refresh".into())
            .spawn(move || {
                let Ok(agent) = shared.reader.read(&url, &shared.admin) else {
                    return;
                };
                let status = shared.lock();
                let same = status.lifecycle == Lifecycle::Ready { agent };
                if status.changes != asked || status.run != run || same {
                    return;
                }
                shared.publish(status, Lifecycle::Ready { agent });
            });
    }

    pub fn state(&self) -> Lifecycle {
        self.shared.lock().lifecycle.clone()
    }

    /// Which executor process: grows with every process started (a start,
    /// an exit-75 restart). `0` before the first.
    pub fn incarnation(&self) -> u64 {
        self.shared.lock().run
    }

    /// [`Supervisor::state`] and [`Supervisor::incarnation`], read together.
    pub fn state_at(&self) -> (Lifecycle, u64) {
        let status = self.shared.lock();
        (status.lifecycle.clone(), status.run)
    }

    /// Grows on every change [`Supervisor::state`] reports.
    pub fn changes(&self) -> u64 {
        self.shared.lock().changes
    }

    /// Where the executor listens, from its start until it stops.
    pub fn url(&self) -> Option<String> {
        self.shared.lock().url.clone()
    }

    /// How many times a process was started (an exit-75 restart counts).
    pub fn starts(&self) -> u64 {
        self.shared.starts.load(Ordering::SeqCst)
    }

    /// The running child's process id.
    pub fn pid(&self) -> Option<u32> {
        self.shared.lock().child.as_ref().map(Child::id)
    }
}

impl Drop for Supervisor {
    fn drop(&mut self) {
        self.stop();
    }
}

/// How one child ended.
enum Ended {
    /// Before `/health` answered, with its exit status.
    Early(ExitStatus),
    /// No answer within the ready timeout; the child was ended.
    Timeout,
    /// The stop was asked.
    Stopped,
    /// After it was ready.
    Late(ExitStatus),
}

/// One start: run the child, and again for exit 75 or a taken port, until
/// it fails, stops or is stopped. Clears `running` when done.
fn run(shared: &Shared) {
    let outcome = run_child(shared);
    let mut status = shared.lock();
    status.running = false;
    status.child = None;
    status.stdin = None;
    status.url = None;
    shared.publish(status, outcome);
}

fn run_child(shared: &Shared) -> Lifecycle {
    let config = &shared.config;
    let failed = |reason: String| Lifecycle::Failed {
        reason,
        stopped: false,
    };
    match bounded(
        shared,
        Command::new(&config.binary).arg("--version"),
        VERSION_TIMEOUT,
    ) {
        Bounded::Done(exit, out) if exit.success() => {
            if let Err(reason) = executor_version_ok(&out) {
                return failed(reason);
            }
        }
        Bounded::Done(exit, _) => {
            return failed(format!(
                "Couldn't tell which ad4m version {} is ({}).",
                config.binary.display(),
                describe(&exit)
            ))
        }
        Bounded::Stopped => return stopped_by_us(),
        Bounded::Timeout => {
            return failed(format!(
                "{} --version didn't answer within {} seconds.",
                config.binary.display(),
                VERSION_TIMEOUT.as_secs()
            ))
        }
        Bounded::NotRun(reason) => return failed(reason),
    }
    match init(shared) {
        Ok(()) => {}
        Err(Prep::Stopped) => return stopped_by_us(),
        Err(Prep::Failed(reason)) => return failed(reason),
    }
    let mut restarts = 0;
    loop {
        let run_started = Instant::now();
        let (mut child, tail) = match spawn(shared) {
            Ok(spawned) => spawned,
            Err(reason) => return failed(reason),
        };
        shared.starts.fetch_add(1, Ordering::SeqCst);
        let run = {
            let mut status = shared.lock();
            if status.stopping {
                // Stopped while it was being spawned: end it here.
                let _ = child.kill();
                let _ = child.wait();
                return stopped_by_us();
            }
            status.run += 1;
            status.stdin = child.stdin.take();
            status.child = Some(child);
            status.url = None;
            status.run
        };
        let ended = watch(shared, run, &tail);
        let code = |status: &ExitStatus| status.code();
        match ended {
            Ended::Stopped => return stopped_by_us(),
            Ended::Timeout => {
                return failed(format!(
                    "It didn't respond within {} seconds.",
                    config.ready_timeout.as_secs()
                ))
            }
            // The executor asked to be started again: a new run. The old
            // run's state and address go first (Starting, a new change and
            // a new run number), so nothing answered for the old run is
            // published or sent to as the new one's.
            Ended::Early(exit) | Ended::Late(exit) if code(&exit) == Some(EXIT_RESTART) => {
                restarts = if run_started.elapsed() >= config.restart_window {
                    1
                } else {
                    restarts + 1
                };
                if restarts > MAX_RESTARTS {
                    return Lifecycle::Failed {
                        reason: format!(
                            "It asked to be restarted {} times in a row; it was not started \
                             again.",
                            restarts
                        ),
                        stopped: true,
                    };
                }
                let mut status = shared.lock();
                if status.stopping {
                    return stopped_by_us();
                }
                status.url = None;
                shared.publish(status, Lifecycle::Starting);
            }
            Ended::Early(exit) => match code(&exit) {
                Some(EXIT_DATA_FOLDER_BUSY) => {
                    return failed(
                        "Another executor is using this computer's Coasys data folder. \
                         Close it, then try again."
                            .into(),
                    )
                }
                Some(EXIT_CONFIG_REFUSED) => {
                    return failed(with_last("A setting stops it from starting.".into(), &tail))
                }
                _ => {
                    return failed(with_last(
                        format!("It stopped before it was ready ({}).", describe(&exit)),
                        &tail,
                    ))
                }
            },
            Ended::Late(exit) => {
                let reason = match code(&exit) {
                    Some(0) => "Another program stopped it.".to_string(),
                    _ => format!("It stopped ({}).", describe(&exit)),
                };
                return Lifecycle::Failed {
                    reason,
                    stopped: true,
                };
            }
        }
    }
}

/// How a short helper command ([`bounded`]) ended.
enum Bounded {
    /// It exited; its stdout (the first 64 KiB).
    Done(ExitStatus, String),
    /// The stop was asked; it was killed.
    Stopped,
    /// Past its deadline; it was killed.
    Timeout,
    /// It could not be started.
    NotRun(String),
}

/// Run a helper command (`--version`, `init`) as a child the supervisor
/// holds: the stop reaches it (killed and reaped at once), and so does a
/// deadline. Its stdin is closed; its output is read on a thread, so a
/// full pipe cannot block it.
fn bounded(shared: &Shared, cmd: &mut Command, limit: Duration) -> Bounded {
    let spawned = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(e) => {
            return Bounded::NotRun(format!(
                "Couldn't run {}: {e}",
                shared.config.binary.display()
            ))
        }
    };
    let (out_tx, out_rx) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        let _ = std::thread::Builder::new()
            .name("we-executor-helper".into())
            .spawn(move || {
                let mut text = String::new();
                let _ = stdout.take(64 * 1024).read_to_string(&mut text);
                let _ = out_tx.send(text);
            });
    }
    {
        let mut status = shared.lock();
        if status.stopping {
            let _ = child.kill();
            let _ = child.wait();
            return Bounded::Stopped;
        }
        status.child = Some(child);
    }
    let deadline = Instant::now() + limit;
    loop {
        let mut status = shared.lock();
        let stopping = status.stopping;
        let Some(child) = status.child.as_mut() else {
            return Bounded::Stopped;
        };
        if let Ok(Some(exit)) = child.try_wait() {
            status.child = None;
            drop(status);
            let out = out_rx
                .recv_timeout(Duration::from_secs(1))
                .unwrap_or_default();
            return Bounded::Done(exit, out);
        }
        if stopping || Instant::now() >= deadline {
            let mut child = status.child.take().expect("held above");
            drop(status);
            let _ = child.kill();
            let _ = child.wait();
            return if stopping {
                Bounded::Stopped
            } else {
                Bounded::Timeout
            };
        }
        drop(status);
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn stopped_by_us() -> Lifecycle {
    Lifecycle::Failed {
        reason: "It was stopped.".into(),
        stopped: true,
    }
}

/// Why preparing the data folder did not finish.
enum Prep {
    Stopped,
    Failed(String),
}

/// `init` the data folder the first time, and only then.
///
/// The executor's `init` is not harmless over an existing folder: when the
/// version it finds recorded there is outside the range it supports, it
/// deletes the folder's state (`clean_ad4m_data`). So `init` never runs on
/// the data folder itself:
///
/// - A folder with anything in it is left as it is, whatever it holds or
///   whoever made it (the executor migrates its own when it runs).
/// - A missing (or empty) folder is made by running `init` into a new
///   sibling folder (`.<name>.we-init-<pid>-<n>`) and renaming that into
///   place only after `init` succeeded. A failed, stopped or timed-out
///   `init` leaves no data folder behind (its staging folder is removed),
///   so the next start runs `init` again from nothing. The rename does not
///   replace a folder that has content.
/// - A folder that cannot be read is an error, not an empty folder.
///
/// An OS file lock beside the folder (`.<name>.we-init-lock`) is held while
/// one window decides and runs this; another window waits for it, up to
/// [`SupervisorConfig::init_timeout`], then finds the folder made. The OS
/// lets it go if the app dies. The `init` runs as a child the supervisor
/// holds ([`bounded`]): the stop ends it, and so does the deadline.
fn init(shared: &Shared) -> Result<(), Prep> {
    let config = &shared.config;
    let dir = &config.data_dir;
    let failed = |what: String| Err(Prep::Failed(what));
    let parent = dir
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(std::path::Path::new("."));
    let name = dir
        .file_name()
        .map_or_else(|| "executor".into(), |name| name.to_string_lossy());
    let lock_path = parent.join(format!(".{name}.we-init-lock"));
    if let Err(e) = std::fs::create_dir_all(parent) {
        return failed(format!("Couldn't create {}: {e}", parent.display()));
    }
    let lock = match std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&lock_path)
    {
        Ok(lock) => lock,
        Err(e) => return failed(format!("Couldn't open {}: {e}", lock_path.display())),
    };
    let deadline = Instant::now() + config.init_timeout;
    loop {
        match lock.try_lock() {
            Ok(()) => break,
            Err(std::fs::TryLockError::WouldBlock) => {
                if shared.lock().stopping {
                    return Err(Prep::Stopped);
                }
                if Instant::now() >= deadline {
                    return failed(format!(
                        "Another Coasys window is preparing this data folder, and it did not \
                         finish within {} seconds.",
                        config.init_timeout.as_secs()
                    ));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(std::fs::TryLockError::Error(e)) => {
                return failed(format!("Couldn't lock {}: {e}", lock_path.display()))
            }
        }
    }
    match folder_content(dir) {
        Ok(Folder::HasContent) => return Ok(()),
        Ok(Folder::Missing) => {}
        Ok(Folder::Empty) => {
            // Empty: made by someone, holds nothing. Removed so the staged
            // folder can take its place (a rename onto a folder is not
            // portable).
            if let Err(e) = std::fs::remove_dir(dir) {
                return failed(format!("Couldn't replace the empty {}: {e}", dir.display()));
            }
        }
        Err(e) => {
            return failed(format!(
                "Couldn't read its data folder {}: {e}",
                dir.display()
            ))
        }
    }
    static STAGINGS: AtomicU64 = AtomicU64::new(0);
    let staging = parent.join(format!(
        ".{name}.we-init-{}-{}",
        std::process::id(),
        STAGINGS.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&staging);
    let mut cmd = Command::new(&config.binary);
    cmd.arg("init").arg("--data-path").arg(&staging);
    if let Some(seed) = &config.seed {
        cmd.arg("--network-bootstrap-seed").arg(seed);
    }
    let ran = bounded(shared, &mut cmd, config.init_timeout);
    let outcome = match ran {
        Bounded::Done(exit, _) if exit.success() => match std::fs::create_dir_all(&staging)
            // An init that succeeded and made nothing gives an empty folder.
            .and_then(|()| std::fs::rename(&staging, dir))
        {
            Ok(()) => Ok(()),
            Err(e) => match folder_content(dir) {
                // Made meanwhile by something that does not take our lock
                // (an executor started by hand): theirs is kept.
                Ok(Folder::HasContent) => Ok(()),
                _ => failed(format!(
                    "Couldn't move the prepared data folder into place at {}: {e}",
                    dir.display()
                )),
            },
        },
        Bounded::Done(exit, _) => failed(format!(
            "Couldn't prepare its data folder ({}).",
            describe(&exit)
        )),
        Bounded::Stopped => Err(Prep::Stopped),
        Bounded::Timeout => failed(format!(
            "Preparing its data folder didn't finish within {} seconds.",
            config.init_timeout.as_secs()
        )),
        Bounded::NotRun(reason) => failed(reason),
    };
    // Gone after a rename; what a failed init left is removed.
    let _ = std::fs::remove_dir_all(&staging);
    drop(lock);
    outcome
}

/// What the data folder holds.
enum Folder {
    Missing,
    Empty,
    HasContent,
}

/// The data folder's state. An error reading it, or an entry of it, is an
/// error: nothing is assumed about a folder that cannot be read.
fn folder_content(dir: &std::path::Path) -> std::io::Result<Folder> {
    let mut entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Folder::Missing),
        Err(e) => return Err(e),
    };
    match entries.next() {
        None => Ok(Folder::Empty),
        Some(entry) => entry.map(|_| Folder::HasContent),
    }
}

/// A child's stderr, as read: its last lines, the port it said it bound,
/// and a signal when the pipe closed.
struct Tail {
    lines: Arc<Mutex<VecDeque<String>>>,
    reported: Arc<Mutex<Option<u16>>>,
    closed: mpsc::Receiver<()>,
}

/// The message the executor logs once its API listener is bound
/// (`rust-executor/src/api/mod.rs`, `log::info!` under the target
/// `rust_executor::api`; test harnesses read it as "ready" too).
const LISTENING: &str = "API server starting on http://127.0.0.1:";
const LISTENING_END: &str = "/api/v1";
const API_TARGET: &str = "rust_executor::api";

/// The port in the executor's listening record, if `line` is exactly that
/// record: env_logger's `[<time> INFO  rust_executor::api] ` header, then
/// exactly `API server starting on http://127.0.0.1:<port>/api/v1`. Another
/// target or level, text before or after the message, or the same words
/// inside another record (a value the executor echoes, such as a PID-file
/// path it could not write) give none.
///
/// This is where the address comes from, not a proof of who serves it:
/// the line arrives on the child's own stderr, so it names the port that
/// child says it bound (provenance), not an authenticated server.
pub fn reported_port(line: &str) -> Option<u16> {
    let line = line.trim_end_matches(['\r', '\n']);
    let (header, message) = line.strip_prefix('[')?.split_once("] ")?;
    let mut fields = header.split_whitespace();
    let (_time, level, target) = (fields.next()?, fields.next()?, fields.next()?);
    if level != "INFO" || target != API_TARGET || fields.next().is_some() {
        return None;
    }
    let digits = message
        .strip_prefix(LISTENING)?
        .strip_suffix(LISTENING_END)?;
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok().filter(|port| *port != 0)
}

/// `RUST_LOG` for the child: the environment's, or the executor's own
/// defaults, with `rust_executor::api=info` added so the listening line
/// is logged whatever else is set.
fn child_rust_log() -> String {
    match std::env::var("RUST_LOG") {
        Ok(set) if !set.trim().is_empty() => format!("{set},rust_executor::api=info"),
        _ => "holochain=warn,wasmer_compiler_cranelift=warn,rust_executor=info,warp::server=info"
            .into(),
    }
}

/// Run the child on port 0: the OS gives it a free port, which only it
/// holds, and it says which on its own stderr ([`reported_port`]). Nothing
/// is sent to a port before that (no free-port guess that another process
/// could take in between).
fn spawn(shared: &Shared) -> Result<(Child, Tail), String> {
    let config = &shared.config;
    let mut child = Command::new(&config.binary)
        .arg("run")
        .arg("--app-data-path")
        .arg(&config.data_dir)
        .args(["--port", "0"])
        .args(["--watch-stdin", "true"])
        .args(["--exit-with-parent", "true"])
        .args(["--run-dapp-server", "false"])
        .args(&config.extra_args)
        .env("AD4M_ADMIN_CREDENTIAL", &shared.admin)
        .env("RUST_LOG", child_rust_log())
        // Inherited settings that would change who holds operator
        // authority or which port it listens on: not this app's executor.
        .env_remove("AD4M_INSECURE_NO_ADMIN_CREDENTIAL")
        .env_remove("AD4M_ADMIN_CREDENTIAL_FILE")
        .env_remove("AD4M_AUTO_PERMIT_CAP_REQUESTS")
        .env_remove("AD4M_LOG_SECRETS")
        .env_remove("AD4M_PORT")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't run {}: {e}", config.binary.display()))?;
    let lines = Arc::new(Mutex::new(VecDeque::new()));
    let reported = Arc::new(Mutex::new(None));
    let (closed_tx, closed_rx) = mpsc::channel();
    if let Some(stderr) = child.stderr.take() {
        let kept = lines.clone();
        let port = reported.clone();
        let _ = std::thread::Builder::new()
            .name("we-executor-log".into())
            .spawn(move || {
                for line in BufReader::new(stderr).lines() {
                    let Ok(line) = line else { break };
                    if line.trim().is_empty() {
                        continue;
                    }
                    if let Some(said) = reported_port(&line) {
                        port.lock()
                            .unwrap_or_else(|p| p.into_inner())
                            .get_or_insert(said);
                    }
                    let mut kept = kept.lock().unwrap_or_else(|p| p.into_inner());
                    kept.push_back(line);
                    if kept.len() > TAIL_LINES {
                        kept.pop_front();
                    }
                }
                let _ = closed_tx.send(());
            });
    }
    Ok((
        child,
        Tail {
            lines,
            reported,
            closed: closed_rx,
        },
    ))
}

/// Wait for the child to say its port and answer `/health` there, then
/// for it to end. The admin credential goes only to the port this run's
/// child reported, and only while that child runs ([`admin_url`]).
fn watch(shared: &Shared, run: u64, tail: &Tail) -> Ended {
    let deadline = Instant::now() + shared.config.ready_timeout;
    let mut ready = false;
    loop {
        if let Some(ended) = exited(shared, ready, tail) {
            return ended;
        }
        if !ready {
            let port = *tail.reported.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(port) = port {
                let mut status = shared.lock();
                if status.run == run && status.url.is_none() {
                    status.url = Some(format!("http://127.0.0.1:{port}"));
                }
            }
            if port.is_some_and(healthy) {
                ready = true;
                let url = admin_url(&mut shared.lock(), run);
                let agent =
                    url.and_then(|url| shared.reader.read(&url, &shared.admin).ok().flatten());
                let status = shared.lock();
                if !status.stopping && status.run == run {
                    shared.publish(status, Lifecycle::Ready { agent });
                }
                continue;
            }
            if Instant::now() >= deadline {
                end_child(shared);
                return Ended::Timeout;
            }
            std::thread::sleep(PROBE_INTERVAL);
        } else {
            std::thread::sleep(EXIT_POLL);
        }
    }
}

/// The admin endpoint of run `run`: the port its child reported, while
/// that run is the current one and its child has not exited. `None`
/// otherwise; nothing with the admin credential is sent then.
fn admin_url(status: &mut Status, run: u64) -> Option<String> {
    if status.run != run || status.stopping {
        return None;
    }
    let alive = matches!(status.child.as_mut()?.try_wait(), Ok(None));
    alive.then(|| status.url.clone()).flatten()
}

/// How the child ended, if it did. Reaps it.
fn exited(shared: &Shared, ready: bool, tail: &Tail) -> Option<Ended> {
    let mut status = shared.lock();
    let exit = status.child.as_mut()?.try_wait().ok()??;
    let stopping = status.stopping;
    status.child = None;
    status.stdin = None;
    drop(status);
    // Its last words may still be in the pipe: wait for it to close, a
    // little (a process it started may hold the pipe open).
    let _ = tail.closed.recv_timeout(Duration::from_secs(1));
    Some(match (stopping, ready) {
        (true, _) => Ended::Stopped,
        (false, true) => Ended::Late(exit),
        (false, false) => Ended::Early(exit),
    })
}

/// Kill and reap the child this supervisor holds.
fn end_child(shared: &Shared) {
    let child = {
        let mut status = shared.lock();
        status.stdin = None;
        status.child.take()
    };
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// The reason, and the child's last line on stderr when it said one.
fn with_last(reason: String, tail: &Tail) -> String {
    let lines = tail.lines.lock().unwrap_or_else(|p| p.into_inner());
    match lines.back() {
        Some(line) => {
            // `[2026-11-19T08:33:18Z ERROR rust_executor] Refusing …`
            let said = line.split_once("] ").map_or(line.as_str(), |(_, s)| s);
            format!("{reason} {}", said.trim())
        }
        None => reason,
    }
}

fn describe(exit: &ExitStatus) -> String {
    if let Some(code) = exit.code() {
        return format!("exit {code}");
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = exit.signal() {
            return format!("signal {signal}");
        }
    }
    "no exit code".into()
}

/// `GET /health` on the loopback port answers 200 with `{"status":"ok"}`.
/// Anything else, or no answer within two seconds, is not ready.
fn healthy(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, PROBE_TIMEOUT) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(PROBE_TIMEOUT));
    let _ = stream.set_write_timeout(Some(PROBE_TIMEOUT));
    let ask = "GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(ask.as_bytes()).is_err() {
        return false;
    }
    let mut answer = Vec::new();
    let _ = stream.take(4096).read_to_end(&mut answer);
    let answer = String::from_utf8_lossy(&answer);
    let Some((head, body)) = answer.split_once("\r\n\r\n") else {
        return false;
    };
    let ok_status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        == Some("200");
    // The body is the JSON object, chunked or not.
    let json = match (body.find('{'), body.rfind('}')) {
        (Some(start), Some(end)) if start < end => &body[start..=end],
        _ => return false,
    };
    ok_status
        && serde_json::from_str::<serde_json::Value>(json)
            .is_ok_and(|value| value["status"] == "ok")
}

/// 32 random bytes as hex.
fn fresh_secret() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("the OS gives random bytes");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn status(child: Child) -> Status {
        Status {
            lifecycle: Lifecycle::Starting,
            changes: 0,
            running: true,
            stopping: false,
            child: Some(child),
            stdin: None,
            url: Some("http://127.0.0.1:4000".into()),
            run: 1,
        }
    }

    /// The admin credential goes only to a child that is still running:
    /// once it exited, its port may be anyone's, even before the run loop
    /// reaps it.
    #[test]
    fn admin_url_is_none_once_the_child_has_exited() {
        let mut alive = status(Command::new("sleep").arg("30").spawn().unwrap());
        assert_eq!(
            admin_url(&mut alive, 1).as_deref(),
            Some("http://127.0.0.1:4000")
        );
        assert_eq!(admin_url(&mut alive, 2), None, "another run's address");
        let mut child = alive.child.take().unwrap();
        let _ = child.kill();
        let _ = child.wait();

        let mut exited = Command::new("true").spawn().unwrap();
        exited.wait().unwrap();
        let mut ended = status(exited);
        assert_eq!(
            admin_url(&mut ended, 1),
            None,
            "the address of a child that exited"
        );
    }
}
