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
//!
//! [`ConnectSettings::scope`] picks the grant: read-only (agent and
//! perspective READ, E7), or that plus perspective UPDATE on one perspective
//! (`--write --space <uuid>`, E11), asked for as a separate app so neither
//! token stands in for the other. See [`app_info`].
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use ad4m_client::connect::{
    normalize_base_url, Ad4mConnect, AppInfo, AuthState, ConnectError, ConnectOptions,
    ConnectPrompts, ConnectStatus, ExecutorIo, WsIo,
};
use ad4m_client::types::{CapabilityInput, ResourceInput};
use ad4m_client::ws_rpc::WsRpcClient;

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
    /// The flow stopped. `kind` says why, as a type; `reason` is the
    /// sentence to show and is never read to decide anything.
    Failed { kind: FailureKind, reason: String },
}

/// Why a flow stopped. Decided from the error's type before it is turned
/// into words, so a reason that quotes "connection refused" from an
/// executor's refusal is still a refusal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureKind {
    /// Nothing answered: no executor at the address, or the socket of an
    /// open session went away and did not come back.
    Unreachable,
    /// Something answered at the address, but not as an AD4M executor.
    NotAnExecutor,
    /// The executor answered and refused this app: credentials not
    /// accepted, or a grant removed while the session was open.
    Refused,
    /// Anything else (a transport the flow will not use, a token store it
    /// cannot write).
    Other,
}

/// Which grant this window asks for.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum GrantScope {
    #[default]
    ReadOnly,
    /// Read everything, change one perspective.
    Write { space: String },
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
    /// The grant to ask for: read-only (E7) or read plus one space (E11).
    pub scope: GrantScope,
}

/// The app as the capability request names it. Two grants, two apps:
///
/// **Read-only** (`--connect`, E7), asking for what a read-only renderer
/// uses and nothing else (Lal F1):
///
/// - `agent` READ: `agent.get` (who `me` is);
/// - `perspective` READ: `perspective.all` for the picker, and
///   `perspective.modelQuery` / `modelSubscribe` / `disposeQuery`, which
///   the executor guards with perspective READ (not SUBSCRIBE).
///
/// Not `neighbourhood` READ, although `neighbourhood.otherAgents` wants it:
/// the executor also lets that capability call `neighbourhood.join`, which
/// a read-only app must not be able to do. `spaceStore.memberDids` falls
/// back to the agent alone when the executor refuses it.
///
/// **Writes** (`--connect --write --space <uuid>`, E11): the same, plus
/// `perspective` UPDATE on that one perspective, which is what the
/// validated write RPC (`perspective.instance*`) is guarded by. A separate
/// app name, so the token store (keyed by URL and app name) never hands
/// the read-only window a write token or the other way round.
pub fn app_info(scope: &GrantScope) -> AppInfo {
    match scope {
        GrantScope::ReadOnly => AppInfo::new(
            "WE (Rust renderer)",
            "Reads your spaces to render them natively. Read-only.",
            "https://github.com/coasys/we",
        )
        .capabilities(read_only_capabilities()),
        GrantScope::Write { space } => AppInfo::new(
            "WE (Rust renderer, writes)",
            format!("Renders your spaces natively and makes changes in one space: {space}."),
            "https://github.com/coasys/we",
        )
        .capabilities(write_capabilities(space)),
    }
}

/// The grant [`app_info`] asks for.
pub fn read_only_capabilities() -> Vec<CapabilityInput> {
    ["agent", "perspective"]
        .into_iter()
        .map(|domain| CapabilityInput {
            can: vec!["READ".to_string()],
            with: ResourceInput {
                domain: domain.to_string(),
                pointers: vec!["*".to_string()],
            },
        })
        .collect()
}

/// The write grant: [`read_only_capabilities`] plus perspective UPDATE on
/// `space` alone. No neighbourhood, no perspective CREATE or DELETE, no `*`
/// UPDATE.
pub fn write_capabilities(space: &str) -> Vec<CapabilityInput> {
    let mut caps = read_only_capabilities();
    caps.push(CapabilityInput {
        can: vec!["UPDATE".to_string()],
        with: ResourceInput {
            domain: "perspective".to_string(),
            pointers: vec![space.to_string()],
        },
    });
    caps
}

/// Which grant a stored token for an executor was minted under — kept
/// beside `ad4m-connect`'s token store, because the token itself carries no
/// capabilities and there is no call that reads an app's own grant. A
/// stored token without a current record came from an earlier build that
/// asked for `*` on `*`, or (for the write app) for another space: it is
/// dropped and the grant asked for again.
const GRANT_FILE: &str = "we-renderer-grants.json";

/// What the record says about a grant: `read-only-1`, or `write-1:<uuid>`.
fn grant_tag(scope: &GrantScope) -> String {
    match scope {
        GrantScope::ReadOnly => "read-only-1".to_string(),
        GrantScope::Write { space } => format!("write-1:{space}"),
    }
}

