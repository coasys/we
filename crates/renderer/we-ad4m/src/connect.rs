//! [`ConnectFlow`]: `ad4m-connect` (A5) run for a frame-driven UI.
//!
//! The flow runs on the adapter's runtime; the UI reads [`ConnectFlow::phase`]
//! every frame and answers what it is asked through
//! [`ConnectFlow::answer`]. Every phase change calls the waker, so a sleeping
//! window repaints when there is something new to show.
//!
//! What the user sees, in order:
//!
//! 1. **Searching** — the explicit `--executor-url`, else the launcher's port
//!    file (`~/.ad4m/executor-port`), else the remembered URL, else the
//!    default port.
//! 2. A stored token for this executor and app is tried first; when it holds,
//!    the flow ends **Connected** without asking anything.
//! 3. Otherwise, on a single-user executor, a capability request goes out and
//!    the phase is **Asking { CapabilityCode }**: the user approves the
//!    request in the AD4M launcher, which shows a 6-digit code, and types it
//!    here. The token is stored, so the next run connects without asking.
//! 4. On a multi-user executor the phase asks for an email, then the emailed
//!    code (or a password).
//!
//! An executor with no admin credential lets a loopback caller in as the
//! operator: the flow ends Connected at step 2 with nothing stored.
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use ad4m_client::connect::{
    Ad4mConnect, AppInfo, AuthState, ConnectError, ConnectOptions, ConnectPrompts, ConnectStatus,
};

use crate::connection::Connection;

/// What the flow needs from the user right now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ask {
    /// Approve request `request_id` in the AD4M launcher and type its code.
    CapabilityCode { request_id: String },
    /// A multi-user executor: which account.
    Email,
    /// The code emailed to `email`.
    EmailCode { email: String },
    /// A password for `email` — a new account's when `new_account`.
    Password { email: String, new_account: bool },
}

/// Where the flow is — what the connect screen draws.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectPhase {
    /// Looking for the executor and opening the socket.
    Searching,
    /// Waiting for the user — see [`Ask`]. `note` is the last status line
    /// ("that code did not take").
    Asking { ask: Ask, note: Option<String> },
    /// An answer is on its way to the executor.
    Checking,
    /// The executor accepted this app; take the connection.
    Connected { url: String },
    /// The executor's wallet is locked: unlock it in the launcher, then retry.
    Locked { url: String },
    /// The flow stopped. `reason` is the sentence to show.
    Failed { reason: String },
}

/// What to connect to and as whom.
#[derive(Debug, Clone, Default)]
pub struct ConnectSettings {
    /// `--executor-url`: wins over discovery.
    pub url: Option<String>,
    /// A multi-user sign-in email, when known up front.
    pub email: Option<String>,
    /// Where tokens live; `None` is `ad4m-connect`'s default directory.
    pub token_dir: Option<PathBuf>,
    /// The launcher's port file; `None` is `~/.ad4m/executor-port`.
    pub port_file: Option<PathBuf>,
}

/// The app as the capability request names it.
pub fn app_info() -> AppInfo {
    AppInfo::new(
        "WE (Rust renderer)",
        "Reads your spaces to render them natively. Read-only.",
        "https://github.com/coasys/we",
    )
}

type Wake = Arc<dyn Fn() + Send + Sync>;

struct Shared {
    phase: Mutex<ConnectPhase>,
    connection: Mutex<Option<Connection>>,
    wake: Wake,
}

impl Shared {
    fn set(&self, phase: ConnectPhase) {
        if let Ok(mut p) = self.phase.lock() {
            *p = phase;
        }
        (self.wake)();
    }

    fn note(&self, note: String) {
        if let Ok(mut p) = self.phase.lock() {
            if let ConnectPhase::Asking { note: n, .. } = &mut *p {
                *n = Some(note);
            }
        }
        (self.wake)();
    }
}

