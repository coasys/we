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
//!
//! A locked keyring is `tests/secret_service_locked.rs`, in a session of its own: it leaves the
//! keyring locked.
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
    let dir = tempfile::tempdir().unwrap();
    let store = SecretServiceStore::connect(dir.path()).expect("a Secret Service in this session");
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

/// A claim (`CreateItem` with `replace = false`) never replaces a kept item, though the service
/// keeps a second item beside it: the claim that came second deletes its own and answers `false`.
#[test]
fn a_claim_never_replaces_a_kept_item() {
    if !in_a_session_of_its_own() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let store = SecretServiceStore::connect(dir.path()).expect("a Secret Service in this session");
    let name = format!("coasys.identity.vault/test-claim-{}", std::process::id());
    assert!(store.claim_public(&name, b"first").unwrap());
    assert!(!store.claim_public(&name, b"second").unwrap());
    assert_eq!(store.get(&name).unwrap().as_deref(), Some(&b"first"[..]));
    store.delete(&name).unwrap();
    assert!(!store.contains(&name).unwrap());
}

/// Claims at once over connections of their own, as two custody folders make them: at most one
/// is answered `true`, and the name then holds its bytes; when two tie for first, none is, and
/// nothing is kept.
#[test]
fn of_claims_at_once_at_most_one_is_kept() {
    if !in_a_session_of_its_own() {
        return;
    }
    let name = format!("coasys.identity.vault/test-race-{}", std::process::id());
    let start = std::sync::Arc::new(std::sync::Barrier::new(4));
    let claims: Vec<_> = (0..4u8)
        .map(|n| {
            let (name, start) = (name.clone(), start.clone());
            std::thread::spawn(move || {
                // A custody folder of its own each: no folder lock is shared between them.
                let dir = tempfile::tempdir().unwrap();
                let store = SecretServiceStore::connect(dir.path()).expect("a Secret Service");
                start.wait();
                (n, store.claim_public(&name, &[n; 4]).unwrap())
            })
        })
        .collect();
    let won: Vec<u8> = claims
        .into_iter()
        .map(|c| c.join().unwrap())
        .filter(|(_, made)| *made)
        .map(|(n, _)| n)
        .collect();
    eprintln!("claims kept: {won:?}");
    let dir = tempfile::tempdir().unwrap();
    let store = SecretServiceStore::connect(dir.path()).expect("a Secret Service in this session");
    match won.as_slice() {
        [] => assert_eq!(store.get(&name).unwrap(), None),
        [n] => assert_eq!(store.get(&name).unwrap(), Some(vec![*n; 4])),
        more => panic!("more than one claim was kept: {more:?}"),
    }
    store.delete(&name).unwrap();
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
    let dir = tempfile::tempdir().unwrap();
    runtime.block_on(async {
        let store =
            SecretServiceStore::connect(dir.path()).expect("a Secret Service in this session");
        let name = format!("coasys.identity/test-connect-{}", std::process::id());
        assert!(!store.contains(&name).unwrap());
    });
}

/// Every item kept under `name`, as the Secret Service lists them.
fn items_named(name: &str) -> usize {
    let service =
        secret_service::blocking::SecretService::connect(secret_service::EncryptionType::Dh)
            .unwrap();
    let found = service
        .search_items(std::collections::HashMap::from([("coasys-identity", name)]))
        .unwrap();
    found.unlocked.len() + found.locked.len()
}

#[test]
fn claimers_in_one_custody_folder_make_one_item_and_all_get_it() {
    if !in_a_session_of_its_own() {
        return;
    }
    // Each claimer its own connection, as each custody process has: only the folder's lock is
    // shared between them.
    let dir = tempfile::tempdir().unwrap();
    let name = format!("coasys.identity/test-claim-{}", std::process::id());
    let answers: Vec<Vec<u8>> = std::thread::scope(|scope| {
        let claimers: Vec<_> = (0..6u8)
            .map(|i| {
                let (dir, name) = (dir.path(), name.as_str());
                scope.spawn(move || {
                    let store = SecretServiceStore::connect(dir).unwrap();
                    store.claim_secret(name, &[i; 32]).unwrap().to_vec()
                })
            })
            .collect();
        claimers.into_iter().map(|c| c.join().unwrap()).collect()
    });
    assert!(answers.windows(2).all(|w| w[0] == w[1]), "{answers:?}");
    assert_eq!(items_named(&name), 1);
    SecretServiceStore::connect(dir.path())
        .unwrap()
        .delete(&name)
        .unwrap();
}

#[test]
fn duplicates_already_there_answer_the_first_made_and_none_is_deleted() {
    if !in_a_session_of_its_own() {
        return;
    }
    // Two items under one name, made outside any lock, the second a second later: `Created` is in
    // seconds.
    let name = format!("coasys.identity/test-dup-{}", std::process::id());
    let service =
        secret_service::blocking::SecretService::connect(secret_service::EncryptionType::Dh)
            .unwrap();
    let collection = service.get_default_collection().unwrap();
    let attributes = std::collections::HashMap::from([("coasys-identity", name.as_str())]);
    for (i, secret) in [b"made first", b"made later"].into_iter().enumerate() {
        if i > 0 {
            std::thread::sleep(std::time::Duration::from_millis(1100));
        }
        collection
            .create_item(
                &name,
                attributes.clone(),
                secret,
                false,
                "application/octet-stream",
            )
            .unwrap();
    }
    drop(collection);
    drop(service);

    let dir = tempfile::tempdir().unwrap();
    let store = SecretServiceStore::connect(dir.path()).unwrap();
    assert_eq!(
        &store.claim_secret(&name, b"fresh").unwrap()[..],
        b"made first"
    );
    assert_eq!(items_named(&name), 2, "a claim deletes no item");
    store.delete(&name).unwrap();
}
