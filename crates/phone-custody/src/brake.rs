//! The store's brake on new logs, on the phone's side: a proof of work on the publish of an
//! identity's event #0 (section 14 of ad4m's `docs-src/identity/did-scid-coasys-1.md`, host
//! admission policy).
//!
//! `ViaStore`'s `identity.publish` sends an append with no proof (`pow: None`), and the store
//! admits a new log without one today ("There is no brake yet", `identity-store`'s
//! `admit_new_log`), checking a proof only when one is sent. A phone that makes its identity
//! publishes event #0 itself, with no executor to vouch for it, so the proof is added here, on
//! the way out, and a store that turns its brake on finds every phone already paying it:
//!
//! - only a `POST …/v1/logs/{scid}/events` whose events include an incept at seq 0 of that
//!   `scid`, carrying neither a proof nor a vouching token, is touched; every other request goes
//!   out as it came;
//! - and only when the store holds no log of that scid yet (`GET /v1/heads/{scid}` answers
//!   `404`): the store refuses a proof on a log it holds (`400 malformed`), which a republish of
//!   an incept already admitted would otherwise meet;
//! - the cost is the store's (`GET /v1/pow`), refused above [`MAX_POW_BITS`] so a hostile store
//!   cannot make the phone spin forever; a store with no brake route, or one asking for 0 bits,
//!   gets no proof;
//! - the work runs in rounds of [`ROUND`] tries, the cancel flag read between them, and stops
//!   with an error after [`MAX_SOLVE`]: the bits bound the average cost, and this bounds the
//!   time of one run;
//! - the work goes on while the app is in the background, on the flow's own thread, and
//!   [`MAX_SOLVE`] bounds it there too. When the system ends the app first, the incept stays
//!   pending in the vault and is published at the next open (`finish_pending`);
//! - a `403 pow` (the store's bits went up between the read and the append) reads the cost again
//!   and tries once more.

use std::time::{Duration, Instant};

use ad4m_identity_core::pow;
use ad4m_identity_core::{Event, Op};
use ad4m_ldk::identity::PowParams;
use serde_json::Value;

use crate::ports::{StoreReply, StoreRequest, StoreTransport, TransportError, CANCELLED};

/// The most bits of work the phone spends on one new log: about 2^28 hashes, a minute or two on a
/// phone. The store's default is 22.
pub const MAX_POW_BITS: u8 = 28;

/// The longest time one solve runs before it stops with an error. At [`MAX_POW_BITS`] a phone
/// needs a minute or two on average; this bounds a long run of bad luck on a slow phone.
///
/// It is also the only bound on one solve that has no Cancel: a make publishes an incept left
/// pending before its first screen (`finish_pending` in `steps.rs`), and the app has no flow id to
/// cancel until that first screen comes. A progress screen with a Cancel would close this; there
/// is none yet.
pub const MAX_SOLVE: Duration = Duration::from_secs(10 * 60);

/// Tries per round of the solve, between two reads of the cancel flag.
pub const ROUND: u64 = 1 << 16;

/// An append of a new log's event #0 with no proof: where its store is, its scid and its body.
struct NewLog {
    base: String,
    scid: String,
    body: Value,
}

/// `request` as an append of event #0 that carries no proof and no vouching token.
fn new_log_of(request: &StoreRequest) -> Option<NewLog> {
    if request.method != "POST" {
        return None;
    }
    let at = request.url.find("/v1/logs/")?;
    let base = request.url[..at].to_string();
    let scid = request.url[at + "/v1/logs/".len()..].strip_suffix("/events")?;
    if scid.is_empty() || scid.contains(['/', '?', '#']) {
        return None;
    }
    let body: Value = serde_json::from_slice(&request.body).ok()?;
    let unproved = |key: &str| body.get(key).is_none_or(Value::is_null);
    if !unproved("pow") || !unproved("vouch") {
        return None;
    }
    let incept = body.get("events")?.as_array()?.iter().any(|e| {
        Event::from_json(e)
            .is_ok_and(|e| e.seq == 0 && e.scid == scid && matches!(e.op, Op::Incept { .. }))
    });
    incept.then(|| NewLog {
        base,
        scid: scid.to_string(),
        body,
    })
}

fn get(inner: &dyn StoreTransport, url: String) -> Result<StoreReply, TransportError> {
    inner.send(StoreRequest {
        method: "GET".into(),
        url,
        headers: Vec::new(),
        body: Vec::new(),
    })
}

fn failed(reason: impl Into<String>) -> TransportError {
    TransportError::Failed {
        reason: reason.into(),
    }
}

