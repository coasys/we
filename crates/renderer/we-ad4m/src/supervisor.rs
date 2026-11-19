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
//! - **Starting** from a start until `GET /health` answers 200
//!   `{"status":"ok"}` on its port.
//! - **Ready**, with the agent from `agent.status`: `Locked` when it exists
//!   and is locked, `Unlocked`, or none (no agent yet, or no answer). It is
//!   never guessed to want a password.
//! - **Failed**, `stopped: false`: it exited before it was ready, did not
//!   answer in time (the child is then ended), or could not be run.
//! - **Failed**, `stopped: true`: it was ready and then exited (stopped
//!   outside the app, crashed, or stopped by this supervisor).
//!
//! Exit 75 (the executor asked to be started again) runs it again at once on
//! the same port; exit 80 (port taken) tries another free port, twice. There
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
const EXIT_PORT_TAKEN: i32 = 80;

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
    /// A fixed port; `None` takes a free loopback port at each start.
    pub port: Option<u16>,
    /// The admin credential; `None` makes a fresh random one.
    pub admin_credential: Option<String>,
    /// More `run` arguments (tests: `--run-holochain false`).
    pub extra_args: Vec<String>,
    /// How long a start waits for `/health`.
    pub ready_timeout: Duration,
}

impl SupervisorConfig {
    pub fn new(binary: PathBuf, data_dir: PathBuf) -> Self {
        Self {
            binary,
            data_dir,
            seed: None,
            port: None,
            admin_credential: None,
            extra_args: Vec::new(),
            ready_timeout: Duration::from_secs(60),
        }
    }
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
    url: Option<String>,
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
            let status = self.shared.lock();
            match (&status.lifecycle, &status.url) {
                (Lifecycle::Ready { .. }, Some(url)) => url.clone(),
                _ => return Err("the executor is not running".into()),
            }
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
        let (url, asked) = {
            let status = self.shared.lock();
            let (Lifecycle::Ready { .. }, Some(url)) = (&status.lifecycle, &status.url) else {
                return;
            };
            (url.clone(), status.changes)
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
                if status.changes != asked || same {
                    return;
                }
                shared.publish(status, Lifecycle::Ready { agent });
            });
    }

    pub fn state(&self) -> Lifecycle {
        self.shared.lock().lifecycle.clone()
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
    if let Err(reason) = init(config) {
        return failed(reason);
    }
    let mut port = None;
    let mut port_tries = 0;
    loop {
        let port_now = match port.or(config.port) {
            Some(port) => port,
            None => match free_port() {
                Ok(port) => port,
                Err(e) => return failed(format!("Couldn't find a free port: {e}")),
            },
        };
        let (mut child, tail) = match spawn(shared, port_now) {
            Ok(spawned) => spawned,
            Err(reason) => return failed(reason),
        };
        shared.starts.fetch_add(1, Ordering::SeqCst);
        {
            let mut status = shared.lock();
            if status.stopping {
                // Stopped while it was being spawned: end it here.
                let _ = child.kill();
                let _ = child.wait();
                return stopped_by_us();
            }
            status.stdin = child.stdin.take();
            status.child = Some(child);
            status.url = Some(format!("http://127.0.0.1:{port_now}"));
        }
        let ended = watch(shared, port_now, &tail);
        let code = |status: &ExitStatus| status.code();
        match ended {
            Ended::Stopped => return stopped_by_us(),
            Ended::Timeout => {
                return failed(format!(
                    "It didn't respond within {} seconds.",
                    config.ready_timeout.as_secs()
                ))
            }
            Ended::Early(exit) | Ended::Late(exit) if code(&exit) == Some(EXIT_RESTART) => {
                port = Some(port_now);
            }
            Ended::Early(exit) => match code(&exit) {
                Some(EXIT_PORT_TAKEN) if config.port.is_none() && port_tries < 2 => {
                    port_tries += 1;
                    port = None;
                }
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

fn stopped_by_us() -> Lifecycle {
    Lifecycle::Failed {
        reason: "It was stopped.".into(),
        stopped: true,
    }
}

/// `init` a data folder that is missing or empty. One that has anything in
/// it is left as it is: the executor migrates its own.
fn init(config: &SupervisorConfig) -> Result<(), String> {
    let empty = std::fs::read_dir(&config.data_dir)
        .map(|mut entries| entries.next().is_none())
        .unwrap_or(true);
    if !empty {
        return Ok(());
    }
    let mut cmd = Command::new(&config.binary);
    cmd.arg("init").arg("--data-path").arg(&config.data_dir);
    if let Some(seed) = &config.seed {
        cmd.arg("--network-bootstrap-seed").arg(seed);
    }
    let status = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Couldn't run {}: {e}", config.binary.display()))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "Couldn't prepare its data folder ({}).",
            describe(&status)
        ))
    }
}

type Tail = (Arc<Mutex<VecDeque<String>>>, mpsc::Receiver<()>);

fn spawn(shared: &Shared, port: u16) -> Result<(Child, Tail), String> {
    let config = &shared.config;
    let mut child = Command::new(&config.binary)
        .arg("run")
        .arg("--app-data-path")
        .arg(&config.data_dir)
        .args(["--port", &port.to_string()])
        .args(["--watch-stdin", "true"])
        .args(["--exit-with-parent", "true"])
        .args(["--run-dapp-server", "false"])
        .args(&config.extra_args)
        .env("AD4M_ADMIN_CREDENTIAL", &shared.admin)
        .env_remove("AD4M_INSECURE_NO_ADMIN_CREDENTIAL")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't run {}: {e}", config.binary.display()))?;
    let lines = Arc::new(Mutex::new(VecDeque::new()));
    let (closed_tx, closed_rx) = mpsc::channel();
    if let Some(stderr) = child.stderr.take() {
        let kept = lines.clone();
        let _ = std::thread::Builder::new()
            .name("we-executor-log".into())
            .spawn(move || {
                for line in BufReader::new(stderr).lines() {
                    let Ok(line) = line else { break };
                    if line.trim().is_empty() {
                        continue;
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
    Ok((child, (lines, closed_rx)))
}

/// Wait for the child to be ready, then for it to end.
fn watch(shared: &Shared, port: u16, tail: &Tail) -> Ended {
    let deadline = Instant::now() + shared.config.ready_timeout;
    let mut ready = false;
    loop {
        if let Some(ended) = exited(shared, ready, tail) {
            return ended;
        }
        if !ready {
            if healthy(port) {
                // Asked again after the answer: another executor on the
                // port answers while this one exits (80, the port taken).
                if let Some(ended) = exited(shared, false, tail) {
                    return ended;
                }
                ready = true;
                let url = format!("http://127.0.0.1:{port}");
                let agent = shared.reader.read(&url, &shared.admin).ok().flatten();
                let status = shared.lock();
                if !status.stopping {
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
    let _ = tail.1.recv_timeout(Duration::from_secs(1));
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
    let lines = tail.0.lock().unwrap_or_else(|p| p.into_inner());
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

fn free_port() -> std::io::Result<u16> {
    Ok(std::net::TcpListener::bind("127.0.0.1:0")?
        .local_addr()?
        .port())
}

/// 32 random bytes as hex.
fn fresh_secret() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("the OS gives random bytes");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
