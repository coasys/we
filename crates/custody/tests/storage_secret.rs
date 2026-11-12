//! The executor's storage secret in this computer's keyring (`we_custody::storage_secret`), over the
//! in-memory store and stores that refuse — never the OS keyring or a session bus: one item per
//! data folder, named by a hash of its path, made once as 64 hex and read back the same; a keyring
//! that refuses answered as refused with no secret in the line; and the storage passphrase's
//! derivation, salted with the keyring id.

use std::sync::Mutex;

use ad4m_identity_client::VaultError;
use we_custody::seal::Kdf;
use we_custody::storage_secret::{self, Answer, Command, Mode, PassphraseLine};
use we_custody::store::{keyring_locked, no_keyring, MemoryStore, SecretStore, StoreKind};
use zeroize::Zeroizing;

/// Argon2id at a cost a test can afford; the derivation is the same function at any cost.
const CHEAP: Kdf = Kdf {
    m_kib: 64,
    t: 1,
    p: 1,
};

fn secret_of(answer: Answer) -> Zeroizing<String> {
    match answer {
        Answer::Secret(secret) => secret,
        other => panic!("answered {other:?}"),
    }
}

#[test]
fn a_first_make_keeps_a_new_secret_and_every_call_after_answers_the_same_one() {
    let store = MemoryStore::new();
    let folder = tempfile::tempdir().unwrap();
    let name = storage_secret::item_name(folder.path());

    assert!(matches!(
        storage_secret::answer(&store, &name, Mode::Read),
        Answer::None
    ));

    let made = secret_of(storage_secret::answer(&store, &name, Mode::Make));
    assert!(
        storage_secret::is_secret_hex(&made),
        "{} characters",
        made.len()
    );
    assert_eq!(*made, made.to_ascii_lowercase());
    // What the keyring holds is the 64 hex characters the executor takes.
    assert_eq!(store.get(&name).unwrap().unwrap(), made.as_bytes());

    for mode in [Mode::Read, Mode::Make] {
        assert_eq!(
            *secret_of(storage_secret::answer(&store, &name, mode)),
            *made
        );
    }
}

#[test]
fn the_item_is_named_by_a_hash_of_the_folder_path_one_per_folder() {
    let one = tempfile::tempdir().unwrap();
    let two = tempfile::tempdir().unwrap();
    let (a, b) = (
        storage_secret::item_name(one.path()),
        storage_secret::item_name(two.path()),
    );
    assert_ne!(a, b);
    for name in [&a, &b] {
        let tail = name.strip_prefix(storage_secret::ITEM_PREFIX).unwrap();
        assert_eq!(tail.len(), 16);
        assert!(tail.bytes().all(|c| c.is_ascii_hexdigit()));
        // The path itself is not in the name.
        assert!(!name.contains('/'));
    }

    // The first 16 hex characters of the SHA-256 of the absolute path.
    use sha2::{Digest, Sha256};
    let canonical = std::fs::canonicalize(one.path()).unwrap();
    let digest = Sha256::digest(canonical.as_os_str().as_encoded_bytes());
    let expected: String = digest[..8].iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(a, format!("adam-storage-{expected}"));

    let store = MemoryStore::new();
    let sa = secret_of(storage_secret::answer(&store, &a, Mode::Make));
    let sb = secret_of(storage_secret::answer(&store, &b, Mode::Make));
    assert_ne!(*sa, *sb);
}

#[test]
fn the_same_folder_named_two_ways_is_one_item() {
    let folder = tempfile::tempdir().unwrap();
    let inner = folder.path().join("data");
    std::fs::create_dir(&inner).unwrap();
    let roundabout = folder.path().join("data").join("..").join("data");
    assert_eq!(
        storage_secret::item_name(&inner),
        storage_secret::item_name(&roundabout)
    );
}

#[test]
fn an_item_that_is_not_a_secret_is_a_failure_and_is_never_replaced() {
    let store = MemoryStore::new();
    store.put("adam-storage-x", b"not a secret").unwrap();
    for mode in [Mode::Read, Mode::Make] {
        assert!(matches!(
            storage_secret::answer(&store, "adam-storage-x", mode),
            Answer::Failed(_)
        ));
    }
    assert_eq!(
        store.get("adam-storage-x").unwrap().unwrap(),
        b"not a secret"
    );
}

