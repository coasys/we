//! The executor's wallet passphrase in this computer's keyring (`we_custody::wallet`), over the
//! in-memory store: one item per data folder, made once and read back the same, and a keyring that
//! refuses answered as refused — with the passphrase never in what is answered about a refusal.

use std::sync::Mutex;

use ad4m_identity_client::VaultError;
use we_custody::store::{keyring_locked, no_keyring, MemoryStore, SecretStore, StoreKind};
use we_custody::wallet::{self, Answer, Mode};

#[test]
fn a_first_make_keeps_a_new_passphrase_and_every_read_after_answers_the_same_one() {
    let store = MemoryStore::new();
    let folder = tempfile::tempdir().unwrap();
    let name = wallet::item_name(folder.path());

    assert!(matches!(
        wallet::answer(&store, &name, Mode::Read),
        Answer::None
    ));

    let made = match wallet::answer(&store, &name, Mode::Make) {
        Answer::Passphrase(p) => p,
        other => panic!("make answered {other:?}"),
    };
    // Long and random: 32 bytes from the OS, in base58.
    assert!(
        made.len() >= 40,
        "a passphrase of {} characters",
        made.len()
    );

    for mode in [Mode::Read, Mode::Make] {
        match wallet::answer(&store, &name, mode) {
            Answer::Passphrase(p) => assert_eq!(*p, *made),
            other => panic!("{mode:?} answered {other:?}"),
        }
    }
}

#[test]
fn each_data_folder_has_its_own_item_and_its_own_passphrase() {
    let store = MemoryStore::new();
    let one = tempfile::tempdir().unwrap();
    let two = tempfile::tempdir().unwrap();
    let (a, b) = (wallet::item_name(one.path()), wallet::item_name(two.path()));
    assert_ne!(a, b);
    assert!(a.starts_with(wallet::ITEM_PREFIX));

    let pa = wallet::answer(&store, &a, Mode::Make);
    let pb = wallet::answer(&store, &b, Mode::Make);
    match (pa, pb) {
        (Answer::Passphrase(pa), Answer::Passphrase(pb)) => assert_ne!(*pa, *pb),
        other => panic!("answered {other:?}"),
    }
}

