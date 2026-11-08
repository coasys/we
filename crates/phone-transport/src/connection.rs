//! One pinned WebSocket connection, run as a task on the crate's runtime.
//!
//! The events a listener hears, in order:
//!
//! - `on_open` once, after the TLS handshake and the WebSocket upgrade both succeed;
//! - `on_message` for each text frame;
//! - then exactly one ending. A clean close (either side sent a close frame) is `on_close(code,
//!   reason)` alone. A failure is `on_error(kind, message)` followed by `on_close(1006, kind)`.
//!
//! So `on_close` always comes last and always once, whatever happened, and a failure is always
//! named before it. Nothing is sent before the server certificate has passed the pin check: the
//! WebSocket upgrade is the first application byte, and it is written after the handshake.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use rustls::pki_types::ServerName;
use rustls::ClientConfig;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_rustls::TlsConnector;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;

use crate::pin::Pin;
use crate::verifier::{PinnedVerifier, Refusal};

/// The stable names of what went wrong, as the JS side shows them.
pub mod kind {
    pub const PIN_MISMATCH: &str = "pin-mismatch";
    pub const HOST_MISMATCH: &str = "host-mismatch";
    pub const UNREACHABLE: &str = "unreachable";
    pub const TLS: &str = "tls";
    /// The connection ended without a close frame, or a write failed on it.
    pub const CLOSED: &str = "closed";
    // The set is closed on purpose: the JS side switches on these five words. A WebSocket upgrade
    // that fails after TLS succeeded (a 404, a server that is not WebSocket) is `unreachable`, with
    // the HTTP answer in the message: the pinned desktop answered, the service was not there.
}

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const CLOSE_GRACE: Duration = Duration::from_secs(3);

/// What the phone hears from one connection. Called on a runtime thread; keep each call short.
#[uniffi::export(with_foreign)]
pub trait ConnectionListener: Send + Sync {
    fn on_open(&self);
    fn on_message(&self, text: String);
    fn on_close(&self, code: u16, reason: String);
    fn on_error(&self, kind: String, message: String);
}

/// Errors returned straight from a call, before any connection exists or after one has ended.
#[derive(Debug, thiserror::Error, uniffi::Error)]
#[uniffi(flat_error)]
pub enum TransportError {
    #[error("bad-url: {0}")]
    BadUrl(String),
    #[error("bad-pin: {0}")]
    BadPin(String),
    #[error("closed")]
    Closed,
}

enum Command {
    Send(String),
    Close,
}

static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
static LIVE: AtomicUsize = AtomicUsize::new(0);

/// The one runtime every connection runs on. Two workers: a phone holds one or two connections.
pub(crate) fn runtime() -> &'static tokio::runtime::Runtime {
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("coasys-transport")
            .enable_all()
            .build()
            .expect("the transport runtime starts")
    })
}

/// How many connection tasks are running now. For the leak check after reconnects.
#[uniffi::export]
pub fn live_connections() -> u32 {
    LIVE.load(Ordering::SeqCst) as u32
}

/// How many worker threads the shared runtime has. It does not grow with connections.
#[uniffi::export]
pub fn runtime_workers() -> u32 {
    RUNTIME
        .get()
        .map(|rt| rt.metrics().num_workers() as u32)
        .unwrap_or(0)
}

/// The pin of a certificate, given as PEM. What the desktop puts in its QR code.
#[uniffi::export]
pub fn pin_from_pem(pem: String) -> Result<String, TransportError> {
    crate::pin::pin_from_pem(&pem)
        .map(|p| p.to_b64url())
        .map_err(|e| TransportError::BadPin(e.to_string()))
}

/// A connection handle. Dropping it closes the connection.
#[derive(uniffi::Object)]
pub struct Connection {
    commands: mpsc::UnboundedSender<Command>,
    ended: Arc<AtomicBool>,
}

