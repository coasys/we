//! The custody item, and sealing it under a passphrase (AR-03 4.4.4, Linux).
//!
//! On Linux the Secret Service opens with the login session, so it alone is no per-use unlock: the
//! item is sealed with XChaCha20-Poly1305 under `Argon2id(passphrase, salt, m = 64 MiB, t = 3,
//! p = 4)` before it is stored, and the passphrase is typed in the identity window for each flow.
//! On macOS the keychain item's access control is the unlock, and the item is stored as it is.
//!
//! The item's bytes are written by hand rather than through serde, so nothing derives a
//! serialisation of the master key that could be reached from elsewhere.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use unicode_normalization::UnicodeNormalization;
use zeroize::{Zeroize, Zeroizing};

use ad4m_identity_client::VaultError;

/// The version byte of a custody item.
const ITEM_V: u8 = 1;
/// The sealed blob's prefix: the format, so a later format can tell its own from this one.
const SEALED_MAGIC: &[u8; 16] = b"coasys-custody/1";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;

/// The passphrase's shortest length, in Unicode scalars after NFKC (AR-03 4.7.1).
pub const PASSPHRASE_MIN_CHARS: usize = 15;
/// And its longest.
pub const PASSPHRASE_MAX_CHARS: usize = 256;

/// One identity's custody item: the master key it holds and its index (no custody key, 21.5).
pub struct CustodyItem {
    pub scid: String,
    pub index: u32,
    pub master: Zeroizing<[u8; 32]>,
}

impl CustodyItem {
    /// `v | index (u32 LE) | master (32) | scid (UTF-8)`.
    pub fn to_bytes(&self) -> Zeroizing<Vec<u8>> {
        let mut out = Zeroizing::new(Vec::with_capacity(1 + 4 + 32 + self.scid.len()));
        out.push(ITEM_V);
        out.extend_from_slice(&self.index.to_le_bytes());
        out.extend_from_slice(&self.master[..]);
        out.extend_from_slice(self.scid.as_bytes());
        out
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<CustodyItem, VaultError> {
        if bytes.len() < 1 + 4 + 32 || bytes[0] != ITEM_V {
            return Err(VaultError::Tampered);
        }
        let index = u32::from_le_bytes(bytes[1..5].try_into().map_err(|_| VaultError::Tampered)?);
        let mut master = Zeroizing::new([0u8; 32]);
        master.copy_from_slice(&bytes[5..37]);
        let scid = std::str::from_utf8(&bytes[37..]).map_err(|_| VaultError::Tampered)?.to_string();
        Ok(CustodyItem { scid, index, master })
    }
}

/// Why a passphrase is refused before anything is derived from it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PassphraseProblem {
    TooShort,
    TooLong,
    Mismatch,
}

impl PassphraseProblem {
    pub fn message(&self) -> String {
        match self {
            PassphraseProblem::TooShort => {
                format!("Use at least {PASSPHRASE_MIN_CHARS} characters. Spaces count.")
            }
            PassphraseProblem::TooLong => format!("Use at most {PASSPHRASE_MAX_CHARS} characters."),
            PassphraseProblem::Mismatch => "The two passphrases are not the same.".into(),
        }
    }
}

/// The passphrase as it is derived from: NFKC, so the same words typed on another keyboard open it.
pub fn normalise(passphrase: &str) -> Zeroizing<String> {
    Zeroizing::new(passphrase.nfkc().collect())
}

/// The rules for a new passphrase (AR-03 4.7.1): length only, no composition rules. The breached
/// list that section also asks for is not in slice 1.
pub fn check_new(passphrase: &str, confirm: &str) -> Result<(), PassphraseProblem> {
    let normal = normalise(passphrase);
    let chars = normal.chars().count();
    if chars < PASSPHRASE_MIN_CHARS {
        return Err(PassphraseProblem::TooShort);
    }
    if chars > PASSPHRASE_MAX_CHARS {
        return Err(PassphraseProblem::TooLong);
    }
    if *normal != *normalise(confirm) {
        return Err(PassphraseProblem::Mismatch);
    }
    Ok(())
}

/// The Argon2id cost. [`Kdf::DESKTOP`] in every build; tests pass a cheaper one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Kdf {
    pub m_kib: u32,
    pub t: u32,
    pub p: u32,
}

impl Kdf {
    /// AR-03 4.4.4: m = 64 MiB, t = 3, p = 4.
    pub const DESKTOP: Kdf = Kdf { m_kib: 64 * 1024, t: 3, p: 4 };
}

fn derive(passphrase: &str, salt: &[u8], kdf: Kdf) -> Result<Zeroizing<[u8; 32]>, VaultError> {
    let params = Params::new(kdf.m_kib, kdf.t, kdf.p, Some(32))
        .map_err(|e| VaultError::Unavailable(format!("argon2 parameters: {e}")))?;
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(normalise(passphrase).as_bytes(), salt, &mut key[..])
        .map_err(|e| VaultError::Unavailable(format!("argon2: {e}")))?;
    Ok(key)
}

