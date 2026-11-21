//! What the wallet passphrase ([`crate::wallet`]) and the storage secret ([`crate::storage_secret`])
//! share: each is one text kept in one keyring item, read and made by the Electron supervisor
//! through a command that answers with one JSON line.
//!
//! What is the same lives here: reaching the keyring, reading an item as text, reading a new item
//! back, and writing a line into one zeroised buffer. What differs stays with each: the text (its
//! generator and what it must look like), the line's key (`passphrase` or `secret`), and the
//! refusals each answers, which are different sets (the wallet's say whether the item is there all
//! the same; the storage secret's add a refused passphrase).

use ad4m_identity_client::VaultError;
use serde::Serialize;
use zeroize::Zeroizing;

use crate::store::SecretStore;

/// This computer's keyring for an item kept under `service` (the macOS keychain service; the Linux
/// Secret Service has none), or why there is none.
pub(crate) fn keyring(
    #[cfg_attr(not(target_os = "macos"), allow(unused_variables))] service: &'static str,
) -> Result<Box<dyn SecretStore>, VaultError> {
    #[cfg(target_os = "linux")]
    {
        // The custody folder every custody process takes the claim lock in; these items' own reads
        // and writes never take it.
        let home =
            dirs::home_dir().ok_or_else(|| VaultError::Unavailable("no home folder".into()))?;
        crate::store::SecretServiceStore::connect(&crate::host::custody_dir(&home))
            .map(|store| Box::new(store) as Box<dyn SecretStore>)
    }
    #[cfg(target_os = "macos")]
    {
        Ok(Box::new(crate::wallet::login_keychain::LoginKeychain::new(
            service,
        )))
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        Err(crate::store::no_keyring(
            "this app keeps no keyring item on this system",
        ))
    }
}

/// `ask` of the keyring kept under `service`, or `unreachable` of why there is none.
pub(crate) fn on_keyring<A>(
    service: &'static str,
    ask: impl FnOnce(&dyn SecretStore) -> A,
    unreachable: impl FnOnce(VaultError) -> A,
) -> A {
    match keyring(service) {
        Ok(store) => {
            let answered = ask(store.as_ref());
            // A store whose thread still waits on an unanswered prompt would hold the exit until it
            // is answered; the process ends here either way.
            std::mem::forget(store);
            answered
        }
        Err(e) => unreachable(e),
    }
}

/// The item `name` as text, if it is kept: `accept` turns what is there into what is kept of it, or
/// refuses it ([`VaultError::Tampered`]) where it is not a text of this kind. Not UTF-8 is refused
/// the same.
pub(crate) fn read(
    store: &dyn SecretStore,
    name: &str,
    accept: impl FnOnce(&str) -> Option<Zeroizing<String>>,
) -> Result<Option<Zeroizing<String>>, VaultError> {
    let Some(bytes) = store.get(name)?.map(Zeroizing::new) else {
        return Ok(None);
    };
    let text = std::str::from_utf8(&bytes).map_err(|_| VaultError::Tampered)?;
    accept(text).map(Some).ok_or(VaultError::Tampered)
}

/// Keeps `made` as the item `name` and reads it back: whether the keyring holds what was made, so
/// what is answered is what it holds. A failed write or read is the store's error.
pub(crate) fn keep_and_read_back(
    store: &dyn SecretStore,
    name: &str,
    made: &Zeroizing<String>,
    accept: impl FnOnce(&str) -> Option<Zeroizing<String>>,
) -> Result<bool, VaultError> {
    store.put(name, made.as_bytes())?;
    Ok(matches!(read(store, name, accept)?, Some(back) if *back == **made))
}

/// `line` as JSON, written straight into one buffer of `capacity` bytes, reserved up front and
/// zeroised on drop: no `serde_json::Value` or `String` in between holds the text, and the buffer is
/// never grown, which would free its old copy without zeroising it. Defence in depth on this side
/// only: the supervisor reads the line into JavaScript strings, and the executor keeps what it is
/// given, and neither is zeroised.
pub(crate) fn write_line(line: &impl Serialize, capacity: usize) -> Zeroizing<String> {
    let mut bytes = Zeroizing::new(Vec::with_capacity(capacity));
    serde_json::to_writer(&mut *bytes, line).expect("a line of strings is written to memory");
    debug_assert!(bytes.capacity() == capacity, "the line grew");
    // JSON is UTF-8; the buffer moves into the String, uncopied.
    Zeroizing::new(String::from_utf8(std::mem::take(&mut *bytes)).expect("JSON is UTF-8"))
}

/// Prints `line` and a newline on stdout: the command's whole answer.
pub(crate) fn print_line(line: &str) {
    use std::io::Write;
    let mut out = std::io::stdout().lock();
    let _ = out.write_all(line.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}
