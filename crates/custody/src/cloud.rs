//! Add a cloud device: the host's side of the step (`IdentityStep::AddCloudDevice`). A host is an
//! executor that takes tenants (AR-05). Here live the parts that need no identity flow: which
//! address a host has, what `host.info` says, how an invite is read, how a refusal of `host.join`
//! is worded, and how the join is followed until the host serves the person.
//!
//! The calls go to the host over its WebSocket RPC with no credential: `host.info`, `host.join`
//! and `host.joinStatus` are open to anyone, because each carries its own proof.

use std::time::Duration;

use ad4m_identity_client::executor::RpcError;
use ad4m_identity_client::ExecutorRpc;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Coasys cloud (AR-05 4.11). `WE_COASYS_CLOUD_URL` replaces it (staging, a local host).
pub const DEFAULT_CLOUD_URL: &str = "https://cloud.coasys.org";

/// The environment variable that sets Coasys cloud's address.
pub const CLOUD_URL_VAR: &str = "WE_COASYS_CLOUD_URL";

/// Coasys cloud's address: `WE_COASYS_CLOUD_URL` when it is set, else [`DEFAULT_CLOUD_URL`]; an error
/// when that is not an address. The one place the address is read, so a change of domain is one edit.
pub fn coasys_url() -> Result<String, String> {
    CloudHost::Coasys.url(std::env::var(CLOUD_URL_VAR).ok().as_deref())
}

/// How long the host may take to activate a join after the holder confirmed: the host checks the
/// key log every 5 seconds, and a pending join lasts 10 minutes at most (AR-05 4.4).
pub const ACTIVATION_WAIT: Duration = Duration::from_secs(120);

/// Which host the person adds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CloudHost {
    /// Coasys cloud.
    Coasys,
    /// A host the person types the address of.
    Address { url: String },
}

impl CloudHost {
    /// The host's address, as `https://name[:port]` or `http://…` for a host the person typed with
    /// that scheme. `cloud_url` is what `WE_COASYS_CLOUD_URL` holds, when it is set.
    pub fn url(&self, cloud_url: Option<&str>) -> Result<String, String> {
        match self {
            CloudHost::Coasys => host_url(cloud_url.unwrap_or(DEFAULT_CLOUD_URL)),
            CloudHost::Address { url } => host_url(url),
        }
    }
}

/// The origin of the address a person typed: `cloud.example.org` is `https://cloud.example.org`.
/// A path, query or fragment is dropped, because the host's RPC is at the origin.
pub fn host_url(typed: &str) -> Result<String, String> {
    const NOT_AN_ADDRESS: &str = "That is not a host address. Check it and try again.";
    let typed = typed.trim();
    if typed.is_empty() {
        return Err("Type the host's address.".into());
    }
    let with_scheme = if typed.contains("://") {
        typed.to_string()
    } else {
        format!("https://{typed}")
    };
    let url = reqwest::Url::parse(&with_scheme).map_err(|_| NOT_AN_ADDRESS.to_string())?;
    // ws and wss are the same address as http and https for the RPC's socket.
    let scheme = match url.scheme() {
        "https" | "wss" => "https",
        "http" | "ws" => "http",
        _ => return Err(NOT_AN_ADDRESS.into()),
    };
    let host = url.host_str().ok_or_else(|| NOT_AN_ADDRESS.to_string())?;
    Ok(match url.port() {
        Some(port) => format!("{scheme}://{host}:{port}"),
        None => format!("{scheme}://{host}"),
    })
}

/// Who may join a host (`SignupPolicy`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Signup {
    Anyone,
    ByInvite,
    NoOne,
}

/// What a host says of itself before anyone joins (`HostInfo`).
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub multi_user: bool,
    pub signup: Signup,
    pub name: String,
    pub run_by_coasys: bool,
    pub full: bool,
}

impl HostInfo {
    /// Why the host cannot take this person, in words; `None` when it can.
    pub fn refuses(&self) -> Option<String> {
        if !self.multi_user {
            return Some(format!("{} does not take other people.", self.name));
        }
        if self.full {
            return Some(format!("{} is full. Try another host.", self.name));
        }
        if self.signup == Signup::NoOne {
            return Some(format!("{} is not taking new people.", self.name));
        }
        None
    }
}

/// `host.info` of the host behind `rpc`.
pub async fn info<H: ExecutorRpc>(rpc: &H) -> Result<HostInfo, String> {
    let answer = rpc
        .call("host.info", json!({}))
        .await
        .map_err(|e| unreachable_host(&e))?;
    serde_json::from_value(answer).map_err(|e| {
        log::warn!("custody: a host answered host.info in a shape this build does not know: {e}");
        "That address is not a host this app can add.".to_string()
    })
}

