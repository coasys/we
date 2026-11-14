//! The custody service as a process of its own, for a host that does not link Rust (the Electron
//! app). The `we-custody` binary is [`main`]'s thin loop over this module.
//!
//! The host talks to it in lines of JSON on stdin and stdout. A request is
//! `{"id": 1, "method": "start", "params": {"step": {"kind": "create"}}}`, and its answer is
//! `{"id": 1, "result": …}` or `{"id": 1, "error": "…"}`; a line that is not a request is answered
//! with `"id": null`. The methods are what the Tauri commands ask of [`CustodyHandle`]:
//!
//! - `publicState` → [`crate::CustodyPublic`]
//! - `start` `{step}` → `{screen, outcome}`: the first [`crate::Screen`] of that step
//! - `step` `{input}` → `{screen, outcome}`: the next screen
//! - `cancel` → `null` once the open step ended and was wiped, or `{screen, outcome}` when it could
//!   not be: the screen to show instead, and the window stays ([`CustodyHandle::cancel`])
//!
//! `outcome` is how the step ended ([`crate::StepOutcome`]) once a screen is its last, else `null`:
//! the host keeps it for the main window, which never sees a screen.
//!
//! Answers go out as they are ready, not in order: a `wait-claim` step can wait minutes while
//! `cancel` and `publicState` are answered. When stdin closes the open step is cancelled and the
//! process exits, so it never outlives its host.
//!
//! The custody credential (the one the executor's `--custody-channel` admits; distinct from the
//! admin credential the main window holds, which the custody channel refuses) is the first line of
//! stdin, before any request: the value, then a newline ([`read_credential`]). It is kept only in
//! memory. Never an argument, which every user of the computer can read through `ps`, and never the
//! environment: a process's environment is a readable file (`/proc/<pid>/environ`; `ps eww` on
//! macOS), and the admin credential the renderer holds can read host files through the executor.
//! `AD4M_CUSTODY_CREDENTIAL` or `AD4M_CUSTODY_CREDENTIAL_FILE` set refuses the start, as it does
//! the executor's. No error here repeats what a request carried: a malformed step input could hold
//! a passphrase.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;

use crate::host::custody_dir;
use crate::service::{
    spawn, CustodyHandle, ExecutorAddress, IdentityStep, Screen, StepInput, StepOutcome,
};
use crate::store::system_store;
use crate::{DesktopVault, PendingIncepts};

/// The variables a custody credential must never arrive in: set, they refuse the start.
pub const REFUSED_VARS: [&str; 2] = ["AD4M_CUSTODY_CREDENTIAL", "AD4M_CUSTODY_CREDENTIAL_FILE"];

/// Why the sidecar refuses to start without its credential line.
pub const NO_CREDENTIAL: &str = "the custody credential must be the first line of stdin";

/// How long a closing sidecar waits to send answers already on their way.
const DRAIN: Duration = Duration::from_secs(5);

/// What the sidecar runs with. The credential is not here: [`main`] reads it from stdin.
#[derive(Debug)]
pub struct Config {
    /// The executor's address, `http://127.0.0.1:<port>`.
    pub executor_url: String,
    /// Where the master keys and pending incepts live: [`custody_dir`] unless `--custody-dir`.
    pub custody_dir: PathBuf,
}

