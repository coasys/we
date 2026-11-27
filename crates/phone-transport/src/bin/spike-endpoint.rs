//! The desktop stand-in for spike 1: a TLS 1.3 listener with a self-signed certificate, in front of
//! the executor's WebSocket RPC, until ad4m serves one of its own.
//!
//! ```text
//! spike-endpoint --upstream ws://127.0.0.1:12000 [--listen 0.0.0.0:8443] [--cert-dir DIR] [--san NAME]…
//! spike-endpoint --echo
//! ```
//!
//! The certificate names every private IPv4 address of the machine, `10.0.2.2` (the host as the
//! Android emulator sees it), `127.0.0.1` and `localhost`, plus any `--san`. It is written to
//! `--cert-dir` and reused on the next start, so the pin stays the same; delete the directory for a
//! new one. The terminal shows the pin, the URL and a QR code of `{"url":…,"pin":…}`.
//!
//! Each accepted connection is copied byte for byte to the upstream TCP address once TLS ends: the
//! WebSocket upgrade, the frames and the close all pass through untouched. `--echo` answers the
//! WebSocket itself and echoes every frame, for tests with no executor.

use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use futures_util::{SinkExt, StreamExt};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::ServerConfig;
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;

struct Options {
    listen: SocketAddr,
    upstream: Option<String>,
    cert_dir: PathBuf,
    sans: Vec<String>,
    echo: bool,
    /// The host put in the printed URL and QR code. Must be one the certificate names.
    advertise: Option<String>,
    /// Name only the `--san` hosts, not the machine's addresses. For testing that a certificate
    /// holding the paired key is refused on a host it does not name.
    names_only: bool,
}

fn usage() -> ! {
    eprintln!(
        "usage: spike-endpoint (--upstream ws://127.0.0.1:<port> | --echo) [--listen 0.0.0.0:8443] [--cert-dir DIR] [--san NAME]... [--advertise HOST] [--names-only]"
    );
    std::process::exit(2)
}

fn options() -> Options {
    let mut o = Options {
        listen: "0.0.0.0:8443".parse().unwrap(),
        upstream: None,
        cert_dir: PathBuf::from("spike-endpoint-cert"),
        sans: Vec::new(),
        echo: false,
        advertise: None,
        names_only: false,
    };
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--listen" => {
                o.listen = args
                    .next()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or_else(|| usage())
            }
            "--upstream" => o.upstream = Some(args.next().unwrap_or_else(|| usage())),
            "--cert-dir" => o.cert_dir = PathBuf::from(args.next().unwrap_or_else(|| usage())),
            "--san" => o.sans.push(args.next().unwrap_or_else(|| usage())),
            "--echo" => o.echo = true,
            "--names-only" => o.names_only = true,
            "--advertise" => o.advertise = Some(args.next().unwrap_or_else(|| usage())),
            _ => usage(),
        }
    }
    if o.echo == o.upstream.is_some() {
        usage();
    }
    o
}

/// `ws://host:port[/…]` → `host:port`. The path is the client's to send; it passes through.
fn upstream_addr(url: &str) -> String {
    let rest = url.strip_prefix("ws://").unwrap_or_else(|| {
        eprintln!("--upstream must be a ws:// URL");
        std::process::exit(2)
    });
    rest.split('/').next().unwrap_or(rest).to_string()
}

/// The machine's private IPv4 addresses, the one a phone most likely reaches first.
///
/// Container and VM bridges (docker0, br-…, veth…, virbr…) are private too, but no phone on the
/// LAN can reach them, so they go last: still named in the certificate, never advertised first.
/// Among the rest, 192.168/16 (home routers) before 10/8 before 172.16/12.
fn private_ipv4s() -> Vec<IpAddr> {
    let virtual_bridge = |name: &str| {
        [
            "docker",
            "br-",
            "veth",
            "virbr",
            "lxc",
            "podman",
            "cni",
            "flannel",
            "tailscale",
            "zt",
        ]
        .iter()
        .any(|p| name.starts_with(p))
    };
    let mut ips: Vec<(u8, IpAddr)> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| match i.ip() {
            IpAddr::V4(v4) if v4.is_private() => {
                let class = match v4.octets() {
                    [192, 168, ..] => 0,
                    [10, ..] => 1,
                    _ => 2,
                };
                let rank = if virtual_bridge(&i.name) {
                    10 + class
                } else {
                    class
                };
                Some((rank, IpAddr::V4(v4)))
            }
            _ => None,
        })
        .collect();
    ips.sort();
    let mut out: Vec<IpAddr> = ips.into_iter().map(|(_, ip)| ip).collect();
    let mut seen = std::collections::HashSet::new();
    out.retain(|ip| seen.insert(*ip));
    out
}

/// The certificate and key in `dir`, made when missing.
///
/// The pin names the key, not the certificate, so the key is what has to last. A `key.pem` without a
/// `cert.pem` is kept and given a new certificate: delete `cert.pem` when the machine's addresses
/// change, and the phone's pairing still holds.
fn certificate(
    dir: &PathBuf,
    sans: &[String],
) -> (
    Vec<CertificateDer<'static>>,
    PrivateKeyDer<'static>,
    String,
    bool,
) {
    let cert_path = dir.join("cert.pem");
    let key_path = dir.join("key.pem");
    if cert_path.exists() && key_path.exists() {
        let pem = std::fs::read_to_string(&cert_path).expect("cert.pem is readable");
        let cert =
            CertificateDer::from_pem_slice(pem.as_bytes()).expect("cert.pem holds a certificate");
        let key = PrivateKeyDer::from_pem_file(&key_path).expect("key.pem holds a private key");
        return (vec![cert], key, pem, false);
    }
    let key = if key_path.exists() {
        let pem = std::fs::read_to_string(&key_path).expect("key.pem is readable");
        rcgen::KeyPair::from_pem(&pem).expect("key.pem holds a P-256 key")
    } else {
        rcgen::KeyPair::generate().expect("a P-256 key")
    };
    let mut params =
        rcgen::CertificateParams::new(sans.to_vec()).expect("the names are valid SANs");
    params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "Coasys desktop (spike)");
    let cert = params.self_signed(&key).expect("self-signing succeeds");
    std::fs::create_dir_all(dir).expect("the cert dir can be made");
    std::fs::write(&cert_path, cert.pem()).expect("cert.pem is written");
    std::fs::write(&key_path, key.serialize_pem()).expect("key.pem is written");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600));
    }
    let der = PrivateKeyDer::try_from(key.serialize_der()).expect("the key serialises");
    (vec![cert.der().clone()], der, cert.pem(), true)
}

