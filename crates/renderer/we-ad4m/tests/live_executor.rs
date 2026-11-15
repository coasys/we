//! E7 acceptance, against a real executor (`EXECUTOR_PATH`; skipped
//! without it): a session whose `$queries` read through
//! [`Ad4mQuerySource`] shows a record created by another client within 2 s,
//! and keeps doing so after the socket drops and the subscription re-opens.
use we_ad4m::testkit as common;

use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use we_ad4m::{Ad4mQuerySource, SpaceBinding};
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{LocalState, NoParts, Runtime, SchemaNode, StaticHost, StoreBag};

/// The posts list a space template draws: one hoisted, subscribed query.
fn posts_schema() -> SchemaNode {
    serde_json::from_value(serde_json::json!({
        "type": "Column",
        "$queries": { "posts": {
            "entity": "CollectionBlock",
            "where": { "kind": "post" },
            "order": { "createdAt": "asc" },
            "limit": 50
        } },
        "children": [{
            "type": "$each",
            "props": { "items": { "$": "local.posts" }, "as": "post" },
            "children": [{ "type": "we-text", "children": [{ "$": "post.title" }] }]
        }]
    }))
    .unwrap()
}

/// A session over the live source, woken through `wake`.
fn session(source: Arc<Ad4mQuerySource>) -> (Session, mpsc::Receiver<()>) {
    let bag = Arc::new(StoreBag::new());
    let runtime = Runtime::new(posts_schema(), "live", bag.clone(), LocalState::new())
        .with_sources(Some(source), Arc::new(NoParts));
    let screen = ScreenState::desktop(ScreenSchema::default(), "/");
    let mut session = Session::from_parts(runtime, Box::new(StaticHost::new(bag)), screen);
    let (tx, rx) = mpsc::channel();
    session.set_waker(Arc::new(move || {
        let _ = tx.send(());
    }));
    (session, rx)
}

fn tree_text(session: &mut Session) -> String {
    we_template::normal_form(&session.resolve()).to_string()
}

/// Resolve on every wake until `title` is in the tree; how long it took.
/// Only the session's waker moves this loop on: no wake, no resolve.
fn wait_for(
    session: &mut Session,
    wake: &mpsc::Receiver<()>,
    title: &str,
    limit: Duration,
) -> Duration {
    let start = Instant::now();
    loop {
        if tree_text(session).contains(title) {
            return start.elapsed();
        }
        let left = limit.saturating_sub(start.elapsed());
        assert!(
            !left.is_zero(),
            "{title:?} did not reach the tree in {limit:?}"
        );
        let _ = wake.recv_timeout(left);
    }
}

#[test]
fn live_record_reaches_the_tree_and_survives_a_reconnect() {
    let Some(executor) = common::start_executor() else {
        return;
    };
    let rt = we_ad4m::Runtime::new().unwrap();
    let conn = common::connect(&rt, &executor.url);
    let uuid = common::seed_space(&rt, &conn, "e7-live");
    common::create_post(&rt, &conn, &uuid, "already here");

    // The reader: its own socket, as the app has.
    let reader = common::connect(&rt, &executor.url);
    let source = Arc::new(Ad4mQuerySource::new(
        reader.clone(),
        SpaceBinding::new(&uuid),
    ));
    let stats = source.stats();
    let (mut session, wake) = session(source);
    wait_for(&mut session, &wake, "already here", Duration::from_secs(30));
    assert_eq!(stats.open.load(std::sync::atomic::Ordering::Relaxed), 1);

    // Created by the other client: in the tree within 2 s.
    common::create_post(&rt, &conn, &uuid, "fresh from elsewhere");
    let took = wait_for(
        &mut session,
        &wake,
        "fresh from elsewhere",
        Duration::from_secs(2),
    );
    eprintln!("live record reached the tree in {took:?}");

    // Drop the reader's socket. The client reconnects and re-opens the
    // subscription; the next record still arrives.
    let reconnects = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let counter = reconnects.clone();
    rt.block_on(reader.ws().on_reconnect(move || {
        counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }));
    rt.block_on(reader.ws().disconnect_for_testing());
    let deadline = Instant::now() + Duration::from_secs(60);
    while reconnects.load(std::sync::atomic::Ordering::Relaxed) == 0 || !reader.is_connected() {
        assert!(Instant::now() < deadline, "reader did not reconnect");
        std::thread::sleep(Duration::from_millis(50));
    }
    common::create_post(&rt, &conn, &uuid, "after the drop");
    let took = wait_for(
        &mut session,
        &wake,
        "after the drop",
        Duration::from_secs(10),
    );
    eprintln!("post-reconnect record reached the tree in {took:?}");
    let text = tree_text(&mut session);
    for title in ["already here", "fresh from elsewhere", "after the drop"] {
        assert!(text.contains(title), "{title:?} missing after reconnect");
    }
}