impl Config {
    /// Reads `--executor-port <port>` and `--custody-dir <dir>` from `args`, and refuses a custody
    /// credential in `env` ([`REFUSED_VARS`]). The identity store is not configured here: custody
    /// asks the executor which one it uses (`identity.status`), as in the Tauri app.
    pub fn parse(
        args: impl IntoIterator<Item = String>,
        env: impl Fn(&str) -> Option<String>,
    ) -> Result<Config, String> {
        let mut port = None;
        let mut dir = None;
        let mut args = args.into_iter();
        while let Some(flag) = args.next() {
            let value = |name: &str, v: Option<String>| v.ok_or(format!("{name} needs a value"));
            match flag.as_str() {
                "--executor-port" => {
                    let v = value("--executor-port", args.next())?;
                    port = Some(
                        v.parse::<u16>()
                            .map_err(|_| "--executor-port is not a port".to_string())?,
                    );
                }
                "--custody-dir" => dir = Some(PathBuf::from(value("--custody-dir", args.next())?)),
                _ => return Err(format!("unknown argument `{flag}`")),
            }
        }
        let port = port.ok_or("--executor-port is required")?;
        if let Some(var) = REFUSED_VARS.iter().find(|var| env(var).is_some()) {
            return Err(format!(
                "{var} is set: the custody credential is read only from the first line of stdin, \
                 never from the environment"
            ));
        }
        let custody_dir = match dir {
            Some(dir) => dir,
            None => custody_dir(&dirs::home_dir().ok_or("no home folder")?),
        };
        Ok(Config {
            executor_url: format!("http://127.0.0.1:{port}"),
            custody_dir,
        })
    }

    /// The executor's address, with the credential [`read_credential`] read.
    pub fn executor(&self, credential: Arc<str>) -> ExecutorAddress {
        ExecutorAddress {
            url: self.executor_url.clone(),
            credential,
        }
    }
}

/// Reads the custody credential, the first line of `input`: the value, then `\n` (a `\r` before it
/// is dropped). Stdin closed before the line ends, a line that is empty or blank, or not UTF-8, is
/// refused ([`NO_CREDENTIAL`]); the error never repeats what was read. Reads nothing past the
/// line, so the requests after it stay in `input`.
pub async fn read_credential<R: AsyncBufRead + Unpin>(input: &mut R) -> Result<Arc<str>, String> {
    let mut line = zeroize::Zeroizing::new(Vec::new());
    input
        .read_until(b'\n', &mut line)
        .await
        .map_err(|e| format!("{NO_CREDENTIAL} (stdin: {})", e.kind()))?;
    let Some(value) = line.strip_suffix(b"\n") else {
        return Err(NO_CREDENTIAL.into());
    };
    let value = value.strip_suffix(b"\r").unwrap_or(value);
    match std::str::from_utf8(value) {
        Ok(value) if !value.trim().is_empty() => Ok(Arc::from(value)),
        _ => Err(NO_CREDENTIAL.into()),
    }
}

/// Why [`main`] stopped other than by stdin closing.
#[derive(Debug)]
pub enum Stopped {
    /// No custody credential on stdin's first line: a configuration problem, as a bad argument is.
    NoCredential(String),
    Io(std::io::Error),
}

impl std::fmt::Display for Stopped {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Stopped::NoCredential(why) => f.write_str(why),
            Stopped::Io(e) => e.fmt(f),
        }
    }
}

/// Reads the custody credential from stdin's first line, starts the custody service, and answers
/// the rest of stdin on stdout until stdin closes.
pub fn main(config: Config) -> Result<(), Stopped> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(Stopped::Io)?;
    runtime.block_on(async {
        // One buffered reader for the credential and the requests after it: a second one could
        // lose what the first had already buffered.
        let mut input = tokio::io::BufReader::new(tokio::io::stdin());
        let credential = read_credential(&mut input)
            .await
            .map_err(Stopped::NoCredential)?;
        let vault = DesktopVault::new(
            system_store(config.custody_dir.clone()),
            PendingIncepts::file(config.custody_dir.clone()),
        );
        let custody = spawn(vault, config.executor(credential));
        serve(custody, input, tokio::io::stdout())
            .await
            .map_err(Stopped::Io)
    })
}

