//! This computer's executor, when the app runs it (tests-first stub).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

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
    pub binary: PathBuf,
    pub data_dir: PathBuf,
    pub seed: Option<PathBuf>,
    pub port: Option<u16>,
    pub admin_credential: Option<String>,
    pub extra_args: Vec<String>,
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

/// Reads the agent's state with the admin credential.
pub trait AgentReader: Send + Sync {
    fn read(&self, url: &str, admin: &str) -> Result<Option<Agent>, String>;
}

/// The agent's state from `agent.status`'s two flags.
pub fn agent_from_status(is_initialized: bool, is_unlocked: bool) -> Option<Agent> {
    let _ = (is_initialized, is_unlocked);
    None
}

pub struct Supervisor {
    _config: SupervisorConfig,
}

impl Supervisor {
    pub fn new(config: SupervisorConfig, handle: tokio::runtime::Handle) -> Self {
        let _ = handle;
        Self { _config: config }
    }

    pub fn with_reader(config: SupervisorConfig, reader: Arc<dyn AgentReader>) -> Self {
        let _ = reader;
        Self { _config: config }
    }

    pub fn set_waker(&self, waker: Arc<dyn Fn() + Send + Sync>) {
        let _ = waker;
    }

    pub fn start(&self) -> bool {
        false
    }

    pub fn stop(&self) {}

    pub fn refresh(&self) {}

    pub fn state(&self) -> Lifecycle {
        Lifecycle::Starting
    }

    pub fn changes(&self) -> u64 {
        0
    }

    pub fn url(&self) -> Option<String> {
        None
    }

    pub fn starts(&self) -> u64 {
        0
    }

    pub fn pid(&self) -> Option<u32> {
        None
    }
}
