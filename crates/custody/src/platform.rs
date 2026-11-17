//! The platform's email check (`POST /api/vouch/email/start` and `/verify`), which the custody
//! service calls in the `check-email` step. The platform sends a code to the address, and gives a
//! one-use token for the right code. The token goes to the executor (`identity.attachNote`),
//! never to the identity store from here.
//!
//! The custody service calls the platform, not the identity window: the window's CSP lets it
//! reach only its host's IPC.

use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use zeroize::Zeroizing;

/// The platform in production. `WE_PLATFORM_URL` replaces it (staging, a local platform).
pub const DEFAULT_PLATFORM_URL: &str = "https://api.coasys.app";

/// The environment variable that sets the platform's base URL.
pub const PLATFORM_URL_VAR: &str = "WE_PLATFORM_URL";

/// How long one call to the platform may take. `email/start` answers after a fixed delay, so
/// this is longer than that delay.
const TIMEOUT: Duration = Duration::from_secs(30);

/// Why a call to the platform did not give what was asked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlatformError {
    /// The code is wrong (`400 code`). `tries_left`: how many more codes the platform takes.
    WrongCode { tries_left: u32 },
    /// Too many wrong codes (`429 tries`): the code is spent, and a new one must be sent.
    TooManyTries,
    /// The code is expired (`410 expired`).
    Expired,
    /// The address already vouches for another identity (`409 already-vouched`).
    AlreadyVouched,
    /// Any other answer: its HTTP status and its `error`, when it has one.
    Refused { status: u16, error: Option<String> },
    /// The platform did not answer.
    Unreachable(String),
}

/// The platform at one base URL.
pub struct Platform {
    base: String,
    http: reqwest::Client,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Refusal {
    error: Option<String>,
    tries_left: Option<u32>,
}

#[derive(Deserialize)]
struct Issued {
    token: String,
}

impl Platform {
    /// The platform at `base` (`https://api.coasys.app`); a trailing `/` is removed.
    pub fn new(base: &str) -> Self {
        let http = reqwest::Client::builder()
            .timeout(TIMEOUT)
            .build()
            .expect("an HTTP client with a timeout only");
        Platform {
            base: base.trim().trim_end_matches('/').to_string(),
            http,
        }
    }

