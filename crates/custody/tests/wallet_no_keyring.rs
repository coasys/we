//! What `we-custody wallet-passphrase` answers where there is no keyring at all, run as the
//! supervisor runs it. `unavailable` is the one answer the supervisor gives an agent the WE password
//! for (`apps/we-electron/electron/mainAgent.js`), for good, so it must mean no keyring, and only that:
//!
//! - no session bus to reach — `unavailable`;
//! - a session bus with no Secret Service on it, and none it can start — `unavailable`.
//!
//! A Secret Service that is there and locked, dismissed or failing is `locked` or `failed`
//! (`tests/wallet.rs`, `tests/secret_service_locked.rs`).
//!
//! Neither case reaches the person's own session: the bus is a socket in a temporary folder, or a
//! `dbus-daemon` of the test's own whose configuration starts no service, and `XDG_RUNTIME_DIR` is a
//! temporary folder so nothing falls back to the session's bus.
#![cfg(target_os = "linux")]

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};

/// Runs `wallet-passphrase <mode>` on the bus at `address`, and parses its line.
fn ask(mode: &str, address: &str, runtime: &Path, data: &Path) -> serde_json::Value {
    let out = Command::new(env!("CARGO_BIN_EXE_we-custody"))
        .args(["wallet-passphrase", mode, "--data-folder"])
        .arg(data)
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .env("HOME", runtime)
        .env("XDG_RUNTIME_DIR", runtime)
        .env("DBUS_SESSION_BUS_ADDRESS", address)
        .current_dir(runtime)
        .output()
        .expect("we-custody runs");
    assert!(out.status.success(), "exit {:?}", out.status);
    let line = String::from_utf8(out.stdout).unwrap();
    serde_json::from_str(line.lines().next().expect("one line")).expect("a JSON line")
}

#[test]
fn no_session_bus_is_no_keyring() {
    let dir = tempfile::tempdir().unwrap();
    let address = format!("unix:path={}", dir.path().join("no-bus").display());
    for mode in ["read", "make"] {
        let line = ask(mode, &address, dir.path(), &dir.path().join("data"));
        assert_eq!(line["refused"], "unavailable", "{mode}: {line}");
        assert!(line.get("passphrase").is_none());
    }
}

/// A `dbus-daemon` of the test's own: no service directory, so nothing is started on it. Killed
/// when dropped.
struct Bus(Child);

impl Drop for Bus {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn empty_bus(dir: &Path) -> Option<(Bus, String)> {
    let config = dir.join("bus.conf");
    std::fs::write(
        &config,
        format!(
            r#"<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:path={}</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
"#,
            dir.join("bus").display()
        ),
    )
    .unwrap();
    let child = match Command::new("dbus-daemon")
        .arg(format!("--config-file={}", config.display()))
        .args(["--nofork", "--print-address"])
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            eprintln!("skipped: no dbus-daemon to run a bus of the test's own ({e})");
            return None;
        }
    };
    let mut bus = Bus(child);
    let mut address = String::new();
    BufReader::new(bus.0.stdout.take().unwrap())
        .read_line(&mut address)
        .unwrap();
    Some((bus, address.trim().to_string()))
}

#[test]
fn a_bus_with_no_secret_service_is_no_keyring() {
    let dir = tempfile::tempdir().unwrap();
    let Some((_bus, address)) = empty_bus(dir.path()) else {
        return;
    };
    assert!(
        address.contains(&*dir.path().to_string_lossy()),
        "{address}"
    );
    for mode in ["read", "make"] {
        let line = ask(mode, &address, dir.path(), &dir.path().join("data"));
        assert_eq!(line["refused"], "unavailable", "{mode}: {line}");
        assert!(line.get("passphrase").is_none());
    }
}
