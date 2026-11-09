//! The executor as a child process, supervised here — Electron's model, not Tauri's.
//!
//! Tauri links the executor into its own process, so switching accounts or applying settings
//! relaunches the whole app (the executor's shutdown ends in `std::process::exit`). A child can be
//! stopped and started again under one window: this shell keeps the port and the admin credential
//! for its whole life, so the custody service's `ExecutorAddress` stays right across restarts, and
//! only the page reloads.
//!
//! Started as Electron starts it (`apps/we-electron/electron/main.js`): `init` when the data path
//! has no seed, then `run` with the credential in the environment rather than on the command line,
//! `AD4M_EXIT_WITH_PARENT` so it ends with this process however that ends, and the user's log
//! levels as `RUST_LOG` unless one was inherited. Stopped with SIGTERM, then SIGKILL to the group.
//!
//! Its state is read over the executor's own RPC (`ad4m-client`): the version it reports, and the
//! agent's DID and lock state.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::accounts::ExecutorSettings;
use crate::executor_log::ExecutorLog;

/// Everything one start needs.
#[derive(Clone, Debug)]
pub struct Launch {
    pub binary: PathBuf,
    pub data_path: PathBuf,
    pub port: u16,
    pub credential: String,
    pub settings: ExecutorSettings,
    pub identity_store_url: Option<String>,
    pub identity_store_keys: Option<String>,
}

/// The `run` arguments. The credential is never among them: an argument is visible to every user
/// of the computer through `ps`.
pub fn run_args(launch: &Launch) -> Vec<String> {
    let mut args = vec![
        "run".to_string(),
        "--port".into(),
        launch.port.to_string(),
        "--app-data-path".into(),
        launch.data_path.display().to_string(),
        "--run-dapp-server".into(),
        "false".into(),
        "--connect-holochain".into(),
        "true".into(),
    ];
    if launch.settings.mcp_enabled {
        args.extend([
            "--enable-mcp".into(),
            "true".into(),
            "--mcp-port".into(),
            launch.settings.mcp_port.to_string(),
        ]);
    }
    args
}

/// The variables set on the child, given what this process inherited (`inherited`). The same as
/// Electron's `executorEnv` + `executorSpawnEnv`: an inherited `AD4M_EXIT_WITH_PARENT` or
/// `RUST_LOG` wins; the credential always comes from this process.
pub fn spawn_env(launch: &Launch, inherited: impl Fn(&str) -> Option<String>) -> Vec<(String, String)> {
    let mut env = vec![("AD4M_ADMIN_CREDENTIAL".to_string(), launch.credential.clone())];
    if inherited("AD4M_EXIT_WITH_PARENT").is_none() {
        env.push(("AD4M_EXIT_WITH_PARENT".into(), "true".into()));
    }
    if inherited("RUST_LOG").is_none() && !launch.settings.log_levels.is_empty() {
        let mut levels: Vec<_> = launch.settings.log_levels.iter().collect();
        levels.sort();
        let rust_log = levels
            .iter()
            .map(|(krate, level)| format!("{krate}={level}"))
            .collect::<Vec<_>>()
            .join(",");
        env.push(("RUST_LOG".into(), rust_log));
    }
    if let Some(url) = &launch.identity_store_url {
        env.push(("AD4M_IDENTITY_STORE_URL".into(), url.clone()));
    }
    if let Some(keys) = &launch.identity_store_keys {
        env.push(("AD4M_IDENTITY_STORE_KEYS".into(), keys.clone()));
    }
    env
}

/// Whether `data_path` still needs `init`: the seed the executor writes there is missing.
pub fn needs_init(data_path: &Path) -> bool {
    !data_path.join("mainnet_seed.seed").exists()
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    #[default]
    Stopped,
    Initialising,
    Starting,
    Running,
    Stopping,
    /// It ended without being asked to; the code when it had one.
    Exited(Option<i32>),
    Failed(String),
}

/// What the launcher draws, and what `executor_status` answers.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub phase: Phase,
    pub pid: Option<u32>,
    pub port: u16,
    pub data_path: String,
    pub binary: String,
    pub log_path: Option<String>,
    pub version: Option<String>,
    pub commit: Option<String>,
    pub did: Option<String>,
    pub initialized: Option<bool>,
    pub unlocked: Option<bool>,
    pub started_at_ms: Option<u128>,
    pub ready_after_ms: Option<u128>,
}

struct State {
    child: Option<Child>,
    snapshot: Snapshot,
    /// Bumped on every start and stop, so a watcher from an earlier run stops writing.
    generation: u64,
}

