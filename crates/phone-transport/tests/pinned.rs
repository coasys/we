//! The pin rule against a real TLS server: what connects, what is refused, and how it ends.

mod common;

use std::sync::atomic::Ordering;
use std::time::Duration;

use common::*;

fn error_kind(events: &[Event]) -> Option<String> {
    events.iter().find_map(|e| match e {
        Event::Error(kind, _) => Some(kind.clone()),
        _ => None,
    })
}

#[test]
fn the_right_pin_connects_and_echoes() {
    let cert = cert(&["127.0.0.1"]);
    let server = serve(&cert, None, false, Behaviour::Echo, 0);
    let (connection, rx) = connect(&format!("wss://127.0.0.1:{}/", server.port), &cert.pin);
    assert_eq!(next(&rx), Event::Open);
    connection
        .send(r#"{"jsonrpc":"2.0","id":1}"#.into())
        .unwrap();
    assert_eq!(
        next(&rx),
        Event::Message(r#"{"jsonrpc":"2.0","id":1}"#.into())
    );
    connection.close();
    assert_eq!(until_close(&rx), vec![Event::Close(1000, String::new())]);
    assert!(
        connection.send("late".into()).is_err(),
        "a send after the ending is refused"
    );
}

#[test]
fn a_dns_name_connects_when_the_certificate_names_it() {
    let cert = cert(&["localhost"]);
    let server = serve(&cert, None, false, Behaviour::Echo, 0);
    let (connection, rx) = connect(&format!("wss://localhost:{}", server.port), &cert.pin);
    assert_eq!(next(&rx), Event::Open);
    connection.close();
    until_close(&rx);
}

#[test]
fn a_hex_pin_works_as_well() {
    let cert = cert(&["127.0.0.1"]);
    let server = serve(&cert, None, false, Behaviour::Echo, 0);
    let hex: String = we_phone_transport::Pin::parse(&cert.pin)
        .unwrap()
        .0
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let (connection, rx) = connect(&format!("wss://127.0.0.1:{}", server.port), &hex);
    assert_eq!(next(&rx), Event::Open);
    connection.close();
    until_close(&rx);
}

#[test]
fn a_wrong_pin_is_refused_before_any_application_data() {
    let cert = cert(&["127.0.0.1"]);
    let other = common::cert(&["127.0.0.1"]);
    let server = serve(&cert, None, false, Behaviour::Echo, 0);
    let (connection, rx) = connect(&format!("wss://127.0.0.1:{}", server.port), &other.pin);
    let events = until_close(&rx);
    assert_eq!(
        error_kind(&events).as_deref(),
        Some("pin-mismatch"),
        "{events:?}"
    );
    assert_eq!(
        events.last(),
        Some(&Event::Close(1006, "pin-mismatch".into()))
    );
    assert!(!events.contains(&Event::Open));
    // The client aborted inside the handshake: the server never completed one, so it never read a
    // byte of application data, and the WebSocket upgrade never reached it.
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(server.handshakes.load(Ordering::SeqCst), 0);
    assert_eq!(server.upgrades.load(Ordering::SeqCst), 0);
    assert!(connection.send("x".into()).is_err());
}

#[test]
fn the_right_certificate_for_another_address_is_refused() {
    // The paired desktop's certificate, presented on an address it does not name.
    let cert = cert(&["192.168.1.50"]);
    let server = serve(&cert, None, false, Behaviour::Echo, 0);
    let (_connection, rx) = connect(&format!("wss://127.0.0.1:{}", server.port), &cert.pin);
    let events = until_close(&rx);
    assert_eq!(
        error_kind(&events).as_deref(),
        Some("host-mismatch"),
        "{events:?}"
    );
    assert_eq!(server.upgrades.load(Ordering::SeqCst), 0);
}

#[test]
fn the_right_certificate_for_another_name_is_refused() {
    let cert = cert(&["desk.local"]);
    let server = serve(&cert, None, false, Behaviour::Echo, 0);
    let (_connection, rx) = connect(&format!("wss://localhost:{}", server.port), &cert.pin);
    let events = until_close(&rx);
    assert_eq!(
        error_kind(&events).as_deref(),
        Some("host-mismatch"),
        "{events:?}"
    );
}

#[test]
fn a_certificate_for_an_address_does_not_name_a_host_name() {
    // An IP SAN names the address only. The same machine dialled by the name `localhost` is
    // another host as far as the rule goes, so it is refused.
    let cert = cert(&["127.0.0.1"]);
    let server = serve(&cert, None, false, Behaviour::Echo, 0);
    let (_connection, rx) = connect(&format!("wss://localhost:{}", server.port), &cert.pin);
    let events = until_close(&rx);
    assert_eq!(
        error_kind(&events).as_deref(),
        Some("host-mismatch"),
        "{events:?}"
    );
}

#[test]
fn a_copied_certificate_without_its_key_cannot_finish_the_handshake() {
    let cert = cert(&["127.0.0.1"]);
    let impostor = common::cert(&["127.0.0.1"]);
    // Presents the paired certificate but signs with a different key.
    let server = serve(&cert, Some(&impostor.key), false, Behaviour::Echo, 0);
    let (_connection, rx) = connect(&format!("wss://127.0.0.1:{}", server.port), &cert.pin);
    let events = until_close(&rx);
    assert_eq!(error_kind(&events).as_deref(), Some("tls"), "{events:?}");
    assert_eq!(server.upgrades.load(Ordering::SeqCst), 0);
}

#[test]
fn a_tls12_only_server_is_refused() {
    let cert = cert(&["127.0.0.1"]);
    let server = serve(&cert, None, true, Behaviour::Echo, 0);
    let (_connection, rx) = connect(&format!("wss://127.0.0.1:{}", server.port), &cert.pin);
    let events = until_close(&rx);
    assert_eq!(error_kind(&events).as_deref(), Some("tls"), "{events:?}");
    assert_eq!(server.handshakes.load(Ordering::SeqCst), 0);
}

#[test]
fn nothing_listening_is_unreachable() {
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let (_connection, rx) = connect(
        &format!("wss://127.0.0.1:{port}"),
        &cert(&["127.0.0.1"]).pin,
    );
    let events = until_close(&rx);
    assert_eq!(
        error_kind(&events).as_deref(),
        Some("unreachable"),
        "{events:?}"
    );
}

#[test]
fn a_server_that_vanishes_ends_the_connection_once() {
    let cert = cert(&["127.0.0.1"]);
    let server = serve(&cert, None, false, Behaviour::DropAfterOpen, 0);
    let (_connection, rx) = connect(&format!("wss://127.0.0.1:{}", server.port), &cert.pin);
    assert_eq!(next(&rx), Event::Open);
    let events = until_close(&rx);
    assert_eq!(events.len(), 2, "{events:?}");
    assert_eq!(error_kind(&events).as_deref(), Some("closed"));
    assert_eq!(events[1], Event::Close(1006, "closed".into()));
}

#[test]
fn a_server_that_closes_reports_its_code() {
    let cert = cert(&["127.0.0.1"]);
    let server = serve(&cert, None, false, Behaviour::CloseAfterOpen, 0);
    let (_connection, rx) = connect(&format!("wss://127.0.0.1:{}", server.port), &cert.pin);
    assert_eq!(next(&rx), Event::Open);
    assert_eq!(until_close(&rx), vec![Event::Close(4001, "bye".into())]);
}

#[test]
fn bad_input_is_refused_at_the_call() {
    let (tx, _rx) = std::sync::mpsc::channel();
    let listener = std::sync::Arc::new(Recorder(tx));
    assert!(we_phone_transport::Connection::connect(
        "ws://127.0.0.1:1".into(),
        cert(&["a"]).pin,
        listener.clone()
    )
    .is_err());
    assert!(we_phone_transport::Connection::connect(
        "wss://127.0.0.1:1".into(),
        "short".into(),
        listener
    )
    .is_err());
}

#[test]
fn many_round_trips_arrive_in_order() {
    let cert = cert(&["127.0.0.1"]);
    let server = serve(&cert, None, false, Behaviour::Echo, 0);
    let (connection, rx) = connect(&format!("wss://127.0.0.1:{}", server.port), &cert.pin);
    assert_eq!(next(&rx), Event::Open);
    let started = std::time::Instant::now();
    let mut times = Vec::new();
    for i in 0..200 {
        let t = std::time::Instant::now();
        connection.send(format!("{i}")).unwrap();
        assert_eq!(next(&rx), Event::Message(format!("{i}")));
        times.push(t.elapsed());
    }
    times.sort();
    eprintln!(
        "host loopback, 200 round trips: p50 {:?}, p95 {:?}, {:.0} msg/s",
        times[100],
        times[190],
        200.0 / started.elapsed().as_secs_f64()
    );
    connection.close();
    until_close(&rx);
}

#[test]
fn a_pinned_http_request_gets_its_response() {
    let cert = cert(&["127.0.0.1"]);
    let server = serve(&cert, None, false, Behaviour::Http, 0);
    let response = we_phone_transport::http_request(
        format!("https://127.0.0.1:{}/health?x=1", server.port),
        cert.pin.clone(),
        "get".into(),
        vec![],
        None,
    )
    .unwrap();
    assert_eq!(response.status, 200);
    assert_eq!(response.body, "GET /health?x=1 HTTP/1.1");
    assert!(response
        .headers
        .iter()
        .any(|h| h.name == "X-Test" && h.value == "yes"));
}

#[test]
fn a_pinned_http_request_to_a_wrong_pin_sends_nothing() {
    let cert = cert(&["127.0.0.1"]);
    let other = common::cert(&["127.0.0.1"]);
    let server = serve(&cert, None, false, Behaviour::Http, 0);
    let error = we_phone_transport::http_request(
        format!("https://127.0.0.1:{}/health", server.port),
        other.pin,
        "GET".into(),
        vec![],
        None,
    )
    .unwrap_err();
    assert!(error.to_string().starts_with("pin-mismatch:"), "{error}");
    assert!(
        we_phone_transport::http_request(
            format!("http://127.0.0.1:{}/health", server.port),
            cert.pin,
            "GET".into(),
            vec![],
            None
        )
        .is_err(),
        "cleartext is refused at the call"
    );
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(
        server.upgrades.load(Ordering::SeqCst),
        0,
        "no request reached the server"
    );
}