    /// The platform `WE_PLATFORM_URL` names, else [`DEFAULT_PLATFORM_URL`].
    pub fn from_env() -> Self {
        Platform::new(&platform_url(
            std::env::var(PLATFORM_URL_VAR).ok().as_deref(),
        ))
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    /// `POST /api/vouch/email/start {email, did}`: the platform sends a code to `email`. It
    /// answers `202` for every address, known or not.
    pub async fn start(&self, email: &str, did: &str) -> Result<(), PlatformError> {
        self.post(
            "/api/vouch/email/start",
            json!({ "email": email, "did": did }),
        )
        .await
        .map(|_| ())
    }

    /// `POST /api/vouch/email/verify {email, did, code}`: the one-use token for the right code.
    pub async fn verify(
        &self,
        email: &str,
        did: &str,
        code: &str,
    ) -> Result<Zeroizing<String>, PlatformError> {
        let answer = self
            .post(
                "/api/vouch/email/verify",
                json!({ "email": email, "did": did, "code": code }),
            )
            .await?;
        let issued: Issued =
            serde_json::from_value(answer).map_err(|_| PlatformError::Refused {
                status: 200,
                error: Some("no token".into()),
            })?;
        Ok(Zeroizing::new(issued.token))
    }

    async fn post(&self, path: &str, body: Value) -> Result<Value, PlatformError> {
        let response = self
            .http
            .post(format!("{}{path}", self.base))
            .json(&body)
            .send()
            .await
            .map_err(|e| PlatformError::Unreachable(e.without_url().to_string()))?;
        let status = response.status().as_u16();
        let text = response
            .text()
            .await
            .map_err(|e| PlatformError::Unreachable(e.without_url().to_string()))?;
        if (200..300).contains(&status) {
            return Ok(serde_json::from_str(&text).unwrap_or(Value::Null));
        }
        let refusal: Option<Refusal> = serde_json::from_str(&text).ok();
        let error = refusal.as_ref().and_then(|r| r.error.clone());
        Err(match (status, error.as_deref()) {
            (400, Some("code")) => PlatformError::WrongCode {
                tries_left: refusal.and_then(|r| r.tries_left).unwrap_or(0),
            },
            (429, Some("tries")) => PlatformError::TooManyTries,
            (410, _) => PlatformError::Expired,
            (409, Some("already-vouched")) => PlatformError::AlreadyVouched,
            _ => PlatformError::Refused { status, error },
        })
    }
}

/// The platform's base URL from the value of `WE_PLATFORM_URL`: the value when it is set and not
/// blank, else [`DEFAULT_PLATFORM_URL`].
pub fn platform_url(set: Option<&str>) -> String {
    match set.map(str::trim) {
        Some(url) if !url.is_empty() => url.trim_end_matches('/').to_string(),
        _ => DEFAULT_PLATFORM_URL.to_string(),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// One request the fake platform took: its path and its JSON body.
    pub(crate) type Taken = Arc<Mutex<Vec<(String, Value)>>>;

    /// A platform on a local port that answers each request with the next of `answers` (status
    /// and body), and keeps what it was sent. It answers `500` when it has no answer left.
    pub(crate) async fn fake_platform(answers: Vec<(u16, Value)>) -> (Platform, Taken) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let taken: Taken = Arc::default();
        let kept = taken.clone();
        tokio::spawn(async move {
            let mut answers = answers.into_iter();
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                let Some((path, body)) = read_request(&mut socket).await else {
                    continue;
                };
                kept.lock().unwrap().push((path, body));
                let (status, answer) = answers.next().unwrap_or((500, json!({})));
                let text = answer.to_string();
                let response = format!(
                    "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{text}",
                    text.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            }
        });
        (Platform::new(&format!("http://127.0.0.1:{port}/")), taken)
    }

    async fn read_request(socket: &mut tokio::net::TcpStream) -> Option<(String, Value)> {
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let read = socket.read(&mut chunk).await.ok()?;
            if read == 0 {
                return None;
            }
            bytes.extend_from_slice(&chunk[..read]);
            let text = String::from_utf8_lossy(&bytes).to_string();
            let Some(end) = text.find("\r\n\r\n") else {
                continue;
            };
            let head = &text[..end];
            let length = head
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().ok())?
                })
                .unwrap_or(0);
            if bytes.len() < end + 4 + length {
                continue;
            }
            let path = head.lines().next()?.split(' ').nth(1)?.to_string();
            let body = serde_json::from_slice(&bytes[end + 4..end + 4 + length]).ok()?;
            return Some((path, body));
        }
    }

    #[test]
    fn the_platform_url_is_the_variable_when_set_else_production() {
        assert_eq!(platform_url(None), DEFAULT_PLATFORM_URL);
        assert_eq!(platform_url(Some("  ")), DEFAULT_PLATFORM_URL);
        assert_eq!(
            platform_url(Some(" https://staging.example/ ")),
            "https://staging.example"
        );
    }

    #[tokio::test]
    async fn start_and_verify_send_the_contract_and_read_the_token() {
        let (platform, taken) =
            fake_platform(vec![(202, json!({})), (200, json!({ "token": "t-1" }))]).await;
        platform.start("a@example.org", "did:scid:x").await.unwrap();
        let token = platform
            .verify("a@example.org", "did:scid:x", "123456")
            .await
            .unwrap();
        assert_eq!(token.as_str(), "t-1");
        assert_eq!(
            *taken.lock().unwrap(),
            vec![
                (
                    "/api/vouch/email/start".to_string(),
                    json!({ "email": "a@example.org", "did": "did:scid:x" })
                ),
                (
                    "/api/vouch/email/verify".to_string(),
                    json!({ "email": "a@example.org", "did": "did:scid:x", "code": "123456" })
                ),
            ]
        );
    }

    #[tokio::test]
    async fn each_refusal_of_verify_is_read_as_its_own_error() {
        let (platform, _) = fake_platform(vec![
            (400, json!({ "error": "code", "triesLeft": 3 })),
            (429, json!({ "error": "tries" })),
            (410, json!({ "error": "expired" })),
            (409, json!({ "error": "already-vouched" })),
            (500, json!({ "error": "internal" })),
        ])
        .await;
        let verify = || platform.verify("a@example.org", "did:scid:x", "000000");
        assert_eq!(
            verify().await.unwrap_err(),
            PlatformError::WrongCode { tries_left: 3 }
        );
        assert_eq!(verify().await.unwrap_err(), PlatformError::TooManyTries);
        assert_eq!(verify().await.unwrap_err(), PlatformError::Expired);
        assert_eq!(verify().await.unwrap_err(), PlatformError::AlreadyVouched);
        assert_eq!(
            verify().await.unwrap_err(),
            PlatformError::Refused {
                status: 500,
                error: Some("internal".into())
            }
        );
    }

    #[tokio::test]
    async fn a_platform_that_does_not_answer_is_unreachable() {
        // A port nothing listens on: bound, then let go.
        let port = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        let platform = Platform::new(&format!("http://127.0.0.1:{port}"));
        assert!(matches!(
            platform.start("a@example.org", "did:scid:x").await,
            Err(PlatformError::Unreachable(_))
        ));
    }
}
