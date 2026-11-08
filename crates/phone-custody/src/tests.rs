use std::sync::{Arc, Mutex};

use ad4m_identity_core::link::{verify_claim, Claim, OfferString};
use ad4m_identity_core::{verify_signed, SESSION_DOMAIN};
use serde_json::Value;

use super::*;

/// A sealer for the tests: XOR with a fixed pad, the label in front so a seed sealed under one
/// label does not open under the other, and every plaintext it hands out kept so the test can see
/// `wipe` zero it.
#[derive(Default)]
struct TestSealer {
    pad: u8,
    sealed: Mutex<Vec<Vec<u8>>>,
    handed_out: Mutex<Vec<Arc<Mutex<Vec<u8>>>>>,
    wipes: Mutex<usize>,
    refuse: Mutex<bool>,
}

impl TestSealer {
    fn new() -> Arc<Self> {
        Arc::new(TestSealer {
            pad: 0x5a,
            ..Default::default()
        })
    }
    fn wipes(&self) -> usize {
        *self.wipes.lock().unwrap()
    }
}

impl Sealer for TestSealer {
    fn seal(&self, label: String, plaintext: Vec<u8>) -> Result<Vec<u8>, SealError> {
        self.sealed.lock().unwrap().push(plaintext.clone());
        let mut out = label.into_bytes();
        out.push(0);
        out.extend(plaintext.iter().map(|b| b ^ self.pad));
        Ok(out)
    }

    fn open(&self, label: String, sealed: Vec<u8>) -> Result<Vec<u8>, SealError> {
        if *self.refuse.lock().unwrap() {
            return Err(SealError::Failed {
                reason: "the key needs the screen unlocked".into(),
            });
        }
        let mut prefix = label.into_bytes();
        prefix.push(0);
        let body = sealed
            .strip_prefix(prefix.as_slice())
            .ok_or_else(|| SealError::Failed {
                reason: "sealed under another label".into(),
            })?;
        let plain: Vec<u8> = body.iter().map(|b| b ^ self.pad).collect();
        self.handed_out
            .lock()
            .unwrap()
            .push(Arc::new(Mutex::new(plain.clone())));
        Ok(plain)
    }

    fn wipe(&self) {
        *self.wipes.lock().unwrap() += 1;
        for kept in self.handed_out.lock().unwrap().iter() {
            kept.lock().unwrap().iter_mut().for_each(|b| *b = 0);
        }
    }
}

fn keys(dir: &tempfile::TempDir, sealer: &Arc<TestSealer>) -> Arc<DeviceKeys> {
    DeviceKeys::open(dir.path().to_string_lossy().into_owned(), sealer.clone()).unwrap()
}

fn b58(bytes: &[u8]) -> String {
    bs58::encode(bytes).into_string()
}

/// An offer of a made-up identity at a made-up store.
fn offer() -> OfferString {
    let mut multihash = vec![0x12, 0x20];
    multihash.extend_from_slice(&[7u8; 32]);
    OfferString {
        store: "http://127.0.0.1:4100".into(),
        scid: b58(&multihash),
        offer_id: b58(&[3u8; 16]),
        s: b58(&[9u8; 32]),
    }
}

