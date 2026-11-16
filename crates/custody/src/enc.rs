//! The custody enc key: the X25519 key the key log lists beside this computer's executor device
//! key. The holder seals the master key to it and wraps the record key to it; the custody service
//! opens both, and the executor only passes the sealed text on (`identity.inboxSealed`).
//!
//! One key per executor device key, made at random the first time the custody service connects to
//! that executor and kept in the same store as the master key (`coasys.custody.enc/<device key>`,
//! [`crate::store::enc_item_name`]). Never derived from the words, the master key or the device key.
//! It asks for no unlock: the main window's state reads the record on every call, which a prompt
//! per read would make unusable. A key that is lost cannot be made again; the log then lists one
//! this computer does not have, which `CustodyPublic::enc_mismatch` tells the person.

use std::sync::Arc;

use ad4m_identity_client::{EncKey, EncOpenError, Secret, VaultError};
use ad4m_identity_core::inbox::{InboxAddress, InboxError, InboxPayload};
use ad4m_identity_core::record::{RecordError, RECORD_KEY_LEN};
use ad4m_identity_core::{x25519_multikey_of, Multikey, X25519Secret};
use zeroize::Zeroizing;

use crate::store::{enc_item_name, SecretStore};

/// The custody enc key of one executor device key, kept in the OS store.
pub struct CustodyEncKey {
    store: Arc<dyn SecretStore>,
    name: String,
    /// Public, read once.
    enc: Multikey,
}

/// The X25519 secret in a kept item: exactly 32 bytes.
fn secret_of(bytes: &[u8]) -> Result<X25519Secret, VaultError> {
    let bytes: [u8; 32] = bytes.try_into().map_err(|_| {
        VaultError::Unavailable("the custody enc key item is not a 32-byte key".into())
    })?;
    Ok(X25519Secret::from(bytes))
}

impl CustodyEncKey {
    /// The key for `device_key` (the executor's signing multikey); makes and keeps a new one when
    /// none is kept. Create if absent, never replace ([`SecretStore::claim_secret`]): two callers
    /// at once get the same key.
    pub fn for_device(store: Arc<dyn SecretStore>, device_key: &str) -> Result<Self, VaultError> {
        let name = enc_item_name(device_key);
        let mut fresh = Zeroizing::new([0u8; 32]);
        rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, fresh.as_mut());
        let kept = store.claim_secret(&name, fresh.as_ref())?;
        let enc = x25519_multikey_of(&secret_of(&kept)?);
        Ok(CustodyEncKey { store, name, enc })
    }

    /// The secret, read from the store for one use; wiped when it drops.
    fn secret(&self) -> Result<X25519Secret, String> {
        let bytes = Zeroizing::new(
            self.store
                .get(&self.name)
                .map_err(|e| e.to_string())?
                .ok_or("the custody enc key is no longer kept on this computer")?,
        );
        let secret = secret_of(&bytes).map_err(|e| e.to_string())?;
        // Replaced since it was read: opening with another key would answer `Sealed` and drop
        // messages that were sealed to the one the log lists.
        if x25519_multikey_of(&secret) != self.enc {
            return Err("the custody enc key was replaced while in use".into());
        }
        Ok(secret)
    }
}

impl EncKey for CustodyEncKey {
    fn enc(&self) -> Multikey {
        self.enc.clone()
    }

    fn open(
        &self,
        address: &InboxAddress,
        sealed: &str,
    ) -> Result<InboxPayload, EncOpenError<InboxError>> {
        let secret = self.secret().map_err(EncOpenError::Unavailable)?;
        ad4m_identity_core::inbox::open(&secret, address, sealed).map_err(EncOpenError::Sealed)
    }

