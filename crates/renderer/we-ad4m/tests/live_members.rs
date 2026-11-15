//! The store map's live rows against a real executor (`EXECUTOR_PATH`;
//! skipped without it): a member with a row reads the executor, starting
//! from the TS store's empty value rather than the snapshot's, and the
//! provenance says it was served live.
use we_ad4m::testkit as common;

use std::time::{Duration, Instant};

use serde_json::json;
use we_ad4m::live::{LiveMap, LiveMembers};
use we_ad4m::SpaceBinding;
use we_data::OfflineData;

const SNAPSHOT: &str = include_str!("../../fixtures/coasys/snapshot.json");

fn wait_until(what: &str, limit: Duration, mut ok: impl FnMut() -> bool) {
    let start = Instant::now();
    while !ok() {
        assert!(start.elapsed() < limit, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn live_rows_replace_the_snapshot_for_their_members() {
    let Some(executor) = common::start_executor() else {
        return;
    };
    let rt = we_ad4m::Runtime::new().unwrap();
    let conn = common::connect(&rt, &executor.url);
    let uuid = common::seed_space(&rt, &conn, "e7-members");
    common::add_class(&rt, &conn, &uuid, "Space", common::SPACE_SDNA);
    let me = rt.block_on(conn.client().agent.me()).unwrap().did;

    let truth: serde_json::Value = serde_json::from_str(SNAPSHOT).unwrap();
    let map = LiveMap::bundled();
    let data = OfflineData::from_snapshot(&truth, Some(&map.derived)).unwrap();
    // The snapshot's root, for contrast: the live member must never show it.
    let snapshot_root = data.member("spaceStore", "root").to_json();
    let snapshot_members = data.member("spaceStore", "members").to_json();
    assert!(snapshot_members.as_array().is_some_and(|m| !m.is_empty()));
    // Those were the test's reads; from here on, only the live layer's count.
    data.provenance.reset();

    let _live = LiveMembers::install(
        &data.bag,
        &data.provenance,
        &map,
        &conn,
        &SpaceBinding::new(&uuid),
        None,
    );
    // Before any answer: the TS store's empty value, not the snapshot's.
    assert_eq!(data.member("spaceStore", "root").to_json(), json!(""));
    assert_ne!(snapshot_root, json!(""));

    wait_until("me.did", Duration::from_secs(10), || {
        data.member("me", "did").to_json() == json!(me)
    });
    wait_until("landmarksLoaded", Duration::from_secs(10), || {
        data.member("spaceStore", "landmarksLoaded").to_json() == json!(true)
    });

    // The space's own record appears: root follows it, live.
    common::add_links(
        &rt,
        &conn,
        &uuid,
        "e7test://space",
        &[
            ("we://uuid", common::literal(&uuid)),
            ("we://root", "e7test://collection".to_string()),
        ],
    );
    wait_until("spaceStore.root", Duration::from_secs(5), || {
        data.member("spaceStore", "root").to_json() == json!("e7test://collection")
    });
    assert_eq!(
        data.member("spaceStore", "currentSpace").to_json()["uuid"],
        json!(uuid)
    );

    // A member with no live row still comes from the snapshot.
    assert_eq!(
        data.member("spaceStore", "members").to_json(),
        snapshot_members
    );
    let report = data.provenance.report();
    for member in [
        "spaceStore.root",
        "spaceStore.currentSpace",
        "sessionStore.me",
    ] {
        assert!(
            report.live_served.iter().any(|m| m == member),
            "{member} not live: {report}"
        );
    }
    assert!(report
        .snapshot_served
        .iter()
        .any(|m| m == "spaceStore.members"));
    assert!(!report
        .snapshot_served
        .iter()
        .any(|m| m == "spaceStore.root"));
}
