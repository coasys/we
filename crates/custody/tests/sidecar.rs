//! The `we-custody` binary as the Electron app runs it: the custody credential as the first line of
//! its stdin, then requests; answers on stdout, and exits 0 once stdin closes, so it never outlives
//! its host.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

/// The sidecar with no executor on its port, on a custody folder of its own, off this session's
/// Secret Service (the store falls back to the folder), and with no custody credential in its
/// environment.
fn sidecar(custody_dir: &std::path::Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_we-custody"));
    command
        .args(["--executor-port", "9", "--custody-dir"])
        .arg(custody_dir)
        .env("DBUS_SESSION_BUS_ADDRESS", "unix:path=/nonexistent")
        // The executor's settings, which custody never reads: it asks the executor.
        .env("AD4M_IDENTITY_STORE_URL", "https://store.example")
        .env_remove("AD4M_IDENTITY_STORE_KEYS")
        .env_remove("AD4M_CUSTODY_CREDENTIAL")
        .env_remove("AD4M_CUSTODY_CREDENTIAL_FILE");
    command
}

/// The sidecar's public state, asked once after the credential line. Asserts it exits 0 when stdin
/// closes.
fn public_state() -> serde_json::Value {
    let custody_dir = tempfile::tempdir().unwrap();
    let mut child = sidecar(custody_dir.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();

    let mut stdin = child.stdin.take().unwrap();
    writeln!(stdin, "the-credential").unwrap();
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

/// Exits 2, answering nothing, after writing `stdin` and closing it.
fn refused_with(mut command: Command, stdin: &str) {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    // The sidecar may have exited already (a refused environment), closing its end.
    let _ = input.write_all(stdin.as_bytes());
    drop(input);
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(2), "stdin {stdin:?}");
    assert!(output.stdout.is_empty(), "answered with {stdin:?}");
}

#[test]
fn the_sidecar_refuses_to_start_without_a_credential_line() {
    let dir = tempfile::tempdir().unwrap();
    // Stdin closed at once, closed mid-line, an empty line, a blank one.
    for stdin in ["", "the-credential", "\n", "  \t\r\n"] {
        refused_with(sidecar(dir.path()), stdin);
    }
}

/// The custody credential is never read from the environment, where any process of the user (and
/// the renderer's admin credential, through a host file read of `/proc/<pid>/environ`) could read
/// it: set there, the start is refused, even with a good first line.
#[test]
fn the_sidecar_refuses_a_credential_in_its_environment() {
    let dir = tempfile::tempdir().unwrap();
    for var in ["AD4M_CUSTODY_CREDENTIAL", "AD4M_CUSTODY_CREDENTIAL_FILE"] {
        let mut command = sidecar(dir.path());
        command.env(var, "the-credential");
        refused_with(
            command,
            "the-credential\n{\"id\":1,\"method\":\"publicState\"}\n",
        );
    }
}
