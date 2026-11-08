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
//! Each identity has two slots in the store: its kept master key (`coasys.identity/<scid>`) and a
//! rotation's staged one (`coasys.identity.staged/<scid>`, [`Vault::stage_master`]), the staged one
//! always in the store the kept one is in, sealed as it is. Each item carries its master index
//! where it can be read with no unlock and cannot be changed apart from the key: a sealed item in
//! its header, under the AEAD tag; a keychain item as an attribute written in the same `SecItemAdd`.
//! A staged item carries the staging flow's [`StageToken`] the same way ([`ItemTag`]), so a flow's
//! discard forgets only the key it staged, never one another app sharing this folder staged since.
//!
//! Beside the master keys the vault keeps the incept of an identity `create` made here until its
//! publish is confirmed, and the retry list of master-key pushes to other devices
//! ([`PendingIncepts`]): public data, so in files rather than the secret store.

use ad4m_identity_client::vault::KeySigner;
use ad4m_identity_client::{
    Forgot, MasterUse, PendingPush, Secret, StageToken, Stored, Unlocked, Vault, VaultError,
};
use ad4m_identity_core::Event;
use zeroize::Zeroizing;

use crate::pending::{Exclusive, PendingIncepts};
use crate::seal::{self, CustodyItem, Kdf};
use crate::store::{item_name, staged_name, ItemTag, SecretStore};

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

    /// The index of the master key held for `scid` (#0, or #n after `n` rotations), without an
    /// unlock. From the item itself, never from a list beside it: a sealed item's header, which
    /// its tag covers ([`seal::sealed_index`]), or the attribute the keychain wrote in the same
    /// operation as the key ([`SecretStore::index_of`]). So it names the key an unlock gives,
    /// or that unlock fails. `None` when no item is held, or when the item does not say (one
    /// sealed before the index was in its header, a keychain item without the attribute).
    pub fn master_index(&self, scid: &str) -> Result<Option<u32>, VaultError> {
        self.index_at(&item_name(scid))
    }

    /// The index of the key a rotation staged for `scid`, read as [`master_index`](Self::master_index);
    /// `None` when none is staged.
    pub fn staged_index(&self, scid: &str) -> Result<Option<u32>, VaultError> {
        self.index_at(&staged_name(scid))
    }

    /// The index the item `name` carries, with no unlock.
    fn index_at(&self, name: &str) -> Result<Option<u32>, VaultError> {
        Ok(self.tag_at(name)?.map(|tag| tag.index))
    }

    /// The index and the staging token the item `name` carries, read together from the item
    /// with no unlock: a keychain item's attribute ([`SecretStore::tag_of`]), a sealed item's
    /// header ([`seal::sealed_index`], [`seal::sealed_owner`]). `None` when no item is kept or it
    /// does not say its index.
    fn tag_at(&self, name: &str) -> Result<Option<ItemTag>, VaultError> {
        if !self.store.contains(name)? {
            return Ok(None);
        }
        if self.store.kind_of(name)?.unlocks_itself() {
            return self.store.tag_of(name);
        }
        // A sealed blob: its bytes are no secret without the passphrase.
        let Some(blob) = self.store.get(name)? else {
            return Ok(None);
        };
        Ok(seal::sealed_index(&blob).map(|index| ItemTag {
            index,
            owner: seal::sealed_owner(&blob),
        }))
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

    /// The bytes that keep `item` under `name` (its kept slot or its staged one), with its index,
    /// and `owner`, the staging flow's token, for a staged key: sealed or not as the store this
    /// item goes to (where it already is, or where a new one goes) keeps it. Made before the
    /// folder's lock is taken, so the seal's Argon2id never holds every other app off.
    fn prepare(
        &self,
        name: &str,
        item: &CustodyItem,
        owner: Option<&StageToken>,
        passphrase: Option<&str>,
    ) -> Result<Prepared, VaultError> {
        if self.store.kind_of(name)?.unlocks_itself() {
            let tag = ItemTag {
                index: item.index,
                owner: owner.copied(),
            };
            Ok(Prepared::Tagged(item.to_bytes(), tag))
        } else {
            let passphrase = passphrase.ok_or(VaultError::Cancelled)?;
            // The index (and the owner) are in the sealed header, under the tag.
            let bytes = match owner {
                Some(owner) => seal::seal_staged(item, owner, passphrase, self.kdf, &os_random)?,
                None => seal::seal(item, passphrase, self.kdf, &os_random)?,
            };
            Ok(Prepared::Sealed(bytes))
        }
    }

    /// Writes `prepared` under `name`, in one store operation that carries its index with it.
    fn put(&self, name: &str, prepared: &Prepared) -> Result<(), VaultError> {
        log::info!("custody: write");
        match prepared {
            Prepared::Tagged(bytes, tag) => self.store.put_tagged(name, bytes, tag),
            Prepared::Sealed(bytes) => self.store.put(name, bytes),
        }
    }
}

/// An item ready for its slot ([`DesktopVault::prepare`]).
enum Prepared {
    /// As it is, for a store that unlocks itself, with the tag the store keeps beside it.
    Tagged(Zeroizing<Vec<u8>>, ItemTag),
    /// Sealed under the flow's passphrase; no secret without it.
    Sealed(Vec<u8>),
}

impl DesktopVault {
    /// The authenticated index of the kept key, under the folder's lock, for a write that must
    /// not go back a generation: an item that does not say its index (sealed before the index
    /// was in its header) is refused rather than guessed at, as a caller never forgets on a
    /// `master_index` of `None` either.
    fn kept_index_held(&self, scid: &str) -> Result<Option<u32>, VaultError> {
        let name = item_name(scid);
        match self.index_at(&name)? {
            Some(index) => Ok(Some(index)),
            None if self.store.contains(&name)? => Err(VaultError::Unavailable(
                "the kept master key does not say its index".into(),
            )),
            None => Ok(None),
        }
    }

    /// `scid`'s custody epoch ([`crate::pending::Epoch`]): how many times its kept master key
    /// changed in this custody folder. Read under the folder's lock.
    pub fn custody_epoch(&self, scid: &str) -> Result<u64, VaultError> {
        self.pending.exclusive()?.epoch(scid)
    }