#[derive(Clone)]
pub struct Supervisor {
    state: Arc<Mutex<State>>,
    runtime: tokio::runtime::Handle,
}

impl Supervisor {
    pub fn new(runtime: tokio::runtime::Handle) -> Self {
        Supervisor {
            state: Arc::new(Mutex::new(State {
                child: None,
                snapshot: Snapshot::default(),
                generation: 0,
            })),
            runtime,
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        self.state.lock().expect("executor state").snapshot.clone()
    }

    fn update(&self, generation: u64, change: impl FnOnce(&mut Snapshot)) -> bool {
        let mut state = self.state.lock().expect("executor state");
        if state.generation != generation {
            return false;
        }
        change(&mut state.snapshot);
        true
    }

    /// Starts the executor and resolves once its RPC answers, or with why it did not. Blocks the
    /// calling thread through `init` and the spawn, so call it off the UI thread.
    pub async fn start(&self, launch: Launch) -> Result<(), String> {
        let generation = {
            let mut state = self.state.lock().expect("executor state");
            if state.child.is_some() {
                return Err("the executor is already running".into());
            }
            state.generation += 1;
            state.snapshot = Snapshot {
                phase: Phase::Initialising,
                port: launch.port,
                data_path: launch.data_path.display().to_string(),
                binary: launch.binary.display().to_string(),
                started_at_ms: Some(now_ms()),
                ..Snapshot::default()
            };
            state.generation
        };
        let started = Instant::now();

        let spawned = {
            let launch = launch.clone();
            tokio::task::spawn_blocking(move || spawn(&launch))
                .await
                .map_err(|e| e.to_string())?
        };
        let (child, log) = match spawned {
            Ok(spawned) => spawned,
            Err(why) => {
                self.update(generation, |s| s.phase = Phase::Failed(why.clone()));
                return Err(why);
            }
        };
        let pid = child.id();
        {
            let mut state = self.state.lock().expect("executor state");
            state.child = Some(child);
            state.snapshot.pid = Some(pid);
            state.snapshot.phase = Phase::Starting;
            state.snapshot.log_path = Some(log.path().display().to_string());
        }

        // Ready when its RPC answers `runtime.info`; gone when the process is.
        let url = format!("http://127.0.0.1:{}", launch.port);
        let deadline = Instant::now() + Duration::from_secs(120);
        let mut last_error = String::from("no probe yet");
        loop {
            if let Some(code) = self.exited(generation) {
                let phase = Phase::Exited(code);
                self.update(generation, |s| s.phase = phase.clone());
                return Err(format!("the executor exited while starting ({code:?}); see {}", log.path().display()));
            }
            let answer = probe(&url, &launch.credential).await;
            if let Err(error) = &answer {
                last_error = format!("{error:#}");
            }
            if let Ok(info) = answer {
                let ready = started.elapsed().as_millis();
                log.host(&format!("executor ready after {ready} ms"));
                self.update(generation, |s| {
                    s.phase = Phase::Running;
                    s.version = info.version;
                    s.commit = info.commit;
                    s.did = info.did;
                    s.initialized = Some(info.initialized);
                    s.unlocked = Some(info.unlocked);
                    s.ready_after_ms = Some(ready);
                });
                self.watch(generation, url, launch.credential.clone());
                return Ok(());
            }
            if Instant::now() > deadline {
                let reason = format!("no answer in 120 s (last: {last_error})");
                log.host(&reason);
                self.update(generation, |s| s.phase = Phase::Failed(reason.clone()));
                return Err(format!("the executor did not answer within 120 s (last: {last_error})"));
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    /// The child's exit code if it has ended, taking it out of the state.
    fn exited(&self, generation: u64) -> Option<Option<i32>> {
        let mut state = self.state.lock().expect("executor state");
        if state.generation != generation {
            return None;
        }
        let child = state.child.as_mut()?;
        match child.try_wait() {
            Ok(Some(status)) => {
                state.child = None;
                state.snapshot.pid = None;
                Some(status.code())
            }
            _ => None,
        }
    }

    /// Keeps the snapshot current while this run lasts: the agent's state every two seconds, and
    /// the exit if the process ends on its own.
    fn watch(&self, generation: u64, url: String, credential: String) {
        let this = self.clone();
        self.runtime.spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                if let Some(code) = this.exited(generation) {
                    this.update(generation, |s| s.phase = Phase::Exited(code));
                    return;
                }
                let alive = match probe(&url, &credential).await {
                    Ok(info) => this.update(generation, |s| {
                        if info.version.is_some() {
                            s.version = info.version;
                            s.commit = info.commit;
                        }
                        s.did = info.did;
                        s.initialized = Some(info.initialized);
                        s.unlocked = Some(info.unlocked);
                    }),
                    Err(_) => this.update(generation, |_| {}),
                };
                if !alive {
                    return;
                }
            }
        });
    }

    /// Stops the executor: SIGTERM, up to ten seconds for it to go, then SIGKILL to its group.
    /// Blocks; call it off the UI thread except at quit.
    pub fn stop(&self) {
        let child = {
            let mut state = self.state.lock().expect("executor state");
            state.generation += 1;
            state.snapshot.phase = Phase::Stopping;
            state.child.take()
        };
        if let Some(mut child) = child {
            stop_child(&mut child, Duration::from_secs(10));
        }
        let mut state = self.state.lock().expect("executor state");
        state.snapshot.phase = Phase::Stopped;
        state.snapshot.pid = None;
    }
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// `init` when needed, then the `run` child with its output in this run's log.
fn spawn(launch: &Launch) -> Result<(Child, ExecutorLog), String> {
    std::fs::create_dir_all(&launch.data_path).map_err(|e| format!("data path: {e}"))?;
    let log = ExecutorLog::open(&launch.data_path);
    log.host(&format!("we-gpui: data path {}", launch.data_path.display()));
    log.host(&format!("we-gpui: executor {}", launch.binary.display()));

    if needs_init(&launch.data_path) {
        log.host("we-gpui: no seed in the data path; running `init`");
        let output = Command::new(&launch.binary)
            .args(["init", "--data-path"])
            .arg(&launch.data_path)
            .output()
            .map_err(|e| format!("could not run {} init: {e}", launch.binary.display()))?;
        let mut sink = log.clone();
        let _ = sink.write_all(&output.stdout);
        let _ = sink.write_all(&output.stderr);
        if !output.status.success() {
            return Err(format!("`init` failed ({:?}); see {}", output.status.code(), log.path().display()));
        }
    }

    let mut command = Command::new(&launch.binary);
    command
        .args(run_args(launch))
        .envs(spawn_env(launch, |name| std::env::var(name).ok()))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Its own group, so a stop reaches what it starts (Holochain, lair) as well.
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", launch.binary.display()))?;
    for stream in [
        child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
        child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let mut sink = log.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                let _ = writeln!(sink, "{line}");
            }
        });
    }
    Ok((child, log))
}

