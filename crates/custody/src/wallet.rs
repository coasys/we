//! The executor's wallet passphrase, kept in this computer's keyring for the Electron supervisor.
//!
//! **A stopgap ahead of AR-06.** Custody's steps need the executor's main agent, made and unlocked,
//! and WE used to make it only at "Create account", after the app before a session hands off: on a
//! new computer every identity door failed ("DID requested but not yet set in AgentService"). So the
//! Electron supervisor makes the main agent itself with a random passphrase and unlocks it at every
//! start, with no prompt, and this module keeps that passphrase. Slice 3's AR-06 (the storage
//! secret, `storage.unlock`) replaces it: the executor's storage is then unlocked by a secret of
//! its own, and this item and the `wallet-passphrase` command go.
//!
//! One item per executor data folder, named by the folder's canonical path ([`item_name`]). The
//! keyring is the one custody keeps master keys in, reached the same way: the Linux Secret Service
//! through [`SecretServiceStore`](crate::store::SecretServiceStore), whose every call waits at most
//! [`UNLOCK_WAIT`](crate::store::SecretServiceStore::UNLOCK_WAIT) on a locked keyring; on macOS the
//! login keychain. There is no file to fall back to: the passphrase rests unsealed, so only a
//! keyring may keep it, and a computer with none is answered [`Answer::Unavailable`].
//!
//! The refusals are three, and the supervisor treats them differently, so they are kept apart:
//!
//! - [`Answer::Unavailable`] — there is no keyring: no session bus, nothing on it answers for the
//!   Secret Service and nothing can be started to, or no keychain. The supervisor's one answer that
//!   gives a new agent the WE password instead, for good, so it says this and nothing else.
//! - [`Answer::Locked`] — the keyring is there and stayed locked: its prompt was dismissed, or
//!   nobody answered it within the bound.
//! - [`Answer::Failed`] — the keyring is there and the call failed: no answer within the bound with
//!   no prompt up, a D-Bus error part way, an item that was not kept. Asking again may work.
//!
//! A refused read also says whether the item is there all the same ([`SecretStore::contains`],
//! which unlocks nothing), so an agent whose passphrase is kept is known as one even where the note
//! the supervisor keeps of it was never written.
//!
//! The supervisor runs `we-custody wallet-passphrase read|make --data-folder <dir>` and reads one
//! JSON line ([`answer_line`]); nothing else is printed, and a refusal's line carries no secret.
//! What this process holds of the passphrase is zeroised when it is dropped; the supervisor's
//! JavaScript strings and the executor still hold plaintext copies, so this is defence in depth, not
//! zeroisation end to end.

use std::path::{Path, PathBuf};

use ad4m_identity_client::VaultError;
use rand_core::{OsRng, RngCore};
use serde::Serialize;
use zeroize::Zeroizing;

use crate::store::{is_keyring_locked, is_no_keyring, SecretStore};

/// What every wallet item's name starts with, apart from custody's own (`coasys.identity/`).
pub const ITEM_PREFIX: &str = "coasys.wallet/";

/// The item for the executor data folder `folder`: its canonical path, so one folder named two ways
/// is one item. A folder that does not exist yet is named as given.
pub fn item_name(folder: &Path) -> String {
    let folder = std::fs::canonicalize(folder).unwrap_or_else(|_| folder.to_path_buf());
    format!("{ITEM_PREFIX}{}", folder.display())
}

/// What the supervisor asks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// The kept passphrase, if there is one: an agent already made needs the one it was made with.
    Read,
    /// The kept passphrase, or a new one kept first: the agent is about to be made with it.
    Make,
}

/// How a call went.
#[derive(Debug)]
pub enum Answer {
    Passphrase(Zeroizing<String>),
    /// Nothing is kept for this folder.
    None,
    /// The keyring is there and locked, and was not unlocked within the bound (or its prompt was
    /// dismissed). `kept`: the item is there all the same.
    Locked {
        kept: bool,
    },
    /// The keyring is there and the call failed; why, in the store's words (no secret in them).
    /// `kept`: the item is there all the same.
    Failed {
        reason: String,
        kept: bool,
    },
    /// There is no keyring to use at all; why, in the store's words.
    Unavailable(String),
}

/// The answer for `error`. `kept`: whether the item is known to be there all the same.
fn refused(error: VaultError, kept: bool) -> Answer {
    if is_keyring_locked(&error) || matches!(error, VaultError::Cancelled) {
        Answer::Locked { kept }
    } else if is_no_keyring(&error) {
        Answer::Unavailable(error.to_string())
    } else {
        Answer::Failed {
            reason: error.to_string(),
            kept,
        }
    }
}

