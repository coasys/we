//! `DesktopVault`: the identity client's [`Vault`] over this computer's store.
//!
//! The client's flows call `Vault::unlock(scid, why, now)`, which has no passphrase in it: with the
//! macOS keychain there is none (the keychain asks), and with a sealed item — the Linux Secret
//! Service, or a file on either OS — the identity window collects one for the flow.
//! So the vault a flow is given is a [`Unlocking`] — the desktop vault together with that flow's
//! passphrase — and it lives exactly as long as the flow step that needs it.
//!
//! Every read and write is logged by kind only (`custody: read for Link`), never with contents.
//!
//! Beside the master keys the vault keeps the incept of an identity `create` made here until its
//! publish is confirmed ([`PendingIncepts`]): public data, so in a file rather than the secret store.

use ad4m_identity_client::vault::KeySigner;
use ad4m_identity_client::{MasterUse, Secret, Unlocked, Vault, VaultError};
use ad4m_identity_core::Event;
use zeroize::Zeroizing;

use crate::pending::PendingIncepts;
use crate::seal::{self, CustodyItem, Kdf};
use crate::store::{item_name, SecretStore};

pub struct DesktopVault {
    store: Box<dyn SecretStore>,
    pending: PendingIncepts,
    kdf: Kdf,
}

fn os_random(out: &mut [u8]) {
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, out);
}

impl DesktopVault {
    /// Master keys in `store`, pending incepts in `pending`.
    pub fn new(store: Box<dyn SecretStore>, pending: PendingIncepts) -> Self {
        DesktopVault {
            store,
            pending,
            kdf: Kdf::DESKTOP,
        }
    }

    /// With another Argon2id cost (tests).
    pub fn with_kdf(store: Box<dyn SecretStore>, pending: PendingIncepts, kdf: Kdf) -> Self {
        DesktopVault {
            store,
            pending,
            kdf,
        }
    }

    /// The incepts of identities made here whose publish is not confirmed. Needs no unlock.
    pub fn pending_incepts(&self) -> Result<Vec<Event>, VaultError> {
        self.pending.list()
    }

    /// Forgets the kept incept of `scid` without publishing it: for an incept that can never be
    /// published. The master key stays where it rests.
    pub fn forget_pending(&self, scid: &str) -> Result<(), VaultError> {
        log::info!("custody: forget an incept that cannot be published");
        self.pending.forget(scid)
    }

    /// Whether the identity window must ask for a passphrase before making a NEW identity here:
    /// false where the OS's own prompt will unlock the item (the keychain), true where it will be
    /// sealed with a passphrase. For an identity already kept here ask
    /// [`needs_passphrase_for`](Self::needs_passphrase_for): two identities on one computer can
    /// rest in different stores.
    pub fn needs_passphrase(&self) -> bool {
        !self.store.kind().unlocks_itself()
    }

    /// Whether a flow on `scid`'s key must ask for a passphrase: true where that item is sealed
    /// (a file, the Secret Service), false where the keychain unlocks it. For an item not kept
    /// here, the answer for a new one. Asks the store where the item is, never reads it; an error
    /// is returned, never guessed at.
    pub fn needs_passphrase_for(&self, scid: &str) -> Result<bool, VaultError> {
        Ok(!self.store.kind_of(&item_name(scid))?.unlocks_itself())
    }

    /// The store in use.
    pub fn store(&self) -> &dyn SecretStore {
        self.store.as_ref()
    }