/// Where the record keeps it: the URL for the read-only app,
/// `<url>#writes` for the write app.
fn grant_key(url: &str, scope: &GrantScope) -> String {
    match scope {
        GrantScope::ReadOnly => url.to_string(),
        GrantScope::Write { .. } => format!("{url}#writes"),
    }
}

fn grant_path(settings: &ConnectSettings) -> PathBuf {
    settings
        .token_dir
        .clone()
        .unwrap_or_else(ad4m_client::connect::default_token_dir)
        .join(GRANT_FILE)
}

fn grants(path: &std::path::Path) -> serde_json::Map<String, serde_json::Value> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn grant_is_current(path: &std::path::Path, url: &str, scope: &GrantScope) -> bool {
    grants(path)
        .get(&grant_key(url, scope))
        .and_then(|v| v.as_str())
        == Some(grant_tag(scope).as_str())
}

fn record_grant(path: &std::path::Path, url: &str, scope: &GrantScope) {
    let mut all = grants(path);
    all.insert(
        grant_key(url, scope),
        serde_json::Value::from(grant_tag(scope)),
    );
    let write = || -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::Value::Object(all).to_string())?;
        std::fs::rename(&tmp, path)
    };
    if let Err(e) = write() {
        log::warn!(
            "we-ad4m: could not record the grant for {}: {e}",
            redact_url(url)
        );
    }
}

/// An endpoint as it may be shown or logged: scheme, host, port and path,
/// without userinfo, query or fragment (Lal P3). An executor's credential
/// is its token, never part of its URL.
pub fn redact_url(url: &str) -> String {
    let (scheme, rest) = match url.split_once("://") {
        Some((s, r)) => (Some(s), r),
        None => (None, url),
    };
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(end);
    let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    let path = &tail[..tail.find(['?', '#']).unwrap_or(tail.len())];
    match scheme {
        Some(s) => format!("{s}://{host}{path}"),
        None => format!("{host}{path}"),
    }
}