/// A keyring that answers every call with `error`, and counts the writes it took.
struct Refusing {
    error: fn() -> VaultError,
    writes: Mutex<u32>,
}

impl SecretStore for Refusing {
    fn kind(&self) -> StoreKind {
        StoreKind::SecretService
    }
    fn kind_of(&self, _: &str) -> Result<StoreKind, VaultError> {
        Ok(StoreKind::SecretService)
    }
    fn put(&self, _: &str, _: &[u8]) -> Result<(), VaultError> {
        *self.writes.lock().unwrap() += 1;
        Err((self.error)())
    }
    fn claim_public(&self, _: &str, _: &[u8]) -> Result<bool, VaultError> {
        *self.writes.lock().unwrap() += 1;
        Err((self.error)())
    }
    fn get(&self, _: &str) -> Result<Option<Vec<u8>>, VaultError> {
        Err((self.error)())
    }
    fn contains(&self, _: &str) -> Result<bool, VaultError> {
        Err((self.error)())
    }
    fn delete(&self, _: &str) -> Result<(), VaultError> {
        Err((self.error)())
    }
}

#[test]
fn a_keyring_that_refuses_is_answered_by_kind_and_nothing_is_written() {
    type MakeError = fn() -> VaultError;
    let cases: [(MakeError, &str); 4] = [
        (keyring_locked, "locked"),
        (|| VaultError::Cancelled, "locked"),
        (
            || no_keyring("Secret Service: no such service"),
            "unavailable",
        ),
        (
            || VaultError::Unavailable("Secret Service: its thread ended".into()),
            "failed",
        ),
    ];
    for (error, refused) in cases {
        let store = Refusing {
            error,
            writes: Mutex::new(0),
        };
        for mode in [Mode::Read, Mode::Make] {
            let line: serde_json::Value = serde_json::from_str(&storage_secret::answer_line(
                &storage_secret::answer(&store, "adam-storage-x", mode),
            ))
            .unwrap();
            assert_eq!(line["refused"], refused, "{mode:?}: {line}");
            assert!(line.get("secret").is_none());
        }
        assert_eq!(*store.writes.lock().unwrap(), 0);
    }
}

#[test]
fn the_line_carries_the_secret_only_when_it_answers_one() {
    let secret = "ab".repeat(32);
    let line: serde_json::Value = serde_json::from_str(&storage_secret::answer_line(
        &Answer::Secret(Zeroizing::new(secret.clone())),
    ))
    .unwrap();
    assert_eq!(line, serde_json::json!({ "secret": secret }));

    let none: serde_json::Value =
        serde_json::from_str(&storage_secret::answer_line(&Answer::None)).unwrap();
    assert_eq!(none, serde_json::json!({ "none": true }));

    let refused: serde_json::Value = serde_json::from_str(&storage_secret::answer_line(
        &Answer::Passphrase("Use at least 15 characters. Spaces count.".into()),
    ))
    .unwrap();
    assert_eq!(refused["refused"], "passphrase");
}

#[test]
fn a_storage_passphrase_derives_the_same_secret_for_the_same_folder_and_another_for_another() {
    let id_a = [7u8; 16];
    let id_b = [8u8; 16];
    let line = PassphraseLine {
        passphrase: Zeroizing::new("correct horse battery staple".into()),
        confirm: None,
    };
    let a1 = secret_of(storage_secret::answer_passphrase(
        &line, &id_a, false, CHEAP,
    ));
    let a2 = secret_of(storage_secret::answer_passphrase(
        &line, &id_a, false, CHEAP,
    ));
    let b = secret_of(storage_secret::answer_passphrase(
        &line, &id_b, false, CHEAP,
    ));
    assert!(storage_secret::is_secret_hex(&a1));
    assert_eq!(*a1, *a2);
    assert_ne!(*a1, *b);

    // NFKC, as custody's passphrases are: the same words typed another way open it.
    let wide = PassphraseLine {
        passphrase: Zeroizing::new("ｃｏｒｒｅｃｔ horse battery staple".into()),
        confirm: None,
    };
    assert_eq!(
        *secret_of(storage_secret::answer_passphrase(
            &wide, &id_a, false, CHEAP
        )),
        *a1
    );
}

