//! Joining an identity by an offer: the holder (a computer that keeps the master key) opens an
//! offer and shows its link; the phone claims it at the identity store with its own keys; both show
//! the match code; the holder confirms, which adds the phone's device key to the log and spends the
//! offer. The phone never needs the master key for this, and talks only to the store.
//!
//! This module shapes the claim and reads the store's answers. The HTTP is the app's (on Android,
//! Kotlin's, over the platform's TLS): the routes are the store's public offer routes,
//! `POST /v1/offers/{scid}/{offerId}/claim` and `GET /v1/offers/{scid}/{offerId}/state?key=`.

use ad4m_identity_core::link::{make_claim, match_code, OfferString};
use ed25519_dalek::SigningKey;
use serde::Deserialize;
use zeroize::Zeroizing;

use crate::file::Pending;
use crate::{invalid, Membership, PhoneKeyError};

/// A claim ready to post, and where to ask how it went.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct PreparedClaim {
    /// The identity the offer is for, `did:scid:coasys:1:…`.
    pub did: String,
    /// The store the offer is at, as the link names it.
    pub store: String,
    /// POST `body` here.
    pub claim_url: String,
    /// The claim, JSON.
    pub body: String,
    /// GET here (adding `&wait=<seconds>`, at most 8) for the claim's progress.
    pub state_url: String,
    /// The code the holder shows: the person checks the two are the same before confirming.
    pub match_code: String,
}

/// How a claim stands after an answer from the store.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Enum)]
pub enum ClaimProgress {
    /// Claimed, the holder has not confirmed yet.
    Waiting { state: String },
    /// The holder confirmed: the log lists this phone's device key.
    Joined { member: Membership },
    /// The claim was refused, or the offer ended without this phone (`reason` is the store's
    /// error code or the offer's state: `secret`, `key-taken`, `expired`, `cancelled`, …).
    Ended { reason: String },
}

pub fn parse_offer(link: &str) -> Result<OfferString, PhoneKeyError> {
    let offer = OfferString::parse_link(link).map_err(|e| invalid(e.to_string()))?;
    let store = offer.store.trim_end_matches('/');
    if !(store.starts_with("https://") || store.starts_with("http://")) {
        return Err(invalid("the offer's store is not an http(s) URL"));
    }
    Ok(offer)
}

fn offer_url(store: &str, scid: &str, offer_id: &str) -> String {
    format!("{store}/v1/offers/{scid}/{offer_id}")
}

/// Where the claiming key `key` asks how its claim on an offer stands.
pub fn state_url(store: &str, scid: &str, offer_id: &str, key: &str) -> String {
    // A multikey is base58: nothing in it needs escaping in a query.
    format!("{}/state?key={key}", offer_url(store, scid, offer_id))
}

/// The claim on `offer` by `sign`, with the enc key `enc`. The claim says `canKeepMaster`: the
/// phone keeps a master key behind its own biometric-gated Keystore key ([`crate::vault`]), so
/// the holder's confirm card offers "Keep my master key on this device too".
pub fn prepare(
    offer: &OfferString,
    sign: &SigningKey,
    enc: &str,
    hint: Option<String>,
) -> Result<(PreparedClaim, Pending), PhoneKeyError> {
    let s = decode_secret(&offer.s)?;
    let hint = hint.map(|h| h.trim().to_string()).filter(|h| !h.is_empty());
    let claim = make_claim(
        &offer.scid,
        &offer.offer_id,
        *s,
        sign,
        enc.to_string(),
        true,
        hint,
    )
    .map_err(|e| invalid(e.to_string()))?;
    let key = claim.device_key.clone();
    let store = offer.store.trim_end_matches('/').to_string();
    let base = offer_url(&store, &offer.scid, &offer.offer_id);
    let code = match_code(&offer.scid, &offer.offer_id, &key);
    let prepared = PreparedClaim {
        did: ad4m_identity_core::did_of(&offer.scid),
        store: store.clone(),
        claim_url: format!("{base}/claim"),
        body: serde_json::to_string(&claim).expect("a claim serialises"),
        state_url: state_url(&store, &offer.scid, &offer.offer_id, &key),
        match_code: code.clone(),
    };
    let pending = Pending {
        scid: offer.scid.clone(),
        offer_id: offer.offer_id.clone(),
        store,
        match_code: code,
    };
    Ok((prepared, pending))
}

fn decode_secret(s: &str) -> Result<Zeroizing<[u8; 32]>, PhoneKeyError> {
    let bytes = Zeroizing::new(
        bs58::decode(s)
            .into_vec()
            .map_err(|_| invalid("the offer's secret is not base58btc"))?,
    );
    let secret: [u8; 32] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| invalid("the offer's secret is not 32 bytes"))?;
    Ok(Zeroizing::new(secret))
}

#[derive(Deserialize)]
struct Answer {
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    seq: Option<u64>,
    #[serde(default)]
    error: Option<String>,
}

/// What `status` and `body` (of the claim's POST or its state GET) say about the claim on an
/// offer of `scid`.
pub fn read_answer(scid: &str, status: u16, body: &str) -> ClaimProgress {
    let answer: Option<Answer> = serde_json::from_str(body).ok();
    if !(200..300).contains(&status) {
        // `410 {state}`: the offer ended; `404`: no such offer, or a claim by another key;
        // `403 {error}`/`409 {error}`: refused. A 5xx or an unreadable answer is worth asking again.
        if status >= 500 || answer.is_none() && status != 404 {
            return ClaimProgress::Waiting {
                state: format!("http {status}"),
            };
        }
        let reason = answer
            .and_then(|a| a.error.or(a.state))
            .unwrap_or_else(|| "not-found".into());
        return ClaimProgress::Ended { reason };
    }
    let Some(Answer {
        state: Some(state),
        seq,
        ..
    }) = answer
    else {
        return ClaimProgress::Waiting {
            state: "unreadable".into(),
        };
    };
    match state.as_str() {
        "open" | "claimed" => ClaimProgress::Waiting { state },
        "spent" => ClaimProgress::Joined {
            member: Membership {
                scid: scid.to_string(),
                did: ad4m_identity_core::did_of(scid),
                seq,
            },
        },
        _ => ClaimProgress::Ended { reason: state },
    }
}
