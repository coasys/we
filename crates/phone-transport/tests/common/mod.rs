//! A local TLS WebSocket server for the tests, and a listener that turns callbacks into a channel.
#![allow(dead_code)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::server::{ClientHello, ResolvesServerCert};
use rustls::sign::CertifiedKey;
use rustls::ServerConfig;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;
use we_phone_transport::{Connection, ConnectionListener};

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Open,
    Message(String),
    Close(u16, String),
    Error(String, String),
}

pub struct Recorder(pub mpsc::Sender<Event>);

impl ConnectionListener for Recorder {
    fn on_open(&self) {
        let _ = self.0.send(Event::Open);
    }
    fn on_message(&self, text: String) {
        let _ = self.0.send(Event::Message(text));
    }
    fn on_close(&self, code: u16, reason: String) {
        let _ = self.0.send(Event::Close(code, reason));
    }
    fn on_error(&self, kind: String, message: String) {
        let _ = self.0.send(Event::Error(kind, message));
    }
}

pub fn connect(url: &str, pin: &str) -> (Arc<Connection>, mpsc::Receiver<Event>) {
    let (tx, rx) = mpsc::channel();
    let connection = Connection::connect(url.into(), pin.into(), Arc::new(Recorder(tx)))
        .expect("the call is accepted");
    (connection, rx)
}

pub fn next(rx: &mpsc::Receiver<Event>) -> Event {
    rx.recv_timeout(Duration::from_secs(10))
        .expect("an event within 10 s")
}

/// Every event up to and including the closing one, and then a check that nothing follows it.
pub fn until_close(rx: &mpsc::Receiver<Event>) -> Vec<Event> {
    let mut events = Vec::new();
    loop {
        let event = next(rx);
        let done = matches!(event, Event::Close(..));
        events.push(event);
        if done {
            break;
        }
    }
    assert!(
        rx.recv_timeout(Duration::from_millis(300)).is_err(),
        "nothing after on_close: {events:?}"
    );
    events
}

pub struct Cert {
    pub der: CertificateDer<'static>,
    pub key: PrivateKeyDer<'static>,
    pub pin: String,
}

pub fn cert(names: &[&str]) -> Cert {
    let key = rcgen::KeyPair::generate().unwrap();
    let cert =
        rcgen::CertificateParams::new(names.iter().map(|n| n.to_string()).collect::<Vec<_>>())
            .unwrap()
            .self_signed(&key)
            .unwrap();
    let pin = we_phone_transport::pin_from_der(cert.der())
        .unwrap()
        .to_b64url();
    Cert {
        der: cert.der().clone(),
        key: PrivateKeyDer::try_from(key.serialize_der()).unwrap(),
        pin,
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Behaviour {
    Echo,
    /// Accept the WebSocket, then drop the TCP connection with no close frame.
    DropAfterOpen,
    /// Accept the WebSocket, then send close 4001 "bye".
    CloseAfterOpen,
    /// Not a WebSocket: answer one HTTP request with its own request line, and close.
    Http,
}

pub struct Server {
    pub port: u16,
    /// Handshakes the server completed.
    pub handshakes: Arc<AtomicUsize>,
    /// WebSocket upgrades the server read — the first application data a client sends.
    pub upgrades: Arc<AtomicUsize>,
    /// The server's own runtime. Shutting it down closes every socket it holds, as killing the
    /// endpoint process would.
    runtime: Option<tokio::runtime::Runtime>,
}

impl Server {
    pub fn kill(&mut self) {
        if let Some(rt) = self.runtime.take() {
            rt.shutdown_background();
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.kill();
    }
}

/// Presents `cert`, signing with `signer` (normally the cert's own key).
#[derive(Debug)]
struct Fixed(Arc<CertifiedKey>);
impl ResolvesServerCert for Fixed {
    fn resolve(&self, _hello: ClientHello<'_>) -> Option<Arc<CertifiedKey>> {
        Some(self.0.clone())
    }
}

fn server_runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .unwrap()
}

pub fn serve(
    cert: &Cert,
    signer: Option<&PrivateKeyDer<'static>>,
    tls12_only: bool,
    behaviour: Behaviour,
    port: u16,
) -> Server {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let signing = provider
        .key_provider
        .load_private_key(signer.unwrap_or(&cert.key).clone_key())
        .unwrap();
    let certified = Arc::new(CertifiedKey::new(vec![cert.der.clone()], signing));
    let versions: &[&rustls::SupportedProtocolVersion] = if tls12_only {
        &[&rustls::version::TLS12]
    } else {
        &[&rustls::version::TLS13]
    };
    let config = ServerConfig::builder_with_provider(provider)
        .with_protocol_versions(versions)
        .unwrap()
        .with_no_client_auth()
        .with_cert_resolver(Arc::new(Fixed(certified)));
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));

    let handshakes = Arc::new(AtomicUsize::new(0));
    let upgrades = Arc::new(AtomicUsize::new(0));
    let (h, u) = (handshakes.clone(), upgrades.clone());
    let rt = server_runtime();
    let listener = rt.block_on(TcpListener::bind(("127.0.0.1", port))).unwrap();
    let port = listener.local_addr().unwrap().port();
    rt.spawn(async move {
        loop {
            let Ok((tcp, _)) = listener.accept().await else {
                return;
            };
            let acceptor = acceptor.clone();
            let (h, u) = (h.clone(), u.clone());
            tokio::spawn(async move {
                let Ok(mut tls) = acceptor.accept(tcp).await else {
                    return;
                };
                h.fetch_add(1, Ordering::SeqCst);
                if behaviour == Behaviour::Http {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut request = Vec::new();
                    let mut buf = [0u8; 4096];
                    while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                        match tls.read(&mut buf).await {
                            Ok(0) | Err(_) => return,
                            Ok(n) => request.extend_from_slice(&buf[..n]),
                        }
                    }
                    u.fetch_add(1, Ordering::SeqCst);
                    let line = String::from_utf8_lossy(&request)
                        .lines()
                        .next()
                        .unwrap_or_default()
                        .to_string();
                    let reply = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nX-Test: yes\r\n\r\n{line}",
                        line.len()
                    );
                    let _ = tls.write_all(reply.as_bytes()).await;
                    let _ = tls.shutdown().await;
                    return;
                }
                let Ok(mut ws) = tokio_tungstenite::accept_async(tls).await else {
                    return;
                };
                u.fetch_add(1, Ordering::SeqCst);
                match behaviour {
                    Behaviour::Http => unreachable!("answered above"),
                    Behaviour::DropAfterOpen => drop(ws),
                    Behaviour::CloseAfterOpen => {
                        let _ = ws
                            .close(Some(CloseFrame {
                                code: CloseCode::Library(4001),
                                reason: "bye".into(),
                            }))
                            .await;
                        while ws.next().await.is_some() {}
                    }
                    Behaviour::Echo => {
                        while let Some(Ok(message)) = ws.next().await {
                            match message {
                                Message::Text(_) | Message::Binary(_) => {
                                    if ws.send(message).await.is_err() {
                                        break;
                                    }
                                }
                                Message::Close(_) => break,
                                _ => {}
                            }
                        }
                    }
                }
            });
        }
    });
    Server {
        port,
        handshakes,
        upgrades,
        runtime: Some(rt),
    }
}