#[uniffi::export]
impl Connection {
    /// Starts connecting and returns at once. `on_open` or the ending follows on the listener.
    /// `url` is `wss://host:port/path`; `pin` is base64url (or hex) of SHA-256(SPKI).
    #[uniffi::constructor]
    pub fn connect(
        url: String,
        pin: String,
        listener: Arc<dyn ConnectionListener>,
    ) -> Result<Arc<Self>, TransportError> {
        let target = Target::parse(&url)?;
        let pin = Pin::parse(&pin).map_err(|e| TransportError::BadPin(e.to_string()))?;
        let (commands, receiver) = mpsc::unbounded_channel();
        let ended = Arc::new(AtomicBool::new(false));
        let task_ended = ended.clone();
        LIVE.fetch_add(1, Ordering::SeqCst);
        runtime().spawn(async move {
            let ending = run(target, pin, listener.as_ref(), receiver).await;
            task_ended.store(true, Ordering::SeqCst);
            match ending {
                Ending::Clean(code, reason) => listener.on_close(code, reason),
                Ending::Failed(kind, message) => {
                    listener.on_error(kind.to_string(), message);
                    listener.on_close(1006, kind.to_string());
                }
            }
            LIVE.fetch_sub(1, Ordering::SeqCst);
        });
        Ok(Arc::new(Self { commands, ended }))
    }

    /// Queues one text frame. Refused once the connection has ended.
    pub fn send(&self, text: String) -> Result<(), TransportError> {
        if self.ended.load(Ordering::SeqCst) {
            return Err(TransportError::Closed);
        }
        self.commands
            .send(Command::Send(text))
            .map_err(|_| TransportError::Closed)
    }

    /// Closes the connection with code 1000. The listener hears `on_close` when it has.
    pub fn close(&self) {
        let _ = self.commands.send(Command::Close);
    }
}

enum Ending {
    Clean(u16, String),
    Failed(&'static str, String),
}

#[derive(Debug)]
pub(crate) struct Target {
    pub(crate) url: String,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) server_name: ServerName<'static>,
    /// `path?query`, as an HTTP request line wants it.
    pub(crate) path_and_query: String,
}

impl Target {
    fn parse(text: &str) -> Result<Self, TransportError> {
        Self::parse_scheme(text, "wss")
    }

    /// `scheme` is the one scheme allowed: `wss` for the socket, `https` for a request. Both are TLS
    /// done here; nothing in this crate speaks cleartext.
    pub(crate) fn parse_scheme(text: &str, scheme: &str) -> Result<Self, TransportError> {
        let url = url::Url::parse(text).map_err(|e| TransportError::BadUrl(e.to_string()))?;
        if url.scheme() != scheme {
            return Err(TransportError::BadUrl(format!(
                "only {scheme}:// is allowed"
            )));
        }
        let (host, server_name) = match url.host() {
            Some(url::Host::Ipv4(ip)) => (
                ip.to_string(),
                ServerName::IpAddress(std::net::IpAddr::V4(ip).into()),
            ),
            Some(url::Host::Ipv6(ip)) => (
                ip.to_string(),
                ServerName::IpAddress(std::net::IpAddr::V6(ip).into()),
            ),
            Some(url::Host::Domain(name)) => {
                let server_name = ServerName::try_from(name.to_string())
                    .map_err(|_| TransportError::BadUrl(format!("{name} is not a host name")))?;
                (name.to_string(), server_name)
            }
            None => return Err(TransportError::BadUrl("the URL names no host".into())),
        };
        let path_and_query = match url.query() {
            Some(q) => format!("{}?{q}", url.path()),
            None => url.path().to_string(),
        };
        Ok(Self {
            url: url.to_string(),
            host,
            port: url.port().unwrap_or(443),
            server_name,
            path_and_query,
        })
    }
}

fn client_config(pin: Pin) -> (Arc<ClientConfig>, Arc<PinnedVerifier>) {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = PinnedVerifier::new(pin, &provider);
    let config = ClientConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .expect("ring supports TLS 1.3")
        .dangerous()
        .with_custom_certificate_verifier(verifier.clone())
        .with_no_client_auth();
    (Arc::new(config), verifier)
}