    /// The compare-and-delete behind [`Vault::forget_master`], under the custody folder's lock:
    /// the kept key is deleted only while `unchanged(lock, kept index)` holds, and the epoch
    /// bumped with it; otherwise it is left and named ([`Forgot::Kept`]). The precondition is a
    /// parameter so the contract's move from "still this index" to "still this epoch" changes
    /// only the caller: `|folder, _| Ok(folder.epoch(scid)? == epoch)`.
    fn forget_kept(
        &self,
        scid: &str,
        unchanged: impl FnOnce(&Exclusive<'_>, u32) -> Result<bool, VaultError>,
    ) -> Result<Forgot, VaultError> {
        let mut folder = self.pending.exclusive()?;
        let Some(kept) = self.kept_index_held(scid)? else {
            return Ok(Forgot::Forgot);
        };
        if !unchanged(&folder, kept)? {
            log::info!("custody: the kept master key changed; nothing forgotten");
            return Ok(Forgot::Kept(kept));
        }
        log::info!("custody: forget a master key");
        self.store.delete(&item_name(scid))?;
        folder.bump_epoch(scid)?;
        Ok(Forgot::Forgot)
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
    /// Under the custody folder's lock (every app on this computer takes it): the kept index is
    /// read from the item, and the item written only when that index is not higher. The item is
    /// sealed before the lock, so the lock is held for a header read and one put.
    fn store_master(
        &self,
        scid: &str,
        index: u32,
        secret: Secret<[u8; 32]>,
    ) -> Result<Stored, VaultError> {
        let item = CustodyItem {
            scid: scid.to_string(),
            index,
            master: Zeroizing::new(*secret.expose()),
        };
        let name = item_name(scid);
        let prepared = self.vault.prepare(&name, &item, None, self.passphrase())?;
        let mut folder = self.vault.pending.exclusive()?;
        if let Some(kept) = self.vault.kept_index_held(scid)? {
            if kept > index {
                log::info!("custody: a newer master key is kept; nothing stored");
                return Ok(Stored::AlreadyNewer { kept });
            }
        }
        self.vault.put(&name, &prepared)?;
        // Every store bumps it, a same-index re-store too: a forget that read the epoch before
        // a duplicate delivery must not delete what that delivery just wrote.
        folder.bump_epoch(scid)?;
        Ok(Stored::Stored)
    }

    fn master_index(&self, scid: &str) -> Result<Option<u32>, VaultError> {
        self.vault.master_index(scid)
    }

    /// The staged slot (`coasys.identity.staged/<scid>`), in the store the kept item is in and
    /// sealed as it is, under this flow's passphrase. `owner` goes with it as the index does: in
    /// a sealed item's header under the tag, in a keychain item's comment written in the same
    /// `SecItemAdd`. Replaces whatever was staged, whoever staged it. The store's put is durable
    /// when it answers (a file is synced before its rename; the keychain and the Secret Service
    /// commit the item).
    fn stage_master(
        &self,
        scid: &str,
        index: u32,
        secret: Secret<[u8; 32]>,
        owner: &StageToken,
    ) -> Result<(), VaultError> {
        log::info!("custody: stage a master key");
        let item = CustodyItem {
            scid: scid.to_string(),
            index,
            master: Zeroizing::new(*secret.expose()),
        };
        let name = staged_name(scid);
        let prepared = self
            .vault
            .prepare(&name, &item, Some(owner), self.passphrase())?;
        // Under the lock, so it never lands between another app's check of the staged slot and
        // its promote or discard.
        let _folder = self.vault.pending.exclusive()?;
        self.vault.put(&name, &prepared)
    }

    fn staged_index(&self, scid: &str) -> Result<Option<u32>, VaultError> {
        self.vault.staged_index(scid)
    }

    /// The staged item is moved over the kept one, as it is: sealed bytes stay sealed, so no
    /// passphrase and no prompt. A crash during the move leaves the key under one name or both,
    /// never neither; `refresh_master` finishes it. Under the custody folder's lock, the staged
    /// and kept indexes are read from their items and the move made only when the kept one is
    /// not higher; when it is, the staged key can never be kept and is deleted.
    fn promote_master(&self, scid: &str, index: u32) -> Result<Stored, VaultError> {
        let mut folder = self.vault.pending.exclusive()?;
        if self.vault.staged_index(scid)? != Some(index) {
            return Err(VaultError::NotFound);
        }
        if let Some(kept) = self.vault.kept_index_held(scid)? {
            if kept > index {
                log::info!("custody: a newer master key is kept; the staged one is discarded");
                self.vault.store.delete(&staged_name(scid))?;
                return Ok(Stored::AlreadyNewer { kept });
            }
        }
        log::info!("custody: promote a staged master key");
        self.vault
            .store
            .rename(&staged_name(scid), &item_name(scid))?;
        folder.bump_epoch(scid)?;
        Ok(Stored::Stored)
    }

    /// Forgets the staged key only when it is staged at `index` and, with `owner` given, was
    /// staged with that token: a flow discarding its own key never takes one another app on this
    /// computer staged since. With no `owner` (a refresh discarding a key behind the log) any
    /// owner's goes. A staged item with no token it can read (staged before tokens were kept)
    /// matches only no `owner`. Anything else is left, with no error.
    fn discard_staged(
        &self,
        scid: &str,
        index: u32,
        owner: Option<&StageToken>,
    ) -> Result<(), VaultError> {
        let _folder = self.vault.pending.exclusive()?;
        let ours = self.vault.tag_at(&staged_name(scid))?.is_some_and(|tag| {
            tag.index == index && owner.is_none_or(|owner| tag.owner.as_ref() == Some(owner))
        });
        if !ours {
            return Ok(());
        }
        log::info!("custody: discard a staged master key");
        self.vault.store.delete(&staged_name(scid))
    }

    /// Forgets the kept key only. A staged key stays: a refresh forgets a kept key the log has
    /// replaced while a rotation's stage ahead of the log (this app's, or another app's on this
    /// computer) may still be waiting for its publish, and `promote_master` needs it then. The
    /// logout (`remove_master`) calls this too, then discards a stage at or behind the log itself
    /// with [`Vault::discard_staged`], leaving one ahead of it.
    ///
    /// A compare-and-delete under the custody folder's lock: the kept index is read from the
    /// item and the item deleted only while it is still `index`; another index is left and named
    /// ([`Forgot::Kept`]). An item that does not say its index is left, with an error.
    fn forget_master(&self, scid: &str, index: u32) -> Result<Forgot, VaultError> {
        self.vault.forget_kept(scid, |_, kept| Ok(kept == index))
    }

    fn unlock(&self, scid: &str, why: MasterUse, now: u64) -> Result<Unlocked, VaultError> {
        let item = self.vault.read(scid, self.passphrase(), why)?;
        // `why` sets how long the unlock lasts (`MasterUse::ttl_s`): a link's runs to the end of the
        // store's confirm grace, so the `add` can still be signed while the store would take it.
        Ok(Unlocked::new(
            Box::new(KeySigner::new(&item.master, item.index)),
            why,
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

    fn keep_push(&self, push: &PendingPush) -> Result<(), VaultError> {
        log::info!("custody: keep a master-key push on the retry list");
        self.vault.pending.keep_push(push)
    }

    fn pending_pushes(&self) -> Result<Vec<PendingPush>, VaultError> {
        self.vault.pending.pushes()
    }

    fn push_done(&self, push: &PendingPush) -> Result<(), VaultError> {
        log::info!("custody: forget a master-key push");
        self.vault.pending.push_done(push)
    }

    /// In the custody folder beside the pending lists ([`PendingIncepts::record_seen`]): a
    /// version number per identity, no secret, so not in the secret store.
    fn record_seen(&self, scid: &str, version: u64) -> Result<Option<u64>, VaultError> {
        self.vault.pending.record_seen(scid, version)
    }

    fn record_seen_reset(&self, scid: &str) -> Result<(), VaultError> {
        log::info!("custody: reset a record's high-water mark");
        self.vault.pending.record_seen_reset(scid)
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
        fn put_tagged(&self, n: &str, b: &[u8], t: &ItemTag) -> Result<(), VaultError> {
            (**self).put_tagged(n, b, t)
        }
        fn tag_of(&self, n: &str) -> Result<Option<ItemTag>, VaultError> {
            (**self).tag_of(n)
        }
        fn rename(&self, from: &str, to: &str) -> Result<(), VaultError> {
            (**self).rename(from, to)
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

    /// The index of the key kept is read with no unlock — a sealed item, no passphrase — from the
    /// item, follows a rotation, and is gone with the key. No index list beside the item is
    /// written: the folder holds the item, the folder's lock and the custody epochs (counters,
    /// no index in them).
    #[test]
    fn the_master_index_needs_no_unlock_and_goes_with_the_key() {
        let dir = tempfile::tempdir().unwrap();
        let vault = DesktopVault::with_kdf(
            Box::new(crate::store::FileStore::new(dir.path())),
            PendingIncepts::file(dir.path()),
            CHEAP,
        );
        assert!(vault.needs_passphrase_for("QmScid").unwrap());
        let locked = vault.unlocking(None);
        assert_eq!(locked.master_index("QmScid").unwrap(), None);
        let flow = vault.unlocking(pass("a passphrase of some length"));
        flow.store_master("QmScid", 0, Secret::new([4u8; 32]))
            .unwrap();
        flow.store_master("QmScid", 1, Secret::new([5u8; 32]))
            .unwrap();
        assert_eq!(locked.master_index("QmScid").unwrap(), Some(1));
        let mut files = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect::<Vec<_>>();
        files.sort();
        assert_eq!(
            files,
            vec![
                "QmScid.bin".to_string(),
                crate::pending::EPOCHS_FILE_NAME.to_string(),
                crate::pending::LOCK_NAME.to_string(),
            ]
        );
        let epochs =
            std::fs::read_to_string(dir.path().join(crate::pending::EPOCHS_FILE_NAME)).unwrap();
        assert_eq!(
            serde_json::from_str::<Vec<crate::pending::Epoch>>(&epochs).unwrap(),
            vec![crate::pending::Epoch {
                scid: "QmScid".into(),
                epoch: 2
            }]
        );
        assert_eq!(locked.forget_master("QmScid", 1).unwrap(), Forgot::Forgot);
        // None kept: forgotten already.
        assert_eq!(locked.forget_master("QmScid", 1).unwrap(), Forgot::Forgot);
        assert!(!vault.holds("QmScid").unwrap());
        assert_eq!(locked.master_index("QmScid").unwrap(), None);
        assert_eq!(
            flow.unlock("QmScid", MasterUse::Link, 0).err(),
            Some(VaultError::NotFound)
        );
    }

    /// The vaults the generation rules are checked on: a sealed file in a custody folder, and a
    /// keychain (its index an attribute of the item); with the passphrase a flow on each needs.
    fn generation_vaults(dir: &std::path::Path) -> Vec<(DesktopVault, Option<&'static str>)> {
        vec![
            (
                DesktopVault::with_kdf(
                    Box::new(crate::store::FileStore::new(dir)),
                    PendingIncepts::file(dir),
                    CHEAP,
                ),
                Some("a passphrase of length"),
            ),
            (
                DesktopVault::new(
                    Box::new(MemoryStore::as_kind(StoreKind::Keychain)),
                    PendingIncepts::memory(),
                ),
                None,
            ),
        ]
    }

    /// The key a flow on `vault` unlocks for `scid`.
    fn unlocked_key(vault: &DesktopVault, passphrase: Option<&str>) -> String {
        let unlocked = vault
            .unlocking(passphrase.map(|p| Secret::new(p.to_string())))
            .unlock("QmScid", MasterUse::Link, 0)
            .unwrap();
        ad4m_identity_core::build::Signer::key(unlocked.signer(0).unwrap())
    }

    /// The custody epoch goes up with every change of the kept key — a store, a same-index
    /// re-store (a duplicate delivery), a promote, a forget that deletes — and not with a write
    /// that changes nothing (`AlreadyNewer`, a promote with nothing staged, a forget refused or
    /// of nothing). A forget conditioned on an epoch read before a duplicate delivery keeps it.
    #[test]
    fn the_custody_epoch_counts_every_change_of_the_kept_key() {
        let dir = tempfile::tempdir().unwrap();
        for (vault, passphrase) in generation_vaults(dir.path()) {
            let flow = vault.unlocking(passphrase.map(|p| Secret::new(p.to_string())));
            let epoch = || vault.custody_epoch("QmScid").unwrap();
            assert_eq!(epoch(), 0);
            flow.store_master("QmScid", 1, Secret::new([5u8; 32]))
                .unwrap();
            assert_eq!(epoch(), 1);
            let read_before = epoch();
            // The same key delivered twice.
            assert_eq!(
                flow.store_master("QmScid", 1, Secret::new([5u8; 32]))
                    .unwrap(),
                Stored::Stored
            );
            assert_eq!(epoch(), 2);
            assert_eq!(
                vault
                    .forget_kept("QmScid", |folder, _| Ok(
                        folder.epoch("QmScid")? == read_before
                    ))
                    .unwrap(),
                Forgot::Kept(1)
            );
            assert_eq!(vault.master_index("QmScid").unwrap(), Some(1));
            assert_eq!(epoch(), 2);
            // Nothing changed, nothing counted.
            flow.store_master("QmScid", 0, Secret::new([4u8; 32]))
                .unwrap();
            assert_eq!(
                flow.promote_master("QmScid", 2).err(),
                Some(VaultError::NotFound)
            );
            assert_eq!(flow.forget_master("QmScid", 0).unwrap(), Forgot::Kept(1));
            assert_eq!(epoch(), 2);
            flow.stage_master("QmScid", 2, Secret::new([6u8; 32]), &StageToken([1; 16]))
                .unwrap();
            assert_eq!(epoch(), 2);
            flow.promote_master("QmScid", 2).unwrap();
            assert_eq!(epoch(), 3);
            assert_eq!(
                vault
                    .forget_kept("QmScid", |folder, _| Ok(folder.epoch("QmScid")? == 3))
                    .unwrap(),
                Forgot::Forgot
            );
            assert_eq!(epoch(), 4);
            assert_eq!(flow.forget_master("QmScid", 2).unwrap(), Forgot::Forgot);
            assert_eq!(epoch(), 4);
        }
    }

    /// Another app kept #2 since this flow read #0: this flow's store of #1 changes nothing and
    /// names the index kept. The same index again is stored (the words derive the same key).
    #[test]
    fn an_older_store_does_not_replace_a_newer_kept_key() {
        let dir = tempfile::tempdir().unwrap();
        for (vault, passphrase) in generation_vaults(dir.path()) {
            let flow = vault.unlocking(passphrase.map(|p| Secret::new(p.to_string())));
            assert_eq!(
                flow.store_master("QmScid", 2, Secret::new([6u8; 32]))
                    .unwrap(),
                Stored::Stored
            );
            assert_eq!(
                flow.store_master("QmScid", 1, Secret::new([5u8; 32]))
                    .unwrap(),
                Stored::AlreadyNewer { kept: 2 }
            );
            assert_eq!(
                flow.store_master("QmScid", 0, Secret::new([4u8; 32]))
                    .unwrap(),
                Stored::AlreadyNewer { kept: 2 }
            );
            assert_eq!(vault.master_index("QmScid").unwrap(), Some(2));
            assert_eq!(
                unlocked_key(&vault, passphrase),
                ed25519_signing_key_multikey([6u8; 32])
            );
            assert_eq!(
                flow.store_master("QmScid", 2, Secret::new([6u8; 32]))
                    .unwrap(),
                Stored::Stored
            );
            assert_eq!(
                flow.store_master("QmScid", 3, Secret::new([7u8; 32]))
                    .unwrap(),
                Stored::Stored
            );
            assert_eq!(vault.master_index("QmScid").unwrap(), Some(3));
        }
    }

    /// A rotation staged #1 while another app kept #2: its promote changes nothing kept, names
    /// #2, and discards the staged #1, which can never be kept.
    #[test]
    fn a_promote_meeting_a_newer_kept_key_discards_the_staged_one() {
        let dir = tempfile::tempdir().unwrap();
        for (vault, passphrase) in generation_vaults(dir.path()) {
            let flow = vault.unlocking(passphrase.map(|p| Secret::new(p.to_string())));
            flow.stage_master("QmScid", 1, Secret::new([5u8; 32]), &StageToken([1; 16]))
                .unwrap();
            flow.store_master("QmScid", 2, Secret::new([6u8; 32]))
                .unwrap();
            assert_eq!(
                flow.promote_master("QmScid", 1).unwrap(),
                Stored::AlreadyNewer { kept: 2 }
            );
            assert_eq!(vault.staged_index("QmScid").unwrap(), None);
            assert_eq!(vault.master_index("QmScid").unwrap(), Some(2));
            assert_eq!(
                unlocked_key(&vault, passphrase),
                ed25519_signing_key_multikey([6u8; 32])
            );
            // Nothing staged at #1 any more.
            assert_eq!(flow.promote_master("QmScid", 1), Err(VaultError::NotFound));
            // A stage at the kept index or past it is promoted.
            flow.stage_master("QmScid", 3, Secret::new([7u8; 32]), &StageToken([1; 16]))
                .unwrap();
            assert_eq!(flow.promote_master("QmScid", 3).unwrap(), Stored::Stored);
            assert_eq!(vault.master_index("QmScid").unwrap(), Some(3));
        }
    }

    /// A refresh that read #0 forgets #0; another app kept #2 since: the forget leaves #2 and
    /// names it. With the kept key at the index named, it goes.
    #[test]
    fn a_forget_with_a_stale_index_keeps_the_newer_key() {
        let dir = tempfile::tempdir().unwrap();
        for (vault, passphrase) in generation_vaults(dir.path()) {
            let flow = vault.unlocking(passphrase.map(|p| Secret::new(p.to_string())));
            flow.store_master("QmScid", 2, Secret::new([6u8; 32]))
                .unwrap();
            assert_eq!(flow.forget_master("QmScid", 0).unwrap(), Forgot::Kept(2));
            assert_eq!(flow.forget_master("QmScid", 3).unwrap(), Forgot::Kept(2));
            assert_eq!(vault.master_index("QmScid").unwrap(), Some(2));
            assert_eq!(
                unlocked_key(&vault, passphrase),
                ed25519_signing_key_multikey([6u8; 32])
            );
            assert_eq!(flow.forget_master("QmScid", 2).unwrap(), Forgot::Forgot);
            assert!(!vault.holds("QmScid").unwrap());
        }
    }

    /// A kept item that does not say its index is never forgotten, nor written over: the vault
    /// cannot tell whether it is newer.
    #[test]
    fn a_kept_key_without_its_index_is_neither_forgotten_nor_replaced() {
        let keychain = Arc::new(MemoryStore::as_kind(StoreKind::Keychain));
        let vault = DesktopVault::new(Box::new(keychain.clone()), PendingIncepts::memory());
        let item = CustodyItem {
            scid: "QmScid".into(),
            index: 2,
            master: Zeroizing::new([6u8; 32]),
        };
        keychain
            .put(&item_name("QmScid"), &item.to_bytes())
            .unwrap();
        let flow = vault.unlocking(None);
        assert!(matches!(
            flow.forget_master("QmScid", 2),
            Err(VaultError::Unavailable(_))
        ));
        assert!(matches!(
            flow.store_master("QmScid", 1, Secret::new([5u8; 32])),
            Err(VaultError::Unavailable(_))
        ));
        assert_eq!(
            unlocked_key(&vault, None),
            ed25519_signing_key_multikey([6u8; 32])
        );
    }

    /// A file store that, the first time the kept item is read (the forget's check), lets
    /// `between` run on another thread and waits for it, up to a limit: where another process
    /// would install its key between this one's check and its delete.
    struct Interleaved {
        file: crate::store::FileStore,
        between: std::sync::Mutex<Option<Box<dyn FnOnce() + Send>>>,
        /// The thread `between` runs on, to join once the forget is done.
        other: std::sync::Mutex<Option<std::thread::JoinHandle<()>>>,
    }

    impl SecretStore for Interleaved {
        fn kind(&self) -> StoreKind {
            self.file.kind()
        }
        fn kind_of(&self, n: &str) -> Result<StoreKind, VaultError> {
            self.file.kind_of(n)
        }
        fn put(&self, n: &str, b: &[u8]) -> Result<(), VaultError> {
            self.file.put(n, b)
        }
        fn get(&self, n: &str) -> Result<Option<Vec<u8>>, VaultError> {
            let got = self.file.get(n);
            if n == item_name("QmScid") {
                if let Some(between) = self.between.lock().unwrap().take() {
                    let (tx, rx) = std::sync::mpsc::channel();
                    *self.other.lock().unwrap() = Some(std::thread::spawn(move || {
                        between();
                        let _ = tx.send(());
                    }));
                    // Long enough for the other handle's whole store when nothing holds it off.
                    let _ = rx.recv_timeout(std::time::Duration::from_secs(2));
                }
            }
            got
        }
        fn contains(&self, n: &str) -> Result<bool, VaultError> {
            self.file.contains(n)
        }
        fn delete(&self, n: &str) -> Result<(), VaultError> {
            self.file.delete(n)
        }
        fn rename(&self, from: &str, to: &str) -> Result<(), VaultError> {
            self.file.rename(from, to)
        }
    }

    /// Two handles on one custody folder, each its own store and its own lists, as two apps'
    /// custody services are: one forgets #0 (a refresh that read #0) and, between its check and
    /// its delete, the other installs #1. The custody folder's lock holds the install off until
    /// the forget is done, so #1 survives; without it the forget deleted #1.
    #[test]
    fn an_install_racing_a_forget_on_another_handle_survives() {
        const PASS: &str = "a passphrase of length";
        let dir = tempfile::tempdir().unwrap();
        let custody = dir.path().to_path_buf();
        sealed_in_file(&custody, "QmScid", [4u8; 32], PASS);
        let installed = Arc::new(std::sync::Mutex::new(None));
        let other_custody = custody.clone();
        let other_installed = installed.clone();
        let between: Box<dyn FnOnce() + Send> = Box::new(move || {
            let other_app = DesktopVault::with_kdf(
                Box::new(crate::store::FileStore::new(&other_custody)),
                PendingIncepts::file(&other_custody),
                CHEAP,
            );
            let stored =
                other_app
                    .unlocking(pass(PASS))
                    .store_master("QmScid", 1, Secret::new([5u8; 32]));
            *other_installed.lock().unwrap() = Some(stored);
        });
        let store = Arc::new(Interleaved {
            file: crate::store::FileStore::new(&custody),
            between: std::sync::Mutex::new(Some(between)),
            other: std::sync::Mutex::new(None),
        });
        let this_app = DesktopVault::with_kdf(
            Box::new(store.clone()),
            PendingIncepts::file(&custody),
            CHEAP,
        );
        let forgot = this_app.unlocking(None).forget_master("QmScid", 0);
        let other = store.other.lock().unwrap().take();
        other.expect("the other handle ran").join().unwrap();
        assert_eq!(forgot.unwrap(), Forgot::Forgot);
        assert_eq!(
            installed.lock().unwrap().take().unwrap().unwrap(),
            Stored::Stored
        );
        let vault = placed(&custody, None);
        assert_eq!(vault.master_index("QmScid").unwrap(), Some(1));
        assert_eq!(
            unlocked_key(&vault, Some(PASS)),
            ed25519_signing_key_multikey([5u8; 32])
        );
    }

    /// An item the vault cannot vouch for answers `None`, never a guess: a keychain item kept
    /// without its index attribute (before this build), a sealed blob that is not one.
    #[test]
    fn an_item_that_does_not_say_its_index_answers_none() {
        let keychain = Arc::new(MemoryStore::as_kind(StoreKind::Keychain));
        let vault = DesktopVault::new(Box::new(keychain.clone()), PendingIncepts::memory());
        let item = CustodyItem {
            scid: "QmScid".into(),
            index: 2,
            master: Zeroizing::new([4u8; 32]),
        };
        keychain
            .put(&item_name("QmScid"), &item.to_bytes())
            .unwrap();
        let flow = vault.unlocking(None);
        assert!(vault.holds("QmScid").unwrap());
        assert_eq!(flow.master_index("QmScid").unwrap(), None);
        // The key itself still unlocks, at the index sealed inside it.
        assert_eq!(
            flow.unlock("QmScid", MasterUse::Link, 0)
                .unwrap()
                .signer(0)
                .unwrap()
                .index(),
            2
        );

        let sealed = Arc::new(MemoryStore::new());
        let vault = DesktopVault::new(Box::new(sealed.clone()), PendingIncepts::memory());
        sealed
            .put(&item_name("QmScid"), b"not a sealed item")
            .unwrap();
        assert_eq!(vault.master_index("QmScid").unwrap(), None);
    }

    /// The state the concurrent-rebuild test on #1667 builds: this app keeps #0, another app's
    /// rotation to #1 landed, and this app's rebuild staged #2, whose publish is still on its
    /// way. Another app's refresh (`refresh_master`) leaves the stage ahead of the log alone, then
    /// finds the kept #0 behind the log with no key in its inbox and forgets it. Forgetting the
    /// obsolete kept key must leave the staged #2 where it is: when the publish lands, this app
    /// promotes it. Removing the master key from this computer (a logout) is the step that takes
    /// every copy, the staged one included.
    fn forgetting_the_obsolete_kept_key_leaves_a_stage_ahead_of_the_log(
        this_app: &DesktopVault,
        other_app: &DesktopVault,
        passphrase: Option<&str>,
    ) {
        let ours = StageToken([0xa; 16]);
        let flow = this_app.unlocking(passphrase.map(|p| Secret::new(p.to_string())));
        flow.stage_master("QmScid", 2, Secret::new([6u8; 32]), &ours)
            .unwrap();
        assert_eq!(this_app.master_index("QmScid").unwrap(), Some(0));
        assert_eq!(other_app.staged_index("QmScid").unwrap(), Some(2));

        // The other app's refresh with the log at #1: nothing for a stage ahead of the log, then
        // the kept #0 is behind the log and no key waits in its inbox.
        assert_eq!(
            other_app
                .unlocking(None)
                .forget_master("QmScid", 0)
                .unwrap(),
            Forgot::Forgot
        );
        assert_eq!(other_app.master_index("QmScid").unwrap(), None);
        assert_eq!(
            this_app.staged_index("QmScid").unwrap(),
            Some(2),
            "the stage ahead of the log survives a refresh that forgets the kept key"
        );

        // This app's publish lands; its promote finds the key.
        this_app
            .unlocking(None)
            .promote_master("QmScid", 2)
            .unwrap();
        assert_eq!(this_app.master_index("QmScid").unwrap(), Some(2));
        assert_eq!(this_app.staged_index("QmScid").unwrap(), None);
        assert_eq!(
            flow.unlock("QmScid", MasterUse::Link, 0)
                .unwrap()
                .signer(0)
                .unwrap()
                .index(),
            2
        );
    }

    #[test]
    fn forgetting_the_obsolete_kept_key_leaves_a_stage_ahead_of_the_log_in_a_sealed_file() {
        let dir = tempfile::tempdir().unwrap();
        let custody = dir.path().join("custody");
        sealed_in_file(&custody, "QmScid", [4u8; 32], "a passphrase of length");
        let this_app = placed(&custody, None);
        let other_app = placed(&custody, None);
        forgetting_the_obsolete_kept_key_leaves_a_stage_ahead_of_the_log(
            &this_app,
            &other_app,
            Some("a passphrase of length"),
        );
    }

    #[test]
    fn forgetting_the_obsolete_kept_key_leaves_a_stage_ahead_of_the_log_in_the_keychain() {
        let keychain = Arc::new(MemoryStore::as_kind(StoreKind::Keychain));
        let this_app = DesktopVault::new(Box::new(keychain.clone()), PendingIncepts::memory());
        let other_app = DesktopVault::new(Box::new(keychain.clone()), PendingIncepts::memory());
        this_app
            .unlocking(None)
            .store_master("QmScid", 0, Secret::new([4u8; 32]))
            .unwrap();
        forgetting_the_obsolete_kept_key_leaves_a_stage_ahead_of_the_log(
            &this_app, &other_app, None,
        );
    }

    /// Data's review test (we#431, r2), adapted to the contract with stage tokens. Two handles on
    /// one custody folder, as two desktop apps on one computer have (`host.rs`): what one
    /// stages, the other reads. The other's discard naming its own token (a rotation of its own
    /// that was refused) leaves this app's key; only a discard naming no owner (a refresh whose
    /// log is already past the staged index) takes another app's. This app's promote after its
    /// publish lands works, or finds the key already promoted by the other app, which the client
    /// counts as kept because the vault keeps that index.
    fn two_handles_share_the_staged_slot(
        this_app: &DesktopVault,
        other_app: &DesktopVault,
        passphrase: Option<&str>,
    ) {
        let (ours, theirs) = (StageToken([0xa; 16]), StageToken([0xb; 16]));
        let flow = this_app.unlocking(passphrase.map(|p| Secret::new(p.to_string())));
        let other = other_app.unlocking(None);

        flow.stage_master("QmScid", 1, Secret::new([5u8; 32]), &ours)
            .unwrap();
        assert_eq!(other_app.staged_index("QmScid").unwrap(), Some(1));
        // The other app's own rotation, refused, discards with its own token: ours stays.
        other.discard_staged("QmScid", 1, Some(&theirs)).unwrap();
        assert_eq!(other_app.staged_index("QmScid").unwrap(), Some(1));
        // Its refresh with the log still at #0 leaves a key staged ahead of the log: the
        // client calls nothing here. Our publish lands; our promote finds the key.
        this_app
            .unlocking(None)
            .promote_master("QmScid", 1)
            .unwrap();
        assert_eq!(this_app.master_index("QmScid").unwrap(), Some(1));
        assert_eq!(other_app.master_index("QmScid").unwrap(), Some(1));

        // The other app's refresh reads the log at #2 first and promotes our key: our promote
        // finds nothing staged, and the vault keeps #2, which the client counts as kept.
        flow.stage_master("QmScid", 2, Secret::new([6u8; 32]), &ours)
            .unwrap();
        other.promote_master("QmScid", 2).unwrap();
        assert_eq!(
            this_app.unlocking(None).promote_master("QmScid", 2),
            Err(VaultError::NotFound)
        );
        assert_eq!(this_app.master_index("QmScid").unwrap(), Some(2));
        assert_eq!(
            flow.unlock("QmScid", MasterUse::Link, 0)
                .unwrap()
                .signer(0)
                .unwrap()
                .index(),
            2
        );

        // A refresh whose log is past the staged index discards it whoever staged it.
        flow.stage_master("QmScid", 3, Secret::new([7u8; 32]), &ours)
            .unwrap();
        other.discard_staged("QmScid", 3, None).unwrap();
        assert_eq!(this_app.staged_index("QmScid").unwrap(), None);
        assert_eq!(
            this_app.unlocking(None).promote_master("QmScid", 3),
            Err(VaultError::NotFound)
        );
        // The vault does not keep #3: the client stores the key again from the words.
        assert_eq!(this_app.master_index("QmScid").unwrap(), Some(2));

        // A stage replaces another app's stage; then the first app's discard of its own key is
        // a no-op, and the stage left is the second app's.
        flow.stage_master("QmScid", 3, Secret::new([7u8; 32]), &ours)
            .unwrap();
        other_app
            .unlocking(passphrase.map(|p| Secret::new(p.to_string())))
            .stage_master("QmScid", 3, Secret::new([8u8; 32]), &theirs)
            .unwrap();
        this_app
            .unlocking(None)
            .discard_staged("QmScid", 3, Some(&ours))
            .unwrap();
        assert_eq!(this_app.staged_index("QmScid").unwrap(), Some(3));
        other.discard_staged("QmScid", 3, Some(&theirs)).unwrap();
        assert_eq!(this_app.staged_index("QmScid").unwrap(), None);
        assert_eq!(this_app.master_index("QmScid").unwrap(), Some(2));
    }

    #[test]
    fn a_second_handle_on_the_same_folder_sees_and_deletes_a_staged_key() {
        let dir = tempfile::tempdir().unwrap();
        let custody = dir.path().join("custody");
        sealed_in_file(&custody, "QmScid", [4u8; 32], "a passphrase of length");
        let this_app = placed(&custody, None);
        let other_app = placed(&custody, None);
        two_handles_share_the_staged_slot(&this_app, &other_app, Some("a passphrase of length"));
    }

    /// The same over one keychain, where the token is an attribute of the item.
    #[test]
    fn a_second_handle_on_the_same_keychain_sees_and_deletes_a_staged_key() {
        let keychain = Arc::new(MemoryStore::as_kind(StoreKind::Keychain));
        let this_app = DesktopVault::new(Box::new(keychain.clone()), PendingIncepts::memory());
        let other_app = DesktopVault::new(Box::new(keychain.clone()), PendingIncepts::memory());
        this_app
            .unlocking(None)
            .store_master("QmScid", 0, Secret::new([4u8; 32]))
            .unwrap();
        two_handles_share_the_staged_slot(&this_app, &other_app, None);
    }

    /// The token is kept with the staged item and authenticated as its index is: a sealed
    /// item's header token or index, edited, leaves an item that does not open, and an edited
    /// token makes the discard of the flow that staged it leave the key.
    #[test]
    fn a_staged_token_is_kept_with_the_key_and_cannot_be_edited() {
        use crate::store::FileStore;
        let dir = tempfile::tempdir().unwrap();
        let custody = dir.path().join("custody");
        sealed_in_file(&custody, "QmScid", [4u8; 32], "a passphrase of length");
        let vault = placed(&custody, None);
        let flow = vault.unlocking(pass("a passphrase of length"));
        let ours = StageToken([0xa; 16]);
        flow.stage_master("QmScid", 1, Secret::new([5u8; 32]), &ours)
            .unwrap();
        let file = FileStore::new(&custody);
        let blob = file.get(&staged_name("QmScid")).unwrap().unwrap();
        assert_eq!(seal::sealed_owner(&blob), Some(ours));
        assert_eq!(seal::sealed_index(&blob), Some(1));

        // The token in the file, edited to another app's: the flow's own discard leaves it, and
        // the key, promoted by index, does not open.
        let at = blob.windows(16).position(|w| w == ours.0).unwrap();
        let mut edited = blob.clone();
        edited[at..at + 16].copy_from_slice(&[0xb; 16]);
        file.put(&staged_name("QmScid"), &edited).unwrap();
        flow.discard_staged("QmScid", 1, Some(&ours)).unwrap();
        assert_eq!(vault.staged_index("QmScid").unwrap(), Some(1));
        flow.promote_master("QmScid", 1).unwrap();
        assert_eq!(
            flow.unlock("QmScid", MasterUse::Link, 0).err(),
            Some(VaultError::Cancelled)
        );

        // The index edited: read as the new index, and it does not open either.
        flow.store_master("QmScid", 1, Secret::new([5u8; 32]))
            .unwrap();
        flow.stage_master("QmScid", 2, Secret::new([6u8; 32]), &ours)
            .unwrap();
        let mut moved = file.get(&staged_name("QmScid")).unwrap().unwrap();
        let index_at = at - 4;
        assert_eq!(moved[index_at..at], 2u32.to_le_bytes());
        moved[index_at..at].copy_from_slice(&5u32.to_le_bytes());
        file.put(&staged_name("QmScid"), &moved).unwrap();
        assert_eq!(vault.staged_index("QmScid").unwrap(), Some(5));
        flow.discard_staged("QmScid", 2, Some(&ours)).unwrap();
        assert_eq!(vault.staged_index("QmScid").unwrap(), Some(5));
        flow.promote_master("QmScid", 5).unwrap();
        assert!(flow.unlock("QmScid", MasterUse::Link, 0).is_err());
    }

    /// A key staged before tokens were kept (a `/2` sealed item, a keychain item whose comment
    /// names only its index) has no owner: a flow's discard naming its token leaves it, and only
    /// a discard naming no owner (a refresh behind the log) forgets it.
    #[test]
    fn a_key_staged_without_a_token_is_discarded_only_without_an_owner() {
        let ours = StageToken([0xa; 16]);
        let item = CustodyItem {
            scid: "QmScid".into(),
            index: 1,
            master: Zeroizing::new([5u8; 32]),
        };

        let sealed = Arc::new(MemoryStore::new());
        let vault =
            DesktopVault::with_kdf(Box::new(sealed.clone()), PendingIncepts::memory(), CHEAP);
        let blob = seal::seal(&item, "a passphrase of length", CHEAP, &os_random).unwrap();
        sealed.put(&staged_name("QmScid"), &blob).unwrap();

        let keychain = Arc::new(MemoryStore::as_kind(StoreKind::Keychain));
        let unsealed = DesktopVault::new(Box::new(keychain.clone()), PendingIncepts::memory());
        let tag = ItemTag {
            index: 1,
            owner: None,
        };
        keychain
            .put_tagged(&staged_name("QmScid"), &item.to_bytes(), &tag)
            .unwrap();

        for vault in [&vault, &unsealed] {
            let locked = vault.unlocking(None);
            assert_eq!(locked.staged_index("QmScid").unwrap(), Some(1));
            locked.discard_staged("QmScid", 1, Some(&ours)).unwrap();
            assert_eq!(locked.staged_index("QmScid").unwrap(), Some(1));
            locked.discard_staged("QmScid", 1, None).unwrap();
            assert_eq!(locked.staged_index("QmScid").unwrap(), None);
        }
    }

    /// A keychain stage keeps its token in the same write as the key, and a promote keeps the
    /// item's attributes with it (by index; the token then names nothing).
    #[test]
    fn a_keychain_stage_keeps_its_token_as_an_attribute() {
        let keychain = Arc::new(MemoryStore::as_kind(StoreKind::Keychain));
        let vault = DesktopVault::new(Box::new(keychain.clone()), PendingIncepts::memory());
        let ours = StageToken([0xa; 16]);
        vault
            .unlocking(None)
            .stage_master("QmScid", 1, Secret::new([5u8; 32]), &ours)
            .unwrap();
        assert_eq!(
            keychain.tag_of(&staged_name("QmScid")).unwrap(),
            Some(ItemTag {
                index: 1,
                owner: Some(ours)
            })
        );
        vault.unlocking(None).promote_master("QmScid", 1).unwrap();
        assert_eq!(vault.master_index("QmScid").unwrap(), Some(1));
        assert_eq!(keychain.tag_of(&staged_name("QmScid")).unwrap(), None);
    }

    /// Stage, promote and discard on one store: a staged key is not what unlock gives and leaves
    /// the kept one as it is; promote moves it over the kept one with no passphrase; discard
    /// forgets only the index named, and with an owner only that owner's key; forgetting the
    /// master key leaves a staged one.
    fn stage_promote_discard(vault: &DesktopVault, passphrase: Option<&str>) {
        let (ours, theirs) = (StageToken([1u8; 16]), StageToken([2u8; 16]));
        let flow = vault.unlocking(passphrase.map(|p| Secret::new(p.to_string())));
        let locked = vault.unlocking(None);
        flow.store_master("QmScid", 0, Secret::new([4u8; 32]))
            .unwrap();
        assert_eq!(locked.staged_index("QmScid").unwrap(), None);
        // Nothing staged: a discard is no error.
        locked.discard_staged("QmScid", 1, None).unwrap();

        flow.stage_master("QmScid", 1, Secret::new([5u8; 32]), &ours)
            .unwrap();
        assert_eq!(locked.staged_index("QmScid").unwrap(), Some(1));
        assert_eq!(locked.master_index("QmScid").unwrap(), Some(0));
        let kept = flow.unlock("QmScid", MasterUse::Link, 0).unwrap();
        assert_eq!(kept.signer(0).unwrap().index(), 0);
        drop(kept);
        // Staging again replaces the staged key, whatever its index and whoever staged it.
        flow.stage_master("QmScid", 2, Secret::new([6u8; 32]), &theirs)
            .unwrap();
        assert_eq!(locked.staged_index("QmScid").unwrap(), Some(2));
        // Discarding another index leaves it, with or without an owner; so does discarding
        // its index with another owner's token. Promoting another index is NotFound.
        locked.discard_staged("QmScid", 1, None).unwrap();
        locked.discard_staged("QmScid", 1, Some(&theirs)).unwrap();
        locked.discard_staged("QmScid", 2, Some(&ours)).unwrap();
        assert_eq!(locked.staged_index("QmScid").unwrap(), Some(2));
        assert_eq!(
            locked.promote_master("QmScid", 1),
            Err(VaultError::NotFound)
        );

        // The promote needs no passphrase, and no owner: it goes by index.
        locked.promote_master("QmScid", 2).unwrap();
        assert_eq!(locked.staged_index("QmScid").unwrap(), None);
        assert_eq!(locked.master_index("QmScid").unwrap(), Some(2));
        let promoted = flow.unlock("QmScid", MasterUse::Link, 0).unwrap();
        assert_eq!(
            ad4m_identity_core::build::Signer::key(promoted.signer(0).unwrap()),
            ed25519_signing_key_multikey([6u8; 32])
        );
        drop(promoted);
        assert_eq!(
            locked.promote_master("QmScid", 2),
            Err(VaultError::NotFound)
        );

        // A rotation that did not land: its flow discards its own key, the kept key untouched.
        flow.stage_master("QmScid", 3, Secret::new([7u8; 32]), &ours)
            .unwrap();
        locked.discard_staged("QmScid", 3, Some(&ours)).unwrap();
        locked.discard_staged("QmScid", 3, Some(&ours)).unwrap();
        assert_eq!(locked.staged_index("QmScid").unwrap(), None);
        assert_eq!(locked.master_index("QmScid").unwrap(), Some(2));
        // A refresh discarding one behind the log names no owner, and takes anyone's.
        flow.stage_master("QmScid", 3, Secret::new([7u8; 32]), &theirs)
            .unwrap();
        locked.discard_staged("QmScid", 3, None).unwrap();
        assert_eq!(locked.staged_index("QmScid").unwrap(), None);

        // A refresh forgetting a replaced kept key leaves a staged one (a rotation's publish may
        // be on its way).
        flow.stage_master("QmScid", 3, Secret::new([7u8; 32]), &ours)
            .unwrap();
        assert_eq!(locked.forget_master("QmScid", 2).unwrap(), Forgot::Forgot);
        assert_eq!(locked.staged_index("QmScid").unwrap(), Some(3));
        assert_eq!(locked.master_index("QmScid").unwrap(), None);
    }

    /// Lal's review case (we#431): a refresh leaves a key staged ahead of the log, then forgets
    /// the kept key behind it (kept #0, log at #1, another app's rebuild staged #2). The forget
    /// takes the kept slot only: #2 stays staged, and its promote still works once its publish
    /// lands, giving the staged key.
    fn forgetting_the_kept_key_leaves_a_stage_in_flight(
        vault: &DesktopVault,
        passphrase: Option<&str>,
    ) {
        let flow = vault.unlocking(passphrase.map(|p| Secret::new(p.to_string())));
        let locked = vault.unlocking(None);
        flow.store_master("QmScid", 0, Secret::new([4u8; 32]))
            .unwrap();
        flow.stage_master("QmScid", 2, Secret::new([6u8; 32]), &StageToken([0xc; 16]))
            .unwrap();

        assert_eq!(locked.forget_master("QmScid", 0).unwrap(), Forgot::Forgot);
        assert_eq!(vault.master_index("QmScid").unwrap(), None);
        assert!(!vault.holds("QmScid").unwrap());
        assert_eq!(vault.staged_index("QmScid").unwrap(), Some(2));

        locked.promote_master("QmScid", 2).unwrap();
        assert_eq!(vault.staged_index("QmScid").unwrap(), None);
        assert_eq!(vault.master_index("QmScid").unwrap(), Some(2));
        let promoted = flow.unlock("QmScid", MasterUse::Link, 0).unwrap();
        assert_eq!(
            ad4m_identity_core::build::Signer::key(promoted.signer(0).unwrap()),
            ed25519_signing_key_multikey([6u8; 32])
        );
    }

    #[test]
    fn forgetting_the_kept_key_leaves_a_stage_in_flight_in_every_store() {
        let dir = tempfile::tempdir().unwrap();
        let sealed_file = DesktopVault::with_kdf(
            Box::new(crate::store::FileStore::new(dir.path())),
            PendingIncepts::memory(),
            CHEAP,
        );
        forgetting_the_kept_key_leaves_a_stage_in_flight(
            &sealed_file,
            Some("a passphrase of some length"),
        );

        let keychain = DesktopVault::new(
            Box::new(MemoryStore::as_kind(StoreKind::Keychain)),
            PendingIncepts::memory(),
        );
        forgetting_the_kept_key_leaves_a_stage_in_flight(&keychain, None);

        let sealed_platform = DesktopVault::with_kdf(
            Box::new(MemoryStore::new()),
            PendingIncepts::memory(),
            CHEAP,
        );
        forgetting_the_kept_key_leaves_a_stage_in_flight(
            &sealed_platform,
            Some("a passphrase of some length"),
        );
    }

    #[test]
    fn a_rotation_stages_and_promotes_in_a_sealed_file() {
        let dir = tempfile::tempdir().unwrap();
        let vault = DesktopVault::with_kdf(
            Box::new(crate::store::FileStore::new(dir.path())),
            PendingIncepts::memory(),
            CHEAP,
        );
        stage_promote_discard(&vault, Some("a passphrase of some length"));
        // Staging with no passphrase seals nothing.
        assert_eq!(
            vault.unlocking(None).stage_master(
                "QmScid",
                1,
                Secret::new([5u8; 32]),
                &StageToken([1u8; 16])
            ),
            Err(VaultError::Cancelled)
        );
    }

    #[test]
    fn a_rotation_stages_and_promotes_in_the_keychain() {
        let vault = DesktopVault::new(
            Box::new(MemoryStore::as_kind(StoreKind::Keychain)),
            PendingIncepts::memory(),
        );
        stage_promote_discard(&vault, None);
    }

    #[test]
    fn a_rotation_stages_and_promotes_in_a_sealed_platform_store() {
        let vault = DesktopVault::with_kdf(
            Box::new(MemoryStore::new()),
            PendingIncepts::memory(),
            CHEAP,
        );
        stage_promote_discard(&vault, Some("a passphrase of some length"));
    }

    /// A key kept in the file while the platform store is up: its staged key goes to the file
    /// too, sealed, and is promoted there; nothing lands in the platform store.
    #[test]
    fn a_staged_key_rests_beside_the_kept_one() {
        use crate::store::FileStore;
        let dir = tempfile::tempdir().unwrap();
        let custody = dir.path().join("custody");
        sealed_in_file(&custody, "QmScid", [4u8; 32], "a passphrase of length");
        let platform = Arc::new(MemoryStore::as_kind(StoreKind::Keychain));
        let vault = placed(&custody, Some(platform.clone()));
        let flow = vault.unlocking(pass("a passphrase of length"));
        flow.stage_master("QmScid", 1, Secret::new([5u8; 32]), &StageToken([1u8; 16]))
            .unwrap();
        assert!(FileStore::new(&custody)
            .contains(&staged_name("QmScid"))
            .unwrap());
        assert!(platform.all_bytes().is_empty());
        assert_eq!(vault.staged_index("QmScid").unwrap(), Some(1));
        vault.unlocking(None).promote_master("QmScid", 1).unwrap();
        assert_eq!(vault.master_index("QmScid").unwrap(), Some(1));
        assert!(platform.all_bytes().is_empty());
    }

    /// Data's review test (we#431), adapted to the contract: `store_master` once wrote the item,
    /// then the index in a list beside it; when that second write failed, the item held master
    /// #1 while `master_index` answered #0, and the client's `refresh_master` forgot the only
    /// copy of the current key. The index now lives with the item, so after a write that the
    /// lists' folder refuses `master_index` names the key `unlock` gives, or says it cannot tell
    /// (`None`): never the replaced index.
    #[test]
    fn a_failed_index_write_leaves_the_item_ahead_of_the_index() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let lists = dir.path().join("lists");
        std::fs::create_dir_all(&lists).unwrap();
        let items = Arc::new(MemoryStore::as_kind(StoreKind::Keychain));
        let vault =
            DesktopVault::with_kdf(Box::new(items.clone()), PendingIncepts::file(&lists), CHEAP);
        let flow = vault.unlocking(None);
        flow.store_master("QmScid", 0, Secret::new([4u8; 32]))
            .unwrap();
        assert_eq!(flow.master_index("QmScid").unwrap(), Some(0));

        // The lists' folder cannot be written to (disk full, permissions, a crash between two
        // writes) while the rotation's key is kept.
        std::fs::set_permissions(&lists, std::fs::Permissions::from_mode(0o555)).unwrap();
        let _ = flow.store_master("QmScid", 1, Secret::new([5u8; 32]));
        std::fs::set_permissions(&lists, std::fs::Permissions::from_mode(0o755)).unwrap();

        let unlocked = flow.unlock("QmScid", MasterUse::Link, 0).unwrap();
        let given = unlocked.signer(0).unwrap().index();
        let index = flow.master_index("QmScid").unwrap();
        assert!(
            index.is_none() || index == Some(given),
            "master_index answers {index:?} while unlock gives master #{given}"
        );
    }

    fn ed25519_signing_key_multikey(secret: [u8; 32]) -> ad4m_identity_core::Multikey {
        ad4m_identity_core::build::Signer::key(&KeySigner::new(&secret, 0))
    }
}
