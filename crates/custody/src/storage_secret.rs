//! The executor's storage secret, kept in this computer's keyring for the desktop supervisor.
//!
//! The executor keeps its data encrypted on disk under keys it derives from a 32-byte storage
//! secret, and starts sealed: nothing but its storage status and `storage.unlock` answers until it
//! is handed that secret. The secret never rests in the data folder. On a desktop it rests in the
//! OS keyring, one item per executor data folder, and the supervisor reads it at every start,
//! hands it to the executor and forgets it.
//!
//! The item is named for the folder's absolute path, hashed ([`item_name`]): `adam-storage-` and
//! the first 16 hex characters of the SHA-256 of the path, so the name carries no path and one
//! folder named two ways is one item. It holds the secret as 64 lowercase hex characters, which is
//! what `storage.unlock` takes. On macOS it is a generic password in the login keychain, service
//! [`SERVICE`], read with no prompt (the custody item asks for the person at every read; this one
//! is read at every start). On Linux it is a Secret Service item, reached as custody's own items
//! are, each call waiting at most the store's bound on a locked keyring.
//!
//! Where there is no keyring at all (a Linux desktop with no Secret Service) the secret is not kept
//! anywhere: the person gives a storage passphrase at each start, and [`derive`] makes the secret
//! from it with Argon2id, salted with the executor's keyring id, so the same words open the same
//! folder and a different folder's data is not opened by them.
//!
//! The supervisor runs `we-custody storage-secret read|make --data-folder <dir>`, or
//! `we-custody storage-secret derive --keyring-id <hex> [--new]` with the passphrase as a JSON line
//! on stdin, and reads one JSON line ([`answer_line`]). Nothing else is printed, and no line but
//! `{"secret": …}` carries a secret.

use std::io::BufRead;
use std::path::{Path, PathBuf};

use ad4m_identity_client::VaultError;
use argon2::{Algorithm, Argon2, Params, Version};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::seal::{self, Kdf, PassphraseProblem};
use crate::store::{is_keyring_locked, is_no_keyring, SecretStore};

/// What every storage item's name starts with.
pub const ITEM_PREFIX: &str = "adam-storage-";

/// The macOS keychain service the item is kept under; the account is [`item_name`].
pub const SERVICE: &str = "org.coasys.app";

/// The secret's length in bytes; it is kept and handed over as twice as many hex characters.
pub const SECRET_BYTES: usize = 32;

/// The item for the executor data folder `folder`: its absolute path, canonical where the folder
/// exists, hashed. A folder that does not exist yet is named by its absolute path as given.
pub fn item_name(folder: &Path) -> String {
    let absolute = std::fs::canonicalize(folder).unwrap_or_else(|_| {
        if folder.is_absolute() {
            folder.to_path_buf()
        } else {
            std::env::current_dir()
                .map(|here| here.join(folder))
                .unwrap_or_else(|_| folder.to_path_buf())
        }
    });
    let digest = Sha256::digest(absolute.as_os_str().as_encoded_bytes());
    format!("{ITEM_PREFIX}{}", secret_hex(&digest[..8]).as_str())
}

/// `bytes` as lowercase hex, in a buffer reserved up front and zeroised on drop.
fn secret_hex(bytes: &[u8]) -> Zeroizing<String> {
    let mut out = Zeroizing::new(String::with_capacity(bytes.len() * 2));
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    out
}

/// Whether `text` is a secret as the executor takes one: 64 hex characters.
pub fn is_secret_hex(text: &str) -> bool {
    text.len() == SECRET_BYTES * 2 && text.bytes().all(|b| b.is_ascii_hexdigit())
}

/// What the supervisor asks of the keyring.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// The kept secret, if there is one: a folder the executor has keys for needs the one they
    /// were made under.
    Read,
    /// The kept secret, or a new one kept first: a folder starting for the first time.
    Make,
}