/// Answers each request line of `input` on `output`, until `input` ends.
pub async fn serve<R, W>(custody: CustodyHandle, input: R, mut output: W) -> std::io::Result<()>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let (tx, mut answers) = mpsc::unbounded_channel::<String>();
    let mut lines = input.lines();
    loop {
        tokio::select! {
            line = lines.next_line() => match line {
                Ok(Some(line)) if line.trim().is_empty() => {}
                Ok(Some(line)) => {
                    let (custody, tx) = (custody.clone(), tx.clone());
                    tokio::spawn(async move {
                        let _ = tx.send(answer(&custody, &line).await);
                    });
                }
                // Closed, or unreadable: the host is gone either way.
                Ok(None) | Err(_) => break,
            },
            Some(reply) = answers.recv() => write_line(&mut output, &reply).await?,
        }
    }
    // Wipe the open step, then send what is still owed while the host may read it.
    custody.cancel().await;
    drop(tx);
    let _ = tokio::time::timeout(DRAIN, async {
        while let Some(reply) = answers.recv().await {
            if write_line(&mut output, &reply).await.is_err() {
                break;
            }
        }
    })
    .await;
    Ok(())
}

async fn write_line<W: AsyncWrite + Unpin>(output: &mut W, line: &str) -> std::io::Result<()> {
    output.write_all(line.as_bytes()).await?;
    output.write_all(b"\n").await?;
    output.flush().await
}

#[derive(Deserialize)]
struct Request {
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

/// A screen, and how the step ended when it is the last.
#[derive(Serialize)]
struct Shown {
    screen: Screen,
    outcome: Option<StepOutcome>,
}

impl Shown {
    fn of(screen: Screen) -> Self {
        let outcome = screen.outcome();
        Shown { screen, outcome }
    }
}

#[derive(Deserialize)]
struct StartParams {
    step: IdentityStep,
}

#[derive(Deserialize)]
struct StepParams {
    input: StepInput,
}

/// The answer line to one request line.
async fn answer(custody: &CustodyHandle, line: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return json!({ "id": null, "error": "not JSON" }).to_string();
    };
    let id = value.get("id").cloned().unwrap_or(Value::Null);
    let Ok(request) = serde_json::from_value::<Request>(value) else {
        return json!({ "id": id, "error": "not a request" }).to_string();
    };
    match call(custody, &request.method, request.params).await {
        Ok(result) => json!({ "id": request.id, "result": result }),
        Err(error) => json!({ "id": request.id, "error": error }),
    }
    .to_string()
}

async fn call(custody: &CustodyHandle, method: &str, params: Value) -> Result<Value, String> {
    let fail = |e: crate::CustodyError| e.to_string();
    let result = match method {
        "publicState" => serde_json::to_value(custody.public_state().await.map_err(fail)?),
        "start" => {
            let StartParams { step } = params_of(method, params)?;
            serde_json::to_value(Shown::of(custody.start(step).await.map_err(fail)?))
        }
        "step" => {
            let StepParams { input } = params_of(method, params)?;
            serde_json::to_value(Shown::of(custody.step(input).await.map_err(fail)?))
        }
        "cancel" => serde_json::to_value(custody.cancel().await.map(Shown::of)),
        _ => return Err(format!("unknown method `{method}`")),
    };
    result.map_err(|e| e.to_string())
}

/// The params of `method`, with an error that never repeats them.
fn params_of<T: DeserializeOwned>(method: &str, params: Value) -> Result<T, String> {
    serde_json::from_value(params).map_err(|_| format!("the params of `{method}` are not valid"))
}