/// `magic | m_kib | t | p | salt | nonce | ciphertext`, the parameters in the blob so a later
/// change of cost still opens what was sealed before it. The scid is the AEAD's associated data.
pub fn seal(item: &CustodyItem, passphrase: &str, kdf: Kdf, random: &dyn Fn(&mut [u8])) -> Result<Vec<u8>, VaultError> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    random(&mut salt);
    random(&mut nonce);
    let key = derive(passphrase, &salt, kdf)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key[..]).map_err(|_| VaultError::Tampered)?;
    let plain = item.to_bytes();
    let sealed = cipher
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: &plain, aad: item.scid.as_bytes() })
        .map_err(|_| VaultError::Unavailable("sealing failed".into()))?;
    let mut out = Vec::with_capacity(16 + 12 + SALT_LEN + NONCE_LEN + sealed.len());
    out.extend_from_slice(SEALED_MAGIC);
    for n in [kdf.m_kib, kdf.t, kdf.p] {
        out.extend_from_slice(&n.to_le_bytes());
    }
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// Opens a sealed item. A wrong passphrase and a changed blob are the same answer, `Cancelled`
/// for the person (they typed something else) — the flow returns to the passphrase screen.
pub fn open(blob: &[u8], scid: &str, passphrase: &str) -> Result<CustodyItem, VaultError> {
    let header = 16 + 12 + SALT_LEN + NONCE_LEN;
    if blob.len() <= header || &blob[..16] != SEALED_MAGIC {
        return Err(VaultError::Tampered);
    }
    let num = |at: usize| u32::from_le_bytes(blob[at..at + 4].try_into().unwrap_or([0; 4]));
    let kdf = Kdf { m_kib: num(16), t: num(20), p: num(24) };
    // Refuse a blob asking for a cost below the floor a hostile file could pick to make guessing cheap.
    if kdf.m_kib < 8 * 1024 && !cfg!(test) && !cfg!(feature = "cheap-kdf") {
        return Err(VaultError::Tampered);
    }
    let salt = &blob[28..28 + SALT_LEN];
    let nonce = &blob[28 + SALT_LEN..header];
    let key = derive(passphrase, salt, kdf)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key[..]).map_err(|_| VaultError::Tampered)?;
    let mut plain = cipher
        .decrypt(XNonce::from_slice(nonce), Payload { msg: &blob[header..], aad: scid.as_bytes() })
        .map_err(|_| VaultError::Cancelled)?;
    let item = CustodyItem::from_bytes(&plain);
    plain.zeroize();
    let item = item?;
    if item.scid != scid {
        return Err(VaultError::Tampered);
    }
    Ok(item)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHEAP: Kdf = Kdf { m_kib: 64, t: 1, p: 1 };

    fn item() -> CustodyItem {
        CustodyItem { scid: "QmScid".into(), index: 2, master: Zeroizing::new([7u8; 32]) }
    }

    fn counter() -> impl Fn(&mut [u8]) {
        |out: &mut [u8]| rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, out)
    }

    #[test]
    fn a_sealed_item_opens_with_its_passphrase_only() {
        let blob = seal(&item(), "correct horse battery", CHEAP, &counter()).unwrap();
        let opened = open(&blob, "QmScid", "correct horse battery").unwrap();
        assert_eq!((opened.index, *opened.master), (2, [7u8; 32]));
        assert_eq!(open(&blob, "QmScid", "wrong horse battery!").err(), Some(VaultError::Cancelled));
        // The blob is bound to its identity.
        assert!(open(&blob, "QmOther", "correct horse battery").is_err());
    }

    #[test]
    fn the_master_key_is_not_in_the_sealed_blob() {
        let blob = seal(&item(), "correct horse battery", CHEAP, &counter()).unwrap();
        assert!(!blob.windows(32).any(|w| w == [7u8; 32]));
    }

    #[test]
    fn a_changed_blob_does_not_open() {
        let mut blob = seal(&item(), "correct horse battery", CHEAP, &counter()).unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 1;
        assert!(open(&blob, "QmScid", "correct horse battery").is_err());
        assert_eq!(open(b"nonsense", "QmScid", "x").err(), Some(VaultError::Tampered));
    }

    #[test]
    fn the_same_passphrase_typed_another_way_opens_it() {
        // "ﬁ" (U+FB01) is "fi" after NFKC.
        let blob = seal(&item(), "ﬁve finches fly far", CHEAP, &counter()).unwrap();
        assert!(open(&blob, "QmScid", "five finches fly far").is_ok());
    }

    #[test]
    fn a_new_passphrase_needs_fifteen_characters_typed_twice() {
        assert_eq!(check_new("short", "short"), Err(PassphraseProblem::TooShort));
        assert_eq!(check_new("fifteen chars ok", "fifteen chars ok!"), Err(PassphraseProblem::Mismatch));
        assert_eq!(check_new("fifteen chars ok", "fifteen chars ok"), Ok(()));
        assert_eq!(check_new(&"x".repeat(257), &"x".repeat(257)), Err(PassphraseProblem::TooLong));
    }

    #[test]
    fn the_desktop_cost_is_the_one_ar03_names() {
        assert_eq!(Kdf::DESKTOP, Kdf { m_kib: 65536, t: 3, p: 4 });
    }
}
