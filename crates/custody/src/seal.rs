//! The custody item, and sealing it under a passphrase (every store but the macOS keychain).
//!
//! On Linux the Secret Service opens with the login session, so it alone is no per-use unlock, and
//! a file is none at all: the item is sealed with XChaCha20-Poly1305 under `Argon2id(passphrase,
//! salt, m = 64 MiB, t = 3, p = 4)` before it is stored, and the passphrase is typed in the
//! identity window for each flow. The same holds for the file a macOS build without the keychain
//! entitlement keeps. In the macOS keychain the item's access control is the unlock, and the item
//! is stored as it is.
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
/// The sealed blob's prefix: the format, so a later format can tell its own from this one. `/2`
/// carries the master index in the header, covered by the AEAD tag ([`sealed_index`]).
const SEALED_MAGIC: &[u8; 16] = b"coasys-custody/2";
/// The first format: no index in the header. Still opened; its index is read only from inside.
const SEALED_MAGIC_V1: &[u8; 16] = b"coasys-custody/1";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;
/// Where the Argon2id cost (m, t, p) sits in either format.
const KDF_AT: usize = 16;
const SALT_AT: usize = KDF_AT + 12;
const NONCE_AT: usize = SALT_AT + SALT_LEN;
/// Where `/2` keeps the master index (u32 LE), after the nonce.
const INDEX_AT: usize = NONCE_AT + NONCE_LEN;
const HEADER_V1: usize = INDEX_AT;
const HEADER_V2: usize = INDEX_AT + 4;

/// The passphrase's shortest length, in Unicode scalars after NFKC.
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
        let scid = std::str::from_utf8(&bytes[37..])
            .map_err(|_| VaultError::Tampered)?
            .to_string();
        Ok(CustodyItem {
            scid,
            index,
            master,
        })
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

/// The rules for a new passphrase: length only, no composition rules. A check against a list of
/// breached passwords is not made yet.
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
    /// m = 64 MiB, t = 3, p = 4: slow enough on a desktop to make guessing costly, quick enough
    /// to wait for once per flow.
    pub const DESKTOP: Kdf = Kdf {
        m_kib: 64 * 1024,
        t: 3,
        p: 4,
    };

    /// The most a sealed item may ask for: 1 GiB, 48 passes, 64 lanes.
    pub const CEILING: Kdf = Kdf {
        m_kib: 1024 * 1024,
        t: 48,
        p: 64,
    };

    fn within_ceiling(self) -> bool {
        self.m_kib <= Self::CEILING.m_kib && self.t <= Self::CEILING.t && self.p <= Self::CEILING.p
    }
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

/// The associated data of a `/2` blob: its whole header (magic, cost, salt, nonce, index), then
/// the scid. So the index read from the header with no passphrase ([`sealed_index`]) is the one
/// the tag covers: a changed index does not open.
fn aad_v2(header: &[u8], scid: &str) -> Vec<u8> {
    let mut aad = Vec::with_capacity(header.len() + scid.len());
    aad.extend_from_slice(header);
    aad.extend_from_slice(scid.as_bytes());
    aad
}

/// `magic | m_kib | t | p | salt | nonce | index | ciphertext`, the parameters in the blob so a
/// later change of cost still opens what was sealed before it, and the master index in clear
/// so it is read with no passphrase. The header and the scid are the AEAD's associated data.
pub fn seal(
    item: &CustodyItem,
    passphrase: &str,
    kdf: Kdf,
    random: &dyn Fn(&mut [u8]),
) -> Result<Vec<u8>, VaultError> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    random(&mut salt);
    random(&mut nonce);
    let key = derive(passphrase, &salt, kdf)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key[..]).map_err(|_| VaultError::Tampered)?;
    let mut out = Vec::with_capacity(HEADER_V2 + 1 + 4 + 32 + item.scid.len() + 16);
    out.extend_from_slice(SEALED_MAGIC);
    for n in [kdf.m_kib, kdf.t, kdf.p] {
        out.extend_from_slice(&n.to_le_bytes());
    }
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&item.index.to_le_bytes());
    let plain = item.to_bytes();
    let sealed = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &plain,
                aad: &aad_v2(&out, &item.scid),
            },
        )
        .map_err(|_| VaultError::Unavailable("sealing failed".into()))?;
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// The master index a sealed blob names in its header, read with no passphrase. `None` for a
/// blob of the first format (no index outside the ciphertext) or one that is not a sealed item.
///
/// The header is covered by the tag, so the index is the one [`open`] gives, or the blob does
/// not open at all: it names the key an unlock would give, never another.
pub fn sealed_index(blob: &[u8]) -> Option<u32> {
    if blob.len() <= HEADER_V2 || &blob[..16] != SEALED_MAGIC {
        return None;
    }
    Some(u32::from_le_bytes(
        blob[INDEX_AT..HEADER_V2].try_into().ok()?,
    ))
}