/// A running connect flow. Drop it to abandon the flow.
pub struct ConnectFlow {
    shared: Arc<Shared>,
    answers: tokio::sync::mpsc::UnboundedSender<String>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for ConnectFlow {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl ConnectFlow {
    /// Start the flow on `handle`. `wake` is called on every phase change.
    pub fn start(
        handle: &tokio::runtime::Handle,
        settings: ConnectSettings,
        wake: impl Fn() + Send + Sync + 'static,
    ) -> Self {
        let shared = Arc::new(Shared {
            phase: Mutex::new(ConnectPhase::Searching),
            connection: Mutex::new(None),
            wake: Arc::new(wake),
        });
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let task = handle.spawn(run(shared.clone(), settings, rx, handle.clone()));
        Self {
            shared,
            answers: tx,
            task,
        }
    }

    /// Where the flow is now.
    pub fn phase(&self) -> ConnectPhase {
        self.shared
            .phase
            .lock()
            .map(|p| p.clone())
            .unwrap_or(ConnectPhase::Failed {
                reason: "connect state poisoned".into(),
            })
    }

    /// Answer the current [`Ask`] — the code, email or password typed.
    pub fn answer(&self, text: impl Into<String>) {
        let _ = self.answers.send(text.into());
    }

    /// The connection, once [`ConnectPhase::Connected`] — taken once.
    pub fn take_connection(&self) -> Option<Connection> {
        self.shared.connection.lock().ok()?.take()
    }
}

/// The prompts the flow asks through: each sets the phase, wakes the UI and
/// waits for the next answer.
struct UiPrompts {
    shared: Arc<Shared>,
    answers: tokio::sync::mpsc::UnboundedReceiver<String>,
}

impl UiPrompts {
    async fn ask(&mut self, ask: Ask) -> anyhow::Result<String> {
        self.shared.set(ConnectPhase::Asking { ask, note: None });
        let answer = self
            .answers
            .recv()
            .await
            .ok_or_else(|| anyhow::anyhow!("cancelled"))?;
        self.shared.set(ConnectPhase::Checking);
        Ok(answer.trim().to_string())
    }
}

impl ConnectPrompts for UiPrompts {
    fn capability_code<'a>(
        &'a mut self,
        request_id: &'a str,
        _app: &'a AppInfo,
    ) -> impl Future<Output = anyhow::Result<String>> + Send + 'a {
        self.ask(Ask::CapabilityCode {
            request_id: request_id.to_string(),
        })
    }

    fn email<'a>(&'a mut self) -> impl Future<Output = anyhow::Result<String>> + Send + 'a {
        self.ask(Ask::Email)
    }

    fn email_code<'a>(
        &'a mut self,
        email: &'a str,
    ) -> impl Future<Output = anyhow::Result<String>> + Send + 'a {
        self.ask(Ask::EmailCode {
            email: email.to_string(),
        })
    }

    fn password<'a>(
        &'a mut self,
        email: &'a str,
        new_account: bool,
    ) -> impl Future<Output = anyhow::Result<String>> + Send + 'a {
        self.ask(Ask::Password {
            email: email.to_string(),
            new_account,
        })
    }

    fn status(&mut self, status: ConnectStatus) {
        match status {
            ConnectStatus::Connecting => self.shared.set(ConnectPhase::Searching),
            ConnectStatus::WaitingForApproval { .. }
            | ConnectStatus::WaitingForEmailCode { .. } => {}
            ConnectStatus::CodeRejected => self
                .shared
                .note("That code did not take — try again.".into()),
            ConnectStatus::RequestExpired => self.shared.note(
                "The request expired; a new one was sent — approve it in the launcher.".into(),
            ),
            ConnectStatus::EmailCodeExpired => self
                .shared
                .note("That code is no longer valid; a new one was emailed.".into()),
        }
    }
}

async fn run(
    shared: Arc<Shared>,
    settings: ConnectSettings,
    answers: tokio::sync::mpsc::UnboundedReceiver<String>,
    handle: tokio::runtime::Handle,
) {
    let mut opts = ConnectOptions::new(app_info());
    opts.url = settings.url;
    opts.email = settings.email;
    opts.token_dir = settings.token_dir;
    opts.executor_port_file = settings.port_file;
    let mut session = match Ad4mConnect::new(opts) {
        Ok(s) => s,
        Err(e) => return shared.set(ConnectPhase::Failed { reason: reason(&e) }),
    };
    let mut prompts = UiPrompts {
        shared: shared.clone(),
        answers,
    };
    let state = match session.connect(&mut prompts).await {
        Ok(state) => state,
        Err(e) => return shared.set(ConnectPhase::Failed { reason: reason(&e) }),
    };
    let url = session.url().unwrap_or_default().to_string();
    match state {
        AuthState::Authenticated => {
            let Some(ws) = session.rpc().cloned() else {
                return shared.set(ConnectPhase::Failed {
                    reason: "connected without a socket".into(),
                });
            };
            if let Ok(mut c) = shared.connection.lock() {
                *c = Some(Connection::new(handle, ws));
            }
            shared.set(ConnectPhase::Connected { url });
            // The session owns the refusal watch and the token's lifetime:
            // keep it until the flow is dropped (the app's connection lives
            // as long as the flow's owner keeps it).
            let mut watch = session.watch_state();
            while watch.changed().await.is_ok() {
                if *watch.borrow() == AuthState::Unauthenticated {
                    shared.set(ConnectPhase::Failed {
                        reason: "the executor refused this app's token — connect again".into(),
                    });
                    break;
                }
            }
            std::future::pending::<()>().await;
        }
        AuthState::Locked => shared.set(ConnectPhase::Locked { url }),
        AuthState::Unauthenticated => shared.set(ConnectPhase::Failed {
            reason: "the executor did not accept this app".into(),
        }),
    }
}

/// The sentence for a failed connect.
fn reason(e: &anyhow::Error) -> String {
    match e.downcast_ref::<ConnectError>() {
        Some(ConnectError::ExecutorNotFound { tried }) => format!(
            "No AD4M executor found. Start the AD4M launcher, or pass --executor-url. Tried: {}",
            tried.join(", ")
        ),
        Some(other) => other.to_string(),
        None => format!("{e:#}"),
    }
}