#[test]
fn the_same_folder_named_two_ways_is_one_item() {
    let folder = tempfile::tempdir().unwrap();
    let inner = folder.path().join("data");
    std::fs::create_dir(&inner).unwrap();
    let roundabout = folder.path().join("data").join("..").join("data");
    assert_eq!(wallet::item_name(&inner), wallet::item_name(&roundabout));
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
fn a_locked_keyring_is_answered_locked_and_nothing_is_written() {
    let store = Refusing {
        error: keyring_locked,
        writes: Mutex::new(0),
    };
    for mode in [Mode::Read, Mode::Make] {
        assert!(matches!(
            wallet::answer(&store, "coasys.wallet/x", mode),
            Answer::Locked { kept: false }
        ));
    }
    assert_eq!(*store.writes.lock().unwrap(), 0);
}

#[test]
fn a_keyring_that_is_not_there_is_answered_unavailable_with_its_reason() {
    let store = Refusing {
        error: || no_keyring("Secret Service: no such service"),
        writes: Mutex::new(0),
    };
    match wallet::answer(&store, "coasys.wallet/x", Mode::Make) {
        Answer::Unavailable(reason) => assert!(reason.contains("no such service")),
        other => panic!("answered {other:?}"),
    }
}

#[test]
fn a_dismissed_unlock_prompt_is_a_locked_keyring() {
    let store = Refusing {
        error: || VaultError::Cancelled,
        writes: Mutex::new(0),
    };
    assert!(matches!(
        wallet::answer(&store, "coasys.wallet/x", Mode::Read),
        Answer::Locked { kept: false }
    ));
}

/// Lal's review of #438: the supervisor gives an agent a WE password for good on `unavailable`, so
/// only a keyring that is not there may be answered so. A Secret Service that is there and fails — no
/// answer within the bound with no prompt up, a D-Bus error mid-call — is `failed`, which the
/// supervisor answers with "Try again".
#[test]
fn a_keyring_that_is_there_and_fails_is_answered_failed_not_unavailable() {
    const NO_ANSWER: &str = "Secret Service: no answer in 90 s";
    const ENDED: &str = "Secret Service: its thread ended";
    const NO_REPLY: &str =
        "Secret Service: zbus error: org.freedesktop.DBus.Error.NoReply: timed out";
    type MakeError = fn() -> VaultError;
    let errors: [(MakeError, &str); 3] = [
        (|| VaultError::Unavailable(NO_ANSWER.into()), NO_ANSWER),
        (|| VaultError::Unavailable(ENDED.into()), ENDED),
        (|| VaultError::Unavailable(NO_REPLY.into()), NO_REPLY),
    ];
    for (error, why) in errors {
        let store = Refusing {
            error,
            writes: Mutex::new(0),
        };
        for mode in [Mode::Read, Mode::Make] {
            let line: serde_json::Value = serde_json::from_str(&wallet::answer_line(
                &wallet::answer(&store, "coasys.wallet/x", mode),
            ))
            .unwrap();
            assert_eq!(line["refused"], "failed", "{why} on {mode:?}: {line}");
            assert!(line["reason"].as_str().unwrap().contains(why));
        }
    }
}

/// A keyring that refuses to open an item it does hold: locked behind a prompt, or failing.
struct Holding {
    error: fn() -> VaultError,
}

impl SecretStore for Holding {
    fn kind(&self) -> StoreKind {
        StoreKind::SecretService
    }
    fn kind_of(&self, _: &str) -> Result<StoreKind, VaultError> {
        Ok(StoreKind::SecretService)
    }
    fn put(&self, _: &str, _: &[u8]) -> Result<(), VaultError> {
        Err((self.error)())
    }
    fn claim_public(&self, _: &str, _: &[u8]) -> Result<bool, VaultError> {
        Err((self.error)())
    }
    fn get(&self, _: &str) -> Result<Option<Vec<u8>>, VaultError> {
        Err((self.error)())
    }
    // Asked without unlocking anything, as the Secret Service's `SearchItems` answers.
    fn contains(&self, _: &str) -> Result<bool, VaultError> {
        Ok(true)
    }
    fn delete(&self, _: &str) -> Result<(), VaultError> {
        Err((self.error)())
    }
}

/// Lal's review of #438: an agent whose passphrase the keyring keeps, with no note of it beside the
/// data folder (the note's write failed), was asked a WE password nobody knows. A read the keyring
/// refuses says when the item is there all the same, and the supervisor takes it as kept.
#[test]
fn a_refused_read_says_when_the_item_is_kept_all_the_same() {
    for (error, refused) in [
        (keyring_locked as fn() -> VaultError, "locked"),
        (
            || VaultError::Unavailable("Secret Service: no answer in 90 s".into()),
            "failed",
        ),
    ] {
        let store = Holding { error };
        let line: serde_json::Value = serde_json::from_str(&wallet::answer_line(&wallet::answer(
            &store,
            "coasys.wallet/x",
            Mode::Read,
        )))
        .unwrap();
        assert_eq!(line["refused"], refused);
        assert_eq!(line["kept"], true, "{line}");
    }
    // And says nothing of the kind where it does not know.
    let store = Refusing {
        error: keyring_locked,
        writes: Mutex::new(0),
    };
    let line: serde_json::Value = serde_json::from_str(&wallet::answer_line(&wallet::answer(
        &store,
        "coasys.wallet/x",
        Mode::Read,
    )))
    .unwrap();
    assert!(line.get("kept").is_none(), "{line}");
}

#[test]
fn the_answer_line_carries_the_passphrase_only_when_there_is_one() {
    let store = MemoryStore::new();
    let made = match wallet::answer(&store, "coasys.wallet/y", Mode::Make) {
        Answer::Passphrase(p) => p,
        other => panic!("answered {other:?}"),
    };
    let line: serde_json::Value =
        serde_json::from_str(&wallet::answer_line(&Answer::Passphrase(made.clone()))).unwrap();
    assert_eq!(line["passphrase"], made.as_str());

    for (answer, refused) in [
        (Answer::None, None),
        (Answer::Locked { kept: false }, Some("locked")),
        (Answer::Locked { kept: true }, Some("locked")),
        (
            Answer::Failed {
                reason: "why".into(),
                kept: true,
            },
            Some("failed"),
        ),
        (Answer::Unavailable("why".into()), Some("unavailable")),
    ] {
        let text = wallet::answer_line(&answer);
        assert!(!text.contains(made.as_str()));
        let line: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert!(line.get("passphrase").is_none());
        match refused {
            None => assert_eq!(line["none"], true),
            Some(kind) => assert_eq!(line["refused"], kind),
        }
    }
}

/// Lal's review of #438: the line held the passphrase in a `serde_json::Value`, and in the `String`
/// made from it, neither zeroised. It is written straight into one buffer, reserved up front for the
/// longest the line can be and never grown: a grown buffer frees its old copy without zeroising it.
#[test]
fn the_answer_line_is_written_into_one_buffer_that_is_never_grown() {
    // The longest a passphrase's line can be: every character escaped as `\u00XX`.
    let worst: String = (1u8..32).map(char::from).cycle().take(4096).collect();
    for answer in [
        Answer::Passphrase(zeroize::Zeroizing::new(worst.clone())),
        Answer::Passphrase(zeroize::Zeroizing::new("p".into())),
        Answer::Passphrase(zeroize::Zeroizing::new(String::new())),
        Answer::None,
        Answer::Locked { kept: true },
        Answer::Failed {
            reason: worst.clone(),
            kept: true,
        },
        Answer::Unavailable(worst.clone()),
    ] {
        let line = wallet::answer_line(&answer);
        assert_eq!(
            line.capacity(),
            wallet::line_capacity(&answer),
            "grown past what was reserved"
        );
        let value: serde_json::Value = serde_json::from_str(&line).unwrap();
        if let Answer::Passphrase(p) = &answer {
            assert_eq!(value["passphrase"], p.as_str());
            assert_eq!(value.as_object().unwrap().len(), 1);
        }
    }
}

#[test]
fn the_command_line_names_a_mode_and_a_data_folder() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().to_string_lossy().to_string();
    let args = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();

    let (mode, name) = wallet::parse_args(args(&["make", "--data-folder", &path])).unwrap();
    assert_eq!(mode, Mode::Make);
    assert_eq!(name, wallet::item_name(folder.path()));
    assert_eq!(
        wallet::parse_args(args(&["read", "--data-folder", &path]))
            .unwrap()
            .0,
        Mode::Read
    );
    assert!(wallet::parse_args(args(&["make"])).is_err());
    assert!(wallet::parse_args(args(&["burn", "--data-folder", &path])).is_err());
    assert!(wallet::parse_args(args(&["read", "--data-folder"])).is_err());
}