/// What the person reads when the host does not answer.
pub const UNREACHABLE: &str = "Can't reach that host. Check the address and your connection.";

/// [`UNREACHABLE`], with the cause kept in the log.
pub fn unreachable_host(e: &RpcError) -> String {
    log::warn!("custody: the host did not answer: {e}");
    UNREACHABLE.into()
}

/// The invite's secret, from an invite link (`https://…#secret`) or the secret pasted alone.
/// `None` when what was typed is not one: the secret is base64url.
pub fn invite_secret(typed: &str) -> Option<String> {
    let typed = typed.trim();
    let secret = typed
        .rsplit_once('#')
        .map_or(typed, |(_, fragment)| fragment);
    let well_formed = !secret.is_empty()
        && secret.len() <= 256
        && secret
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    well_formed.then(|| secret.to_string())
}

/// What `host.join` answers.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Joined {
    pub join_handle: String,
    pub tenant_id: String,
    pub device_did: String,
    /// Kept data was reattached.
    pub rejoin: bool,
}

/// Why `host.join` did not take the person.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JoinRefused {
    /// The invite is missing, used, revoked or expired: the person can type another and go on.
    Invite,
    /// The join cannot go on; the words say why and what to do.
    Stopped(String),
}

/// A refusal of `host.join` as the person reads it. The host's message starts with its refusal
/// code (AR-05 4.13.3).
pub fn join_refused(e: &RpcError) -> JoinRefused {
    let code = e.message.split(':').next().unwrap_or("").trim();
    let words = match code {
        "invite-invalid" => return JoinRefused::Invite,
        "signups-closed" => "This host is not taking new people.",
        "host-full" => "This host is full. Try another host.",
        "already-a-tenant" => "You already use this host.",
        "email-check-required" => {
            "The host can't see your email check yet. Wait a minute and try again."
        }
        "unknown-identity" => "The host can't find your identity. Try again in a minute.",
        "offer-invalid" => "The host did not accept the link. Try again.",
        "rate-limited" => "Too many tries. Wait a few minutes and try again.",
        "not-a-host" => "That address is not a host that takes people.",
        "store-unreachable" => "The host can't reach the identity service now. Try again later.",
        _ => {
            log::warn!("custody: host.join was refused: {e}");
            "The host did not take you. Try again later."
        }
    };
    JoinRefused::Stopped(words.into())
}

/// `host.join` for the person's `did`, with the offer string the holder opened and the invite's
/// secret when the host asks for one.
pub async fn join<H: ExecutorRpc>(
    rpc: &H,
    did_scid: &str,
    offer: &str,
    invite: Option<&str>,
) -> Result<Joined, RpcError> {
    let answer = rpc
        .call(
            "host.join",
            json!({ "didScid": did_scid, "offer": offer, "inviteSecret": invite }),
        )
        .await?;
    serde_json::from_value(answer).map_err(|e| RpcError {
        code: 500,
        message: format!("internal: host.join answered in a shape this build does not know: {e}"),
    })
}

/// How a join stands (`host.joinStatus`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JoinState {
    Pending,
    Active,
    /// The host ended the join before the key was listed: `expired` or `failed`, and why.
    Ended(String),
}

/// `host.joinStatus` for `handle`.
pub async fn status<H: ExecutorRpc>(rpc: &H, handle: &str) -> Result<JoinState, RpcError> {
    let answer = rpc
        .call("host.joinStatus", json!({ "joinHandle": handle }))
        .await?;
    Ok(match answer["state"].as_str() {
        Some("active") => JoinState::Active,
        Some("pending") => JoinState::Pending,
        Some(other) => JoinState::Ended(match answer["reason"].as_str() {
            Some(reason) => format!("{other}: {reason}"),
            None => other.to_string(),
        }),
        None => JoinState::Ended("no state".into()),
    })
}