/// How a call went.
#[derive(Debug)]
pub enum Answer {
    /// The secret, as 64 hex characters.
    Secret(Zeroizing<String>),
    /// Nothing is kept for this folder.
    None,
    /// The keyring is there and locked, and was not unlocked within the bound (or its prompt was
    /// dismissed).
    Locked,
    /// The keyring is there and the call failed; why, in the store's words (no secret in them).
    Failed(String),
    /// There is no keyring to use at all; why, in the store's words.
    Unavailable(String),
    /// A storage passphrase was refused before anything was derived from it: too short, too long,
    /// or not the same twice. The person's words for it.
    Passphrase(String),
}

fn refused(error: VaultError) -> Answer {
    if is_keyring_locked(&error) || matches!(error, VaultError::Cancelled) {
        Answer::Locked
    } else if is_no_keyring(&error) {
        Answer::Unavailable(error.to_string())
    } else {
        Answer::Failed(error.to_string())
    }
}

fn read(store: &dyn SecretStore, name: &str) -> Result<Option<Zeroizing<String>>, VaultError> {
    let Some(bytes) = store.get(name)?.map(Zeroizing::new) else {
        return Ok(None);
    };
    let text = std::str::from_utf8(&bytes).map_err(|_| VaultError::Tampered)?;
    if !is_secret_hex(text) {
        return Err(VaultError::Tampered);
    }
    Ok(Some(Zeroizing::new(text.to_ascii_lowercase())))
}

/// 32 bytes from the OS, as hex.
fn new_secret() -> Zeroizing<String> {
    let mut raw = Zeroizing::new([0u8; SECRET_BYTES]);
    OsRng.fill_bytes(raw.as_mut());
    secret_hex(raw.as_ref())
}

/// Answers `mode` for the item `name` in `store`. A make reads first, so a folder whose secret was
/// kept keeps it; a new one is read back after it is kept, so what is answered is what the keyring
/// holds. An item that is not a secret (not 64 hex characters) is a failure, never replaced: the
/// folder's data may be under it.
pub fn answer(store: &dyn SecretStore, name: &str, mode: Mode) -> Answer {
    let kept = match read(store, name) {
        Ok(kept) => kept,
        Err(VaultError::Tampered) => {
            return Answer::Failed("the keyring item is not a storage secret".into())
        }
        Err(e) => return refused(e),
    };
    match (kept, mode) {
        (Some(secret), _) => Answer::Secret(secret),
        (None, Mode::Read) => Answer::None,
        (None, Mode::Make) => {
            let made = new_secret();
            if let Err(e) = store.put(name, made.as_bytes()) {
                return refused(e);
            }
            match read(store, name) {
                Ok(Some(back)) if *back == *made => Answer::Secret(made),
                Ok(_) | Err(VaultError::Tampered) => {
                    Answer::Failed("the keyring did not keep the secret".into())
                }
                Err(e) => refused(e),
            }
        }
    }
}

/// The Argon2id cost a storage passphrase is derived at: the desktop cost custody seals with.
pub const PASSPHRASE_KDF: Kdf = Kdf::DESKTOP;

/// The secret for `passphrase` on the folder whose keyring id is `keyring_id` (16 bytes): Argon2id
/// over the passphrase as custody normalises one (NFKC), salted with the keyring id, at `kdf`.
pub fn derive(
    passphrase: &str,
    keyring_id: &[u8],
    kdf: Kdf,
) -> Result<Zeroizing<String>, VaultError> {
    let params = Params::new(kdf.m_kib, kdf.t, kdf.p, Some(SECRET_BYTES))
        .map_err(|e| VaultError::Unavailable(format!("argon2 parameters: {e}")))?;
    let mut key = Zeroizing::new([0u8; SECRET_BYTES]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(
            seal::normalise(passphrase).as_bytes(),
            keyring_id,
            &mut key[..],
        )
        .map_err(|e| VaultError::Unavailable(format!("argon2: {e}")))?;
    Ok(secret_hex(key.as_ref()))
}

/// The keyring id as the executor's status gives it: 32 hex characters, 16 bytes.
pub fn parse_keyring_id(text: &str) -> Result<[u8; 16], String> {
    if text.len() != 32 || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("--keyring-id takes 32 hex characters".into());
    }
    let mut out = [0u8; 16];
    for (i, pair) in text.as_bytes().chunks(2).enumerate() {
        let pair = std::str::from_utf8(pair).map_err(|_| "--keyring-id is not hex")?;
        out[i] = u8::from_str_radix(pair, 16).map_err(|_| "--keyring-id is not hex")?;
    }
    Ok(out)
}

