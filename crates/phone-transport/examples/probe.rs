//! Times the phases of one pinned connection: TCP connect, TLS handshake, WebSocket upgrade, one
//! round trip. For finding where time goes on a device, without the plugin or the WebView:
//!
//! ```text
//! cargo ndk -t x86_64 build --release --example probe
//! adb push target/x86_64-linux-android/release/examples/probe /data/local/tmp/
//! adb shell /data/local/tmp/probe wss://10.0.2.2:8443 <pin>
//! ```
use std::sync::Arc;
use std::time::Instant;

use futures_util::{SinkExt, StreamExt};
use rustls::pki_types::ServerName;
use tokio_tungstenite::tungstenite::Message;
use we_phone_transport::verifier::PinnedVerifier;
use we_phone_transport::Pin;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let mut args = std::env::args().skip(1);
    let url = url::Url::parse(&args.next().expect("a wss:// URL")).expect("a URL");
    let pin = Pin::parse(&args.next().expect("a pin")).expect("a pin");
    let host = url.host_str().unwrap().trim_matches(['[', ']']).to_string();
    let port = url.port().unwrap_or(443);
    let server_name = match host.parse::<std::net::IpAddr>() {
        Ok(ip) => ServerName::IpAddress(ip.into()),
        Err(_) => ServerName::try_from(host.clone()).unwrap(),
    };

    // What the ClientHello costs to make, on its own: randomness and one key share per group.
    let provider = rustls::crypto::ring::default_provider();
    let t = Instant::now();
    let mut buf = [0u8; 32];
    provider.secure_random.fill(&mut buf).unwrap();
    println!("random: {:?}", t.elapsed());
    for group in provider.kx_groups.iter() {
        let t = Instant::now();
        let _ = group.start().unwrap();
        println!("key share {:?}: {:?}", group.name(), t.elapsed());
    }

    for round in 0..3 {
        let t0 = Instant::now();
        let tcp = tokio::net::TcpStream::connect((host.as_str(), port))
            .await
            .expect("tcp");
        tcp.set_nodelay(true).unwrap();
        let t_tcp = t0.elapsed();
        // `PROBE_PAUSE_MS`: wait before the first byte. On the Android emulator the first segment a
        // guest sends on a new connection is held by the emulator's user-mode NAT until its
        // 500 ms timer; a pause after connect shows whether that is what a slow handshake is.
        if let Some(ms) = std::env::var("PROBE_PAUSE_MS")
            .ok()
            .and_then(|v| v.parse().ok())
        {
            tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
        }

        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let verifier = PinnedVerifier::new(pin, &provider);
        let config = rustls::ClientConfig::builder_with_provider(provider)
            .with_protocol_versions(&[&rustls::version::TLS13])
            .unwrap()
            .dangerous()
            .with_custom_certificate_verifier(verifier)
            .with_no_client_auth();
        let t1 = Instant::now();
        let tls = tokio_rustls::TlsConnector::from(Arc::new(config))
            .connect(server_name.clone(), tcp)
            .await
            .expect("tls");
        let t_tls = t1.elapsed();
        println!("round {round}: tcp {t_tcp:?}, tls {t_tls:?}");

        let t2 = Instant::now();
        let (mut ws, _) = tokio_tungstenite::client_async(url.as_str(), tls)
            .await
            .expect("upgrade");
        let t_up = t2.elapsed();

        let t3 = Instant::now();
        ws.send(Message::Text(
            r#"{"id":"1","type":"agent.status","params":{}}"#.into(),
        ))
        .await
        .unwrap();
        let _ = ws.next().await;
        let t_rt = t3.elapsed();
        println!("round {round}: tcp {t_tcp:?}, tls {t_tls:?}, upgrade {t_up:?}, first round trip {t_rt:?}");

        // `PROBE_N` sequential calls, as the diagnostic page makes them, without the bridge.
        let n: usize = std::env::var("PROBE_N")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        if n > 0 {
            let mut times = Vec::with_capacity(n);
            let started = Instant::now();
            for i in 0..n {
                let t = Instant::now();
                let call = format!(r#"{{"id":"{i}","type":"agent.status","params":{{}}}}"#);
                ws.send(Message::Text(call.into())).await.unwrap();
                let _ = ws.next().await;
                times.push(t.elapsed());
            }
            let elapsed = started.elapsed();
            times.sort();
            println!(
                "  {n} round trips: p50 {:?}, p95 {:?}, {:.0} msg/s",
                times[n / 2],
                times[n * 95 / 100],
                n as f64 / elapsed.as_secs_f64()
            );
        }
        let _ = ws.close(None).await;
    }
}
