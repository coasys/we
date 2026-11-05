//! The Secret Service store against a real Secret Service, called the way the custody service calls
//! it: from inside a current-thread async runtime, and dropped there.
//!
//! Skipped unless `CUSTODY_SECRET_SERVICE=1`. It writes to the session's default collection, so run
//! it in a session of its own, never the person's:
//!
//! ```sh
//! XDG_RUNTIME_DIR=$(mktemp -d) dbus-run-session -- sh -c 'K=$(mktemp -d);
//!   printf secret | HOME=$K XDG_DATA_HOME=$K gnome-keyring-daemon --unlock --components=secrets >/dev/null &&
//!   CUSTODY_SECRET_SERVICE=1 cargo test --test secret_service'
//! ```
#![cfg(target_os = "linux")]

use we_custody::store::{SecretServiceStore, SecretStore, StoreKind};

/// Whether to run: `CUSTODY_SECRET_SERVICE=1`, and never in the person's own session.
fn in_a_session_of_its_own() -> bool {
    if std::env::var("CUSTODY_SECRET_SERVICE").as_deref() != Ok("1") {
        eprintln!(
            "skipped: set CUSTODY_SECRET_SERVICE=1 (see the header of tests/secret_service.rs)"
        );
        return false;
    }
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_default();
    assert!(
        !runtime_dir.starts_with("/run/user/"),
        "this would write to the person's own keyring: run it in a session of its own"
    );
    true
}

#[test]
fn the_store_works_from_inside_the_custody_runtime_and_drops_there() {
    if !in_a_session_of_its_own() {
        return;
    }

    // Connected outside the runtime, as the app connects it before the custody thread starts.
    let store = SecretServiceStore::connect().expect("a Secret Service in this session");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async move {
        let name = format!("coasys.identity/test-{}", std::process::id());
        assert_eq!(store.kind_of(&name).unwrap(), StoreKind::SecretService);
        assert!(!store.contains(&name).unwrap());
        store.put(&name, b"sealed bytes").unwrap();
        assert!(store.contains(&name).unwrap());
        assert_eq!(
            store.get(&name).unwrap().as_deref(),
            Some(&b"sealed bytes"[..])
        );
        store.delete(&name).unwrap();
        assert_eq!(store.get(&name).unwrap(), None);
        // Dropped inside the runtime, as the custody service drops it when it stops.
        drop(store);
    });
}

#[test]
fn the_store_connects_from_inside_a_runtime_too() {
    if !in_a_session_of_its_own() {
        return;
    }
    // The client is opened on its own thread, so where `connect` is called from does not matter.
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let store = SecretServiceStore::connect().expect("a Secret Service in this session");
        let name = format!("coasys.identity/test-connect-{}", std::process::id());
        assert!(!store.contains(&name).unwrap());
    });
}