/// The bits the store asks of a new log: `None` when it has no brake route or asks for none.
fn store_bits(inner: &dyn StoreTransport, base: &str) -> Result<Option<u8>, TransportError> {
    let reply = get(inner, format!("{base}/v1/pow"))?;
    if reply.status != 200 {
        // No brake route (an older store), or one that is not answering: the append is sent as
        // it is, and the store says itself whether it takes it.
        return Ok(None);
    }
    let params: PowParams = serde_json::from_slice(&reply.body).map_err(|e| {
        failed(format!(
            "the identity store's proof-of-work cost does not parse: {e}"
        ))
    })?;
    if params.bits > MAX_POW_BITS {
        return Err(failed(format!(
            "the identity store asks for a proof of work of {} bits, more than this phone spends ({MAX_POW_BITS})",
            params.bits
        )));
    }
    Ok((params.bits > 0).then_some(params.bits))
}

/// A proof for `scid` at `bits`, solved in rounds; `cancelled` is read between them. Stops after
/// [`MAX_SOLVE`].
pub fn solve(
    scid: &str,
    bits: u8,
    cancelled: &dyn Fn() -> bool,
) -> Result<pow::Pow, TransportError> {
    solve_within(scid, bits, cancelled, MAX_SOLVE)
}

/// [`solve`], stopping after `limit`.
fn solve_within(
    scid: &str,
    bits: u8,
    cancelled: &dyn Fn() -> bool,
    limit: Duration,
) -> Result<pow::Pow, TransportError> {
    let started = Instant::now();
    let mut start = 0u128;
    loop {
        if cancelled() {
            return Err(failed(CANCELLED));
        }
        if started.elapsed() >= limit {
            return Err(failed(format!(
                "the identity store's proof of work at {bits} bits took longer than this phone \
                 spends on it ({} minutes)",
                limit.as_secs() / 60
            )));
        }
        if let Some(proof) = pow::solve_range(scid, bits, start, ROUND) {
            return Ok(proof);
        }
        start = start.wrapping_add(u128::from(ROUND));
    }
}

/// `request` sent through `inner`, with a proof of work when it is a new log's event #0.
pub fn send(
    inner: &dyn StoreTransport,
    request: StoreRequest,
    cancelled: &dyn Fn() -> bool,
) -> Result<StoreReply, TransportError> {
    let Some(new_log) = new_log_of(&request) else {
        return inner.send(request);
    };
    let held = get(inner, format!("{}/v1/heads/{}", new_log.base, new_log.scid))?;
    if held.status != 404 {
        // The store holds the log (a republish), or did not say: no proof, which the store
        // refuses on a log it holds.
        return inner.send(request);
    }
    let mut again = true;
    loop {
        let Some(bits) = store_bits(inner, &new_log.base)? else {
            return inner.send(request);
        };
        let proof = solve(&new_log.scid, bits, cancelled)?;
        let mut body = new_log.body.clone();
        body["pow"] = serde_json::json!({ "nonce": proof.nonce, "bits": proof.bits });
        let reply = inner.send(StoreRequest {
            body: serde_json::to_vec(&body).expect("a JSON value serialises"),
            ..request.clone()
        })?;
        if again && reply.status == 403 && error_of(&reply) == Some("pow") {
            again = false;
            continue;
        }
        return Ok(reply);
    }
}