/// `text` with every URL in it redacted — for messages that quote one.
pub fn scrub(text: &str) -> String {
    text.split(' ')
        .map(|word| {
            if word.contains("://") {
                redact_url(word)
            } else {
                word.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

type Wake = Arc<dyn Fn() + Send + Sync>;

struct Shared {
    phase: Mutex<ConnectPhase>,
    connection: Mutex<Option<Connection>>,
    wake: Wake,
}

impl Shared {
    fn set(&self, phase: ConnectPhase) {
        // Whatever the flow shows, no endpoint in it carries credentials.
        let phase = match phase {
            ConnectPhase::Connected { url } => ConnectPhase::Connected {
                url: redact_url(&url),
            },
            ConnectPhase::Locked { url } => ConnectPhase::Locked {
                url: redact_url(&url),
            },
            ConnectPhase::Failed { kind, reason } => ConnectPhase::Failed {
                kind,
                reason: scrub(&reason),
            },
            other => other,
        };
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
                kind: FailureKind::Other,
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
    /// The user was asked something: the token came from this flow.
    asked: bool,
}

impl UiPrompts {
    async fn ask(&mut self, ask: Ask) -> anyhow::Result<String> {
        self.asked = true;
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

/// The transport `ad4m-connect` dials through. With an explicit
/// `--executor-url`, it refuses every other candidate before any request
/// leaves the machine (Lal F2): `ad4m-connect` still lists the remembered
/// URL, the launcher's port file and port 12000 after the explicit one, and
/// takes the first that answers — so a URL that is down would otherwise
/// quietly become a different executor.
struct Io {
    inner: WsIo,
    only: Option<String>,
}

impl Io {
    fn allowed(&self, base_url: &str) -> anyhow::Result<()> {
        match &self.only {
            Some(only) if normalize_base_url(base_url) != *only => Err(anyhow::anyhow!(
                "not the executor named by --executor-url ({only})"
            )),
            _ => Ok(()),
        }
    }
}

impl ExecutorIo for Io {
    type Rpc = Arc<WsRpcClient>;

    async fn healthy<'a>(&'a self, base_url: &'a str) -> anyhow::Result<()> {
        self.allowed(base_url)?;
        self.inner.healthy(base_url).await
    }

    async fn rpc<'a>(&'a self, base_url: &'a str, token: &'a str) -> anyhow::Result<Self::Rpc> {
        self.allowed(base_url)?;
        self.inner.rpc(base_url, token).await
    }
}

async fn run(
    shared: Arc<Shared>,
    settings: ConnectSettings,
    answers: tokio::sync::mpsc::UnboundedReceiver<String>,
    handle: tokio::runtime::Handle,
) {
    let grant_file = grant_path(&settings);
    let scope = settings.scope.clone();
    let mut opts = ConnectOptions::new(app_info(&scope));
    // Userinfo, query and fragment mean nothing to an executor (the token is
    // the credential), and kept they would ride into every message and log
    // line `ad4m-connect` prints — so they never reach it.
    opts.url = settings.url.as_deref().map(|url| {
        let bare = redact_url(url);
        if bare != url {
            log::warn!("we-ad4m: --executor-url: userinfo, query and fragment ignored ({bare})");
        }
        bare
    });
    opts.email = settings.email;
    opts.token_dir = settings.token_dir;
    opts.executor_port_file = settings.port_file;
    let io = Io {
        inner: WsIo::new(),
        only: opts.url.as_deref().map(normalize_base_url),
    };
    let only = io.only.clone();
    let failed = |e: &anyhow::Error| ConnectPhase::Failed {
        kind: failure_kind(e, false),
        reason: reason_for(e, only.as_deref()),
    };
    let mut session = match Ad4mConnect::with_io(opts, io) {
        Ok(s) => s,
        Err(e) => return shared.set(failed(&e)),
    };
    let mut prompts = UiPrompts {
        shared: shared.clone(),
        answers,
        asked: false,
    };
    let mut state = match session.connect(&mut prompts).await {
        Ok(state) => state,
        Err(e) => return shared.set(failed(&e)),
    };
    let mut url = session.url().unwrap_or_default().to_string();
    let app = app_info(&scope).name;
    let stored = |s: &Ad4mConnect<Io>, url: &str| s.store().token(url, &app).ok().flatten();
    // A stored token this build did not ask for may hold another grant (a
    // broader one, or the write grant for another space): drop it and ask
    // for the one this window wants.
    if state == AuthState::Authenticated
        && !prompts.asked
        && stored(&session, &url).is_some()
        && !grant_is_current(&grant_file, &url, &scope)
    {
        log::warn!(
            "we-ad4m: the stored token for {} is not for the grant this window asks ({}); asking again",
            redact_url(&url),
            grant_tag(&scope)
        );
        if let Err(e) = session.disconnect().await {
            return shared.set(failed(&e));
        }
        state = match session.connect(&mut prompts).await {
            Ok(state) => state,
            Err(e) => return shared.set(failed(&e)),
        };
        url = session.url().unwrap_or_default().to_string();
    }
    if prompts.asked && state != AuthState::Unauthenticated && stored(&session, &url).is_some() {
        record_grant(&grant_file, &url, &scope);
    }
    match state {
        AuthState::Authenticated => {
            let Some(ws) = session.rpc().cloned() else {
                return shared.set(ConnectPhase::Failed {
                    kind: FailureKind::Other,
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
                        kind: FailureKind::Other,
                        reason: "the executor refused this app's token — connect again".into(),
                    });
                    break;
                }
            }
            std::future::pending::<()>().await;
        }
        AuthState::Locked => shared.set(ConnectPhase::Locked { url }),
        AuthState::Unauthenticated => shared.set(ConnectPhase::Failed {
            kind: FailureKind::Other,
            reason: "the executor did not accept this app".into(),
        }),
    }
}

/// The kind of a failed connect, from the error's type. `answered` is
/// whether something took a TCP connection at an address that failed the
/// executor health check.
///
/// Slice 2 behaviour (stub for the failing tests): not computed.
fn failure_kind(_e: &anyhow::Error, _answered: bool) -> FailureKind {
    FailureKind::Other
}

/// The sentence for a failed connect; `only` is the explicit URL, if any.
fn reason_for(e: &anyhow::Error, only: Option<&str>) -> String {
    match e.downcast_ref::<ConnectError>() {
        Some(ConnectError::ExecutorNotFound { .. }) if only.is_some() => format!(
            "The executor at {} does not answer. Start it, or leave out --executor-url to look for one.",
            only.unwrap_or_default()
        ),
        Some(ConnectError::ExecutorNotFound { tried }) => format!(
            "No AD4M executor found. Start the AD4M launcher, or pass --executor-url. Tried: {}",
            tried.join(", ")
        ),
        Some(other) => other.to_string(),
        None => format!("{e:#}"),
    }
}

#[cfg(test)]
mod redact_tests {
    use super::*;

    #[test]
    fn redact_url_keeps_scheme_host_port_and_path_only() {
        assert_eq!(
            redact_url("https://alice:pw@example.org:443/ad4m/?token=x#f"),
            "https://example.org:443/ad4m/"
        );
        assert_eq!(
            redact_url("http://127.0.0.1:12000"),
            "http://127.0.0.1:12000"
        );
        assert_eq!(redact_url("ws://u@h/p?q"), "ws://h/p");
        assert_eq!(redact_url("h:1?q=1"), "h:1");
    }

    #[test]
    fn scrub_redacts_every_url_in_a_message() {
        assert_eq!(
            scrub("WebSocket to ws://a:b@h:1/?t=x failed; tried http://c@d:2."),
            "WebSocket to ws://h:1/ failed; tried http://d:2."
        );
    }
}

#[cfg(test)]
mod grant_tests {
    use super::*;

    #[test]
    fn grant_tag_and_key_per_scope() {
        let write = GrantScope::Write { space: "u".into() };
        assert_eq!(grant_tag(&GrantScope::ReadOnly), "read-only-1");
        assert_eq!(grant_tag(&write), "write-1:u");
        assert_eq!(grant_key("http://h:1", &GrantScope::ReadOnly), "http://h:1");
        assert_eq!(grant_key("http://h:1", &write), "http://h:1#writes");
    }

    #[test]
    fn the_write_grant_is_read_plus_update_on_one_space() {
        let caps = serde_json::to_value(write_capabilities("u")).unwrap();
        assert_eq!(
            caps,
            serde_json::json!([
                { "with": { "domain": "agent", "pointers": ["*"] }, "can": ["READ"] },
                { "with": { "domain": "perspective", "pointers": ["*"] }, "can": ["READ"] },
                { "with": { "domain": "perspective", "pointers": ["u"] }, "can": ["UPDATE"] }
            ])
        );
        let app = app_info(&GrantScope::Write { space: "u".into() });
        assert_eq!(app.name, "WE (Rust renderer, writes)");
        assert_ne!(app.name, app_info(&GrantScope::ReadOnly).name);
    }
}

#[cfg(test)]
mod failure_tests {
    use super::*;

    /// Acceptance (slice 3): failures are typed in the flow, not matched on
    /// the words. Each reason below says the opposite of its type.
    #[test]
    fn the_kind_is_read_from_the_error_type_not_its_words() {
        let refused = anyhow::Error::new(ConnectError::Refused {
            message: "connection refused: no such account".into(),
        });
        assert_eq!(failure_kind(&refused, false), FailureKind::Refused);

        let io = std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "the executor did not accept this app",
        );
        let dropped = anyhow::Error::new(io).context("websocket handshake");
        assert_eq!(failure_kind(&dropped, false), FailureKind::Unreachable);

        let nothing = anyhow::Error::new(ConnectError::ExecutorNotFound {
            tried: vec!["http://127.0.0.1:1".into()],
        });
        assert_eq!(failure_kind(&nothing, false), FailureKind::Unreachable);
        assert_eq!(failure_kind(&nothing, true), FailureKind::NotAnExecutor);

        let insecure = anyhow::Error::new(ConnectError::InsecureTransport {
            url: "http://example.org".into(),
        });
        assert_eq!(failure_kind(&insecure, false), FailureKind::Other);
        assert_eq!(
            failure_kind(&anyhow::anyhow!("does not answer: timed out"), false),
            FailureKind::Other,
            "words alone decide nothing"
        );
    }

    fn ended(flow: &ConnectFlow) -> (FailureKind, String) {
        let start = std::time::Instant::now();
        loop {
            if let ConnectPhase::Failed { kind, reason } = flow.phase() {
                return (kind, reason);
            }
            assert!(start.elapsed().as_secs() < 30, "the flow did not end");
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }

    fn settings_for(url: String, dir: &std::path::Path) -> ConnectSettings {
        ConnectSettings {
            url: Some(url),
            token_dir: Some(dir.to_path_buf()),
            port_file: Some(dir.join("no-port-file")),
            ..ConnectSettings::default()
        }
    }

    /// Acceptance (slice 3): an executor that is not running is offline.
    #[test]
    fn a_closed_port_is_unreachable() {
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let dir = tempfile::tempdir().unwrap();
        let rt = crate::Runtime::new().unwrap();
        let flow = ConnectFlow::start(
            &rt.handle(),
            settings_for(format!("http://127.0.0.1:{port}"), dir.path()),
            || {},
        );
        let (kind, reason) = ended(&flow);
        assert_eq!(kind, FailureKind::Unreachable, "{reason}");
    }

    /// Something answers on the port, but not as an executor: that is not
    /// "offline", and a retry will not change it.
    #[test]
    fn a_service_that_is_not_an_executor_is_not_unreachable() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let mut buf = [0u8; 2048];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
            }
        });
        let dir = tempfile::tempdir().unwrap();
        let rt = crate::Runtime::new().unwrap();
        let flow = ConnectFlow::start(
            &rt.handle(),
            settings_for(format!("http://127.0.0.1:{port}"), dir.path()),
            || {},
        );
        let (kind, reason) = ended(&flow);
        assert_eq!(kind, FailureKind::NotAnExecutor, "{reason}");
        assert!(reason.contains(&port.to_string()), "{reason}");
    }
}
