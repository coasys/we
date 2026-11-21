//! What the key log says about a device: the signing key a request card shows, and whether the
//! device may keep the master key. Both come from the log, never from the private record, whose
//! names and kinds any linked device can write.
//!
//! A device may keep the master key when it made the identity (a standing key of the incept) or
//! when the claim it joined with said `canKeepMaster`: the claim's co-signature, which the `add`
//! carries, covers that flag, so the log proves it. A server's claim says `false`, and no record
//! entry it writes afterwards changes its log.

use ad4m_identity_core::link::{ClaimBody, CLAIM_DOMAIN};
use ad4m_identity_core::{verify_signed, Event, KeyLife, Op};

/// A device key as the log lists it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LoggedDevice {
    /// Its signing key (multikey).
    pub sign: String,
    /// The X25519 key the holder seals the master key and wraps the record key to (multikey).
    pub enc: String,
    /// Made the identity, or joined with a claim that said `canKeepMaster`.
    pub may_keep_master: bool,
}

/// Device `key_id` in `events`, the identity's log from #0.
pub fn device(events: &[Event], key_id: &str) -> Option<LoggedDevice> {
    events.iter().find_map(|event| match &event.op {
        Op::Incept { add, .. } => {
            add.iter()
                .find(|k| k.id.as_str() == key_id)
                .map(|k| LoggedDevice {
                    sign: k.sign.as_str().to_string(),
                    enc: k.enc.as_str().to_string(),
                    may_keep_master: matches!(k.life, KeyLife::Standing),
                })
        }
        Op::Add { add, offer, co_sig } => {
            add.iter()
                .find(|k| k.id.as_str() == key_id)
                .map(|k| LoggedDevice {
                    sign: k.sign.as_str().to_string(),
                    enc: k.enc.as_str().to_string(),
                    may_keep_master: matches!(k.life, KeyLife::Standing)
                        && claimed_can_keep_master(
                            &event.scid,
                            offer,
                            k.sign.as_str(),
                            k.enc.as_str(),
                            co_sig,
                        ),
                })
        }
        _ => None,
    })
}

/// The revoked or unlinked keys that may still hold a valid master key: the log let them keep it
/// (see [`device`]), and no rotation since replaced the master key. Neither a revoke nor an unlink
/// changes the master key, so a copy such a device took stays valid until the master key is
/// replaced. The private record cannot say this: its write drops the entries of ended keys.
pub fn ended_holders(events: &[Event]) -> Vec<String> {
    let mut ended: Vec<String> = Vec::new();
    for event in events {
        match &event.op {
            Op::Revoke { revoke, .. } => {
                ended.extend(revoke.iter().map(|k| k.as_str().to_string()))
            }
            Op::Unlink { unlink } => ended.push(unlink.as_str().to_string()),
            // A new master key: no copy of the old one acts any more.
            Op::Rotate { .. } => ended.clear(),
            _ => {}
        }
    }
    ended.retain(|id| device(events, id).is_some_and(|d| d.may_keep_master));
    ended.sort();
    ended.dedup();
    ended
}

/// Whether the log lists device `key_id` as one that may keep the master key, not revoked, with an
/// enc key other than `custody_enc`: the holder seals the master key and wraps the record key to the
/// log's, which this computer then cannot open. A device that may not keep the master key is
/// listed with its executor's own enc key, which opens its record key there, so it is not one.
pub fn enc_mismatch(events: &[Event], key_id: Option<&str>, custody_enc: &str) -> bool {
    let Some(key_id) = key_id else {
        return false;
    };
    let revoked = events.iter().any(|event| match &event.op {
        Op::Revoke { revoke, .. } => revoke.iter().any(|k| k.as_str() == key_id),
        _ => false,
    });
    !revoked && device(events, key_id).is_some_and(|d| d.may_keep_master && d.enc != custody_enc)
}

/// Whether `co_sig` is the device's signature over a claim on `offer_id` that said
/// `canKeepMaster: true`.
fn claimed_can_keep_master(
    scid: &str,
    offer_id: &str,
    sign: &str,
    enc: &str,
    co_sig: &str,
) -> bool {
    let Some(signature) = decode_proof_value(co_sig) else {
        return false;
    };
    let body = ClaimBody {
        scid,
        offer_id,
        device_key: sign,
        enc_key: enc,
        can_keep_master: true,
    };
    verify_signed(CLAIM_DOMAIN, &body, sign, &signature)
}

