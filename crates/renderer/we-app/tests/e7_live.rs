//! E7 acceptance for the app (`EXECUTOR_PATH`; skipped without it): the
//! Coasys app opened on a live space shows a call created by another
//! client within 2 s, and the next one after its socket drops and its
//! subscriptions re-open. Store members with a live row read the
//! executor; the rest still come from the snapshot, and provenance says
//! which.
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use we_ad4m::testkit as kit;
use we_ad4m::SpaceRow;
use we_app::live::{live_space_app, LiveSpace};

const BUNDLE: &str = include_str!("../../../../bundles/coasys.bundle.json");

fn tree_text(live: &mut LiveSpace) -> String {
    we_template::normal_form(&live.app.session.resolve()).to_string()
}

/// Resolve on each wake until `want` is in the tree; how long it took.
fn wait_for(
    live: &mut LiveSpace,
    wake: &mpsc::Receiver<()>,
    want: &str,
    limit: Duration,
) -> Duration {
    let start = Instant::now();
    loop {
        if tree_text(live).contains(want) {
            return start.elapsed();
        }
        let left = limit.saturating_sub(start.elapsed());
        assert!(!left.is_zero(), "{want:?} not in the tree after {limit:?}");
        let _ = wake.recv_timeout(left);
    }
}

#[test]
fn coasys_app_renders_a_live_space() {
    let Some(executor) = kit::start_executor() else {
        return;
    };
    let rt = we_ad4m::Runtime::new().unwrap();
    let writer = kit::connect(&rt, &executor.url);
    let uuid = kit::seed_space(&rt, &writer, "e7-app");

    // The app's own socket, as `--connect` has.
    let reader = kit::connect(&rt, &executor.url);
    let bundle = we_template::Bundle::parse(BUNDLE).unwrap();
    let space = SpaceRow {
        uuid: uuid.clone(),
        name: "e7-app".into(),
        shared_url: None,
    };
    let (mut live, _) = live_space_app(&bundle, &reader, space, "dark").unwrap();
    let (tx, wake) = mpsc::channel();
    live.app.session.set_waker(Arc::new(move || {
        let _ = tx.send(());
    }));

    // An empty space: the template's own empty state, from live (empty)
    // answers — not the recording's calls.
    wait_for(
        &mut live,
        &wake,
        "A space starts with ",
        Duration::from_secs(30),
    );
    assert!(
        !tree_text(&mut live).contains("Weekly sync"),
        "a recorded call leaked in"
    );

    kit::create_collection(&rt, &writer, &uuid, "call", "Live call one");
    let took = wait_for(&mut live, &wake, "Live call one", Duration::from_secs(2));
    eprintln!("a call created elsewhere reached the app's tree in {took:?}");

    let reconnects = Arc::new(AtomicU64::new(0));
    let counter = reconnects.clone();
    rt.block_on(reader.ws().on_reconnect(move || {
        counter.fetch_add(1, Ordering::Relaxed);
    }));
    rt.block_on(reader.ws().disconnect_for_testing());
    let deadline = Instant::now() + Duration::from_secs(60);
    while reconnects.load(Ordering::Relaxed) == 0 || !reader.is_connected() {
        assert!(
            Instant::now() < deadline,
            "the app's socket did not reconnect"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
    kit::create_collection(&rt, &writer, &uuid, "call", "Live call two");
    let took = wait_for(&mut live, &wake, "Live call two", Duration::from_secs(10));
    eprintln!("after a reconnect, the next call reached the tree in {took:?}");

    let report = live.provenance.report();
    eprintln!("{report}");
    assert!(report.live_served.iter().any(|m| m == "sessionStore.me"));
    assert!(report
        .live_served
        .iter()
        .any(|m| m == "spaceStore.taskStates"));
    // The rest is still the recording — and the report says so.
    assert!(report
        .snapshot_served
        .iter()
        .any(|m| m == "spaceStore.members"));
    assert!(live.source.deliveries.load(Ordering::Relaxed) > 0);
}