fn read(store: &dyn SecretStore, name: &str) -> Result<Option<Zeroizing<String>>, VaultError> {
    let Some(bytes) = store.get(name)?.map(Zeroizing::new) else {
        return Ok(None);
    };
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| VaultError::Tampered)?
        .to_string();
    Ok(Some(Zeroizing::new(text)))
}

/// 32 bytes from the OS, in base58: nothing a person types, so nothing short.
fn new_passphrase() -> Zeroizing<String> {
    let mut raw = Zeroizing::new([0u8; 32]);
    OsRng.fill_bytes(raw.as_mut());
    Zeroizing::new(bs58::encode(raw.as_ref()).into_string())
}

/// Answers `mode` for the item `name` in `store`. A make reads first, so a folder whose agent was
/// made, or nearly made, keeps the passphrase it has; a new one is read back after it is kept, so
/// what is answered is what the keyring holds. A read the keyring refuses says whether the item is
/// there all the same: asked first, as the asking unlocks nothing and prompts nobody, where after a
/// read left waiting on a prompt it would queue behind that prompt.
pub fn answer(store: &dyn SecretStore, name: &str, mode: Mode) -> Answer {
    let there = mode == Mode::Read && matches!(store.contains(name), Ok(true));
    let kept = match read(store, name) {
        Ok(kept) => kept,
        Err(e) => return refused(e, there),
    };
    match (kept, mode) {
        (Some(passphrase), _) => Answer::Passphrase(passphrase),
        (None, Mode::Read) => Answer::None,
        (None, Mode::Make) => {
            let made = new_passphrase();
            if let Err(e) = store.put(name, made.as_bytes()) {
                return refused(e, false);
            }
            match read(store, name) {
                Ok(Some(back)) if *back == *made => Answer::Passphrase(made),
                Ok(_) => Answer::Failed {
                    reason: "the keyring did not keep the passphrase".into(),
                    kept: false,
                },
                Err(e) => refused(e, false),
            }
        }
    }
}

/// The line as it is written: borrowed from the [`Answer`], so the passphrase is copied once, into
/// the line's own buffer.
#[derive(Serialize)]
#[serde(untagged)]
enum Line<'a> {
    Passphrase {
        passphrase: &'a str,
    },
    None {
        none: bool,
    },
    Refused {
        refused: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<&'a str>,
        /// Written only when true: the item is there all the same.
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        kept: bool,
    },
}

/// Everything in a line but its one text, with room to spare:
/// `{"refused":"failed","reason":"","kept":true}` is the longest, at 45 bytes.
const LINE_FRAME: usize = 64;

/// What [`answer_line`] reserves for `answer`'s line: its frame and its text with every character
/// escaped as `\u00XX`, six bytes, the most JSON writes for one byte. The line never needs more, so
/// its buffer is never grown.
pub fn line_capacity(answer: &Answer) -> usize {
    let text = match answer {
        Answer::Passphrase(p) => p.len(),
        Answer::Unavailable(reason) | Answer::Failed { reason, .. } => reason.len(),
        Answer::None | Answer::Locked { .. } => 0,
    };
    LINE_FRAME + 6 * text
}

/// The one line the command prints: `{"passphrase": …}`, `{"none": true}`, or
/// `{"refused": "locked" | "failed" | "unavailable", "reason": …, "kept": true}` (`reason` and
/// `kept` only where there is one, and where it is true).
///
/// Written straight into one buffer, reserved up front ([`line_capacity`]) and zeroised on drop: no
/// `serde_json::Value` or `String` in between holds the passphrase, and the buffer is never grown,
/// which would free its old copy without zeroising it. This is defence in depth on this side only,
/// not zeroisation end to end: the supervisor reads the line into JavaScript strings, and the
/// executor keeps the passphrase it is given, and neither is zeroised.
pub fn answer_line(answer: &Answer) -> Zeroizing<String> {
    let line = match answer {
        Answer::Passphrase(p) => Line::Passphrase { passphrase: p },
        Answer::None => Line::None { none: true },
        Answer::Locked { kept } => Line::Refused {
            refused: "locked",
            reason: None,
            kept: *kept,
        },
        Answer::Failed { reason, kept } => Line::Refused {
            refused: "failed",
            reason: Some(reason),
            kept: *kept,
        },
        Answer::Unavailable(reason) => Line::Refused {
            refused: "unavailable",
            reason: Some(reason),
            kept: false,
        },
    };
    let mut bytes = Zeroizing::new(Vec::with_capacity(line_capacity(answer)));
    serde_json::to_writer(&mut *bytes, &line).expect("a line of strings is written to memory");
    debug_assert!(bytes.capacity() == line_capacity(answer), "the line grew");
    // JSON is UTF-8; the buffer moves into the String, uncopied.
    Zeroizing::new(String::from_utf8(std::mem::take(&mut *bytes)).expect("JSON is UTF-8"))
}