/// What `derive` reads from stdin: one JSON line. `confirm` is the passphrase typed again, and only
/// a new passphrase (`--new`) has one.
#[derive(Deserialize)]
pub struct PassphraseLine {
    #[serde(deserialize_with = "zeroizing")]
    pub passphrase: Zeroizing<String>,
    #[serde(default, deserialize_with = "zeroizing_some")]
    pub confirm: Option<Zeroizing<String>>,
}

fn zeroizing<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Zeroizing<String>, D::Error> {
    String::deserialize(d).map(Zeroizing::new)
}

fn zeroizing_some<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Zeroizing<String>>, D::Error> {
    Option::<String>::deserialize(d).map(|s| s.map(Zeroizing::new))
}

/// Answers a storage passphrase: refused by custody's rules for a new passphrase where `new`
/// (length, and the same twice), else the secret derived from it.
pub fn answer_passphrase(line: &PassphraseLine, keyring_id: &[u8], new: bool, kdf: Kdf) -> Answer {
    if new {
        let confirm = line.confirm.as_deref().map(String::as_str).unwrap_or("");
        if let Err(problem) = seal::check_new(&line.passphrase, confirm) {
            return Answer::Passphrase(problem.message());
        }
    } else if line.passphrase.is_empty() {
        return Answer::Passphrase(PassphraseProblem::TooShort.message());
    }
    match derive(&line.passphrase, keyring_id, kdf) {
        Ok(secret) => Answer::Secret(secret),
        Err(e) => Answer::Failed(e.to_string()),
    }
}

#[derive(Serialize)]
#[serde(untagged)]
enum Line<'a> {
    Secret {
        secret: &'a str,
    },
    None {
        none: bool,
    },
    Refused {
        refused: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<&'a str>,
    },
}

/// Everything in a line but its one text, with room to spare:
/// `{"refused":"unavailable","reason":""}` is the longest frame.
const LINE_FRAME: usize = 64;

/// What [`answer_line`] reserves for `answer`'s line: its frame and its text with every byte
/// escaped as `\u00XX`, the most JSON writes for one byte. The buffer is never grown.
pub fn line_capacity(answer: &Answer) -> usize {
    let text = match answer {
        Answer::Secret(s) => s.len(),
        Answer::Unavailable(reason) | Answer::Failed(reason) | Answer::Passphrase(reason) => {
            reason.len()
        }
        Answer::None | Answer::Locked => 0,
    };
    LINE_FRAME + 6 * text
}

/// The one line the command prints: `{"secret": …}`, `{"none": true}`, or
/// `{"refused": "locked" | "failed" | "unavailable" | "passphrase", "reason": …}`. Written straight
/// into one buffer reserved up front and zeroised on drop, as the wallet line is.
pub fn answer_line(answer: &Answer) -> Zeroizing<String> {
    let line = match answer {
        Answer::Secret(s) => Line::Secret { secret: s },
        Answer::None => Line::None { none: true },
        Answer::Locked => Line::Refused {
            refused: "locked",
            reason: None,
        },
        Answer::Failed(reason) => Line::Refused {
            refused: "failed",
            reason: Some(reason),
        },
        Answer::Unavailable(reason) => Line::Refused {
            refused: "unavailable",
            reason: Some(reason),
        },
        Answer::Passphrase(reason) => Line::Refused {
            refused: "passphrase",
            reason: Some(reason),
        },
    };
    let mut bytes = Zeroizing::new(Vec::with_capacity(line_capacity(answer)));
    serde_json::to_writer(&mut *bytes, &line).expect("a line of strings is written to memory");
    debug_assert!(bytes.capacity() == line_capacity(answer), "the line grew");
    Zeroizing::new(String::from_utf8(std::mem::take(&mut *bytes)).expect("JSON is UTF-8"))
}

