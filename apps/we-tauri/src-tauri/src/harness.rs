//! The harness build: the desktop app driven by the acceptance world (`tests/acceptance/`).
//!
//! Compiled only with the cargo feature `harness`, and only on Linux, where the automated
//! acceptance runs. A release build has none of this code. The harness build is the release build
//! in every other respect: the same windows, capabilities, CSP, executor and custody service. It adds
//! no Tauri command and no capability: it reaches the windows through WebKitGTK, from this process.
//!
//! At start the app reads `COASYS_HARNESS_URL` (`tcp://127.0.0.1:<port>`) and `COASYS_HARNESS_TOKEN`,
//! dials the harness link, and sends `{"hello":"we","token":…}`. The link accepts the app only with
//! the token it gave it. An address that is not on the loopback interface is refused here, before
//! any connection. Each line after that is one JSON command `{id, cmd, args}`; the app answers each
//! with `{id, ok, result}` or `{id, ok: false, error}`:
//!
//! - `eval {window, js}`: runs `js` as the body of an async function in the window with that label,
//!   in the page's own world, and answers what it returns, through JSON. The script has the rights of
//!   a script in that window and no more.
//! - `state`: the open windows (label and address) and the custody service's public state.
//! - `ipc.log {since}`: every command a window invoked since a time: when, which window, which
//!   command. Never the arguments: a passphrase or a word goes through them.
//!
//! Two more settings are read at start, for the world the app runs in:
//!
//! - `COASYS_HARNESS_VAULT`: `memory` (the default) keeps custody items in memory, so a run leaves
//!   nothing in the session's keyring; `os` uses this computer's store as a release build does (the
//!   Secret Service, else a sealed file).
//! - `COASYS_HARNESS_HOLOCHAIN`: `on` starts Holochain; anything else does not. The local world
//!   runs its languages without it.

use std::net::{SocketAddr, ToSocketAddrs};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use we_custody::CustodyHandle;

/// The custody store the harness build uses: memory unless `COASYS_HARNESS_VAULT=os`. `system`
/// makes this computer's store, and is not called for memory: connecting to the Secret Service
/// activates one.
pub fn custody_store(
    system: impl FnOnce() -> Box<dyn we_custody::store::SecretStore>,
) -> Box<dyn we_custody::store::SecretStore> {
    match std::env::var("COASYS_HARNESS_VAULT").as_deref() {
        Ok("os") => system(),
        _ => Box::new(we_custody::store::MemoryStore::new()),
    }
}

/// The executor settings the local world needs: no Holochain unless asked for.
pub fn adjust_config(config: &mut rust_executor::Ad4mConfig) {
    let holochain = std::env::var("COASYS_HARNESS_HOLOCHAIN").as_deref() == Ok("on");
    config.run_holochain = Some(holochain);
    config.connect_holochain = Some(holochain);
}

/// One command a window invoked.
#[derive(Clone, Serialize)]
struct IpcCall {
    at: u64,
    window: String,
    command: String,
}

/// Every command the windows invoked in this run, without arguments.
#[derive(Clone, Default)]
pub struct IpcLog(Arc<Mutex<Vec<IpcCall>>>);

impl IpcLog {
    pub fn record(&self, window: &str, command: &str) {
        if let Ok(mut calls) = self.0.lock() {
            calls.push(IpcCall {
                at: now_ms(),
                window: window.to_string(),
                command: command.to_string(),
            });
        }
    }

    fn since(&self, since: u64) -> Vec<IpcCall> {
        self.0
            .lock()
            .map(|calls| calls.iter().filter(|c| c.at >= since).cloned().collect())
            .unwrap_or_default()
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The harness link's address, when it is set and on the loopback interface.
fn link_address() -> Result<Option<SocketAddr>, String> {
    let Ok(url) = std::env::var("COASYS_HARNESS_URL") else {
        return Ok(None);
    };
    let host = url.strip_prefix("tcp://").unwrap_or(&url);
    let address = host
        .to_socket_addrs()
        .map_err(|e| format!("COASYS_HARNESS_URL {url}: {e}"))?
        .next()
        .ok_or_else(|| format!("COASYS_HARNESS_URL {url} names no address"))?;
    if !address.ip().is_loopback() {
        return Err(format!(
            "COASYS_HARNESS_URL {url} is not on the loopback interface: refused"
        ));
    }
    Ok(Some(address))
}

/// Dials the harness link, when one is set, and answers its commands until it closes.
pub fn start<R: Runtime>(app: AppHandle<R>, custody: CustodyHandle, ipc: IpcLog) {
    let address = match link_address() {
        Ok(Some(address)) => address,
        Ok(None) => return,
        Err(error) => {
            eprintln!("[harness] {error}");
            return;
        }
    };
    let token = std::env::var("COASYS_HARNESS_TOKEN").unwrap_or_default();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = serve(app, custody, ipc, address, token).await {
            eprintln!("[harness] the link ended: {error}");
        }
    });
}