/// Opens a sealed item. A wrong passphrase and a changed blob are the same answer, `Cancelled`
/// for the person (they typed something else) — the flow returns to the passphrase screen.
pub fn open(blob: &[u8], scid: &str, passphrase: &str) -> Result<CustodyItem, VaultError> {
    let v2 = blob.len() > HEADER_V2 && &blob[..16] == SEALED_MAGIC;
    let v1 = blob.len() > HEADER_V1 && &blob[..16] == SEALED_MAGIC_V1;
    if !v1 && !v2 {
        return Err(VaultError::Tampered);
    }
    let header = if v2 { HEADER_V2 } else { HEADER_V1 };
    let num = |at: usize| u32::from_le_bytes(blob[at..at + 4].try_into().unwrap_or([0; 4]));
    let kdf = Kdf {
        m_kib: num(KDF_AT),
        t: num(KDF_AT + 4),
        p: num(KDF_AT + 8),
    };
    // Refuse a blob asking for a cost below the floor a hostile file could pick to make guessing cheap.
    if kdf.m_kib < 8 * 1024 && !cfg!(test) && !cfg!(feature = "cheap-kdf") {
        return Err(VaultError::Tampered);
    }
    // And above the ceiling one could pick to make opening it hang the service or exhaust memory:
    // sixteen times what this crate seals with, so a later, costlier setting still opens.
    if !kdf.within_ceiling() {
        return Err(VaultError::Tampered);
    }
    let salt = &blob[SALT_AT..NONCE_AT];
    let nonce = &blob[NONCE_AT..INDEX_AT];
    let key = derive(passphrase, salt, kdf)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key[..]).map_err(|_| VaultError::Tampered)?;
    let aad = if v2 {
        aad_v2(&blob[..header], scid)
    } else {
        scid.as_bytes().to_vec()
    };
    let mut plain = cipher
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: &blob[header..],
                aad: &aad,
            },
        )
        .map_err(|_| VaultError::Cancelled)?;
    let item = CustodyItem::from_bytes(&plain);
    plain.zeroize();
    let item = item?;
    if item.scid != scid {
        return Err(VaultError::Tampered);
    }
    // The header's index is covered by the tag; one sealed beside another index inside is not
    // what this crate writes.
    if v2 && sealed_index(blob) != Some(item.index) {
        return Err(VaultError::Tampered);
    }
    Ok(item)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHEAP: Kdf = Kdf {
        m_kib: 64,
        t: 1,
        p: 1,
    };

    fn item() -> CustodyItem {
        CustodyItem {
            scid: "QmScid".into(),
            index: 2,
            master: Zeroizing::new([7u8; 32]),
        }
    }

    fn counter() -> impl Fn(&mut [u8]) {
        |out: &mut [u8]| rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, out)
    }

    #[test]
    fn a_sealed_item_opens_with_its_passphrase_only() {
        let blob = seal(&item(), "correct horse battery", CHEAP, &counter()).unwrap();
        let opened = open(&blob, "QmScid", "correct horse battery").unwrap();
        assert_eq!((opened.index, *opened.master), (2, [7u8; 32]));
        assert_eq!(
            open(&blob, "QmScid", "wrong horse battery!").err(),
            Some(VaultError::Cancelled)
        );
        // The blob is bound to its identity.
        assert!(open(&blob, "QmOther", "correct horse battery").is_err());
    }

    /// The index is read from the header with no passphrase, and the tag covers it: a header
    /// that names another index does not open.
    #[test]
    fn the_index_is_read_without_the_passphrase_and_cannot_be_changed() {
        let blob = seal(&item(), "correct horse battery", CHEAP, &counter()).unwrap();
        assert_eq!(sealed_index(&blob), Some(2));
        let mut moved = blob.clone();
        moved[INDEX_AT..HEADER_V2].copy_from_slice(&5u32.to_le_bytes());
        assert_eq!(sealed_index(&moved), Some(5));
        assert!(open(&moved, "QmScid", "correct horse battery").is_err());
        assert_eq!(sealed_index(b"nonsense"), None);
    }

    /// A blob of the first format (sealed before the index was in the header) still opens, and
    /// its index cannot be vouched for without the passphrase.
    #[test]
    fn a_first_format_blob_opens_and_names_no_index() {
        let item = item();
        let mut salt = [0u8; SALT_LEN];
        let mut nonce = [0u8; NONCE_LEN];
        counter()(&mut salt);
        counter()(&mut nonce);
        let key = derive("correct horse battery", &salt, CHEAP).unwrap();
        let cipher = XChaCha20Poly1305::new_from_slice(&key[..]).unwrap();
        let sealed = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &item.to_bytes(),
                    aad: b"QmScid",
                },
            )
            .unwrap();
        let mut blob = SEALED_MAGIC_V1.to_vec();
        for n in [CHEAP.m_kib, CHEAP.t, CHEAP.p] {
            blob.extend_from_slice(&n.to_le_bytes());
        }
        blob.extend_from_slice(&salt);
        blob.extend_from_slice(&nonce);
        blob.extend_from_slice(&sealed);
        assert_eq!(sealed_index(&blob), None);
        let opened = open(&blob, "QmScid", "correct horse battery").unwrap();
        assert_eq!((opened.index, *opened.master), (2, [7u8; 32]));
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
        assert_eq!(
            open(b"nonsense", "QmScid", "x").err(),
            Some(VaultError::Tampered)
        );
    }

    #[test]
    fn a_blob_asking_for_more_than_the_ceiling_is_refused_before_any_work() {
        let blob = seal(&item(), "correct horse battery", CHEAP, &counter()).unwrap();
        // The cost sits after the magic, as m, t, p.
        for (at, value) in [(16, 4 * 1024 * 1024), (20, 1_000_000), (24, 1_000)] {
            let mut asking = blob.clone();
            asking[at..at + 4].copy_from_slice(&(value as u32).to_le_bytes());
            assert_eq!(
                open(&asking, "QmScid", "correct horse battery").err(),
                Some(VaultError::Tampered)
            );
        }
        assert!(Kdf::DESKTOP.within_ceiling());
    }

    #[test]
    fn the_same_passphrase_typed_another_way_opens_it() {
        // "ﬁ" (U+FB01) is "fi" after NFKC.
        let blob = seal(&item(), "ﬁve finches fly far", CHEAP, &counter()).unwrap();
        assert!(open(&blob, "QmScid", "five finches fly far").is_ok());
    }

    #[test]
    fn a_new_passphrase_needs_fifteen_characters_typed_twice() {
        assert_eq!(
            check_new("short", "short"),
            Err(PassphraseProblem::TooShort)
        );
        assert_eq!(
            check_new("fifteen chars ok", "fifteen chars ok!"),
            Err(PassphraseProblem::Mismatch)
        );
        assert_eq!(check_new("fifteen chars ok", "fifteen chars ok"), Ok(()));
        assert_eq!(
            check_new(&"x".repeat(257), &"x".repeat(257)),
            Err(PassphraseProblem::TooLong)
        );
    }

    #[test]
    fn the_desktop_cost_is_the_one_ar03_names() {
        assert_eq!(
            Kdf::DESKTOP,
            Kdf {
                m_kib: 65536,
                t: 3,
                p: 4
            }
        );
    }
}
