//! `we-app/tests/data/tree-snapshot.json` is a valid snapshot input — the
//! loader accepts it unchanged, and the members its sidebar reads are marked
//! snapshot-served. Read-only: the fixture belongs to we-app's tree tests.
use std::collections::BTreeSet;

use we_data::OfflineData;
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{AppSpec, Bundle, LocalState, StaticHost};

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));
const SNAPSHOT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../we-app/tests/data/tree-snapshot.json"
));

#[test]
fn tree_snapshot_loads_and_marks_sidebar_members() {
    let bundle = Bundle::parse(BUNDLE).expect("bundle parses");
    let json: serde_json::Value = serde_json::from_str(SNAPSHOT).unwrap();
    let data = OfflineData::from_snapshot(&json, None).expect("tree snapshot loads");

    let locals = LocalState::new();
    let spec = AppSpec {
        app: bundle.app.as_ref().map(|t| t.node.clone()),
        template: bundle.templates.as_deref().and_then(|t| t.first()).cloned(),
        pages: bundle.pages.clone().unwrap_or_default(),
        boot: bundle.boot_screen.clone(),
    };
    let screen = ScreenState::desktop(ScreenSchema::default(), "/space/demo");
    let mut session = Session {
        runtime: we_template::Runtime::app(spec, data.bag.clone(), locals.clone()),
        host: StaticHost::new(data.bag.clone(), locals),
        screen,
    };
    session.resolve();

    let report = data.provenance.report();
    let snapshot_served: BTreeSet<&str> =
        report.snapshot_served.iter().map(String::as_str).collect();
    // The sidebar's space facts — present in the tree fixture, read on
    // `/space/demo`, recorded snapshot-served.
    for member in [
        "spaceStore.root",
        "spaceStore.currentSpace",
        "spaceStore.members",
        "spaceStore.taskStates",
        "spaceStore.involvementTypes",
        "spaceStore.policy",
        "workflowStore.workflows",
        "recordStore.creatableEntities",
        "templateStore.switcherGroups",
        "themeStore.builtInThemes",
        "sessionStore.bootState",
        "sessionStore.signInStep",
    ] {
        assert!(
            snapshot_served.contains(member),
            "{member} should be snapshot-served; got {snapshot_served:?}"
        );
    }
}