    /// The vault for one flow, with the passphrase the identity window collected (ignored where the
    /// OS unlocks the item itself). The passphrase is wiped when the returned value drops.
    pub fn unlocking<'a>(&'a self, passphrase: Option<Secret<String>>) -> Unlocking<'a> {
        Unlocking {
            vault: self,
            passphrase,
        }
    }

    /// Whether an item for `scid` is held, without an unlock (no prompt, no passphrase): the store is
    /// asked whether the item exists, and the item itself is never read.
    pub fn holds(&self, scid: &str) -> Result<bool, VaultError> {
        self.store.contains(&item_name(scid))
    }

    fn read(
        &self,
        scid: &str,
        passphrase: Option<&str>,
        why: MasterUse,
    ) -> Result<CustodyItem, VaultError> {
        log::info!("custody: read for {why:?}");
        let name = item_name(scid);
        let bytes = Zeroizing::new(self.store.get(&name)?.ok_or(VaultError::NotFound)?);
        // How this item is kept, not how a new one would be: another identity on this computer
        // may rest in another store.
        if self.store.kind_of(&name)?.unlocks_itself() {
            return CustodyItem::from_bytes(&bytes);
        }
        let passphrase = passphrase.ok_or(VaultError::Cancelled)?;
        seal::open(&bytes, scid, passphrase)
    }

    fn write(&self, item: &CustodyItem, passphrase: Option<&str>) -> Result<(), VaultError> {
        log::info!("custody: write");
        let name = item_name(&item.scid);
        // Sealed or not as the store this item goes to (where it already is, or where a new one
        // goes) keeps it.
        let bytes = if self.store.kind_of(&name)?.unlocks_itself() {
            item.to_bytes().to_vec()
        } else {
            let passphrase = passphrase.ok_or(VaultError::Cancelled)?;
            seal::seal(item, passphrase, self.kdf, &os_random)?
        };
        self.store.put(&name, &bytes)
    }
}

/// [`DesktopVault`] with one flow's passphrase: the [`Vault`] the client's flows are given.
pub struct Unlocking<'a> {
    vault: &'a DesktopVault,
    passphrase: Option<Secret<String>>,
}

impl Unlocking<'_> {
    fn passphrase(&self) -> Option<&str> {
        self.passphrase.as_ref().map(|p| p.expose().as_str())
    }
}

