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
                    may_keep_master: matches!(k.life, KeyLife::Standing),
                })
        }
        Op::Add { add, offer, co_sig } => {
            add.iter()
                .find(|k| k.id.as_str() == key_id)
                .map(|k| LoggedDevice {
                    sign: k.sign.as_str().to_string(),
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

/// The revoked keys that may still hold a valid master key: the log let them keep it (see
/// [`device`]), and no rotation since their revocation replaced the master key. A revoke does not
/// change the master key, so a copy such a device took stays valid until the master key is
/// replaced. The private record cannot say this: its write drops the entries of revoked keys.
pub fn revoked_holders(events: &[Event]) -> Vec<String> {
    let mut revoked: Vec<String> = Vec::new();
    for event in events {
        match &event.op {
            Op::Revoke { revoke } => revoked.extend(revoke.iter().map(|k| k.as_str().to_string())),
            // A new master key: no copy of the old one acts any more.
            Op::Rotate { .. } => revoked.clear(),
            _ => {}
        }
    }
    revoked.retain(|id| device(events, id).is_some_and(|d| d.may_keep_master));
    revoked.dedup();
    revoked
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
    use ad4m_identity_core::{encode_x25519_multikey, fold, DeviceKey};

    /// A log made by device `d1`, which adds `d2` from a claim that said `can_keep_master`.
    pub(crate) fn log_with_d2(can_keep_master: bool) -> (Vec<Event>, KeySigner) {
        use ad4m_identity_core::words;
        let seed = words::seed(&words::from_entropy(&[41u8; 16]));
        let master = words::master_key(&seed, 0).unwrap();
        let (next, _) = words::next_commitment(&seed, 1).unwrap();
        let d1_signer = KeySigner::new(&[2u8; 32], 0);
        let d1 = DeviceKey {
            id: "d1".into(),
            sign: Signer::key(&d1_signer),
            enc: encode_x25519_multikey(&[3u8; 32]),
            life: KeyLife::Standing,
        };
        let mut incept = incept_human(&master, next, vec![d1]).unwrap();
        cosign(&mut incept, "d1", &d1_signer).unwrap();
        let chain = fold(std::slice::from_ref(&incept)).unwrap();
        let d2_signer = KeySigner::new(&[4u8; 32], 0);
        let enc = encode_x25519_multikey(&[5u8; 32]);
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
    fn a_fingerprint_is_the_keys_last_eight_characters() {
        assert_eq!(fingerprint("z6MkabcdEFGH1234"), "EFGH 1234");
        assert_eq!(fingerprint("abc"), "abc");
    }

    #[test]
    fn a_revoked_device_that_may_keep_the_master_key_still_may_hold_it() {
        use ad4m_identity_core::build::revoke;
        use ad4m_identity_core::{words, KeyId};
        let master = words::master_key(&words::seed(&words::from_entropy(&[41u8; 16])), 0).unwrap();
        for (can_keep_master, expected) in [(true, vec!["d2".to_string()]), (false, vec![])] {
            let (mut events, _) = log_with_d2(can_keep_master);
            assert!(revoked_holders(&events).is_empty(), "nothing revoked yet");
            let chain = fold(&events).unwrap();
            events.push(revoke(&chain, &master, &[KeyId::from("d2")]).unwrap());
            fold(&events).unwrap();
            assert_eq!(revoked_holders(&events), expected);
        }
    }
}