/// `read|make --data-folder <dir>`: the mode and the item it names.
pub fn parse_args(args: impl IntoIterator<Item = String>) -> Result<(Mode, String), String> {
    let mut args = args.into_iter();
    let mode = match args.next().as_deref() {
        Some("read") => Mode::Read,
        Some("make") => Mode::Make,
        Some(other) => return Err(format!("unknown mode `{other}`: read or make")),
        None => return Err("a mode is required: read or make".into()),
    };
    let mut folder = None;
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--data-folder" => {
                folder = Some(PathBuf::from(
                    args.next().ok_or("--data-folder needs a value")?,
                ))
            }
            _ => return Err(format!("unknown argument `{flag}`")),
        }
    }
    let folder = folder.ok_or("--data-folder is required")?;
    Ok((mode, item_name(&folder)))
}

/// This computer's keyring for the wallet passphrase, or why there is none ([`no_keyring`] where
/// there is none at all; another error where it is there and could not be reached).
pub fn keyring() -> Result<Box<dyn SecretStore>, VaultError> {
    #[cfg(target_os = "linux")]
    {
        crate::store::SecretServiceStore::connect()
            .map(|store| Box::new(store) as Box<dyn SecretStore>)
    }
    #[cfg(target_os = "macos")]
    {
        Ok(Box::new(login_keychain::LoginKeychain::new(
            login_keychain::WALLET_SERVICE,
        )))
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        Err(crate::store::no_keyring(
            "this app keeps no keyring item on this system",
        ))
    }
}