/// A proof value: `z` + base58btc(64-byte Ed25519 signature).
fn decode_proof_value(value: &str) -> Option<[u8; 64]> {
    let bytes = bs58::decode(value.strip_prefix('z')?).into_vec().ok()?;
    bytes.try_into().ok()
}

/// A device's signing key as people compare it: its last eight characters, in two groups. Both
/// devices show it from the same log entry (the requester from its own key), so it is stable.
pub fn fingerprint(sign: &str) -> String {
    let chars: Vec<char> = sign.chars().collect();
    let tail: String = chars[chars.len().saturating_sub(8)..].iter().collect();
    let (a, b) = tail.split_at(tail.len().min(4));
    format!("{a} {b}").trim().to_string()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use ad4m_identity_client::vault::KeySigner;
    use ad4m_identity_core::build::{add_unsigned, cosign, incept_human, Signer};
    use ad4m_identity_core::link::make_claim;
    use ad4m_identity_core::{
        encode_x25519_multikey, fold, x25519_multikey_of, DeviceKey, X25519Secret,
    };

    /// `d1`'s X25519 secret in [`log_with_d2`]: a test's executor opens the record keys sealed
    /// to `d1` with it, as the real executor's wallet does.
    pub(crate) const D1_ENC_SECRET: [u8; 32] = [3u8; 32];

    /// A log made by device `d1`, which adds `d2` from a claim that said `can_keep_master`.
    pub(crate) fn log_with_d2(can_keep_master: bool) -> (Vec<Event>, KeySigner) {
        log_with_d2_enc(can_keep_master, encode_x25519_multikey(&[5u8; 32]))
    }

    /// [`log_with_d2`], with `d2` listed with enc key `enc`.
    pub(crate) fn log_with_d2_enc(can_keep_master: bool, enc: String) -> (Vec<Event>, KeySigner) {
        use ad4m_identity_core::words;
        let seed = words::seed(&words::from_entropy(&[41u8; 16]));
        let master = words::master_key(&seed, 0).unwrap();
        let (next, _) = words::next_commitment(&seed, 1).unwrap();
        let d1_signer = KeySigner::new(&[2u8; 32], 0);
        let d1 = DeviceKey {
            id: "d1".into(),
            sign: Signer::key(&d1_signer),
            enc: x25519_multikey_of(&X25519Secret::from(D1_ENC_SECRET)),
            life: KeyLife::Standing,
        };
        let mut incept = incept_human(&master, next, vec![d1]).unwrap();
        cosign(&mut incept, "d1", &d1_signer).unwrap();
        let chain = fold(std::slice::from_ref(&incept)).unwrap();
        let d2_signer = KeySigner::new(&[4u8; 32], 0);
        let claim = make_claim(
            &incept.scid,
            "offer-1",
            [9u8; 32],
            &d2_signer,
            enc.clone(),
            can_keep_master,
            None,
        )
        .unwrap();
        let d2 = DeviceKey {
            id: "d2".into(),
            sign: Signer::key(&d2_signer),
            enc,
            life: KeyLife::Standing,
        };
        let mut add = add_unsigned(&chain, d2, "offer-1", &claim.co_sig).unwrap();
        cosign(&mut add, "m0", &master).unwrap();
        (vec![incept, add], d2_signer)
    }

    /// `events` (from [`log_with_d2`]) with device `d3` added from a claim that said
    /// `can_keep_master`; answers `d3`'s signer.
    pub(crate) fn add_d3(events: &mut Vec<Event>, can_keep_master: bool) -> KeySigner {
        use ad4m_identity_core::words;
        let master = words::master_key(&words::seed(&words::from_entropy(&[41u8; 16])), 0).unwrap();
        let chain = fold(events).unwrap();
        let signer = KeySigner::new(&[7u8; 32], 0);
        let enc = encode_x25519_multikey(&[8u8; 32]);
        let claim = make_claim(
            &events[0].scid,
            "offer-3",
            [10u8; 32],
            &signer,
            enc.clone(),
            can_keep_master,
            None,
        )
        .unwrap();
        let d3 = DeviceKey {
            id: "d3".into(),
            sign: Signer::key(&signer),
            enc,
            life: KeyLife::Standing,
        };
        let mut add = add_unsigned(&chain, d3, "offer-3", &claim.co_sig).unwrap();
        cosign(&mut add, "m0", &master).unwrap();
        events.push(add);
        fold(events).unwrap();
        signer
    }

    #[test]
    fn the_log_says_which_device_may_keep_the_master_key() {
        let (events, d2) = log_with_d2(true);
        let logged = device(&events, "d2").unwrap();
        assert_eq!(logged.sign, Signer::key(&d2).as_str());
        assert!(logged.may_keep_master);
        // The device that made the identity may.
        assert!(device(&events, "d1").unwrap().may_keep_master);
        assert_eq!(device(&events, "d9"), None);

        // A claim that said no: the same key, and no record entry can change it.
        let (events, _) = log_with_d2(false);
        assert!(!device(&events, "d2").unwrap().may_keep_master);
    }

    #[test]
    fn an_enc_key_this_computer_does_not_keep_is_a_mismatch_only_where_it_may_keep_the_master_key()
    {
        use ad4m_identity_core::build::revoke;
        use ad4m_identity_core::{words, KeyId};
        let kept = encode_x25519_multikey(&[6u8; 32]);
        let lost = encode_x25519_multikey(&[5u8; 32]);
        let (events, _) = log_with_d2(true);
        assert_eq!(device(&events, "d2").unwrap().enc, lost);
        // The log lists another key than the one kept here.
        assert!(enc_mismatch(&events, Some("d2"), &kept));
        // It lists the one kept here.
        assert!(!enc_mismatch(&events, Some("d2"), &lost));
        // A device that may not keep the master key is listed with its executor's own enc key.
        let (events_no_master, _) = log_with_d2(false);
        assert!(!enc_mismatch(&events_no_master, Some("d2"), &kept));
        // No key id, or one the log does not list: nothing is known to be wrong.
        assert!(!enc_mismatch(&events, None, &kept));
        assert!(!enc_mismatch(&events, Some("d9"), &kept));
        // Revoked: linking again is under way or done, and this key is past.
        let master = words::master_key(&words::seed(&words::from_entropy(&[41u8; 16])), 0).unwrap();
        let mut revoked = events.clone();
        revoked.push(revoke(&fold(&events).unwrap(), &master, &[KeyId::from("d2")], None).unwrap());
        assert!(!enc_mismatch(&revoked, Some("d2"), &kept));
    }

    #[test]
    fn a_fingerprint_is_the_keys_last_eight_characters() {
        assert_eq!(fingerprint("z6MkabcdEFGH1234"), "EFGH 1234");
        assert_eq!(fingerprint("abc"), "abc");
    }

    #[test]
    fn a_revoked_or_unlinked_device_that_may_keep_the_master_key_still_may_hold_it() {
        use ad4m_identity_core::build::{revoke, unlink};
        use ad4m_identity_core::{words, KeyId};
        let master = words::master_key(&words::seed(&words::from_entropy(&[41u8; 16])), 0).unwrap();
        for (can_keep_master, expected) in [(true, vec!["d2".to_string()]), (false, vec![])] {
            let (events, _) = log_with_d2(can_keep_master);
            assert!(ended_holders(&events).is_empty(), "nothing ended yet");
            let chain = fold(&events).unwrap();
            let mut revoked = events.clone();
            revoked.push(revoke(&chain, &master, &[KeyId::from("d2")], None).unwrap());
            fold(&revoked).unwrap();
            assert_eq!(ended_holders(&revoked), expected);
            let mut unlinked = events.clone();
            unlinked.push(unlink(&chain, &master, &KeyId::from("d2")).unwrap());
            fold(&unlinked).unwrap();
            assert_eq!(ended_holders(&unlinked), expected);
            // A revoke after the unlink names the key once.
            let chain = fold(&unlinked).unwrap();
            unlinked.push(revoke(&chain, &master, &[KeyId::from("d2")], None).unwrap());
            assert_eq!(ended_holders(&unlinked), expected);
        }
    }
}
