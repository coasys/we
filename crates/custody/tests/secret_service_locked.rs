//! The Secret Service store against a real Secret Service whose keyring is locked.
//!
//! Found on a real desktop: with the login keyring locked, the store's first write asked the Secret
//! Service to unlock it and waited for the answer, and so did custody behind it, for as long as
//! nobody answered the prompt. A write to a locked keyring now stops waiting after a bound and says
//! the keyring is locked, changing nothing; the prompt stays up for the person to answer.
//!
//! Skipped unless `CUSTODY_SECRET_SERVICE=1`. It locks the session's default collection and raises
//! its unlock prompt, which nobody answers, so run it in a session of its own, never the person's,
//! and with no display of the person's for the prompt to draw on:
//!
//! ```sh
//! env -u DISPLAY -u WAYLAND_DISPLAY XDG_RUNTIME_DIR=$(mktemp -d) xvfb-run -a dbus-run-session -- sh -c 'K=$(mktemp -d);
//!   printf secret | HOME=$K XDG_DATA_HOME=$K gnome-keyring-daemon --unlock --components=secrets >/dev/null &&
//!   CUSTODY_SECRET_SERVICE=1 cargo test --test secret_service_locked'
//! ```
//!
//! It leaves the keyring locked, so it is a file of its own rather than a case of
//! `tests/secret_service.rs`, whose cases need it open.
#![cfg(target_os = "linux")]

use std::collections::HashMap;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use secret_service::blocking::SecretService;
use secret_service::EncryptionType;
use we_custody::store::{is_keyring_locked, SecretServiceStore, SecretStore};

/// Whether to run: `CUSTODY_SECRET_SERVICE=1`, never in the person's own session, and never where
/// the prompt would draw on the person's display.
fn in_a_session_of_its_own() -> bool {
    if std::env::var("CUSTODY_SECRET_SERVICE").as_deref() != Ok("1") {
        eprintln!(
            "skipped: set CUSTODY_SECRET_SERVICE=1 (see the header of tests/secret_service_locked.rs)"
        );
        return false;
    }
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_default();
    assert!(
        !runtime_dir.starts_with("/run/user/"),
        "this would lock the person's own keyring: run it in a session of its own"
    );
    assert!(
        std::env::var_os("WAYLAND_DISPLAY").is_none(),
        "the unlock prompt would draw on the person's display: unset WAYLAND_DISPLAY, use xvfb-run"
    );
    true
}

#[test]
fn a_locked_keyring_is_answered_within_a_bound_and_nothing_is_written() {
    if !in_a_session_of_its_own() {
        return;
    }
    let service = SecretService::connect(EncryptionType::Dh).unwrap();
    let collection = service.get_default_collection().unwrap();
    collection.lock().unwrap();
    assert!(collection.is_locked().unwrap());

    let wait = Duration::from_secs(3);
    let store =
        SecretServiceStore::connect_waiting(wait).expect("a Secret Service in this session");
    let name = format!("coasys.identity/test-locked-{}", std::process::id());
    let (answer, answered) = mpsc::channel();
    let started = Instant::now();
    let writing = name.clone();
    std::thread::spawn(move || {
        let _ = answer.send(store.put(&writing, b"sealed bytes"));
        // Kept: the store's thread is still waiting on the prompt, and dropping the store waits
        // for that thread.
        std::mem::forget(store);
    });
    let result = answered
        .recv_timeout(wait + Duration::from_secs(30))
        .expect("the write to a locked keyring never answered");
    let error = result.expect_err("a locked keyring took the write");
    assert!(
        is_keyring_locked(&error),
        "answered {error:?}, not that the keyring is locked"
    );
    assert!(started.elapsed() < wait + Duration::from_secs(5));

    // Nothing was written: the keyring holds no item by that name, locked or not. Searching asks
    // nobody; unlocking the keyring again here would raise a prompt of its own.
    let found = service
        .search_items(HashMap::from([("coasys-identity", name.as_str())]))
        .unwrap();
    assert!(found.unlocked.is_empty() && found.locked.is_empty());
}