/// Keys that are in the made-up identity, as after a confirmed claim.
fn joined(dir: &tempfile::TempDir, sealer: &Arc<TestSealer>) -> (Arc<DeviceKeys>, String) {
    let keys = keys(dir, sealer);
    keys.create().unwrap();
    let offer = offer();
    keys.prepare_claim(offer.link(), None).unwrap();
    let progress = keys
        .claim_answer(200, r#"{"state":"spent","seq":3}"#.into())
        .unwrap();
    assert!(matches!(progress, ClaimProgress::Joined { .. }));
    (keys, ad4m_identity_core::did_of(&offer.scid))
}

fn login(challenge: &str) -> SessionRequest {
    SessionRequest {
        purpose: SessionPurpose::Login,
        executor: "did:key:z6MkExecutor".into(),
        url: "ws://127.0.0.1:12600/graphql".into(),
        challenge: challenge.into(),
        grant: None,
    }
}

fn challenge() -> String {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    URL_SAFE_NO_PAD.encode([4u8; 32])
}

#[test]
fn create_makes_two_keys_and_keeps_only_their_sealed_seeds() {
    let dir = tempfile::tempdir().unwrap();
    let sealer = TestSealer::new();
    let keys = keys(&dir, &sealer);
    assert_eq!(keys.status().keys, None);

    let public = keys.create().unwrap();
    assert!(public.sign.starts_with("z6Mk"));
    assert!(public.enc.starts_with("z6LS"));
    assert_eq!(public.did_key, format!("did:key:{}", public.sign));
    assert_eq!(keys.status().keys, Some(public.clone()));

    // The file holds the sealer's output and the public keys; no seed in any form.
    let written = std::fs::read(dir.path().join(file::FILE_NAME)).unwrap();
    let text = String::from_utf8(written.clone()).unwrap();
    let seeds = sealer.sealed.lock().unwrap().clone();
    assert_eq!(seeds.len(), 2);
    assert_ne!(seeds[0], seeds[1]);
    for seed in &seeds {
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine;
        assert!(!written.windows(32).any(|w| w == seed.as_slice()));
        assert!(!text.contains(&STANDARD.encode(seed)));
        assert!(!text.contains(&b58(seed)));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(dir.path().join(file::FILE_NAME))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    // The keys read back from the file, and a second create is refused.
    let again =
        DeviceKeys::open(dir.path().to_string_lossy().into_owned(), sealer.clone()).unwrap();
    assert_eq!(again.status().keys, Some(public));
    assert!(matches!(again.create(), Err(PhoneKeyError::KeysExist)));
}

#[test]
fn sealed_seeds_open_to_the_keys_on_record_and_are_wiped_after_use() {
    let dir = tempfile::tempdir().unwrap();
    let sealer = TestSealer::new();
    let keys = keys(&dir, &sealer);
    let public = keys.create().unwrap();
    let file = keys.lock().clone().unwrap();

    let sign = keys.signing_key(&file).unwrap();
    assert_eq!(
        ad4m_hash_chain::encode_ed25519_multikey(sign.verifying_key().as_bytes()),
        public.sign
    );
    assert_eq!(sealer.wipes(), 1);
    let enc = keys.enc_key(&file).unwrap();
    assert_eq!(ad4m_identity_core::x25519_multikey_of(&enc), public.enc);
    assert_eq!(sealer.wipes(), 2);

    // Every plaintext the sealer handed back is zero now.
    let handed = sealer.handed_out.lock().unwrap();
    assert_eq!(handed.len(), 2);
    for kept in handed.iter() {
        assert!(kept.lock().unwrap().iter().all(|b| *b == 0));
    }
}

#[test]
fn a_seed_sealed_under_the_other_label_or_swapped_in_the_file_does_not_open() {
    let dir = tempfile::tempdir().unwrap();
    let sealer = TestSealer::new();
    let keys = keys(&dir, &sealer);
    keys.create().unwrap();
    let mut file = keys.lock().clone().unwrap();
    std::mem::swap(&mut file.sealed_sign, &mut file.sealed_enc);
    assert!(matches!(
        keys.signing_key(&file),
        Err(PhoneKeyError::Sealer { .. })
    ));
    // Sealed under the right label, but a key that is not the one on record.
    let other = sealer.seal(SIGN_LABEL.into(), vec![1u8; 32]).unwrap();
    let file = KeyFile::new(
        keys.status().keys.unwrap().sign,
        keys.status().keys.unwrap().enc,
        other,
        vec![],
    );
    assert!(matches!(
        keys.signing_key(&file),
        Err(PhoneKeyError::Mismatch)
    ));
    // Each failed open still wiped.
    assert_eq!(sealer.wipes(), 2);
}

#[test]
fn a_refusing_sealer_is_an_error_and_signs_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let sealer = TestSealer::new();
    let (keys, _) = joined(&dir, &sealer);
    *sealer.refuse.lock().unwrap() = true;
    let refused = keys.sign_session(login(&challenge()));
    assert!(
        matches!(refused, Err(PhoneKeyError::Sealer { reason }) if reason.contains("unlocked"))
    );
}

#[test]
fn a_login_statement_verifies_with_the_device_key_and_names_the_identity() {
    let dir = tempfile::tempdir().unwrap();
    let sealer = TestSealer::new();
    let (keys, did) = joined(&dir, &sealer);
    let public = keys.status().keys.unwrap();
    let wipes = sealer.wipes();

    let signed: Value = serde_json::from_str(
        &keys
            .sign_session_at(login(&challenge()), 1_700_000_000)
            .unwrap(),
    )
    .unwrap();
    let statement = &signed["statement"];
    assert_eq!(
        statement,
        &serde_json::json!({
            "v": 1,
            "purpose": "login",
            "scid": did,
            "key": public.sign,
            "executor": "did:key:z6MkExecutor",
            "audience": "http://127.0.0.1:12600",
            "challenge": challenge(),
            "client": { "kind": "native" },
            "issuedAt": 1_700_000_000u64,
        })
    );
    let sig = ad4m_hash_chain::decode_proof_value(signed["sig"].as_str().unwrap()).unwrap();
    assert!(verify_signed(SESSION_DOMAIN, statement, &public.sign, &sig));
    // The signature is under coasys:session only, and over exactly this statement.
    assert!(!verify_signed(
        "coasys:claim",
        statement,
        &public.sign,
        &sig
    ));
    let mut changed = statement.clone();
    changed["audience"] = "https://elsewhere.example".into();
    assert!(!verify_signed(SESSION_DOMAIN, &changed, &public.sign, &sig));
    assert_eq!(sealer.wipes(), wipes + 1);
}

#[test]
fn a_renewal_names_its_grant_and_a_login_names_none() {
    let dir = tempfile::tempdir().unwrap();
    let sealer = TestSealer::new();
    let (keys, _) = joined(&dir, &sealer);

    let renew = SessionRequest {
        purpose: SessionPurpose::Renew,
        grant: Some("grant-1".into()),
        ..login(&challenge())
    };
    let signed: Value = serde_json::from_str(&keys.sign_session(renew.clone()).unwrap()).unwrap();
    assert_eq!(signed["statement"]["purpose"], "renew");
    assert_eq!(signed["statement"]["grant"], "grant-1");

    let no_grant = SessionRequest {
        grant: None,
        ..renew.clone()
    };
    assert!(matches!(
        keys.sign_session(no_grant),
        Err(PhoneKeyError::Invalid { .. })
    ));
    let login_with_grant = SessionRequest {
        purpose: SessionPurpose::Login,
        ..renew
    };
    assert!(matches!(
        keys.sign_session(login_with_grant),
        Err(PhoneKeyError::Invalid { .. })
    ));
}

#[test]
fn a_statement_needs_a_challenge_an_executor_and_an_identity() {
    let dir = tempfile::tempdir().unwrap();
    let sealer = TestSealer::new();
    let keys = keys(&dir, &sealer);
    assert!(matches!(
        keys.sign_session(login(&challenge())),
        Err(PhoneKeyError::NoKeys)
    ));
    keys.create().unwrap();
    assert!(matches!(
        keys.sign_session(login(&challenge())),
        Err(PhoneKeyError::NoIdentity)
    ));

    let dir = tempfile::tempdir().unwrap();
    let (keys, _) = joined(&dir, &sealer);
    assert!(matches!(
        keys.sign_session(login("short")),
        Err(PhoneKeyError::Invalid { .. })
    ));
    let not_a_did = SessionRequest {
        executor: "127.0.0.1".into(),
        ..login(&challenge())
    };
    assert!(matches!(
        keys.sign_session(not_a_did),
        Err(PhoneKeyError::Invalid { .. })
    ));
    let ftp = SessionRequest {
        url: "ftp://127.0.0.1".into(),
        ..login(&challenge())
    };
    assert!(matches!(
        keys.sign_session(ftp),
        Err(PhoneKeyError::Invalid { .. })
    ));
}

#[test]
fn the_audience_is_the_dialed_origin_normalised_as_the_executor_does() {
    let cases = [
        ("ws://127.0.0.1:12600/graphql", "http://127.0.0.1:12600"),
        ("http://localhost:12000", "http://localhost:12000"),
        ("wss://Host.Example.org/api?x=1", "https://host.example.org"),
        ("https://host.example.org:443/", "https://host.example.org"),
        ("http://host.example.org:80", "http://host.example.org"),
        ("http://[::1]:12600/x", "http://[::1]:12600"),
        ("https://[::1]", "https://[::1]"),
    ];
    for (url, origin) in cases {
        assert_eq!(session::origin_of(url).unwrap(), origin, "{url}");
    }
    for bad in [
        "127.0.0.1:12600",
        "http://",
        "http://u:p@host",
        "http://host:x",
        "file:///x",
    ] {
        assert!(session::origin_of(bad).is_err(), "{bad}");
    }
}

#[test]
fn a_claim_carries_both_keys_and_a_co_signature_the_store_accepts() {
    let dir = tempfile::tempdir().unwrap();
    let sealer = TestSealer::new();
    let keys = keys(&dir, &sealer);
    assert!(matches!(
        keys.prepare_claim(offer().link(), None),
        Err(PhoneKeyError::NoKeys)
    ));
    let public = keys.create().unwrap();
    let offer = offer();

    let prepared = keys
        .prepare_claim(offer.link(), Some("  Pixel 8 ".into()))
        .unwrap();
    let claim: Claim = serde_json::from_str(&prepared.body).unwrap();
    verify_claim(&offer.scid, &claim).unwrap();
    assert_eq!(claim.device_key, public.sign);
    assert_eq!(claim.enc_key, public.enc);
    assert_eq!(claim.s, offer.s);
    assert_eq!(claim.hint.as_deref(), Some("Pixel 8"));
    assert!(claim.can_keep_master);
    assert_eq!(
        prepared.claim_url,
        format!(
            "http://127.0.0.1:4100/v1/offers/{}/{}/claim",
            offer.scid, offer.offer_id
        )
    );
    assert_eq!(
        prepared.state_url,
        format!(
            "http://127.0.0.1:4100/v1/offers/{}/{}/state?key={}",
            offer.scid, offer.offer_id, public.sign
        )
    );
    assert_eq!(
        prepared.match_code,
        ad4m_identity_core::link::match_code(&offer.scid, &offer.offer_id, &public.sign)
    );
    assert_eq!(prepared.did, ad4m_identity_core::did_of(&offer.scid));
    // The bare offer string works as well as the link.
    keys.prepare_claim(offer.encode(), None).unwrap();

    let pending = keys.status().pending.unwrap();
    assert_eq!(pending.match_code, prepared.match_code);
    assert_eq!(pending.offer_id, offer.offer_id);
    // A claim the app reopens to finds where to ask from the key file alone.
    assert_eq!(pending.state_url, prepared.state_url);
}

#[test]
fn the_stores_answers_move_the_claim_on() {
    let dir = tempfile::tempdir().unwrap();
    let sealer = TestSealer::new();
    let keys = keys(&dir, &sealer);
    keys.create().unwrap();
    assert!(matches!(
        keys.claim_answer(200, "{}".into()),
        Err(PhoneKeyError::NoClaim)
    ));
    let offer = offer();
    keys.prepare_claim(offer.link(), None).unwrap();

    let posted = keys
        .claim_answer(
            201,
            r#"{"state":"claimed","kind":"node","expires":1}"#.into(),
        )
        .unwrap();
    assert_eq!(
        posted,
        ClaimProgress::Waiting {
            state: "claimed".into()
        }
    );
    // A store that is down is asked again; the claim stays.
    let down = keys.claim_answer(503, "".into()).unwrap();
    assert!(matches!(down, ClaimProgress::Waiting { .. }));
    assert!(keys.status().pending.is_some());

    let spent = keys
        .claim_answer(200, r#"{"state":"spent","seq":4}"#.into())
        .unwrap();
    let member = Membership {
        scid: offer.scid.clone(),
        did: ad4m_identity_core::did_of(&offer.scid),
        seq: Some(4),
    };
    assert_eq!(
        spent,
        ClaimProgress::Joined {
            member: member.clone()
        }
    );
    let status = keys.status();
    assert_eq!(status.identity, Some(member.clone()));
    assert_eq!(status.pending, None);
    // Kept on disk, and a phone in an identity claims no other offer.
    let again =
        DeviceKeys::open(dir.path().to_string_lossy().into_owned(), sealer.clone()).unwrap();
    assert_eq!(again.status().identity, Some(member));
    assert!(matches!(
        again.prepare_claim(offer.link(), None),
        Err(PhoneKeyError::AlreadyJoined { .. })
    ));
}

#[test]
fn a_refused_claim_or_an_offer_that_ended_drops_the_claim() {
    let dir = tempfile::tempdir().unwrap();
    let sealer = TestSealer::new();
    let keys = keys(&dir, &sealer);
    keys.create().unwrap();
    let cases = [
        (403, r#"{"error":"secret","detail":"x"}"#, "secret"),
        (409, r#"{"error":"key-taken","key":"z6Mk"}"#, "key-taken"),
        (410, r#"{"state":"expired"}"#, "expired"),
        (404, "", "not-found"),
        (200, r#"{"state":"cancelled"}"#, "cancelled"),
    ];
    for (status, body, reason) in cases {
        keys.prepare_claim(offer().link(), None).unwrap();
        assert_eq!(
            keys.claim_answer(status, body.into()).unwrap(),
            ClaimProgress::Ended {
                reason: reason.into()
            },
            "{status} {body}"
        );
        assert_eq!(keys.status().pending, None);
        assert_eq!(keys.status().identity, None);
    }
}

#[test]
fn a_damaged_key_file_is_refused_not_replaced() {
    let dir = tempfile::tempdir().unwrap();
    let sealer = TestSealer::new();
    std::fs::write(dir.path().join(file::FILE_NAME), b"{\"v\":1}").unwrap();
    let opened = DeviceKeys::open(dir.path().to_string_lossy().into_owned(), sealer.clone());
    assert!(matches!(opened, Err(PhoneKeyError::Damaged { .. })));
    let written = std::fs::read(dir.path().join(file::FILE_NAME)).unwrap();
    assert_eq!(written, b"{\"v\":1}");
}

#[test]
fn an_offer_link_to_a_store_that_is_not_http_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let sealer = TestSealer::new();
    let keys = keys(&dir, &sealer);
    keys.create().unwrap();
    let offer = OfferString {
        store: "file:///etc".into(),
        ..offer()
    };
    assert!(matches!(
        keys.prepare_claim(offer.link(), None),
        Err(PhoneKeyError::Invalid { .. })
    ));
    assert!(matches!(
        keys.prepare_claim("https://id.coasys.org/o#nonsense".into(), None),
        Err(PhoneKeyError::Invalid { .. })
    ));
}