/// Sends the crate's log lines to stderr, which the host keeps in its own log. They carry no
/// secret; stdout carries only answers.
pub fn log_to_stderr() {
    struct Stderr;
    impl log::Log for Stderr {
        fn enabled(&self, metadata: &log::Metadata) -> bool {
            metadata.level() <= log::Level::Info
        }
        fn log(&self, record: &log::Record) {
            if self.enabled(record.metadata()) {
                eprintln!("[we-custody] {}: {}", record.level(), record.args());
            }
        }
        fn flush(&self) {}
    }
    static LOGGER: Stderr = Stderr;
    if log::set_logger(&LOGGER).is_ok() {
        log::set_max_level(log::LevelFilter::Info);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::MemoryStore;

    fn custody() -> CustodyHandle {
        // No executor answers on port 9, so nothing here reaches one.
        spawn(
            DesktopVault::new(Box::new(MemoryStore::new()), PendingIncepts::memory()),
            ExecutorAddress {
                url: "http://127.0.0.1:9".into(),
                credential: Arc::from("x"),
            },
        )
    }

    /// Serves `lines` and returns the answers by id, the malformed ones under `null`.
    async fn exchange(custody: CustodyHandle, lines: &[&str]) -> Vec<Value> {
        let input = lines.join("\n");
        let mut output = Vec::new();
        serve(custody, input.as_bytes(), &mut output).await.unwrap();
        String::from_utf8(output)
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    fn by_id(answers: &[Value], id: Value) -> &Value {
        answers
            .iter()
            .find(|a| a["id"] == id)
            .unwrap_or_else(|| panic!("no answer for {id}"))
    }

    #[tokio::test]
    async fn every_request_is_answered_under_its_id_and_stdin_closing_ends_the_service() {
        let answers = exchange(
            custody(),
            &[
                r#"{"id":1,"method":"publicState"}"#,
                r#"{"id":2,"method":"step","params":{"input":{"kind":"confirm"}}}"#,
                r#"{"id":3,"method":"cancel"}"#,
                "",
            ],
        )
        .await;
        assert_eq!(answers.len(), 3);
        let public = &by_id(&answers, json!(1))["result"];
        assert_eq!(public["did"], Value::Null);
        assert_eq!(public["unlock"], "passphrase");
        assert_eq!(by_id(&answers, json!(2))["error"], "no step is open");
        assert_eq!(by_id(&answers, json!(3))["result"], Value::Null);
    }

    #[tokio::test]
    async fn a_step_runs_through_the_service() {
        let answers = exchange(
            custody(),
            &[r#"{"id":"a","method":"start","params":{"step":{"kind":"create"}}}"#],
        )
        .await;
        let shown = &by_id(&answers, json!("a"))["result"];
        // No executor answers, so the step cannot learn its store and stops before it starts.
        assert_eq!(shown["screen"]["screen"], "failed");
        assert_eq!(
            shown["screen"]["message"],
            "The identity service on this computer is still starting. Try again in a moment."
        );
        // The last screen of the step: the host learns how it ended without reading the screen.
        assert_eq!(shown["outcome"], "failed");
    }

    #[tokio::test]
    async fn a_malformed_line_is_answered_with_an_error_and_never_echoed() {
        let answers = exchange(
            custody(),
            &[
                "not json",
                r#"{"id":7}"#,
                r#"{"id":8,"method":"open-the-vault"}"#,
                r#"{"id":9,"method":"step","params":{"input":{"kind":"passphrase","passphrase":4815162342}}}"#,
                r#"{"id":10,"method":"start","params":{"step":{"kind":"burn-it-all"}}}"#,
            ],
        )
        .await;
        assert_eq!(by_id(&answers, Value::Null)["error"], "not JSON");
        assert_eq!(by_id(&answers, json!(7))["error"], "not a request");
        assert_eq!(
            by_id(&answers, json!(8))["error"],
            "unknown method `open-the-vault`"
        );
        assert_eq!(
            by_id(&answers, json!(9))["error"],
            "the params of `step` are not valid"
        );
        assert_eq!(
            by_id(&answers, json!(10))["error"],
            "the params of `start` are not valid"
        );
        let all = serde_json::to_string(&answers).unwrap();
        assert!(!all.contains("4815162342") && !all.contains("burn-it-all"));
    }

    fn env(vars: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |name| {
            vars.iter()
                .find(|(n, _)| *n == name)
                .map(|(_, v)| v.to_string())
        }
    }

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|a| a.to_string()).collect()
    }

    #[test]
    fn the_port_and_folder_come_from_arguments_and_nothing_from_the_environment() {
        let config = Config::parse(
            args(&["--executor-port", "12001", "--custody-dir", "/tmp/custody"]),
            env(&[
                // Read by the executor, never by custody.
                ("AD4M_IDENTITY_STORE_URL", "https://store.example"),
                ("AD4M_ADMIN_CREDENTIAL", "the-admin-credential"),
            ]),
        )
        .unwrap();
        assert_eq!(config.executor_url, "http://127.0.0.1:12001");
        assert_eq!(config.custody_dir, PathBuf::from("/tmp/custody"));
        let shown = format!("{config:?}");
        assert!(!shown.contains("store.example") && !shown.contains("the-admin-credential"));
        // The credential never shows in a debug print of the address either.
        let address = config.executor(Arc::from("the-credential"));
        assert!(!format!("{address:?}").contains("the-credential"));
    }

    /// The executor's `--custody-channel` admits only its own credential, never the admin one the
    /// main window holds: custody connects with the line on stdin, and an admin credential in the
    /// environment is never taken for it — with no line, the start is refused.
    #[tokio::test]
    async fn custody_connects_with_the_custody_credential_not_the_admin_one() {
        let config = Config::parse(
            args(&["--executor-port", "1"]),
            env(&[("AD4M_ADMIN_CREDENTIAL", "the-admin-credential")]),
        )
        .unwrap();
        let mut stdin: &[u8] = b"the-custody-credential\n";
        let credential = read_credential(&mut stdin).await.unwrap();
        let address = config.executor(credential);
        assert_eq!(&*address.credential, "the-custody-credential");
        assert_eq!(address.url, "http://127.0.0.1:1");
        let mut nothing: &[u8] = b"";
        assert_eq!(
            read_credential(&mut nothing).await.unwrap_err(),
            NO_CREDENTIAL
        );
    }

    /// The credential is the first line, and the requests after it are served from the same
    /// reader: nothing past the line is read away.
    #[tokio::test]
    async fn the_credential_is_the_first_line_and_the_requests_follow_it() {
        let mut input: &[u8] = b"the-credential\r\n{\"id\":1,\"method\":\"publicState\"}\n";
        let credential = read_credential(&mut input).await.unwrap();
        assert_eq!(&*credential, "the-credential");
        let mut output = Vec::new();
        serve(custody(), input, &mut output).await.unwrap();
        let answer: Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(answer["id"], 1);
        assert_eq!(answer["result"]["did"], Value::Null);
    }

    /// Stdin closed before the line ends, an empty or blank line, or one that is not UTF-8: refused,
    /// with an error that repeats none of it.
    #[tokio::test]
    async fn a_missing_or_empty_credential_line_is_refused() {
        for stdin in [
            &b""[..],
            b"secret-without-newline",
            b"\n",
            b"\r\n",
            b"   \t\n{\"id\":1}\n",
            b"\xff\xfesecret\n",
        ] {
            let mut input = stdin;
            let refused = read_credential(&mut input).await.unwrap_err();
            assert_eq!(refused, NO_CREDENTIAL, "{stdin:?}");
        }
    }

    /// Never the environment: either variable set refuses the start, whatever its value.
    #[test]
    fn a_credential_in_the_environment_is_refused() {
        for var in REFUSED_VARS {
            let refused = Config::parse(args(&["--executor-port", "1"]), move |name: &str| {
                (name == var).then(|| "the-credential".to_string())
            })
            .unwrap_err();
            assert!(refused.starts_with(&format!("{var} is set")), "{refused}");
            assert!(!refused.contains("the-credential"));
        }
    }

    #[test]
    fn a_credential_cannot_be_given_as_an_argument() {
        let refused = Config::parse(
            args(&[
                "--executor-port",
                "1",
                "--admin-credential",
                "the-credential",
            ]),
            env(&[]),
        )
        .unwrap_err();
        assert_eq!(refused, "unknown argument `--admin-credential`");
    }

    #[test]
    fn the_executor_port_is_required_and_must_be_a_port() {
        let with = |a: &[&str]| Config::parse(args(a), env(&[]));
        assert_eq!(with(&[]).unwrap_err(), "--executor-port is required");
        assert_eq!(
            with(&["--executor-port", "99999"]).unwrap_err(),
            "--executor-port is not a port"
        );
        assert_eq!(
            with(&["--executor-port"]).unwrap_err(),
            "--executor-port needs a value"
        );
    }
}
