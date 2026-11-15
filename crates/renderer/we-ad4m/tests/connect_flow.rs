//! The connect screen's flow against real executors (`EXECUTOR_PATH`;
//! skipped without it): not found, a capability request the operator
//! approves, and the stored token reused without asking again.
use we_ad4m::testkit as common;

use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::json;
use we_ad4m::connect::{Ask, ConnectFlow, ConnectPhase, ConnectSettings};

/// A flow with its own token directory and no launcher port file.
fn flow(
    rt: &we_ad4m::Runtime,
    url: &str,
    tokens: &std::path::Path,
) -> (ConnectFlow, mpsc::Receiver<()>) {
    let (tx, rx) = mpsc::channel();
    let settings = ConnectSettings {
        url: Some(url.to_string()),
        token_dir: Some(tokens.to_path_buf()),
        port_file: Some(tokens.join("no-port-file")),
        ..ConnectSettings::default()
    };
    let flow = ConnectFlow::start(&rt.handle(), settings, move || {
        let _ = tx.send(());
    });
    (flow, rx)
}

/// Wait (on the flow's wakes) for a phase `pick` accepts; every phase seen
/// on the way is returned too.
fn wait<T>(
    flow: &ConnectFlow,
    wake: &mpsc::Receiver<()>,
    limit: Duration,
    mut pick: impl FnMut(&ConnectPhase) -> Option<T>,
) -> (T, Vec<ConnectPhase>) {
    let start = Instant::now();
    let mut seen = Vec::new();
    loop {
        let phase = flow.phase();
        if seen.last() != Some(&phase) {
            seen.push(phase.clone());
        }
        if let Some(t) = pick(&phase) {
            return (t, seen);
        }
        let left = limit.saturating_sub(start.elapsed());
        assert!(!left.is_zero(), "timed out; phases seen: {seen:?}");
        let _ = wake.recv_timeout(left.min(Duration::from_millis(200)));
    }
}

#[test]
fn no_executor_is_a_failure_with_a_reason() {
    if common::require_binary().is_none() {
        return;
    }
    // `ad4m-connect` falls back to the default port after an explicit URL
    // fails; an executor listening there is not ours to touch.
    if std::net::TcpStream::connect(("127.0.0.1", 12000)).is_ok() {
        eprintln!("SKIP: something listens on 127.0.0.1:12000");
        return;
    }
    let rt = we_ad4m::Runtime::new().unwrap();
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let tokens = tempfile::tempdir().unwrap();
    let (flow, wake) = flow(&rt, &format!("http://127.0.0.1:{port}"), tokens.path());
    let (reason, _) = wait(&flow, &wake, Duration::from_secs(30), |p| match p {
        ConnectPhase::Failed { reason } => Some(reason.clone()),
        _ => None,
    });
    assert!(reason.contains("No AD4M executor found"), "{reason}");
}