#[cfg(unix)]
fn stop_child(child: &mut Child, grace: Duration) {
    let pid = child.id() as libc::pid_t;
    // SAFETY: signalling a pid this process spawned and has not reaped.
    unsafe { libc::kill(pid, libc::SIGTERM) };
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    // SAFETY: the negative pid names the group `spawn` made this child the leader of.
    unsafe { libc::kill(-pid, libc::SIGKILL) };
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(not(unix))]
fn stop_child(child: &mut Child, _grace: Duration) {
    let _ = child.kill();
    let _ = child.wait();
}

pub struct Info {
    pub version: Option<String>,
    pub commit: Option<String>,
    pub did: Option<String>,
    pub initialized: bool,
    pub unlocked: bool,
}

/// The executor's version and its agent's state, over its RPC.
///
/// The executor is ready once its RPC answers `agent.status`, which it does before any agent
/// exists. `runtime.info` answers only once there is an agent (before that it is an RPC error,
/// `Agent not found`), so the version is filled in when it can be.
pub async fn probe(url: &str, credential: &str) -> anyhow::Result<Info> {
    let client = tokio::time::timeout(
        Duration::from_secs(3),
        ad4m_client::Ad4mClient::connect(url.to_string(), credential.to_string()),
    )
    .await??;
    let status = tokio::time::timeout(Duration::from_secs(3), client.agent.status()).await??;
    let info = match tokio::time::timeout(Duration::from_secs(3), client.runtime.info()).await? {
        Ok(info) => Some(info),
        Err(error) if no_agent_yet(&format!("{error:#}")) => None,
        Err(error) => return Err(error),
    };
    Ok(Info {
        version: info.as_ref().map(|i| i.ad4m_executor_version.clone()),
        commit: info.and_then(|i| i.ad4m_executor_commit),
        did: status.did,
        initialized: status.is_initialized,
        unlocked: status.is_unlocked,
    })
}