fn error_of(reply: &StoreReply) -> Option<&'static str> {
    let value: Value = serde_json::from_slice(&reply.body).ok()?;
    (value.get("error")?.as_str()? == "pow").then_some("pow")
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    /// A store that answers by path, recording every request.
    struct Fake {
        sent: Mutex<Vec<StoreRequest>>,
        head: u16,
        pow: Mutex<Vec<(u16, String)>>,
        append: Mutex<Vec<(u16, String)>>,
    }

    impl Fake {
        fn new(head: u16, pow: &[(u16, &str)], append: &[(u16, &str)]) -> Fake {
            let own = |l: &[(u16, &str)]| l.iter().map(|(s, b)| (*s, b.to_string())).collect();
            Fake {
                sent: Mutex::new(Vec::new()),
                head,
                pow: Mutex::new(own(pow)),
                append: Mutex::new(own(append)),
            }
        }

        fn sent(&self) -> Vec<StoreRequest> {
            self.sent.lock().unwrap().clone()
        }
    }

    impl StoreTransport for Fake {
        fn send(&self, request: StoreRequest) -> Result<StoreReply, TransportError> {
            self.sent.lock().unwrap().push(request.clone());
            let next = |l: &Mutex<Vec<(u16, String)>>| l.lock().unwrap().remove(0);
            let (status, body) = if request.url.contains("/v1/heads/") {
                (self.head, "{}".to_string())
            } else if request.url.ends_with("/v1/pow") {
                next(&self.pow)
            } else {
                next(&self.append)
            };
            Ok(StoreReply {
                status,
                headers: Vec::new(),
                body: body.into_bytes(),
            })
        }
    }

    /// An incept of a new identity (unsigned: the brake reads its seq, op and scid), and its scid.
    fn incept() -> (String, Value) {
        use ad4m_identity_core::build::incept_unsigned;
        let key = |seed: u8| {
            ad4m_hash_chain::encode_ed25519_multikey(
                ed25519_dalek::SigningKey::from_bytes(&[seed; 32])
                    .verifying_key()
                    .as_bytes(),
            )
        };
        let device = ad4m_identity_core::DeviceKey {
            id: "d1".into(),
            sign: key(9),
            enc: ad4m_identity_core::x25519_multikey_of(&ad4m_identity_core::X25519Secret::from(
                [7; 32],
            )),
            life: ad4m_identity_core::KeyLife::Standing,
        };
        let event = incept_unsigned(
            &key(1),
            ad4m_identity_core::commitment(&key(2), "salt"),
            vec![device],
        )
        .unwrap();
        (event.scid.clone(), serde_json::to_value(&event).unwrap())
    }

    fn append(scid: &str, events: Vec<Value>, extra: &[(&str, Value)]) -> StoreRequest {
        let mut body = serde_json::json!({ "events": events });
        for (k, v) in extra {
            body[*k] = v.clone();
        }
        StoreRequest {
            method: "POST".into(),
            url: format!("https://store.test/v1/logs/{scid}/events"),
            headers: Vec::new(),
            body: serde_json::to_vec(&body).unwrap(),
        }
    }

    fn sent_pow(request: &StoreRequest) -> Option<pow::Pow> {
        let body: Value = serde_json::from_slice(&request.body).unwrap();
        serde_json::from_value(body.get("pow")?.clone()).ok()
    }

    const NEVER: &dyn Fn() -> bool = &|| false;

    #[test]
    fn a_new_logs_incept_carries_a_proof_at_the_stores_bits() {
        let (scid, event) = incept();
        let fake = Fake::new(
            404,
            &[(200, r#"{"bits":8,"previousBits":8,"changedAt":0}"#)],
            &[(201, "{}")],
        );
        let reply = send(&fake, append(&scid, vec![event], &[]), NEVER).unwrap();
        assert_eq!(reply.status, 201);
        let sent = fake.sent();
        assert_eq!(sent.len(), 3, "the head, the cost, the append");
        assert_eq!(sent[0].url, format!("https://store.test/v1/heads/{scid}"));
        assert_eq!(sent[1].url, "https://store.test/v1/pow");
        let proof = sent_pow(&sent[2]).expect("the append carries a proof");
        assert_eq!(proof.bits, 8);
        assert!(pow::check(&scid, &proof, 8));
        // The events are sent as they were.
        let body: Value = serde_json::from_slice(&sent[2].body).unwrap();
        let first: Value =
            serde_json::from_slice(&append(&scid, vec![incept().1], &[]).body).unwrap();
        assert_eq!(body["events"], first["events"]);
    }

    #[test]
    fn a_log_the_store_holds_is_republished_with_no_proof() {
        let (scid, event) = incept();
        let request = append(&scid, vec![event], &[]);
        let fake = Fake::new(200, &[], &[(409, "{}")]);
        send(&fake, request.clone(), NEVER).unwrap();
        let sent = fake.sent();
        assert_eq!(sent.len(), 2);
        assert_eq!(sent[1], request, "sent as it came");
    }

    #[test]
    fn other_requests_go_out_as_they_came() {
        let (scid, event) = incept();
        let mut later = event.clone();
        later["seq"] = 1.into();
        for request in [
            // Not event #0.
            append(&scid, vec![later], &[]),
            // A proof or a vouching token already there.
            append(&scid, vec![event.clone()], &[("vouch", "token".into())]),
            append(
                &scid,
                vec![event.clone()],
                &[("pow", serde_json::json!({"nonce": "1", "bits": 1}))],
            ),
            // Another log's path.
            append("Qmother", vec![event.clone()], &[]),
            StoreRequest {
                method: "GET".into(),
                ..append(&scid, vec![event.clone()], &[])
            },
        ] {
            let fake = Fake::new(404, &[], &[(201, "{}")]);
            send(&fake, request.clone(), NEVER).unwrap();
            assert_eq!(fake.sent(), vec![request]);
        }
    }

    #[test]
    fn a_store_with_no_brake_gets_no_proof() {
        let (scid, event) = incept();
        for pow in [
            (404, "{}"),
            (200, r#"{"bits":0,"previousBits":0,"changedAt":0}"#),
        ] {
            let request = append(&scid, vec![event.clone()], &[]);
            let fake = Fake::new(404, &[pow], &[(201, "{}")]);
            send(&fake, request.clone(), NEVER).unwrap();
            assert_eq!(fake.sent()[2], request);
        }
    }

    #[test]
    fn a_raised_cost_is_read_again_once() {
        let (scid, event) = incept();
        let refused =
            r#"{"error":"pow","detail":"the proof of work does not meet the store's bits"}"#;
        let fake = Fake::new(
            404,
            &[
                (200, r#"{"bits":4,"previousBits":4,"changedAt":0}"#),
                (200, r#"{"bits":10,"previousBits":4,"changedAt":1}"#),
            ],
            &[(403, refused), (201, "{}")],
        );
        let reply = send(&fake, append(&scid, vec![event.clone()], &[]), NEVER).unwrap();
        assert_eq!(reply.status, 201);
        let sent = fake.sent();
        assert_eq!(sent.len(), 5);
        assert!(pow::check(&scid, &sent_pow(&sent[4]).unwrap(), 10));

        // A second refusal is the store's answer.
        let fake = Fake::new(
            404,
            &[
                (200, r#"{"bits":4,"previousBits":4,"changedAt":0}"#),
                (200, r#"{"bits":4,"previousBits":4,"changedAt":0}"#),
            ],
            &[(403, refused), (403, refused)],
        );
        let reply = send(&fake, append(&scid, vec![event], &[]), NEVER).unwrap();
        assert_eq!(reply.status, 403);
        assert_eq!(fake.sent().len(), 5);
    }

    #[test]
    fn a_cost_above_the_phones_is_refused_and_a_cancel_stops_the_work() {
        let (scid, event) = incept();
        let fake = Fake::new(
            404,
            &[(200, r#"{"bits":29,"previousBits":22,"changedAt":0}"#)],
            &[],
        );
        let Err(TransportError::Failed { reason }) =
            send(&fake, append(&scid, vec![event.clone()], &[]), NEVER)
        else {
            panic!("a cost above the phone's is refused");
        };
        assert!(reason.contains("29 bits"), "{reason}");
        assert_eq!(fake.sent().len(), 2, "nothing appended");

        // 64 bits would never finish: the cancel ends it at the next round.
        let Err(TransportError::Failed { reason }) = solve(&scid, 64, &|| true) else {
            panic!("a cancelled solve stops");
        };
        assert_eq!(reason, CANCELLED);
        let rounds = std::sync::atomic::AtomicU32::new(0);
        let cancel_after_two = || rounds.fetch_add(1, std::sync::atomic::Ordering::SeqCst) >= 2;
        assert!(solve(&scid, 64, &cancel_after_two).is_err());
        assert_eq!(rounds.load(std::sync::atomic::Ordering::SeqCst), 3);
    }

    #[test]
    fn a_solve_stops_at_its_time_limit() {
        let (scid, _) = incept();
        // 64 bits would never finish: the limit ends it, with its own reason.
        let Err(TransportError::Failed { reason }) = solve_within(&scid, 64, NEVER, Duration::ZERO)
        else {
            panic!("a solve past its limit stops");
        };
        assert!(
            reason.contains("took longer than this phone spends"),
            "{reason}"
        );
        assert_ne!(reason, CANCELLED);
        let started = Instant::now();
        let limit = Duration::from_millis(50);
        assert!(solve_within(&scid, 64, NEVER, limit).is_err());
        assert!(started.elapsed() >= limit);
        // A cancel is still read first.
        let Err(TransportError::Failed { reason }) =
            solve_within(&scid, 64, &|| true, Duration::ZERO)
        else {
            panic!("a cancelled solve stops");
        };
        assert_eq!(reason, CANCELLED);
    }

    /// How long one solve at the store's default cost takes on this machine: run with
    /// `cargo test --release -- --ignored --nocapture a_solve_at_the_stores_default_bits`.
    #[test]
    #[ignore]
    fn a_solve_at_the_stores_default_bits() {
        let mut times = Vec::new();
        for i in 0..8u8 {
            let scid = format!("QmTiming{i}");
            let started = std::time::Instant::now();
            let proof = solve(&scid, 22, NEVER).unwrap();
            times.push(started.elapsed());
            assert!(pow::check(&scid, &proof, 22));
        }
        times.sort();
        let total: std::time::Duration = times.iter().sum();
        println!(
            "22 bits, 8 scids: min {:?}, median {:?}, max {:?}, mean {:?}",
            times[0],
            times[4],
            times[7],
            total / 8
        );
    }
}