/// TCP, then TLS 1.3 under the pin rule. The one way this crate reaches a desktop: the WebSocket
/// and the one-shot HTTP request both start here, so neither can skip the pin.
pub(crate) async fn dial(
    target: &Target,
    pin: Pin,
) -> Result<tokio_rustls::client::TlsStream<TcpStream>, (&'static str, String)> {
    let tcp = match tokio::time::timeout(
        CONNECT_TIMEOUT,
        TcpStream::connect((target.host.as_str(), target.port)),
    )
    .await
    {
        Ok(Ok(tcp)) => tcp,
        Ok(Err(e)) => return Err((kind::UNREACHABLE, e.to_string())),
        Err(_) => return Err((kind::UNREACHABLE, "no answer within 10 s".into())),
    };
    let _ = tcp.set_nodelay(true);

    let (config, verifier) = client_config(pin);
    match tokio::time::timeout(
        CONNECT_TIMEOUT,
        TlsConnector::from(config).connect(target.server_name.clone(), tcp),
    )
    .await
    {
        Ok(Ok(tls)) => Ok(tls),
        Ok(Err(e)) => Err(match verifier.refusal() {
            Some(Refusal::PinMismatch) => (
                kind::PIN_MISMATCH,
                "the certificate's key is not the one paired".into(),
            ),
            Some(Refusal::HostMismatch) => (
                kind::HOST_MISMATCH,
                format!("the paired certificate does not name {}", target.host),
            ),
            _ => (kind::TLS, e.to_string()),
        }),
        Err(_) => Err((kind::TLS, "the handshake did not finish within 10 s".into())),
    }
}

async fn run(
    target: Target,
    pin: Pin,
    listener: &dyn ConnectionListener,
    mut commands: mpsc::UnboundedReceiver<Command>,
) -> Ending {
    let tls = match dial(&target, pin).await {
        Ok(tls) => tls,
        Err((kind, message)) => return Ending::Failed(kind, message),
    };

    let mut ws = match tokio_tungstenite::client_async(target.url.as_str(), tls).await {
        Ok((ws, _response)) => ws,
        Err(e) => {
            return Ending::Failed(
                kind::UNREACHABLE,
                format!("the WebSocket upgrade was refused: {e}"),
            )
        }
    };
    listener.on_open();

    loop {
        tokio::select! {
            command = commands.recv() => match command {
                Some(Command::Send(text)) => {
                    if let Err(e) = ws.send(Message::Text(text.into())).await {
                        return Ending::Failed(kind::CLOSED, e.to_string());
                    }
                }
                // An explicit close, or the handle was dropped.
                Some(Command::Close) | None => {
                    let _ = ws.close(Some(CloseFrame { code: CloseCode::Normal, reason: "".into() })).await;
                    // Wait briefly for the server's close frame, so the ending reports its answer.
                    let answer = tokio::time::timeout(CLOSE_GRACE, async {
                        while let Some(Ok(message)) = ws.next().await {
                            if let Message::Close(frame) = message {
                                return frame;
                            }
                        }
                        None
                    }).await;
                    return match answer {
                        Ok(Some(frame)) => Ending::Clean(frame.code.into(), frame.reason.to_string()),
                        _ => Ending::Clean(1000, String::new()),
                    };
                }
            },
            incoming = ws.next() => match incoming {
                Some(Ok(Message::Text(text))) => listener.on_message(text.to_string()),
                Some(Ok(Message::Binary(bytes))) => listener.on_message(String::from_utf8_lossy(&bytes).into_owned()),
                Some(Ok(Message::Close(frame))) => {
                    return match frame {
                        Some(frame) => Ending::Clean(frame.code.into(), frame.reason.to_string()),
                        None => Ending::Clean(1005, String::new()),
                    };
                }
                // Pings are answered by tungstenite itself.
                Some(Ok(_)) => {}
                Some(Err(e)) => return Ending::Failed(kind::CLOSED, e.to_string()),
                None => return Ending::Failed(kind::CLOSED, "the connection ended without a close frame".into()),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_are_read_as_the_verifier_needs_them() {
        let t = Target::parse("wss://10.0.2.2:8443/").unwrap();
        assert_eq!((t.host.as_str(), t.port), ("10.0.2.2", 8443));
        assert!(matches!(t.server_name, ServerName::IpAddress(_)));
        let t = Target::parse("wss://desk.local/rpc").unwrap();
        assert_eq!(t.port, 443);
        assert!(matches!(t.server_name, ServerName::DnsName(_)));
        let t = Target::parse("wss://[::1]:9000").unwrap();
        assert_eq!(t.host, "::1");
        assert!(Target::parse("ws://10.0.2.2:8443").is_err());
        assert!(Target::parse("not a url").is_err());
    }
}
