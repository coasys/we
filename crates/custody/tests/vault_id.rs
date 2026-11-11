//! The vault id (`Vault::vault_id`) is kept with the master key, in the store that keeps it, and
//! not in the custody folder: a folder reset while the platform store keeps the key gives the
//! same id back, and two custody folders over one platform store do not each count the one copy.
//!
//! The platform store here is a memory store that behaves as the keychain does. No test touches
//! the computer's keychain or Secret Service.

use std::path::Path;
use std::sync::Arc;

use ad4m_identity_client::{Secret, StageToken, Vault, VaultError};
use we_custody::pending::PendingIncepts;
use we_custody::seal::Kdf;
use we_custody::store::{FileStore, ItemTag, MemoryStore, PlacedStore, SecretStore, StoreKind};
use we_custody::vault::DesktopVault;

const CHEAP: Kdf = Kdf {
    m_kib: 64,
    t: 1,
    p: 1,
};

/// The name the vault id is kept under (`we_custody::store::vault_id_name`).
const ID_OF_A: &str = "coasys.identity.vault/QmA";

/// One keychain, shared by every vault a test makes, as one computer has one.
struct Keychain(Arc<MemoryStore>);

impl SecretStore for Keychain {
    fn kind(&self) -> StoreKind {
        self.0.kind()
    }
    fn kind_of(&self, name: &str) -> Result<StoreKind, VaultError> {
        self.0.kind_of(name)
    }
    fn put(&self, name: &str, bytes: &[u8]) -> Result<(), VaultError> {
        self.0.put(name, bytes)
    }
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, VaultError> {
        self.0.get(name)
    }
    fn contains(&self, name: &str) -> Result<bool, VaultError> {
        self.0.contains(name)
    }
    fn delete(&self, name: &str) -> Result<(), VaultError> {
        self.0.delete(name)
    }
    fn put_tagged(&self, name: &str, bytes: &[u8], tag: &ItemTag) -> Result<(), VaultError> {
        self.0.put_tagged(name, bytes, tag)
    }
    fn tag_of(&self, name: &str) -> Result<Option<ItemTag>, VaultError> {
        self.0.tag_of(name)
    }
    fn rename(&self, from: &str, to: &str) -> Result<(), VaultError> {
        self.0.rename(from, to)
    }
}

/// A vault over the custody folder `custody` (its lock, its epochs, its files) and `keychain`.
fn over(custody: &Path, keychain: &Arc<MemoryStore>) -> DesktopVault {
    DesktopVault::with_kdf(
        Box::new(PlacedStore::new(
            Box::new(FileStore::new(custody)),
            Some(Box::new(Keychain(keychain.clone()))),
        )),
        PendingIncepts::file(custody),
        CHEAP,
    )
}

fn keychain() -> Arc<MemoryStore> {
    Arc::new(MemoryStore::as_kind(StoreKind::Keychain))
}

/// The custody folder is reset (removed) while the keychain keeps the master key: the id comes
/// back with the key, never drawn again. With the id gone and the key kept, an ask and a store
/// are errors, and no fresh id is kept.
#[test]
fn a_folder_reset_keeps_the_vault_id_the_key_is_kept_with() {
    let dir = tempfile::tempdir().unwrap();
    let custody = dir.path().join("custody");
    let keychain = keychain();
    let vault = over(&custody, &keychain);
    vault
        .unlocking(None)
        .store_master("QmA", 0, Secret::new([7u8; 32]))
        .unwrap();
    let id = vault.vault_id("QmA").unwrap();
    drop(vault);

    std::fs::remove_dir_all(&custody).unwrap();
    let reset = over(&custody, &keychain);
    assert_eq!(reset.master_index("QmA").unwrap(), Some(0));
    assert_eq!(reset.vault_id("QmA").unwrap(), id);
    assert_eq!(Vault::vault_id(&reset.unlocking(None), "QmA").unwrap(), id);

    // The id is in the keychain with the key.
    assert!(keychain.contains(ID_OF_A).unwrap());
    keychain.delete(ID_OF_A).unwrap();
    assert!(reset.vault_id("QmA").is_err());
    assert!(reset
        .unlocking(None)
        .store_master("QmA", 1, Secret::new([8u8; 32]))
        .is_err());
    assert!(!keychain.contains(ID_OF_A).unwrap());
    assert_eq!(reset.master_index("QmA").unwrap(), Some(0));
}

/// Two custody folders over one keychain (two `--custody-dir` values): the slots of an identity
/// belong to the folder that kept its id first. The second folder's ask, store, stage, promote
/// and forget of that identity are refused, so one copy never has two ids, and the slots never
/// have two locks or two epochs. Another identity is the second folder's own.
#[test]
fn a_second_custody_folder_over_one_keychain_is_refused_the_first_ones_slots() {
    let dir = tempfile::tempdir().unwrap();
    let keychain = keychain();
    let first = over(&dir.path().join("one"), &keychain);
    first
        .unlocking(None)
        .store_master("QmA", 0, Secret::new([7u8; 32]))
        .unwrap();
    let id = first.vault_id("QmA").unwrap();

    let second = over(&dir.path().join("two"), &keychain);
    let flow = second.unlocking(None);
    assert!(second.vault_id("QmA").is_err());
    assert!(Vault::vault_id(&flow, "QmA").is_err());
    assert!(flow.store_master("QmA", 1, Secret::new([8u8; 32])).is_err());
    assert!(flow
        .stage_master("QmA", 1, Secret::new([8u8; 32]), &StageToken([1; 16]))
        .is_err());
    assert!(flow.promote_master("QmA", 1).is_err());
    assert!(flow.forget_master("QmA", 0).is_err());
    assert!(flow.forget_master_at("QmA", 0).is_err());
    assert_eq!(first.master_index("QmA").unwrap(), Some(0));
    assert_eq!(first.staged_index("QmA").unwrap(), None);
    assert_eq!(first.vault_id("QmA").unwrap(), id);

    flow.store_master("QmB", 0, Secret::new([9u8; 32])).unwrap();
    assert!(second.vault_id("QmB").is_ok());
    assert!(first.vault_id("QmB").is_err());
}
