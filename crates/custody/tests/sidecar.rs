//! The `we-custody` binary as the Electron app runs it: answers a request on stdout, and exits 0
//! once stdin closes, so it never outlives its host.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

/// The sidecar's public state, asked once, with the identity store given as `store_url` and no
/// store keys. Asserts it exits 0 when stdin closes.
fn public_state(store_url: Option<&str>) -> serde_json::Value {
    let custody_dir = tempfile::tempdir().unwrap();
    let mut command = Command::new(env!("CARGO_BIN_EXE_we-custody"));
    command
        .args(["--executor-port", "9", "--custody-dir"])
        .arg(custody_dir.path())
        .env("AD4M_ADMIN_CREDENTIAL", "the-credential")
        // Keeps the test off this session's Secret Service: the store falls back to the folder.
        .env("DBUS_SESSION_BUS_ADDRESS", "unix:path=/nonexistent")
        .env_remove("AD4M_IDENTITY_STORE_KEYS");
    match store_url {
        Some(url) => command.env("AD4M_IDENTITY_STORE_URL", url),
        None => command.env_remove("AD4M_IDENTITY_STORE_URL"),
    };
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();

    let mut stdin = child.stdin.take().unwrap();
    writeln!(stdin, r#"{{"id":1,"method":"publicState"}}"#).unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let answer: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(answer["id"], 1);

    drop(stdin);
    assert!(child.wait().unwrap().success());
    answer
}

#[test]
fn the_sidecar_answers_on_stdout_and_exits_when_stdin_closes() {
    // A store named without its key: the executor trusts none, so every step is blocked.
    let answer = public_state(Some("https://store.example"));
    assert_eq!(answer["result"]["did"], serde_json::Value::Null);
    assert!(
        answer["result"]["blocked"].is_string(),
        "a store url without its key: {answer}"
    );
}

#[test]
fn with_no_store_configured_the_sidecar_trusts_the_default_store() {
    let answer = public_state(None);
    assert!(
        answer["result"]["blocked"].is_null(),
        "the executor trusts the default store's key: {answer}"
    );
}

#[test]
fn the_sidecar_refuses_to_start_without_a_credential() {
    let status = Command::new(env!("CARGO_BIN_EXE_we-custody"))
        .args(["--executor-port", "9", "--custody-dir", "/nonexistent"])
        .env_remove("AD4M_ADMIN_CREDENTIAL")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(2));
}