#[test]
fn capability_request_then_the_stored_token_needs_no_approval() {
    let Some(executor) = common::start_executor_with_admin("e7-admin") else {
        return;
    };
    let rt = we_ad4m::Runtime::new().unwrap();
    let admin = common::connect_as(&rt, &executor.url, "e7-admin");
    rt.block_on(admin.client().agent.generate("passphrase".into()))
        .unwrap();
    let tokens = tempfile::tempdir().unwrap();

    // First run: the request waits for the user.
    let (first, wake) = flow(&rt, &executor.url, tokens.path());
    let (request_id, _) = wait(&first, &wake, Duration::from_secs(60), |p| match p {
        ConnectPhase::Asking {
            ask: Ask::CapabilityCode { request_id },
            ..
        } => Some(request_id.clone()),
        ConnectPhase::Failed { reason } => panic!("connect failed: {reason}"),
        _ => None,
    });
    // The launcher's consent screen: approving mints the code.
    let app = we_ad4m::connect::app_info();
    let auth = json!({
        "requestId": request_id,
        "auth": { "appName": app.name, "appDesc": app.description, "capabilities": app.capabilities },
    })
    .to_string();
    let code: String = rt
        .block_on(
            admin
                .ws()
                .call("agent.permitCapability", json!({ "auth": auth })),
        )
        .unwrap();
    first.answer(code);
    wait(&first, &wake, Duration::from_secs(60), |p| match p {
        ConnectPhase::Connected { .. } => Some(()),
        ConnectPhase::Failed { reason } => panic!("connect failed: {reason}"),
        _ => None,
    });
    let conn = first
        .take_connection()
        .expect("a connection once connected");
    let spaces = rt.block_on(we_ad4m::list_spaces(&conn)).unwrap();
    assert!(spaces.iter().all(|s| !s.uuid.is_empty()));

    // What the app reads works under the grant (Lal F1)…
    let uuid = common::seed_space_as(&rt, &admin, "e7-grant");
    common::create_post(&rt, &admin, &uuid, "readable");
    let model = ad4m_client::model::Model::new(conn.ws(), uuid.clone(), "CollectionBlock");
    let rows = rt.block_on(model.query(&Default::default())).unwrap();
    assert_eq!(rows.instances.len(), 1);
    let mut sub = rt.block_on(model.subscribe(&Default::default())).unwrap();
    assert!(rt.block_on(sub.next()).is_some());
    rt.block_on(sub.dispose());
    rt.block_on(conn.client().agent.me()).unwrap();
    // …and nothing it does not: a write, an administrative read, a join.
    let refused = |what: &str, r: anyhow::Result<serde_json::Value>| {
        let e = r.expect_err(&format!(
            "{what} should be refused under the read-only grant"
        ));
        eprintln!("{what} refused: {e:#}");
    };
    refused(
        "perspective.create",
        rt.block_on(
            conn.ws()
                .call("perspective.create", json!({ "name": "nope" })),
        ),
    );
    refused(
        "perspective.addLink",
        rt.block_on(conn.ws().call(
            "perspective.addLink",
            json!({ "uuid": uuid, "link": { "source": "a://b", "predicate": "a://p", "target": "a://c" } }),
        )),
    );
    refused(
        "neighbourhood.join",
        rt.block_on(conn.ws().call(
            "neighbourhood.join",
            json!({ "url": "neighbourhood://nope" }),
        )),
    );
    // agent READ also reads the agent's grants (`agent.getApps`, without
    // tokens). That is how the executor shows what this app was granted:
    // exactly the two READ capabilities it asked for.
    let apps: serde_json::Value = rt
        .block_on(conn.ws().call("agent.getApps", json!({})))
        .unwrap();
    let ours: Vec<&serde_json::Value> = apps
        .as_array()
        .unwrap()
        .iter()
        .filter(|a| a["auth"]["appName"] == json!(app.name))
        .collect();
    assert_eq!(ours.len(), 1);
    assert_eq!(
        ours[0]["auth"]["capabilities"],
        json!([
            { "with": { "domain": "agent", "pointers": ["*"] }, "can": ["READ"] },
            { "with": { "domain": "perspective", "pointers": ["*"] }, "can": ["READ"] }
        ])
    );

    // Second run: the stored token holds; nothing is asked.
    let (second, wake) = flow(&rt, &executor.url, tokens.path());
    let (_, seen) = wait(&second, &wake, Duration::from_secs(60), |p| match p {
        ConnectPhase::Connected { .. } => Some(()),
        ConnectPhase::Failed { reason } => panic!("reconnect failed: {reason}"),
        _ => None,
    });
    assert!(
        !seen
            .iter()
            .any(|p| matches!(p, ConnectPhase::Asking { .. })),
        "the stored token should connect without asking: {seen:?}"
    );
}

/// A token stored by an earlier build was granted `*` on `*` (Lal F1). It
/// still works, so `ad4m-connect` would reuse it silently; the flow drops
/// it and asks for the read-only grant instead.
#[test]
fn a_cached_broad_grant_is_asked_for_again() {
    let Some(executor) = common::start_executor_with_admin("e7-admin") else {
        return;
    };
    let rt = we_ad4m::Runtime::new().unwrap();
    let admin = common::connect_as(&rt, &executor.url, "e7-admin");
    rt.block_on(admin.client().agent.generate("passphrase".into()))
        .unwrap();
    let tokens = tempfile::tempdir().unwrap();
    let app = we_ad4m::connect::app_info();
    let broad = common::mint_token(
        &rt,
        &executor.url,
        &admin,
        &app.name,
        json!([
            { "with": { "domain": "*", "pointers": ["*"] }, "can": ["*"] }
        ]),
    );
    ad4m_client::connect::TokenStore::new(tokens.path())
        .set_token(
            &ad4m_client::connect::normalize_base_url(&executor.url),
            &app.name,
            &broad,
        )
        .unwrap();

    let (flow, wake) = flow(&rt, &executor.url, tokens.path());
    let (asked, seen) = wait(&flow, &wake, Duration::from_secs(60), |p| match p {
        ConnectPhase::Asking {
            ask: Ask::CapabilityCode { .. },
            ..
        } => Some(true),
        ConnectPhase::Connected { .. } => Some(false),
        ConnectPhase::Failed { reason } => panic!("connect failed: {reason}"),
        _ => None,
    });
    assert!(
        asked,
        "the broad cached token was reused without asking: {seen:?}"
    );
}