    fn unwrap_record_key(
        &self,
        scid: &str,
        wrapped: &str,
    ) -> Result<Secret<[u8; RECORD_KEY_LEN]>, EncOpenError<RecordError>> {
        let secret = self.secret().map_err(EncOpenError::Unavailable)?;
        ad4m_identity_core::record::unwrap_key(wrapped, scid, &secret)
            .map(|key| Secret::new(*key))
            .map_err(EncOpenError::Sealed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pending::PendingIncepts;
    use crate::store::{FileStore, MemoryStore, PlacedStore, StoreKind};
    use crate::vault::DesktopVault;
    use ad4m_identity_core::inbox::{seal, sign_payload, InboxBody};
    use ad4m_identity_core::link::SignedBy;

    const DEVICE: &str = "z6MkDeviceKeyOfThisExecutor";
    const OTHER_DEVICE: &str = "z6MkDeviceKeyOfAnotherExecutor";

    fn file_vault(dir: &std::path::Path) -> DesktopVault {
        DesktopVault::new(
            Box::new(PlacedStore::new(
                Box::new(FileStore::new(dir)),
                None,
                dir.join("claim.lock"),
            )),
            PendingIncepts::memory(),
        )
    }

    #[test]
    fn each_device_key_gets_one_enc_key_that_outlives_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        let custody = dir.path().join("custody");
        let first = file_vault(&custody);
        let key = CustodyEncKey::for_device(first.shared_store(), DEVICE).unwrap();
        assert!(key.enc().starts_with("z6LS"), "{}", key.enc());
        // Asked again, the same key.
        let again = CustodyEncKey::for_device(first.shared_store(), DEVICE).unwrap();
        assert_eq!(again.enc(), key.enc());
        // Another executor's device key, another key.
        let other = CustodyEncKey::for_device(first.shared_store(), OTHER_DEVICE).unwrap();
        assert_ne!(other.enc(), key.enc());
        drop(first);

        // A new vault over the same folder, as after a restart: the key is still there.
        let restarted = file_vault(&custody);
        let kept = CustodyEncKey::for_device(restarted.shared_store(), DEVICE).unwrap();
        assert_eq!(kept.enc(), key.enc());
        // It rests beside the master keys, as `<device key>.enc`, readable by its owner only.
        let path = custody.join(format!("{DEVICE}.enc"));
        assert_eq!(std::fs::read(&path).unwrap().len(), 32);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        // Nothing is left beside it from the write but the claim lock, which stays by design.
        let mut names: Vec<_> = std::fs::read_dir(&custody)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        assert_eq!(
            names,
            [
                "claim.lock".to_string(),
                format!("{OTHER_DEVICE}.enc"),
                format!("{DEVICE}.enc"),
            ]
        );
    }

    #[test]
    fn callers_racing_for_a_new_device_key_all_get_the_same_enc_key() {
        for _ in 0..20 {
            let dir = tempfile::tempdir().unwrap();
            let custody = dir.path().join("custody");
            let barrier = Arc::new(std::sync::Barrier::new(8));
            let threads: Vec<_> = (0..8)
                .map(|_| {
                    let (custody, barrier) = (custody.clone(), barrier.clone());
                    std::thread::spawn(move || {
                        // Each its own vault and store over the one folder, as two processes.
                        let vault = file_vault(&custody);
                        barrier.wait();
                        CustodyEncKey::for_device(vault.shared_store(), DEVICE)
                            .unwrap()
                            .enc()
                    })
                })
                .collect();
            let encs: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
            assert!(encs.iter().all(|e| e == &encs[0]), "{encs:?}");
        }

        // One store shared by the racers.
        let store: Arc<dyn SecretStore> = Arc::new(MemoryStore::as_kind(StoreKind::Keychain));
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let store = store.clone();
                std::thread::spawn(move || CustodyEncKey::for_device(store, DEVICE).unwrap().enc())
            })
            .collect();
        let encs: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
        assert!(encs.iter().all(|e| e == &encs[0]), "{encs:?}");
    }

    #[test]
    fn it_opens_what_is_sealed_to_it_and_says_so_when_its_item_is_gone() {
        let store: Arc<dyn SecretStore> = Arc::new(MemoryStore::new());
        let key = CustodyEncKey::for_device(store.clone(), DEVICE).unwrap();
        let (events, _) = crate::keylog::tests::log_with_d2(true);
        let chain = ad4m_identity_core::fold(&events).unwrap();
        let address = InboxAddress::Joined {
            scid: chain.id().to_string(),
            key_id: "d2".into(),
        };
        let master = ad4m_identity_client::vault::KeySigner::new(&[8u8; 32], 0);
        let payload = sign_payload(
            DEVICE.into(),
            InboxBody::Master {
                did: chain.state().did.clone(),
                index: 0,
                secret: bs58::encode([8u8; 32]).into_string(),
            },
            1_800_000_000,
            SignedBy {
                key_id: "m0".into(),
                kel_seq: 0,
                kel_hash: chain.hash_at(0).unwrap().clone(),
            },
            &master,
        )
        .unwrap();
        let sealed = seal(&key.enc(), &address, &payload, &mut rand_core::OsRng).unwrap();
        let opened = key.open(&address, &sealed).unwrap();
        assert!(matches!(opened.body, InboxBody::Master { index: 0, .. }));

        // Sealed to another key: not for this computer.
        let other = CustodyEncKey::for_device(store.clone(), OTHER_DEVICE).unwrap();
        assert!(matches!(
            other.open(&address, &sealed),
            Err(EncOpenError::Sealed(_))
        ));

        // The item gone: the message stays unopened rather than taken for someone else's.
        store.delete(&enc_item_name(DEVICE)).unwrap();
        assert!(matches!(
            key.open(&address, &sealed),
            Err(EncOpenError::Unavailable(_))
        ));
        // Replaced by another key under the same name: the same.
        store.put(&enc_item_name(DEVICE), &[9u8; 32]).unwrap();
        assert!(matches!(
            key.open(&address, &sealed),
            Err(EncOpenError::Unavailable(_))
        ));
    }
}