#[test]
fn the_derivation_is_argon2id_salted_with_the_keyring_id() {
    use argon2::{Algorithm, Argon2, Params, Version};
    let id = [3u8; 16];
    let mut expected = [0u8; 32];
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(CHEAP.m_kib, CHEAP.t, CHEAP.p, Some(32)).unwrap(),
    )
    .hash_password_into(b"a storage passphrase", &id, &mut expected)
    .unwrap();
    let expected: String = expected.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(
        *storage_secret::derive("a storage passphrase", &id, CHEAP).unwrap(),
        expected
    );
    // The app derives at the desktop cost: m = 64 MiB, t = 3, p = 4.
    assert_eq!(storage_secret::PASSPHRASE_KDF, Kdf::DESKTOP);
    assert_eq!(
        (Kdf::DESKTOP.m_kib, Kdf::DESKTOP.t, Kdf::DESKTOP.p),
        (64 * 1024, 3, 4)
    );
}

#[test]
fn a_new_storage_passphrase_is_held_to_custodys_rules() {
    let id = [1u8; 16];
    let short = PassphraseLine {
        passphrase: Zeroizing::new("too short".into()),
        confirm: Some(Zeroizing::new("too short".into())),
    };
    match storage_secret::answer_passphrase(&short, &id, true, CHEAP) {
        Answer::Passphrase(words) => assert!(words.contains("at least 15")),
        other => panic!("answered {other:?}"),
    }
    let mismatch = PassphraseLine {
        passphrase: Zeroizing::new("a long enough passphrase".into()),
        confirm: Some(Zeroizing::new("a long enough passphrasf".into())),
    };
    assert!(matches!(
        storage_secret::answer_passphrase(&mismatch, &id, true, CHEAP),
        Answer::Passphrase(_)
    ));
    let good = PassphraseLine {
        passphrase: Zeroizing::new("a long enough passphrase".into()),
        confirm: Some(Zeroizing::new("a long enough passphrase".into())),
    };
    assert!(matches!(
        storage_secret::answer_passphrase(&good, &id, true, CHEAP),
        Answer::Secret(_)
    ));
}

#[test]
fn the_arguments_name_the_mode_and_the_folder_or_the_keyring_id() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().display().to_string();
    let args = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert_eq!(
        storage_secret::parse_args(args(&["make", "--data-folder", &path])).unwrap(),
        Command::Keyring {
            mode: Mode::Make,
            item: storage_secret::item_name(folder.path()),
        }
    );
    assert_eq!(
        storage_secret::parse_args(args(&[
            "derive",
            "--keyring-id",
            "000102030405060708090a0b0c0d0e0f",
            "--new"
        ]))
        .unwrap(),
        Command::Derive {
            keyring_id: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            new: true,
        }
    );
    assert!(storage_secret::parse_args(args(&["read"])).is_err());
    assert!(storage_secret::parse_args(args(&["derive", "--keyring-id", "zz"])).is_err());
    assert!(storage_secret::parse_args(args(&["derive", "--data-folder", &path])).is_err());
    assert!(storage_secret::parse_args(args(&["unlock"])).is_err());
}

#[test]
fn the_passphrase_line_is_read_from_json() {
    let mut input =
        std::io::Cursor::new(b"{\"passphrase\":\"words\",\"confirm\":\"words\"}\n".to_vec());
    let line = storage_secret::read_passphrase_line(&mut input).unwrap();
    assert_eq!(line.passphrase.as_str(), "words");
    assert_eq!(line.confirm.as_deref().map(String::as_str), Some("words"));
    let mut bad = std::io::Cursor::new(b"words\n".to_vec());
    assert!(storage_secret::read_passphrase_line(&mut bad).is_err());
}
