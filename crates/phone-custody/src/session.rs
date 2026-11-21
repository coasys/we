//! Key statements: what a device key signs to log in to an executor, or to renew the session it
//! got there (`user.loginWithKey`, `user.renewSession`). The shape is ad4m's `KeyStatement`
//! (`rust-executor/src/identity/types.rs` at the pinned commit), signed as
//! `signing_bytes("coasys:session", statement)`.

use std::time::{SystemTime, UNIX_EPOCH};

use ad4m_identity_core::{signing_bytes, SESSION_DOMAIN};
use ed25519_dalek::SigningKey;
use serde::Serialize;

use crate::{invalid, PhoneKeyError};

/// What a statement asks for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, uniffi::Enum)]
#[serde(rename_all = "lowercase")]
pub enum SessionPurpose {
    /// A new session.
    Login,
    /// One more hour for the session `grant` names.
    Renew,
}

/// What the caller supplies of a statement. The identity, the key and the time are the phone's.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct SessionRequest {
    pub purpose: SessionPurpose,
    /// The executor's DID, from `user.sessionChallenge`.
    pub executor: String,
    /// The URL the phone dialed (`https://host[:port][/path]`, or `ws(s)://`). The statement
    /// names its origin; the executor accepts only an origin it answers at, so a server that
    /// relays the statement elsewhere is refused there.
    pub url: String,
    /// The challenge from `user.sessionChallenge`: 32 bytes, base64url without padding.
    pub challenge: String,
    /// The grant id a renewal renews: `grantId` of the login's answer. None for a login.
    pub grant: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum SessionClient {
    Native,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatement {
    v: u8,
    purpose: SessionPurpose,
    scid: String,
    key: String,
    executor: String,
    audience: String,
    challenge: String,
    client: SessionClient,
    #[serde(skip_serializing_if = "Option::is_none")]
    grant: Option<String>,
    issued_at: u64,
}

#[derive(Serialize)]
struct SignedKeyStatement<'a> {
    statement: &'a KeyStatement,
    sig: String,
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The statement for `request`, by the device key `key` of the identity `did`, at `now`.
pub fn statement(
    request: &SessionRequest,
    did: &str,
    key: &str,
    now: u64,
) -> Result<KeyStatement, PhoneKeyError> {
    match (request.purpose, &request.grant) {
        (SessionPurpose::Login, Some(_)) => return Err(invalid("a login names no grant")),
        (SessionPurpose::Renew, None) => return Err(invalid("a renewal names its grant")),
        (SessionPurpose::Renew, Some(g)) if g.is_empty() => {
            return Err(invalid("a renewal names its grant"))
        }
        _ => {}
    }
    if !request.executor.starts_with("did:") {
        return Err(invalid("the executor is the DID sessionChallenge answered"));
    }
    if !is_challenge(&request.challenge) {
        return Err(invalid(
            "the challenge is 32 bytes of base64url, as sessionChallenge answers it",
        ));
    }
    Ok(KeyStatement {
        v: 1,
        purpose: request.purpose,
        scid: did.to_string(),
        key: key.to_string(),
        executor: request.executor.clone(),
        audience: origin_of(&request.url)?,
        challenge: request.challenge.clone(),
        client: SessionClient::Native,
        grant: request.grant.clone(),
        issued_at: now,
    })
}

/// `{statement, sig}`, the signature a proof value (`z` + base58btc).
pub fn sign(statement: &KeyStatement, key: &SigningKey) -> Result<String, PhoneKeyError> {
    let bytes = signing_bytes(SESSION_DOMAIN, statement).map_err(|e| invalid(e.to_string()))?;
    let sig = ed25519_dalek::Signer::sign(key, &bytes).to_bytes();
    let signed = SignedKeyStatement {
        statement,
        sig: ad4m_hash_chain::encode_proof_value(&sig),
    };
    Ok(serde_json::to_string(&signed).expect("a statement serialises"))
}

fn is_challenge(text: &str) -> bool {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    text.len() == 43 && URL_SAFE_NO_PAD.decode(text).is_ok_and(|b| b.len() == 32)
}

/// `scheme://host[:port]` of `url`: `ws`/`wss` as `http`/`https`, the host lowercase, a default
/// port left out. The executor normalises the same way (`key_login::normalise_origin`).
pub fn origin_of(url: &str) -> Result<String, PhoneKeyError> {
    let not = |why: &str| invalid(format!("{url} is not an http(s) or ws(s) URL: {why}"));
    let (scheme, rest) = url
        .trim()
        .split_once("://")
        .ok_or_else(|| not("no scheme"))?;
    let (scheme, default_port) = match scheme.to_ascii_lowercase().as_str() {
        "http" | "ws" => ("http", "80"),
        "https" | "wss" => ("https", "443"),
        _ => return Err(not("the scheme is not http, https, ws or wss")),
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.is_empty() {
        return Err(not("no host"));
    }
    if authority.contains('@') {
        return Err(not("credentials in the URL"));
    }
    let authority = authority.to_ascii_lowercase();
    // An IPv6 host is bracketed, so the port is what follows `]:`.
    let (host, port) = match authority.rfind(':') {
        Some(i) if !authority[i..].contains(']') => (&authority[..i], Some(&authority[i + 1..])),
        _ => (authority.as_str(), None),
    };
    if host.is_empty() {
        return Err(not("no host"));
    }
    match port {
        Some(p) if p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()) => {
            Err(not("the port is not a number"))
        }
        Some(p) if p != default_port => Ok(format!("{scheme}://{host}:{p}")),
        _ => Ok(format!("{scheme}://{host}")),
    }
}
