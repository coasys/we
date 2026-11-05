//! The `we-custody` binary as the Electron app runs it: answers a request on stdout, and exits 0
//! once stdin closes, so it never outlives its host.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

/// The sidecar's public state, asked once, with no executor on its port. Asserts it exits 0 when
/// stdin closes.
fn public_state() -> serde_json::Value {
    let custody_dir = tempfile::tempdir().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_we-custody"))
        .args(["--executor-port", "9", "--custody-dir"])
        .arg(custody_dir.path())
        .env("AD4M_ADMIN_CREDENTIAL", "the-credential")
        // Keeps the test off this session's Secret Service: the store falls back to the folder.
        .env("DBUS_SESSION_BUS_ADDRESS", "unix:path=/nonexistent")
        // The executor's settings, which custody never reads: it asks the executor.
        .env("AD4M_IDENTITY_STORE_URL", "https://store.example")
        .env_remove("AD4M_IDENTITY_STORE_KEYS")
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
    let answer = public_state();
    assert_eq!(answer["result"]["did"], serde_json::Value::Null);
    // Whether a step is blocked is the executor's to say (`identity.status`), and none answers
    // here: nothing is known, so nothing is blocked — whatever the environment names.
    assert!(
        answer["result"]["blocked"].is_null(),
        "no executor, nothing known: {answer}"
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