impl Vault for Unlocking<'_> {
    fn store_master(
        &self,
        scid: &str,
        index: u32,
        secret: Secret<[u8; 32]>,
    ) -> Result<(), VaultError> {
        let item = CustodyItem {
            scid: scid.to_string(),
            index,
            master: Zeroizing::new(*secret.expose()),
        };
        self.vault.write(&item, self.passphrase())
    }

    fn unlock(&self, scid: &str, why: MasterUse, now: u64) -> Result<Unlocked, VaultError> {
        let item = self.vault.read(scid, self.passphrase(), why)?;
        Ok(Unlocked::new(
            Box::new(KeySigner::new(&item.master, item.index)),
            now,
        ))
    }

    fn store_pending_incept(&self, incept: &Event) -> Result<(), VaultError> {
        log::info!("custody: keep pending incept");
        self.vault.pending.keep(incept)
    }

    fn pending_incepts(&self) -> Result<Vec<Event>, VaultError> {
        self.vault.pending.list()
    }

    fn incept_published(&self, scid: &str) -> Result<(), VaultError> {
        log::info!("custody: forget published incept");
        self.vault.pending.forget(scid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use crate::store::{MemoryStore, StoreKind};

    const CHEAP: Kdf = Kdf {
        m_kib: 64,
        t: 1,
        p: 1,
    };

    fn pass(p: &str) -> Option<Secret<String>> {
        Some(Secret::new(p.to_string()))
    }

    #[test]
    fn a_key_sealed_in_a_file_stays_usable_when_the_platform_store_becomes_available() {
        use crate::store::{FileStore, PlacedStore};
        let dir = tempfile::tempdir().unwrap();
        let custody = dir.path().join("custody");
        // A build without the keychain (or without a Secret Service) makes the identity: the
        // master key goes into the sealed file.
        sealed_in_file(&custody, "QmScid", [7u8; 32], "a passphrase of length");

        // The next start can use the platform store. The key stays in the file and opens with
        // its passphrase; a new identity would go to the platform store.
        let platform = Arc::new(MemoryStore::as_kind(StoreKind::Keychain));
        let second = placed(&custody, Some(platform.clone()));
        assert!(!second.needs_passphrase());
        assert!(second.needs_passphrase_for("QmScid").unwrap());
        assert!(second.holds("QmScid").unwrap());
        let unlocked = second
            .unlocking(pass("a passphrase of length"))
            .unlock("QmScid", MasterUse::Link, 10)
            .unwrap();
        assert_eq!(
            ad4m_identity_core::build::Signer::key(unlocked.signer(10).unwrap()),
            ed25519_signing_key_multikey([7u8; 32])
        );
        // Writing it again (a flow replacing the item) keeps it in the file, sealed.
        second
            .unlocking(pass("a passphrase of length"))
            .store_master("QmScid", 0, Secret::new([7u8; 32]))
            .unwrap();
        assert!(FileStore::new(&custody)
            .contains(&item_name("QmScid"))
            .unwrap());
        assert!(!platform.contains(&item_name("QmScid")).unwrap());

        // Without a platform store, a new item goes to the file, sealed.
        let empty = dir.path().join("empty");
        let none = DesktopVault::with_kdf(
            Box::new(PlacedStore::new(Box::new(FileStore::new(&empty)), None)),
            PendingIncepts::memory(),
            CHEAP,
        );
        assert_eq!(none.store().kind(), StoreKind::File);
        assert!(none.needs_passphrase());
        assert!(none.needs_passphrase_for("QmNew").unwrap());
        none.unlocking(pass("a passphrase of length"))
            .store_master("QmNew", 0, Secret::new([5u8; 32]))
            .unwrap();
        assert!(FileStore::new(&empty)
            .contains(&item_name("QmNew"))
            .unwrap());
    }

    #[test]
    fn two_identities_on_one_computer_each_unlock_from_where_they_rest() {
        use crate::store::FileStore;
        let dir = tempfile::tempdir().unwrap();
        let custody = dir.path().join("custody");
        let platform = Arc::new(MemoryStore::as_kind(StoreKind::Keychain));

        // One account makes its identity while the folder is empty and the keychain usable: the
        // key goes to the keychain, with no passphrase.
        let vault = placed(&custody, Some(platform.clone()));
        assert!(!vault.needs_passphrase_for("QmA").unwrap());
        vault
            .unlocking(None)
            .store_master("QmA", 0, Secret::new([4u8; 32]))
            .unwrap();
        assert!(platform.contains(&item_name("QmA")).unwrap());
        // Another account, on a build without the keychain, seals its key in the same folder.
        sealed_in_file(&custody, "QmB", [7u8; 32], "b passphrase of length");

        // Both are held, and each is opened the way it is kept.
        let vault = placed(&custody, Some(platform.clone()));
        assert!(vault.holds("QmA").unwrap());
        assert!(vault.holds("QmB").unwrap());
        assert!(!vault.needs_passphrase_for("QmA").unwrap());
        assert!(vault.needs_passphrase_for("QmB").unwrap());
        let a = vault
            .unlocking(None)
            .unlock("QmA", MasterUse::Link, 10)
            .unwrap();
        assert_eq!(
            ad4m_identity_core::build::Signer::key(a.signer(10).unwrap()),
            ed25519_signing_key_multikey([4u8; 32])
        );
        assert_eq!(
            vault
                .unlocking(None)
                .unlock("QmB", MasterUse::Link, 10)
                .err(),
            Some(VaultError::Cancelled)
        );
        let b = vault
            .unlocking(pass("b passphrase of length"))
            .unlock("QmB", MasterUse::Revoke, 10)
            .unwrap();
        assert_eq!(
            ad4m_identity_core::build::Signer::key(b.signer(10).unwrap()),
            ed25519_signing_key_multikey([7u8; 32])
        );

        // Deleting one leaves the other.
        vault.store().delete(&item_name("QmA")).unwrap();
        assert!(!vault.holds("QmA").unwrap());
        assert!(vault.holds("QmB").unwrap());
        vault
            .unlocking(None)
            .store_master("QmA", 0, Secret::new([4u8; 32]))
            .unwrap();
        vault.store().delete(&item_name("QmB")).unwrap();
        assert!(!vault.holds("QmB").unwrap());
        assert!(!FileStore::new(&custody)
            .contains(&item_name("QmB"))
            .unwrap());
        assert!(vault
            .unlocking(None)
            .unlock("QmA", MasterUse::Link, 10)
            .is_ok());
    }

    #[test]
    fn a_side_that_cannot_answer_is_never_taken_to_be_empty() {
        use crate::store::PlacedStore;
        struct Unanswering(StoreKind);
        impl SecretStore for Unanswering {
            fn kind(&self) -> StoreKind {
                self.0
            }
            fn kind_of(&self, _: &str) -> Result<StoreKind, VaultError> {
                Ok(self.0)
            }
            fn put(&self, _: &str, _: &[u8]) -> Result<(), VaultError> {
                Err(VaultError::Unavailable("cannot write".into()))
            }
            fn get(&self, _: &str) -> Result<Option<Vec<u8>>, VaultError> {
                Err(VaultError::Unavailable("cannot read".into()))
            }
            fn contains(&self, _: &str) -> Result<bool, VaultError> {
                Err(VaultError::Unavailable("cannot stat".into()))
            }
            fn delete(&self, _: &str) -> Result<(), VaultError> {
                Err(VaultError::Unavailable("cannot delete".into()))
            }
        }
        let name = item_name("QmScid");
        fn refused(store: &dyn SecretStore, name: &str) {
            assert!(unavailable(store.get(name)));
            assert!(unavailable(store.contains(name)));
            assert!(unavailable(store.kind_of(name)));
            assert!(unavailable(store.put(name, b"x")));
            assert!(unavailable(store.delete(name)));
        }

        // The file cannot be asked; the keychain holds the key. Nothing falls through to it.
        let platform = Arc::new(MemoryStore::as_kind(StoreKind::Keychain));
        platform.put(&name, b"the keychain item").unwrap();
        let store = PlacedStore::new(
            Box::new(Unanswering(StoreKind::File)),
            Some(Box::new(platform.clone())),
        );
        refused(&store, &name);
        assert_eq!(
            platform.get(&name).unwrap().as_deref(),
            Some(&b"the keychain item"[..])
        );

        // The platform store cannot be asked; the file holds the key. Nothing is decided either.
        let file = Arc::new(MemoryStore::as_kind(StoreKind::File));
        file.put(&name, b"the sealed item").unwrap();
        let store = PlacedStore::new(
            Box::new(file.clone()),
            Some(Box::new(Unanswering(StoreKind::Keychain))),
        );
        refused(&store, &name);
        assert_eq!(
            file.get(&name).unwrap().as_deref(),
            Some(&b"the sealed item"[..])
        );

        // A real folder that cannot be searched is refused the same way.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let dir = tempfile::tempdir().unwrap();
            let custody = dir.path().join("custody");
            sealed_in_file(&custody, "QmScid", [7u8; 32], "a passphrase of length");
            std::fs::set_permissions(&custody, std::fs::Permissions::from_mode(0o000)).unwrap();
            // Root searches anything, so the folder only fails where it can.
            if std::fs::metadata(custody.join("QmScid.bin")).is_err() {
                let vault = placed(
                    &custody,
                    Some(Arc::new(MemoryStore::as_kind(StoreKind::Keychain))),
                );
                refused(vault.store(), &name);
                assert!(vault.holds("QmScid").is_err());
                assert!(vault.needs_passphrase_for("QmScid").is_err());
            }
            std::fs::set_permissions(&custody, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
    }

    #[test]
    fn a_key_kept_on_both_sides_is_refused_rather_than_chosen() {
        use crate::store::PlacedStore;
        let name = item_name("QmScid");
        let file = Arc::new(MemoryStore::as_kind(StoreKind::File));
        let platform = Arc::new(MemoryStore::as_kind(StoreKind::Keychain));
        file.put(&name, b"sealed").unwrap();
        platform.put(&name, b"keychain").unwrap();
        let store = PlacedStore::new(Box::new(file.clone()), Some(Box::new(platform.clone())));
        assert!(unavailable(store.get(&name)));
        assert!(unavailable(store.contains(&name)));
        assert!(unavailable(store.kind_of(&name)));
        assert!(unavailable(store.put(&name, b"new")));
        assert!(unavailable(store.delete(&name)));
        // Both copies are as they were.
        assert_eq!(file.get(&name).unwrap().unwrap(), b"sealed");
        assert_eq!(platform.get(&name).unwrap().unwrap(), b"keychain");
        // Another identity is unaffected.
        assert!(!store.contains(&item_name("QmOther")).unwrap());
    }

    fn unavailable<T>(result: Result<T, VaultError>) -> bool {
        matches!(result, Err(VaultError::Unavailable(_)))
    }

    /// Seals `secret` for `scid` in the file under `custody`, as a build without a platform store
    /// does.
    fn sealed_in_file(custody: &std::path::Path, scid: &str, secret: [u8; 32], passphrase: &str) {
        DesktopVault::with_kdf(
            Box::new(crate::store::FileStore::new(custody)),
            PendingIncepts::memory(),
            CHEAP,
        )
        .unlocking(pass(passphrase))
        .store_master(scid, 0, Secret::new(secret))
        .unwrap();
    }

    /// A vault over the file under `custody` and `platform`, placed per item.
    fn placed(custody: &std::path::Path, platform: Option<Arc<MemoryStore>>) -> DesktopVault {
        DesktopVault::with_kdf(
            Box::new(crate::store::PlacedStore::new(
                Box::new(crate::store::FileStore::new(custody)),
                platform.map(|p| Box::new(p) as Box<dyn SecretStore>),
            )),
            PendingIncepts::memory(),
            CHEAP,
        )
    }

    /// A store shared with the test, so it can look at what was kept where.
    impl<T: SecretStore + ?Sized> SecretStore for Arc<T> {
        fn kind(&self) -> StoreKind {
            (**self).kind()
        }
        fn kind_of(&self, n: &str) -> Result<StoreKind, VaultError> {
            (**self).kind_of(n)
        }
        fn put(&self, n: &str, b: &[u8]) -> Result<(), VaultError> {
            (**self).put(n, b)
        }
        fn get(&self, n: &str) -> Result<Option<Vec<u8>>, VaultError> {
            (**self).get(n)
        }
        fn contains(&self, n: &str) -> Result<bool, VaultError> {
            (**self).contains(n)
        }
        fn delete(&self, n: &str) -> Result<(), VaultError> {
            (**self).delete(n)
        }
    }

    #[test]
    fn a_passphrase_vault_keeps_the_key_sealed_and_opens_it_with_the_passphrase() {
        let store = std::sync::Arc::new(MemoryStore::new());
        struct Shared(std::sync::Arc<MemoryStore>);
        impl SecretStore for Shared {
            fn kind(&self) -> StoreKind {
                self.0.kind()
            }
            fn kind_of(&self, n: &str) -> Result<StoreKind, VaultError> {
                self.0.kind_of(n)
            }
            fn put(&self, n: &str, b: &[u8]) -> Result<(), VaultError> {
                self.0.put(n, b)
            }
            fn get(&self, n: &str) -> Result<Option<Vec<u8>>, VaultError> {
                self.0.get(n)
            }
            fn contains(&self, n: &str) -> Result<bool, VaultError> {
                self.0.contains(n)
            }
            fn delete(&self, n: &str) -> Result<(), VaultError> {
                self.0.delete(n)
            }
        }
        let vault = DesktopVault::with_kdf(
            Box::new(Shared(store.clone())),
            PendingIncepts::memory(),
            CHEAP,
        );
        assert!(vault.needs_passphrase());
        let flow = vault.unlocking(pass("a passphrase of length"));
        assert!(!vault.holds("QmScid").unwrap());
        flow.store_master("QmScid", 0, Secret::new([9u8; 32]))
            .unwrap();
        // At rest the key is sealed: its bytes are nowhere in the store.
        assert!(!store.all_bytes().windows(32).any(|w| w == [9u8; 32]));
        assert!(vault.holds("QmScid").unwrap());
        let unlocked = flow.unlock("QmScid", MasterUse::Link, 10).unwrap();
        let expected = ed25519_signing_key_multikey([9u8; 32]);
        assert_eq!(
            ad4m_identity_core::build::Signer::key(unlocked.signer(10).unwrap()),
            expected
        );

        // Another flow with the wrong passphrase, or none, cannot use it.
        assert_eq!(
            vault
                .unlocking(pass("not the passphrase!!"))
                .unlock("QmScid", MasterUse::Revoke, 10)
                .err(),
            Some(VaultError::Cancelled)
        );
        assert_eq!(
            vault
                .unlocking(None)
                .unlock("QmScid", MasterUse::Revoke, 10)
                .err(),
            Some(VaultError::Cancelled)
        );
        assert_eq!(unlocked.signer(10).unwrap().index(), 0);
    }

    #[test]
    fn holds_answers_without_a_passphrase_and_never_reads_the_item() {
        // A store whose reads fail the test: on the keychain a read is a Touch ID prompt and the
        // secret in memory, which asking whether the key is here must never cost.
        struct NoReads(crate::store::FileStore);
        impl SecretStore for NoReads {
            fn kind(&self) -> StoreKind {
                self.0.kind()
            }
            fn kind_of(&self, n: &str) -> Result<StoreKind, VaultError> {
                self.0.kind_of(n)
            }
            fn put(&self, n: &str, b: &[u8]) -> Result<(), VaultError> {
                self.0.put(n, b)
            }
            fn get(&self, _: &str) -> Result<Option<Vec<u8>>, VaultError> {
                panic!("holds read the item")
            }
            fn contains(&self, n: &str) -> Result<bool, VaultError> {
                self.0.contains(n)
            }
            fn delete(&self, n: &str) -> Result<(), VaultError> {
                self.0.delete(n)
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let vault = DesktopVault::with_kdf(
            Box::new(NoReads(crate::store::FileStore::new(dir.path()))),
            PendingIncepts::memory(),
            CHEAP,
        );
        assert!(!vault.holds("QmScid").unwrap());
        // Sealed under a passphrase only the flow that stored it had.
        vault
            .unlocking(pass("a passphrase of length"))
            .store_master("QmScid", 0, Secret::new([7u8; 32]))
            .unwrap();
        assert!(vault.holds("QmScid").unwrap());
        assert!(!vault.holds("QmOther").unwrap());
    }

    #[test]
    fn a_keychain_vault_asks_for_no_passphrase() {
        let vault = DesktopVault::new(
            Box::new(MemoryStore::as_kind(StoreKind::Keychain)),
            PendingIncepts::memory(),
        );
        assert!(!vault.needs_passphrase());
        let flow = vault.unlocking(None);
        flow.store_master("QmScid", 3, Secret::new([4u8; 32]))
            .unwrap();
        assert_eq!(
            flow.unlock("QmScid", MasterUse::Link, 0)
                .unwrap()
                .signer(0)
                .unwrap()
                .index(),
            3
        );
        assert_eq!(
            flow.unlock("QmOther", MasterUse::Link, 0).err(),
            Some(VaultError::NotFound)
        );
    }

    fn ed25519_signing_key_multikey(secret: [u8; 32]) -> ad4m_identity_core::Multikey {
        ad4m_identity_core::build::Signer::key(&KeySigner::new(&secret, 0))
    }
}