async fn serve<R: Runtime>(
    app: AppHandle<R>,
    custody: CustodyHandle,
    ipc: IpcLog,
    address: SocketAddr,
    token: String,
) -> Result<(), String> {
    let stream = TcpStream::connect(address)
        .await
        .map_err(|e| format!("connect {address}: {e}"))?;
    let (read, mut write) = stream.into_split();
    let (out, mut outgoing) = mpsc::unbounded_channel::<String>();
    let hello = json!({ "hello": "we", "token": token, "pid": std::process::id() });
    out.send(hello.to_string()).map_err(|e| e.to_string())?;
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(line) = outgoing.recv().await {
            if write
                .write_all(format!("{line}\n").as_bytes())
                .await
                .is_err()
            {
                break;
            }
        }
    });

    let mut lines = BufReader::new(read).lines();
    while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
        let message: Value = match serde_json::from_str(&line) {
            Ok(message) => message,
            Err(_) => continue,
        };
        let id = message["id"].clone();
        let cmd = message["cmd"].as_str().unwrap_or_default().to_string();
        let args = message["args"].clone();
        let (app, custody, ipc, out) = (app.clone(), custody.clone(), ipc.clone(), out.clone());
        // Each command on its own, so a script that waits does not hold up the others.
        tauri::async_runtime::spawn(async move {
            let answer = match command(&app, &custody, &ipc, &cmd, &args).await {
                Ok(result) => json!({ "id": id, "ok": true, "result": result }),
                Err(error) => json!({ "id": id, "ok": false, "error": error }),
            };
            let _ = out.send(answer.to_string());
        });
    }
    writer.abort();
    Ok(())
}

async fn command<R: Runtime>(
    app: &AppHandle<R>,
    custody: &CustodyHandle,
    ipc: &IpcLog,
    cmd: &str,
    args: &Value,
) -> Result<Value, String> {
    match cmd {
        "eval" => {
            let label = args["window"].as_str().ok_or("eval: no window")?;
            let js = args["js"].as_str().ok_or("eval: no js")?;
            eval(app, label, js).await
        }
        "state" => {
            let windows: Vec<Value> = app
                .webview_windows()
                .into_iter()
                .map(|(label, window)| {
                    json!({ "label": label, "url": window.url().map(|u| u.to_string()).unwrap_or_default() })
                })
                .collect();
            let custody = custody
                .public_state()
                .await
                .map_err(|e| e.to_string())
                .and_then(|state| serde_json::to_value(state).map_err(|e| e.to_string()))?;
            Ok(json!({ "windows": windows, "custody": custody }))
        }
        "ipc.log" => {
            let since = args["since"].as_u64().unwrap_or(0);
            serde_json::to_value(ipc.since(since)).map_err(|e| e.to_string())
        }
        other => Err(format!("no harness command {other}")),
    }
}

/// Runs `js` as the body of an async function in a window, and answers what it returns.
async fn eval<R: Runtime>(app: &AppHandle<R>, label: &str, js: &str) -> Result<Value, String> {
    use webkit2gtk::WebViewExt;

    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("no window {label}"))?;
    // The script's value goes through JSON on the way out, so what comes back is a string.
    let body = format!(
        "const value = await (async () => {{\n{js}\n}})();\nreturn JSON.stringify(value === undefined ? null : value);"
    );
    let (done, answer) = oneshot::channel::<Result<String, String>>();
    window
        .with_webview(move |webview| {
            let view = webview.inner();
            view.call_async_javascript_function(
                &body,
                None,
                None,
                None,
                None::<&webkit2gtk::gio::Cancellable>,
                move |result| {
                    use javascriptcore::ValueExt;
                    let _ = done.send(
                        result
                            .map(|value| value.to_str().to_string())
                            .map_err(|e| e.to_string()),
                    );
                },
            );
        })
        .map_err(|e| e.to_string())?;
    let text = answer
        .await
        .map_err(|_| format!("the window {label} closed before the script answered"))??;
    serde_json::from_str(&text).map_err(|e| format!("the script answered {text}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::link_address;

    // One test: the variable is process-wide, and tests run in parallel.
    #[test]
    fn the_link_must_be_on_the_loopback_interface() {
        std::env::remove_var("COASYS_HARNESS_URL");
        assert_eq!(link_address(), Ok(None));
        std::env::set_var("COASYS_HARNESS_URL", "tcp://127.0.0.1:4000");
        assert!(matches!(link_address(), Ok(Some(a)) if a.port() == 4000));
        std::env::set_var("COASYS_HARNESS_URL", "tcp://10.0.0.5:4000");
        assert!(link_address().unwrap_err().contains("loopback"));
        std::env::set_var("COASYS_HARNESS_URL", "8.8.8.8:4000");
        assert!(link_address().is_err());
        std::env::remove_var("COASYS_HARNESS_URL");
    }
}
