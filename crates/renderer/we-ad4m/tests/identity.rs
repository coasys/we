//! Slice 5: the identity read behind the first run. What the executor
//! answers is reduced to public facts; a malformed answer is an error, not
//! an empty identity; the base file keeps "Skip for now".

use serde_json::json;
use we_ad4m::base::BaseFile;
use we_ad4m::identity::{identity_from_answers, Identity, KeyDevice};

const DID: &str = "did:scid:coasys:1:QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const DEVICE_KEY: &str = "z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const ENC_KEY: &str = "z6LSbysY2xFMRpGMhb7tFTLMpeuPRaqaWM1yECx2AtzE3KCc";
const OTHER_KEY: &str = "z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG";
const HEAD: &str = "QmHeadHashOfTheKeyLog1111111111111111111111111";

fn status(did: serde_json::Value, store: serde_json::Value) -> serde_json::Value {
    json!({
        "did": did,
        "deviceKey": DEVICE_KEY,
        "deviceEnc": ENC_KEY,
        "keyId": "d1",
        "revoked": null,
        "head": { "seq": 2, "hash": HEAD, "time": 1, "store": "https://store.example" },
        "fork": null,
        "storeBehind": null,
        "store": store,
    })
}

fn devices() -> serde_json::Value {
    json!([
        { "keyId": "d1", "sign": DEVICE_KEY, "bot": null, "expires": null, "addedSeq": 0, "revokedSeq": null, "thisDevice": true },
        { "keyId": "d2", "sign": OTHER_KEY, "bot": null, "expires": null, "addedSeq": 1, "revokedSeq": null, "thisDevice": false },
        { "keyId": "d3", "sign": "z6MkRevoked", "bot": null, "expires": null, "addedSeq": 2, "revokedSeq": 3, "thisDevice": false },
        { "keyId": "d4", "sign": "z6MkBot", "bot": { "can": ["read"], "expires": 9 }, "expires": 9, "addedSeq": 4, "revokedSeq": null, "thisDevice": false },
    ])
}

/// The answers become the public facts: the DID, whether a change could be
/// published, and the devices in force (no revoked key, no bot). No key,
/// key id or log head is kept.
#[test]
fn the_answers_keep_public_facts_only() {
    let store = json!({ "url": "https://store.example", "trusted": true });
    let identity = identity_from_answers(&status(json!(DID), store), &devices()).unwrap();
    assert_eq!(
        identity,
        Identity {
            did: Some(DID.into()),
            store_trusted: true,
            devices: vec![
                KeyDevice { this_device: true },
                KeyDevice { this_device: false }
            ],
        }
    );
    let kept = format!("{identity:?}");
    for secret in [DEVICE_KEY, ENC_KEY, OTHER_KEY, HEAD, "d1", "d2", "z6Mk"] {
        assert!(!kept.contains(secret), "{secret} kept: {kept}");
    }
}

/// An agent with no identity yet is a known empty identity. No store, or a
/// store without a trusted key, means nothing could be published.
#[test]
fn no_identity_and_no_store_are_read_as_such() {
    let none = identity_from_answers(&status(json!(null), json!(null)), &json!([])).unwrap();
    assert_eq!(none, Identity::default());
    let untrusted = json!({ "url": "https://store.example", "trusted": false });
    let identity = identity_from_answers(&status(json!(null), untrusted), &json!([])).unwrap();
    assert!(!identity.store_trusted);
}

/// An answer of another shape is an error: never read as "no identity".
#[test]
fn a_malformed_answer_is_an_error_not_an_empty_identity() {
    let store = json!({ "url": "https://store.example", "trusted": true });
    let mut no_did = status(json!(null), store.clone());
    no_did.as_object_mut().unwrap().remove("did");
    for (status, devices) in [
        (no_did, json!([])),
        (status(json!(7), store.clone()), json!([])),
        (json!("ok"), json!([])),
        (status(json!(null), json!({ "url": "x" })), json!([])),
        (status(json!(DID), store.clone()), json!({ "devices": [] })),
        (
            status(json!(DID), store.clone()),
            json!([{ "keyId": "d1" }]),
        ),
    ] {
        assert!(
            identity_from_answers(&status, &devices).is_err(),
            "read as an identity: {status} {devices}"
        );
    }
}

/// Acceptance (skip persists): the base file keeps "Skip for now" across a
/// load, and a later choice keeps it.
#[test]
fn the_base_file_keeps_the_skip() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("we-renderer").join("base.json");
    assert!(!BaseFile::load(&path).skipped_identity);
    BaseFile::remember(&path, "this-device").unwrap();
    BaseFile::skip_identity(&path).unwrap();
    let file = BaseFile::load(&path);
    assert!(file.skipped_identity, "the skip was not kept");
    assert_eq!(file.connection.as_deref(), Some("this-device"));
    BaseFile::remember(&path, "server:lab.example:12000").unwrap();
    assert!(
        BaseFile::load(&path).skipped_identity,
        "a choice dropped the skip"
    );
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains("\"skippedIdentity\": true"), "{text}");
}