fn print_qr(text: &str) {
    match qrcode::QrCode::new(text.as_bytes()) {
        Ok(code) => {
            let image = code
                .render::<qrcode::render::unicode::Dense1x2>()
                .dark_color(qrcode::render::unicode::Dense1x2::Light)
                .light_color(qrcode::render::unicode::Dense1x2::Dark)
                .build();
            println!("{image}");
        }
        Err(e) => eprintln!("no QR code: {e}"),
    }
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[tokio::main]
async fn main() {
    let o = options();
    let ips = private_ipv4s();
    let mut sans: Vec<String> = Vec::new();
    if !o.names_only {
        sans.extend(ips.iter().map(|ip| ip.to_string()));
        for extra in ["10.0.2.2", "127.0.0.1", "localhost"] {
            sans.push(extra.to_string());
        }
    }
    sans.extend(o.sans.iter().cloned());
    if sans.is_empty() {
        eprintln!("--names-only needs at least one --san");
        std::process::exit(2);
    }
    let mut seen = std::collections::HashSet::new();
    sans.retain(|name| seen.insert(name.clone()));

    let (chain, key, pem, fresh) = certificate(&o.cert_dir, &sans);
    let pin = we_phone_transport::pin::pin_from_pem(&pem)
        .expect("the certificate has a pin")
        .to_b64url();

    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = ServerConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .expect("ring supports TLS 1.3")
        .with_no_client_auth()
        .with_single_cert(chain, key)
        .expect("the certificate and key match");
    let acceptor = TlsAcceptor::from(Arc::new(config));

    let listener = TcpListener::bind(o.listen).await.unwrap_or_else(|e| {
        eprintln!("cannot listen on {}: {e}", o.listen);
        std::process::exit(1)
    });
    let port = listener
        .local_addr()
        .map(|a| a.port())
        .unwrap_or(o.listen.port());

    let advertised = o
        .advertise
        .clone()
        .or_else(|| ips.first().map(|ip| ip.to_string()))
        .unwrap_or_else(|| "127.0.0.1".into());
    let url = format!("wss://{advertised}:{port}");
    let pairing = serde_json::json!({ "url": url, "pin": pin }).to_string();
    println!(
        "spike-endpoint: {} certificate in {}",
        if fresh { "new" } else { "existing" },
        o.cert_dir.display()
    );
    println!("  names: {}", sans.join(", "));
    println!("  pin:   {pin}");
    println!("  url:   {url}   (emulator: wss://10.0.2.2:{port})");
    match &o.upstream {
        Some(up) => println!("  upstream: {up}"),
        None => println!("  mode: echo"),
    }
    println!("  pairing: {pairing}");
    print_qr(&pairing);

    let upstream = o.upstream.as_deref().map(upstream_addr);
    loop {
        let (tcp, peer) = match listener.accept().await {
            Ok(pair) => pair,
            Err(e) => {
                eprintln!("accept: {e}");
                continue;
            }
        };
        let _ = tcp.set_nodelay(true);
        let acceptor = acceptor.clone();
        let upstream = upstream.clone();
        tokio::spawn(async move {
            let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
            let started = Instant::now();
            let tls = match acceptor.accept(tcp).await {
                Ok(tls) => tls,
                Err(e) => {
                    println!("[{id}] {peer}: handshake refused: {e}");
                    return;
                }
            };
            println!("[{id}] {peer}: TLS 1.3 up in {:?}", started.elapsed());
            match upstream {
                Some(addr) => proxy(id, tls, &addr).await,
                None => echo(id, tls).await,
            }
            println!("[{id}] {peer}: ended after {:?}", started.elapsed());
        });
    }
}

async fn proxy(id: u64, mut tls: tokio_rustls::server::TlsStream<TcpStream>, addr: &str) {
    let mut up = match TcpStream::connect(addr).await {
        Ok(up) => up,
        Err(e) => {
            println!("[{id}] upstream {addr} unreachable: {e}");
            return;
        }
    };
    let _ = up.set_nodelay(true);
    match tokio::io::copy_bidirectional(&mut tls, &mut up).await {
        Ok((to_up, to_phone)) => println!("[{id}] {to_up} bytes up, {to_phone} bytes down"),
        Err(e) => println!("[{id}] proxy ended: {e}"),
    }
}

async fn echo(id: u64, tls: tokio_rustls::server::TlsStream<TcpStream>) {
    let mut ws = match tokio_tungstenite::accept_async(tls).await {
        Ok(ws) => ws,
        Err(e) => {
            println!("[{id}] not a WebSocket: {e}");
            return;
        }
    };
    let mut frames = 0u64;
    while let Some(Ok(message)) = ws.next().await {
        if message.is_close() {
            break;
        }
        if message.is_text() || message.is_binary() {
            frames += 1;
            if ws.send(message).await.is_err() {
                break;
            }
        }
    }
    println!("[{id}] echoed {frames} frames");
}