/// The `wallet-passphrase` command: answers on stdout, one line, and exits 0; 2 on bad arguments.
pub fn main(args: impl IntoIterator<Item = String>) -> std::process::ExitCode {
    use std::io::Write;
    let (mode, name) = match parse_args(args) {
        Ok(parsed) => parsed,
        Err(problem) => {
            eprintln!("[we-custody] wallet-passphrase: {problem}");
            return std::process::ExitCode::from(2);
        }
    };
    let answered = match keyring() {
        Ok(store) => {
            let answered = answer(store.as_ref(), &name, mode);
            // A store whose thread still waits on an unanswered prompt would hold the exit until it
            // is answered; the process ends here either way.
            std::mem::forget(store);
            answered
        }
        Err(e) => refused(e, false),
    };
    let line = answer_line(&answered);
    let mut out = std::io::stdout().lock();
    let _ = out.write_all(line.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.flush();
    std::process::ExitCode::SUCCESS
}

/// macOS: a generic password in the login keychain, under the service it is made with
/// (`org.coasys.app.wallet` for the wallet item; the storage secret's is its own), account the item
/// name. Not the data-protection keychain custody keeps master keys in: that one needs a
/// signed build's entitlement, and its items ask for the person's presence at every read, where
/// this item is read at every start with no prompt. Every call waits at most
/// [`UNLOCK_WAIT`](login_keychain::UNLOCK_WAIT), as the Secret Service's do, so a locked keychain's
/// prompt nobody answers is answered as locked.
#[cfg(target_os = "macos")]
pub(crate) mod login_keychain {
    use std::sync::mpsc;
    use std::time::Duration;

    use core_foundation::base::{CFType, TCFType};
    use core_foundation::data::CFData;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };
    use security_framework_sys::item::{
        kSecAttrAccount, kSecAttrService, kSecClass, kSecClassGenericPassword, kSecValueData,
    };
    use security_framework_sys::keychain_item::SecItemAdd;

    use super::*;
    use crate::store::{keyring_locked, no_keyring, StoreKind};

    pub const UNLOCK_WAIT: Duration = Duration::from_secs(90);
    pub const WALLET_SERVICE: &str = "org.coasys.app.wallet";
    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;
    const ERR_SEC_DUPLICATE_ITEM: i32 = -25299;
    const ERR_SEC_USER_CANCELED: i32 = -128;
    const ERR_SEC_AUTH_FAILED: i32 = -25293;
    const ERR_SEC_INTERACTION_NOT_ALLOWED: i32 = -25308;
    /// No default keychain, and no keychain by the name asked: there is no keychain to keep it in.
    const ERR_SEC_NO_DEFAULT_KEYCHAIN: i32 = -25307;
    const ERR_SEC_NO_SUCH_KEYCHAIN: i32 = -25294;

    pub struct LoginKeychain {
        service: &'static str,
    }

    impl LoginKeychain {
        pub fn new(service: &'static str) -> Self {
            LoginKeychain { service }
        }
    }

    fn refused(e: security_framework::base::Error) -> VaultError {
        match e.code() {
            ERR_SEC_USER_CANCELED | ERR_SEC_AUTH_FAILED | ERR_SEC_INTERACTION_NOT_ALLOWED => {
                keyring_locked()
            }
            ERR_SEC_NO_DEFAULT_KEYCHAIN | ERR_SEC_NO_SUCH_KEYCHAIN => {
                no_keyring(format!("keychain: {e}"))
            }
            // Another failure of a keychain that is there: `failed`, not `unavailable`.
            _ => VaultError::Unavailable(format!("keychain: {e}")),
        }
    }

    /// `job` on a thread of its own, answered within [`UNLOCK_WAIT`]; past it, the keychain is
    /// taken to be locked behind a prompt nobody answered. The caller exits soon after, which ends
    /// the job.
    fn bounded<T: Send + 'static>(
        job: impl FnOnce() -> Result<T, VaultError> + Send + 'static,
    ) -> Result<T, VaultError> {
        let (answer, answered) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = answer.send(job());
        });
        answered
            .recv_timeout(UNLOCK_WAIT)
            .unwrap_or_else(|_| Err(keyring_locked()))
    }

    impl SecretStore for LoginKeychain {
        fn kind(&self) -> StoreKind {
            StoreKind::Keychain
        }

        fn kind_of(&self, _: &str) -> Result<StoreKind, VaultError> {
            Ok(StoreKind::Keychain)
        }

        fn put(&self, name: &str, bytes: &[u8]) -> Result<(), VaultError> {
            let (name, bytes) = (name.to_string(), Zeroizing::new(bytes.to_vec()));
            let service = self.service;
            bounded(move || set_generic_password(service, &name, &bytes).map_err(refused))
        }

        fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError> {
            let name = name.to_string();
            let service = self.service;
            bounded(move || match get_generic_password(service, &name) {
                Ok(bytes) => Ok(Some(bytes)),
                Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
                Err(e) => Err(refused(e)),
            })
        }

        fn contains(&self, name: &str) -> Result<bool, VaultError> {
            Ok(self.get(name)?.is_some())
        }

        /// One plain `SecItemAdd` in the login keychain, with no delete before it and no update
        /// after it (as `set_generic_password` would make on `errSecDuplicateItem`): the keychain
        /// adds the item only when no item of this service and account is kept, and answers
        /// `errSecDuplicateItem` when one is, which is a lost claim.
        fn claim_public(&self, name: &str, bytes: &[u8]) -> Result<bool, VaultError> {
            let (name, bytes) = (name.to_string(), bytes.to_vec());
            let service = self.service;
            bounded(move || {
                let pairs: Vec<(CFString, CFType)> = unsafe {
                    vec![
                        (
                            CFString::wrap_under_get_rule(kSecClass),
                            CFString::wrap_under_get_rule(kSecClassGenericPassword).into_CFType(),
                        ),
                        (
                            CFString::wrap_under_get_rule(kSecAttrService),
                            CFString::new(service).into_CFType(),
                        ),
                        (
                            CFString::wrap_under_get_rule(kSecAttrAccount),
                            CFString::new(&name).into_CFType(),
                        ),
                        (
                            CFString::wrap_under_get_rule(kSecValueData),
                            CFData::from_buffer(&bytes).into_CFType(),
                        ),
                    ]
                };
                let attributes = CFDictionary::from_CFType_pairs(&pairs);
                // No `kSecReturn*` key, so no result is asked for: a null result pointer.
                match unsafe { SecItemAdd(attributes.as_concrete_TypeRef(), std::ptr::null_mut()) }
                {
                    0 => Ok(true),
                    ERR_SEC_DUPLICATE_ITEM => Ok(false),
                    code => Err(refused(security_framework::base::Error::from_code(code))),
                }
            })
        }

        fn delete(&self, name: &str) -> Result<(), VaultError> {
            let name = name.to_string();
            let service = self.service;
            bounded(move || match delete_generic_password(service, &name) {
                Err(e) if e.code() != ERR_SEC_ITEM_NOT_FOUND => Err(refused(e)),
                _ => Ok(()),
            })
        }
    }
}