/// What the command was asked.
#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    /// `read|make --data-folder <dir>`, with the item the folder names.
    Keyring { mode: Mode, item: String },
    /// `derive --keyring-id <hex> [--new]`.
    Derive { keyring_id: [u8; 16], new: bool },
}

pub fn parse_args(args: impl IntoIterator<Item = String>) -> Result<Command, String> {
    let mut args = args.into_iter();
    let first = args.next();
    let mode = match first.as_deref() {
        Some("read") => Some(Mode::Read),
        Some("make") => Some(Mode::Make),
        Some("derive") => None,
        Some(other) => return Err(format!("unknown mode `{other}`: read, make or derive")),
        None => return Err("a mode is required: read, make or derive".into()),
    };
    let (mut folder, mut keyring_id, mut new) = (None, None, false);
    while let Some(flag) = args.next() {
        match (flag.as_str(), mode) {
            ("--data-folder", Some(_)) => {
                folder = Some(PathBuf::from(
                    args.next().ok_or("--data-folder needs a value")?,
                ))
            }
            ("--keyring-id", None) => {
                keyring_id = Some(parse_keyring_id(
                    &args.next().ok_or("--keyring-id needs a value")?,
                )?)
            }
            ("--new", None) => new = true,
            _ => return Err(format!("unknown argument `{flag}`")),
        }
    }
    match mode {
        Some(mode) => Ok(Command::Keyring {
            mode,
            item: item_name(&folder.ok_or("--data-folder is required")?),
        }),
        None => Ok(Command::Derive {
            keyring_id: keyring_id.ok_or("--keyring-id is required")?,
            new,
        }),
    }
}

/// This computer's keyring for the storage secret, or why there is none.
pub fn keyring() -> Result<Box<dyn SecretStore>, VaultError> {
    #[cfg(target_os = "linux")]
    {
        crate::store::SecretServiceStore::connect()
            .map(|store| Box::new(store) as Box<dyn SecretStore>)
    }
    #[cfg(target_os = "macos")]
    {
        Ok(Box::new(crate::wallet::login_keychain::LoginKeychain::new(
            SERVICE,
        )))
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        Err(crate::store::no_keyring(
            "this app keeps no keyring item on this system",
        ))
    }
}

/// Reads the passphrase line from `input`: one line of JSON, zeroised once parsed.
pub fn read_passphrase_line(input: &mut impl BufRead) -> Result<PassphraseLine, String> {
    let mut raw = Zeroizing::new(String::with_capacity(1024));
    input
        .read_line(&mut raw)
        .map_err(|e| format!("reading the passphrase: {e}"))?;
    serde_json::from_str(raw.trim_end()).map_err(|_| "the passphrase line is not JSON".into())
}

/// The `storage-secret` command: answers on stdout, one line, and exits 0; 2 on bad arguments or a
/// passphrase line that is not one.
pub fn main(args: impl IntoIterator<Item = String>) -> std::process::ExitCode {
    use std::io::Write;
    let command = match parse_args(args) {
        Ok(command) => command,
        Err(problem) => {
            eprintln!("[we-custody] storage-secret: {problem}");
            return std::process::ExitCode::from(2);
        }
    };
    let answered = match command {
        Command::Keyring { mode, item } => match keyring() {
            Ok(store) => {
                let answered = answer(store.as_ref(), &item, mode);
                // A store whose thread still waits on an unanswered prompt would hold the exit
                // until it is answered; the process ends here either way.
                std::mem::forget(store);
                answered
            }
            Err(e) => refused(e),
        },
        Command::Derive { keyring_id, new } => {
            let line = match read_passphrase_line(&mut std::io::stdin().lock()) {
                Ok(line) => line,
                Err(problem) => {
                    eprintln!("[we-custody] storage-secret: {problem}");
                    return std::process::ExitCode::from(2);
                }
            };
            answer_passphrase(&line, &keyring_id, new, PASSPHRASE_KDF)
        }
    };
    let line = answer_line(&answered);
    let mut out = std::io::stdout().lock();
    let _ = out.write_all(line.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.flush();
    std::process::ExitCode::SUCCESS
}
