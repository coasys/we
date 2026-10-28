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
//! - `cancel` → `null`, the open step ended and wiped
//!
//! `outcome` is how the step ended ([`crate::StepOutcome`]) once a screen is its last, else `null`:
//! the host keeps it for the main window, which never sees a screen.
//!
//! Answers go out as they are ready, not in order: a `wait-claim` step can wait minutes while
//! `cancel` and `publicState` are answered. When stdin closes the open step is cancelled and the
//! process exits, so it never outlives its host.
//!
//! The admin credential comes from the environment (`AD4M_ADMIN_CREDENTIAL`, as the executor reads
//! it), never from an argument, which every user of the computer can read through `ps`. No error
//! here repeats what a request carried: a malformed step input could hold a passphrase.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;

use crate::host::{custody_dir, StoreSettings};
use crate::service::{
    spawn, CustodyHandle, ExecutorAddress, IdentityStep, Screen, StepInput, StepOutcome,
};
use crate::store::system_store;
use crate::{DesktopVault, PendingIncepts};

/// The variable the admin credential arrives in.
pub const CREDENTIAL_VAR: &str = "AD4M_ADMIN_CREDENTIAL";

/// How long a closing sidecar waits to send answers already on their way.
const DRAIN: Duration = Duration::from_secs(5);

/// What the sidecar runs with.
#[derive(Debug)]
pub struct Config {
    pub executor: ExecutorAddress,
    /// Where the master keys and pending incepts live: [`custody_dir`] unless `--custody-dir`.
    pub custody_dir: PathBuf,
}

impl Config {
    /// Reads `--executor-port <port>` and `--custody-dir <dir>` from `args`, and the credential and
    /// the identity store settings from `env`.
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
        let credential = env(CREDENTIAL_VAR)
            .filter(|c| !c.is_empty())
            .ok_or(format!("{CREDENTIAL_VAR} is not set"))?;
        let custody_dir = match dir {
            Some(dir) => dir,
            None => custody_dir(&dirs::home_dir().ok_or("no home folder")?),
        };
        let store = StoreSettings::resolve(
            env("AD4M_IDENTITY_STORE_URL"),
            None,
            env("AD4M_IDENTITY_STORE_KEYS"),
            None,
        );
        Ok(Config {
            executor: ExecutorAddress {
                url: format!("http://127.0.0.1:{port}"),
                admin_credential: Arc::from(credential.as_str()),
                store_trusted: store.trusted(),
                store_url: store.url,
            },
            custody_dir,
        })
    }
}

/// Starts the custody service and answers stdin on stdout until stdin closes.
pub fn main(config: Config) -> std::io::Result<()> {
    let vault = DesktopVault::new(
        system_store(config.custody_dir.clone()),
        PendingIncepts::file(config.custody_dir),
    );
    let custody = spawn(vault, config.executor);
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(serve(
            custody,
            tokio::io::BufReader::new(tokio::io::stdin()),
            tokio::io::stdout(),
        ))
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
        "cancel" => {
            custody.cancel().await;
            Ok(Value::Null)
        }
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

    fn custody(store_trusted: bool) -> CustodyHandle {
        // No executor answers on port 9, so nothing here reaches one.
        spawn(
            DesktopVault::new(Box::new(MemoryStore::new()), PendingIncepts::memory()),
            ExecutorAddress {
                url: "http://127.0.0.1:9".into(),
                admin_credential: Arc::from("x"),
                store_url: None,
                store_trusted,
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
            custody(true),
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
            custody(false),
            &[r#"{"id":"a","method":"start","params":{"step":{"kind":"create"}}}"#],
        )
        .await;
        let shown = &by_id(&answers, json!("a"))["result"];
        assert_eq!(shown["screen"]["screen"], "failed");
        assert_eq!(shown["screen"]["message"], crate::service::NO_STORE);
        // The last screen of the step: the host learns how it ended without reading the screen.
        assert_eq!(shown["outcome"], "failed");
    }

    #[tokio::test]
    async fn a_malformed_line_is_answered_with_an_error_and_never_echoed() {
        let answers = exchange(
            custody(true),
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
    fn the_credential_comes_from_the_environment_and_the_rest_from_arguments() {
        let config = Config::parse(
            args(&["--executor-port", "12001", "--custody-dir", "/tmp/custody"]),
            env(&[
                (CREDENTIAL_VAR, "the-credential"),
                ("AD4M_IDENTITY_STORE_URL", "https://store.example"),
                ("AD4M_IDENTITY_STORE_KEYS", "z6MkA"),
            ]),
        )
        .unwrap();
        assert_eq!(config.executor.url, "http://127.0.0.1:12001");
        assert_eq!(&*config.executor.admin_credential, "the-credential");
        assert_eq!(
            config.executor.store_url.as_deref(),
            Some("https://store.example")
        );
        assert!(config.executor.store_trusted);
        assert_eq!(config.custody_dir, PathBuf::from("/tmp/custody"));
        // The credential never shows in a debug print either.
        assert!(!format!("{config:?}").contains("the-credential"));
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
            env(&[(CREDENTIAL_VAR, "x")]),
        )
        .unwrap_err();
        assert_eq!(refused, "unknown argument `--admin-credential`");
        let missing = Config::parse(args(&["--executor-port", "1"]), env(&[])).unwrap_err();
        assert_eq!(missing, format!("{CREDENTIAL_VAR} is not set"));
    }

    #[test]
    fn the_executor_port_is_required_and_must_be_a_port() {
        let with = |a: &[&str]| Config::parse(args(a), env(&[(CREDENTIAL_VAR, "x")]));
        assert_eq!(with(&[]).unwrap_err(), "--executor-port is required");
        assert_eq!(
            with(&["--executor-port", "99999"]).unwrap_err(),
            "--executor-port is not a port"
        );
        assert_eq!(
            with(&["--executor-port"]).unwrap_err(),
            "--executor-port needs a value"
        );
        // Without a store key every step is refused before it starts.
        assert!(
            !with(&["--executor-port", "1", "--custody-dir", "/tmp/c"])
                .unwrap()
                .executor
                .store_trusted
        );
    }
}
