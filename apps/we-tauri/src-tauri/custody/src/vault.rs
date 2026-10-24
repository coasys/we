//! `DesktopVault`: the identity client's [`Vault`] over this computer's store.
//!
//! The client's flows call `Vault::unlock(scid, why, now)`, which has no passphrase in it: on macOS
//! there is none (the keychain asks), and on Linux the identity window collects one for the flow.
//! So the vault a flow is given is a [`Unlocking`] — the desktop vault together with that flow's
//! passphrase — and it lives exactly as long as the flow step that needs it.
//!
//! Every read and write is logged by kind only (`custody: read for Link`), never with contents.

use ad4m_identity_client::vault::KeySigner;
use ad4m_identity_client::{MasterUse, Secret, Unlocked, Vault, VaultError};
use zeroize::Zeroizing;

use crate::seal::{self, CustodyItem, Kdf};
use crate::store::{item_name, SecretStore};

pub struct DesktopVault {
    store: Box<dyn SecretStore>,
    kdf: Kdf,
}

fn os_random(out: &mut [u8]) {
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, out);
}

impl DesktopVault {
    pub fn new(store: Box<dyn SecretStore>) -> Self {
        DesktopVault {
            store,
            kdf: Kdf::DESKTOP,
        }
    }

    /// With another Argon2id cost (tests).
    pub fn with_kdf(store: Box<dyn SecretStore>, kdf: Kdf) -> Self {
        DesktopVault { store, kdf }
    }

    /// Whether the identity window must ask for a passphrase before a flow: false where the OS's own
    /// prompt unlocks the item (the keychain), true where the item is sealed with a passphrase.
    pub fn needs_passphrase(&self) -> bool {
        !self.store.kind().unlocks_itself()
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

    /// Whether an item for `scid` is held, without an unlock (no prompt, no passphrase).
    pub fn holds(&self, scid: &str) -> Result<bool, VaultError> {
        Ok(self.store.get(&item_name(scid))?.is_some())
    }

    fn read(
        &self,
        scid: &str,
        passphrase: Option<&str>,
        why: MasterUse,
    ) -> Result<CustodyItem, VaultError> {
        log::info!("custody: read for {why:?}");
        let bytes = Zeroizing::new(
            self.store
                .get(&item_name(scid))?
                .ok_or(VaultError::NotFound)?,
        );
        if self.store.kind().unlocks_itself() {
            return CustodyItem::from_bytes(&bytes);
        }
        let passphrase = passphrase.ok_or(VaultError::Cancelled)?;
        seal::open(&bytes, scid, passphrase)
    }

    fn write(&self, item: &CustodyItem, passphrase: Option<&str>) -> Result<(), VaultError> {
        log::info!("custody: write");
        let bytes = if self.store.kind().unlocks_itself() {
            item.to_bytes().to_vec()
        } else {
            let passphrase = passphrase.ok_or(VaultError::Cancelled)?;
            seal::seal(item, passphrase, self.kdf, &os_random)?
        };
        self.store.put(&item_name(&item.scid), &bytes)
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
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn a_passphrase_vault_keeps_the_key_sealed_and_opens_it_with_the_passphrase() {
        let store = std::sync::Arc::new(MemoryStore::new());
        struct Shared(std::sync::Arc<MemoryStore>);
        impl SecretStore for Shared {
            fn kind(&self) -> StoreKind {
                self.0.kind()
            }
            fn put(&self, n: &str, b: &[u8]) -> Result<(), VaultError> {
                self.0.put(n, b)
            }
            fn get(&self, n: &str) -> Result<Option<Vec<u8>>, VaultError> {
                self.0.get(n)
            }
            fn delete(&self, n: &str) -> Result<(), VaultError> {
                self.0.delete(n)
            }
        }
        let vault = DesktopVault::with_kdf(Box::new(Shared(store.clone())), CHEAP);
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
    fn a_keychain_vault_asks_for_no_passphrase() {
        let vault = DesktopVault::new(Box::new(MemoryStore::as_kind(StoreKind::Keychain)));
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