/// Asks `host.joinStatus` every `every` until the host serves the person, ends the join, or `wait`
/// is over. `Ok(true)`: active. `Ok(false)`: still pending after `wait`.
pub async fn until_active<H: ExecutorRpc>(
    rpc: &H,
    handle: &str,
    every: Duration,
    wait: Duration,
) -> Result<bool, String> {
    let mut waited = Duration::ZERO;
    loop {
        match status(rpc, handle).await {
            Ok(JoinState::Active) => return Ok(true),
            Ok(JoinState::Ended(why)) => {
                log::warn!("custody: the host ended the join: {why}");
                return Err("The host ended the join before it finished. Try again.".into());
            }
            Ok(JoinState::Pending) => {}
            Err(e) => return Err(unreachable_host(&e)),
        }
        if waited >= wait {
            return Ok(false);
        }
        tokio::time::sleep(every).await;
        waited += every;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::cell::RefCell;
    use std::collections::VecDeque;

    /// A host that answers each method from a queue, and keeps what it was asked.
    struct FakeHost {
        answers: RefCell<std::collections::HashMap<String, VecDeque<Result<Value, RpcError>>>>,
        asked: RefCell<Vec<(String, Value)>>,
    }

    impl FakeHost {
        fn new(list: Vec<(&str, Result<Value, RpcError>)>) -> Self {
            let mut answers: std::collections::HashMap<String, VecDeque<_>> = Default::default();
            for (method, answer) in list {
                answers.entry(method.into()).or_default().push_back(answer);
            }
            FakeHost {
                answers: RefCell::new(answers),
                asked: RefCell::new(Vec::new()),
            }
        }
    }

    #[async_trait::async_trait(?Send)]
    impl ExecutorRpc for FakeHost {
        async fn call(&self, method: &str, params: Value) -> Result<Value, RpcError> {
            self.asked.borrow_mut().push((method.into(), params));
            let mut answers = self.answers.borrow_mut();
            let queue = answers.get_mut(method).expect("a method the test names");
            // The last answer stays for any call after it.
            if queue.len() > 1 {
                queue.pop_front().unwrap()
            } else {
                queue.front().unwrap().clone()
            }
        }
    }

    fn refusal(message: &str) -> RpcError {
        RpcError {
            code: 403,
            message: message.into(),
        }
    }

    #[test]
    fn a_typed_address_becomes_the_origin_of_the_host() {
        for (typed, url) in [
            ("cloud.example.org", "https://cloud.example.org"),
            (
                "  https://cloud.example.org/  ",
                "https://cloud.example.org",
            ),
            (
                "wss://cloud.example.org/api/v1/ws",
                "https://cloud.example.org",
            ),
            ("http://localhost:12000", "http://localhost:12000"),
            ("ws://localhost:12000/x?y=1#z", "http://localhost:12000"),
        ] {
            assert_eq!(host_url(typed).as_deref(), Ok(url), "{typed}");
        }
        for typed in ["", "   ", "ftp://example.org", "https://", "not a host"] {
            assert!(host_url(typed).is_err(), "{typed:?}");
        }
    }

    #[test]
    fn coasys_cloud_has_its_own_address_and_a_staging_one_replaces_it() {
        assert_eq!(
            CloudHost::Coasys.url(None).as_deref(),
            Ok("https://cloud.coasys.org")
        );
        assert_eq!(
            CloudHost::Coasys
                .url(Some("https://staging.example.org"))
                .as_deref(),
            Ok("https://staging.example.org")
        );
        assert_eq!(
            CloudHost::Address {
                url: "host.example.org".into()
            }
            .url(None)
            .as_deref(),
            Ok("https://host.example.org")
        );
    }

    #[test]
    fn the_host_step_crosses_ipc_in_the_windows_shape() {
        let coasys: CloudHost = serde_json::from_value(json!({ "kind": "coasys" })).unwrap();
        assert_eq!(coasys, CloudHost::Coasys);
        let address: CloudHost =
            serde_json::from_value(json!({ "kind": "address", "url": "a.example.org" })).unwrap();
        assert_eq!(
            address,
            CloudHost::Address {
                url: "a.example.org".into()
            }
        );
    }

    #[test]
    fn an_invite_is_read_from_its_link_or_alone() {
        assert_eq!(
            invite_secret("https://coasys.id/i#abc-DEF_123").as_deref(),
            Some("abc-DEF_123")
        );
        assert_eq!(
            invite_secret("  abc-DEF_123 ").as_deref(),
            Some("abc-DEF_123")
        );
        for typed in ["", " ", "https://coasys.id/i#", "has space", "a+b", "#"] {
            assert_eq!(invite_secret(typed), None, "{typed:?}");
        }
    }

    #[tokio::test]
    async fn a_host_that_is_closed_full_or_not_a_host_says_why() {
        let info = |multi_user, signup, full| HostInfo {
            multi_user,
            signup,
            name: "Garden host".into(),
            run_by_coasys: false,
            full,
        };
        assert_eq!(info(true, Signup::Anyone, false).refuses(), None);
        assert_eq!(info(true, Signup::ByInvite, false).refuses(), None);
        assert!(info(true, Signup::NoOne, false)
            .refuses()
            .unwrap()
            .contains("not taking new people"));
        assert!(info(true, Signup::Anyone, true)
            .refuses()
            .unwrap()
            .contains("is full"));
        assert!(info(false, Signup::Anyone, false)
            .refuses()
            .unwrap()
            .contains("does not take other people"));

        let host = FakeHost::new(vec![(
            "host.info",
            Ok(
                json!({ "multiUser": true, "signup": "by_invite", "name": "Coasys cloud",
                       "runByCoasys": true, "full": false }),
            ),
        )]);
        let read = info_of(&host).await;
        assert_eq!(read.signup, Signup::ByInvite);
        assert!(read.run_by_coasys);
    }

    async fn info_of(host: &FakeHost) -> HostInfo {
        info(host).await.unwrap()
    }

    #[tokio::test]
    async fn an_answer_that_is_not_host_info_is_not_a_host() {
        let host = FakeHost::new(vec![("host.info", Ok(json!({ "hello": 1 })))]);
        assert!(info(&host).await.unwrap_err().contains("not a host"));
        let down = FakeHost::new(vec![(
            "host.info",
            Err(RpcError {
                code: 503,
                message: "down".into(),
            }),
        )]);
        assert!(info(&down).await.unwrap_err().contains("Can't reach"));
    }

    #[test]
    fn each_refusal_of_a_join_has_its_words_and_only_a_bad_invite_goes_on() {
        assert_eq!(
            join_refused(&refusal("invite-invalid: no invite")),
            JoinRefused::Invite
        );
        for (code, says) in [
            ("signups-closed", "not taking new people"),
            ("host-full", "full"),
            ("already-a-tenant", "already use"),
            ("email-check-required", "email check"),
            ("unknown-identity", "can't find your identity"),
            ("offer-invalid", "did not accept"),
            ("rate-limited", "Too many"),
            ("not-a-host", "not a host"),
            ("store-unreachable", "identity service"),
            ("something-new", "Try again later"),
        ] {
            let JoinRefused::Stopped(words) = join_refused(&refusal(&format!("{code}: why")))
            else {
                panic!("{code}");
            };
            assert!(words.contains(says), "{code}: {words}");
        }
    }

    #[tokio::test]
    async fn the_join_sends_the_identity_the_offer_and_the_invite() {
        let host = FakeHost::new(vec![(
            "host.join",
            Ok(
                json!({ "joinHandle": "h1", "tenantId": "t1", "deviceDid": "did:key:zD",
                       "rejoin": false }),
            ),
        )]);
        let joined = join(&host, "did:scid:abc", "coasys:offer:1:x", Some("secret"))
            .await
            .unwrap();
        assert_eq!(joined.join_handle, "h1");
        assert_eq!(joined.device_did, "did:key:zD");
        assert!(!joined.rejoin);
        assert_eq!(
            host.asked.borrow()[0],
            (
                "host.join".to_string(),
                json!({ "didScid": "did:scid:abc", "offer": "coasys:offer:1:x",
                        "inviteSecret": "secret" })
            )
        );
        let none = FakeHost::new(vec![(
            "host.join",
            Ok(json!({ "joinHandle": "h", "tenantId": "t", "deviceDid": "d", "rejoin": true })),
        )]);
        join(&none, "did:scid:abc", "o", None).await.unwrap();
        assert_eq!(none.asked.borrow()[0].1["inviteSecret"], Value::Null);
    }

    #[tokio::test(start_paused = true)]
    async fn the_join_is_followed_until_the_host_serves_the_person() {
        let step = Duration::from_secs(2);
        let host = FakeHost::new(vec![
            (
                "host.joinStatus",
                Ok(json!({ "state": "pending", "reason": null })),
            ),
            (
                "host.joinStatus",
                Ok(json!({ "state": "pending", "reason": null })),
            ),
            (
                "host.joinStatus",
                Ok(json!({ "state": "active", "reason": null })),
            ),
        ]);
        assert_eq!(
            until_active(&host, "h", step, ACTIVATION_WAIT).await,
            Ok(true)
        );
        assert_eq!(host.asked.borrow().len(), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn a_join_that_stays_pending_is_still_pending_after_the_wait() {
        let host = FakeHost::new(vec![(
            "host.joinStatus",
            Ok(json!({ "state": "pending", "reason": null })),
        )]);
        assert_eq!(
            until_active(&host, "h", Duration::from_secs(2), Duration::from_secs(6)).await,
            Ok(false)
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_join_the_host_ended_is_an_error_with_words() {
        for state in ["expired", "failed"] {
            let host = FakeHost::new(vec![(
                "host.joinStatus",
                Ok(json!({ "state": state, "reason": "no key" })),
            )]);
            let why = until_active(&host, "h", Duration::from_secs(2), ACTIVATION_WAIT)
                .await
                .unwrap_err();
            assert!(why.contains("ended the join"), "{why}");
        }
    }
}