/// Whether an `agent.status` error means the executor has no agent yet.
fn no_agent_yet(error: &str) -> bool {
    error.contains("Agent not found")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn an_executor_with_no_agent_yet_is_still_up() {
        assert!(no_agent_yet("RPC error 404: Agent not found"));
        assert!(!no_agent_yet("RPC error 401: Unauthorized"));
        assert!(!no_agent_yet("connection refused"));
    }

    fn launch() -> Launch {
        Launch {
            binary: "/bin/ad4m-executor".into(),
            data_path: "/data/ad4m".into(),
            port: 12345,
            credential: "secret".into(),
            settings: ExecutorSettings::default(),
            identity_store_url: None,
            identity_store_keys: None,
        }
    }

    #[test]
    fn run_args_match_electrons_and_never_hold_the_credential() {
        let args = run_args(&launch());
        assert_eq!(
            args,
            [
                "run", "--port", "12345", "--app-data-path", "/data/ad4m", "--run-dapp-server",
                "false", "--connect-holochain", "true"
            ]
        );
        assert!(!args.iter().any(|a| a.contains("secret")));
    }

    #[test]
    fn mcp_is_off_unless_asked_for() {
        let mut l = launch();
        l.settings.mcp_enabled = true;
        l.settings.mcp_port = 3001;
        let args = run_args(&l);
        assert!(args.ends_with(&["--enable-mcp".into(), "true".into(), "--mcp-port".into(), "3001".into()]));
    }

    #[test]
    fn the_env_carries_the_credential_and_exits_with_the_parent() {
        let env: HashMap<_, _> = spawn_env(&launch(), |_| None).into_iter().collect();
        assert_eq!(env["AD4M_ADMIN_CREDENTIAL"], "secret");
        assert_eq!(env["AD4M_EXIT_WITH_PARENT"], "true");
        assert!(!env.contains_key("RUST_LOG"));
    }

    #[test]
    fn chosen_log_levels_become_rust_log_unless_one_is_inherited() {
        let mut l = launch();
        l.settings.log_levels =
            HashMap::from([("rust_executor".into(), "debug".into()), ("holochain".into(), "warn".into())]);
        let env: HashMap<_, _> = spawn_env(&l, |_| None).into_iter().collect();
        assert_eq!(env["RUST_LOG"], "holochain=warn,rust_executor=debug");
        let inherited = |name: &str| (name == "RUST_LOG").then(|| "trace".to_string());
        let env: HashMap<_, _> = spawn_env(&l, inherited).into_iter().collect();
        assert!(!env.contains_key("RUST_LOG"));
    }

    #[test]
    fn an_inherited_exit_with_parent_wins() {
        let inherited = |name: &str| (name == "AD4M_EXIT_WITH_PARENT").then(|| "false".to_string());
        let env: HashMap<_, _> = spawn_env(&launch(), inherited).into_iter().collect();
        assert!(!env.contains_key("AD4M_EXIT_WITH_PARENT"));
    }

    #[test]
    fn the_identity_store_passes_through() {
        let mut l = launch();
        l.identity_store_url = Some("https://store".into());
        l.identity_store_keys = Some("k1,k2".into());
        let env: HashMap<_, _> = spawn_env(&l, |_| None).into_iter().collect();
        assert_eq!(env["AD4M_IDENTITY_STORE_URL"], "https://store");
        assert_eq!(env["AD4M_IDENTITY_STORE_KEYS"], "k1,k2");
    }

    #[test]
    fn init_is_needed_until_the_seed_exists() {
        let dir = tempfile::tempdir().unwrap();
        assert!(needs_init(dir.path()));
        std::fs::write(dir.path().join("mainnet_seed.seed"), "{}").unwrap();
        assert!(!needs_init(dir.path()));
    }

    /// A real child through the real start/stop path: a fake binary that ignores SIGTERM is killed
    /// after the grace period, and one that exits at once is reported as exited.
    #[cfg(unix)]
    #[test]
    fn stop_escalates_to_sigkill() {
        let mut child = Command::new("sh")
            .args(["-c", "trap '' TERM; sleep 30"])
            .spawn()
            .unwrap();
        let started = Instant::now();
        stop_child(&mut child, Duration::from_millis(300));
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(child.try_wait().unwrap().is_some());
    }

    #[cfg(unix)]
    #[test]
    fn a_start_whose_process_exits_fails_with_exited() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("mainnet_seed.seed"), "{}").unwrap();
        let fake = dir.path().join("fake-executor");
        std::fs::write(&fake, "#!/bin/sh\necho started\nexit 3\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();

        let runtime = tokio::runtime::Runtime::new().unwrap();
        let supervisor = Supervisor::new(runtime.handle().clone());
        let mut l = launch();
        l.binary = fake;
        l.data_path = data;
        l.port = crate::config::find_port(14000, 15000).unwrap();
        let result = runtime.block_on(supervisor.start(l));
        assert!(result.unwrap_err().contains("exited while starting"));
        assert_eq!(supervisor.snapshot().phase, Phase::Exited(Some(3)));
    }
}
