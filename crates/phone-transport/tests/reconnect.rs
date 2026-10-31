//! The endpoint goes away and comes back: the connection ends once, a new one opens, and nothing is
//! left running. Its own test binary, so the process-wide counters see only these connections.

mod common;

use std::time::Duration;

use common::*;
use we_phone_transport::{live_connections, runtime_workers};

#[test]
fn reconnecting_after_the_endpoint_restarts_leaks_nothing() {
    let cert = cert(&["127.0.0.1"]);
    let mut server = serve(&cert, None, false, Behaviour::Echo, 0);
    let port = server.port;
    let url = format!("wss://127.0.0.1:{port}");

    for round in 0..5 {
        let (connection, rx) = connect(&url, &cert.pin);
        assert_eq!(next(&rx), Event::Open, "round {round}");
        connection.send("ping".into()).unwrap();
        assert_eq!(next(&rx), Event::Message("ping".into()));

        // The endpoint dies, with every socket it holds.
        server.kill();
        let events = until_close(&rx);
        assert_eq!(
            events,
            vec![
                Event::Error("closed".into(), events_message(&events)),
                Event::Close(1006, "closed".into())
            ],
            "round {round}"
        );
        assert!(connection.send("after".into()).is_err());

        // While it is down, a connection is unreachable rather than hanging.
        let (_down, rx_down) = connect(&url, &cert.pin);
        let down = until_close(&rx_down);
        assert!(
            matches!(&down[0], Event::Error(kind, _) if kind == "unreachable"),
            "{down:?}"
        );

        // It comes back on the same port, with the same certificate.
        server = serve(&cert, None, false, Behaviour::Echo, port);
    }

    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(live_connections(), 0, "every connection task has ended");
    assert_eq!(
        runtime_workers(),
        2,
        "one shared runtime, not one per connection"
    );
    // And the OS agrees: the only transport threads are the runtime's two workers (plus at most a
    // blocking-pool thread tokio keeps for DNS), however many connections came and went.
    #[cfg(target_os = "linux")]
    {
        let threads = transport_threads();
        assert!(
            (2..=3).contains(&threads),
            "{threads} transport threads after 10 connections"
        );
    }
}

/// Threads named by the crate's runtime. Linux truncates a thread name to 15 bytes.
#[cfg(target_os = "linux")]
fn transport_threads() -> usize {
    std::fs::read_dir("/proc/self/task")
        .unwrap()
        .filter_map(|t| std::fs::read_to_string(t.ok()?.path().join("comm")).ok())
        .filter(|name| name.starts_with("coasys-transpor"))
        .count()
}

fn events_message(events: &[Event]) -> String {
    match &events[0] {
        Event::Error(_, message) => message.clone(),
        _ => String::new(),
    }
}
