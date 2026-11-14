//! `/space/demo` resolved through `Session` on `coasys-mini.json`: the exact
//! sets of snapshot-served and native-served members, and `reset` clearing
//! both. The expected sets are written by hand from the bundle — each member
//! is checked against `bundles/coasys.bundle.json`, not copied from a run.
//!
//! `?card=call-1&cardType=CollectionBlock` ungates the inspector panel's
//! queries — the second test shows the signal/involvement host functions and
//! the store-map member natives firing there.
use std::collections::BTreeSet;

use we_data::{OfflineData, StoreMap};
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{AppSpec, Bundle, LocalState, ResolvedChild, ResolvedNode, StaticHost};

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));
const MINI: &str = include_str!("data/coasys-mini.json");
const MAP: &str = include_str!("../data/storemap-offline.json");

/// The bundle + mini fixture + seed map, resolved through a real Session.
fn session(route: &str) -> (Session, OfflineData) {
    let bundle = Bundle::parse(BUNDLE).expect("bundle parses");
    let json: serde_json::Value = serde_json::from_str(MINI).unwrap();
    let map = StoreMap::parse(MAP).expect("seed parses");
    let data = OfflineData::from_snapshot(&json, Some(&map)).expect("offline data builds");
    let locals = LocalState::new();
    let spec = AppSpec {
        app: bundle.app.clone(),
        template: bundle.templates.as_deref().and_then(|t| t.first()).cloned(),
        pages: bundle.pages.clone().unwrap_or_default(),
        boot: bundle.boot_screen.clone(),
    };
    let screen = ScreenState::desktop(
        ScreenSchema {
            pages: bundle
                .pages
                .as_deref()
                .unwrap_or_default()
                .iter()
                .map(|p| p.id.clone())
                .collect(),
            ..ScreenSchema::default()
        },
        route,
    );
    let session = Session {
        runtime: we_template::Runtime::app(spec, data.bag.clone(), locals.clone()),
        host: StaticHost::new(data.bag.clone(), locals),
        screen,
    };
    (session, data)
}

fn find_text(node: &ResolvedNode, out: &mut Vec<String>) {
    for child in &node.children {
        match child {
            ResolvedChild::Node(n) => find_text(n, out),
            ResolvedChild::Text(t) => out.push(t.to_string()),
        }
    }
}

/// The members `/space/demo` reads that the fixture ships — verified member
/// by member against `bundles/coasys.bundle.json`:
///
/// - `spaceStore.root` — `params.channel ? params.channel : spaceStore.root`
/// - `spaceStore.currentSpace` — the space name in the header
/// - `spaceStore.members`, `.involvementTypes`, `.orderedSidebarItems`,
///   `.landmarks` — the sidebar's sections
/// - `spaceStore.taskStates` — the board columns
/// - `spaceStore.policy` — the policy line
/// - `spaceStore.spaceDefaultThemeId`, `.spaceThemePinned`,
///   `.spaceDefaultTemplateId` — theme/template pickers
/// - `templateStore.currentSwitcherId` — the picker's `t.id ==` filters and
///   the row's `selected` condition
/// - `spaceStore.canAdministerCurrentSpace` — admin affordances
/// - `sessionStore.signInStep`/`.bootState` — `default_ready`'s gate
/// - `sessionStore.me` — `$me.did` through the `me` alias
/// - `profileStore.profiles` — `ownProfile`'s find, member avatars
/// - `recordStore.creatableEntities` — the create menu
/// - `workflowStore.workflows` — the workflows sidebar
/// - `templateStore.brand`, `.switcherGroups` — brand + template switcher
/// - `themeStore.builtInThemes`, `.currentThemeId` — the theme pickers
/// - `modules.call` — `modules.call.liveCalls` & co. read the `call` member
const SNAPSHOT_DEMO: &[&str] = &[
    "modules.call",
    "profileStore.profiles",
    "recordStore.creatableEntities",
    "sessionStore.bootState",
    "sessionStore.me",
    "sessionStore.signInStep",
    "spaceStore.currentSpace",
    "spaceStore.involvementTypes",
    "spaceStore.members",
    "spaceStore.orderedSidebarItems",
    "spaceStore.policy",
    "spaceStore.root",
    "spaceStore.spaceDefaultTemplateId",
    "spaceStore.spaceDefaultThemeId",
    "spaceStore.spaceThemePinned",
    "spaceStore.taskStates",
    "templateStore.brand",
    "templateStore.currentSwitcherId",
    "templateStore.switcherGroups",
    "themeStore.builtInThemes",
    "themeStore.currentThemeId",
    "workflowStore.workflows",
];

#[test]
fn space_demo_resolves_and_records() {
    let (mut session, data) = session("/space/demo");
    let root = session.resolve().clone();
    let mut texts = Vec::new();
    find_text(&root, &mut texts);
    // The space name landed on screen — the resolve really ran the bundle.
    assert!(
        texts.iter().any(|t| t.contains("Demo Space")),
        "space name should render; got {texts:?}"
    );

    // `$invoke` targets nothing answered are drained into dropped.
    data.provenance
        .absorb_dropped(std::mem::take(&mut session.host.dropped));

    let report = data.provenance.report();

    let snapshot_got: BTreeSet<&str> = report.snapshot_served.iter().map(String::as_str).collect();
    let native_got: BTreeSet<&str> = report.native_served.iter().map(String::as_str).collect();

    let expected: BTreeSet<&str> = SNAPSHOT_DEMO.iter().copied().collect();
    assert_eq!(
        snapshot_got, expected,
        "snapshot-served members on /space/demo"
    );

    // `agent.ownProfile` serves `profileStore.ownProfile` — the only member
    // native this route reads (the inspector's are gated behind `?card=`).
    assert_eq!(
        native_got,
        ["profileStore.ownProfile"].into_iter().collect(),
        "native-served members on /space/demo"
    );
}

/// The rail's template picker reads `switcherGroups[].items`, filtering the
/// Built-in group down to the default and the current template — TS builds
/// the groups as `{ label, items }` in `switcherGroups()`
/// (TemplateStore.tsx:759), and the picker's `$each` renders what survives
/// the filter (designChoices.ts:98).
#[test]
fn the_template_picker_renders_the_fixture_choices() {
    let (mut session, data) = session("/space/demo");
    let root = session.resolve().clone();
    let mut texts = Vec::new();
    find_text(&root, &mut texts);
    let joined = texts.join("\n");

    // SPACE_TEMPLATE_CHOICES: the default built-in, then the space's, then
    // the agent's. "Minimal" is filtered out — it is neither.
    for name in ["Starter", "Space Board", "My Own"] {
        assert!(
            joined.contains(name),
            "choice {name} should render; {joined:?}"
        );
    }
    assert!(
        !joined.contains("Minimal"),
        "a built-in that is neither default nor current is filtered out"
    );

    let report = data.provenance.report();
    let snapshot_got: BTreeSet<&str> = report.snapshot_served.iter().map(String::as_str).collect();
    // The row comparisons read both ids — they may only be missing if
    // `.items` never resolved.
    for member in [
        "spaceStore.spaceDefaultTemplateId",
        "templateStore.currentSwitcherId",
    ] {
        assert!(
            snapshot_got.contains(member),
            "{member} should be snapshot-served; got {snapshot_got:?}"
        );
    }
}

#[test]
fn inspector_route_fires_member_natives_and_host_functions() {
    let (mut session, data) = session("/space/demo?card=call-1&cardType=CollectionBlock");
    // The inspector's declaration is `open: false` — the shell opens it.
    session.screen.shell.open_template_panel("inspector");
    // The reactions section's `$localState` persists under
    // `we-local:inspector.reactionsSection` — open it so the signal rows
    // (and `spaceStore.mutedDids`) resolve.
    session.screen.prefs.set(
        "we-local:inspector.reactionsSection",
        Some(&serde_json::json!(true)),
    );
    session.resolve();
    data.provenance
        .absorb_dropped(std::mem::take(&mut session.host.dropped));
    let report = data.provenance.report();
    let native_got: BTreeSet<&str> = report.native_served.iter().map(String::as_str).collect();

    // The store-map member natives that the inspector's expressions read.
    for member in [
        "profileStore.ownProfile",
        "spaceStore.mutedDids",
        "spaceStore.offeredInvolvementTypes",
    ] {
        assert!(
            native_got.contains(member),
            "{member} should be native-served; got {native_got:?}"
        );
    }
    // The host functions the card's rows call — noted `name()` in the set.
    for call in [
        "involvement()",
        "involvementMenu()",
        "reactors()",
        "reactions()",
    ] {
        assert!(
            native_got.contains(call),
            "{call} should be in native-served; got {native_got:?}"
        );
    }
    // `mutedDids`/`offeredInvolvementTypes` read their inputs through the
    // recording namespace — `mutedAgents`/`involvementTypes` are snapshot.
    let snapshot_got: BTreeSet<&str> = report.snapshot_served.iter().map(String::as_str).collect();
    assert!(snapshot_got.contains("spaceStore.mutedAgents"));
    assert!(snapshot_got.contains("spaceStore.involvementTypes"));
    // `mutedDids` itself must NOT be in the snapshot set — the overlay
    // intercepted it before the snapshot answered.
    assert!(!snapshot_got.contains("spaceStore.mutedDids"));
}

#[test]
fn reset_clears_both_sets() {
    let (mut session, data) = session("/space/demo");
    session.resolve();
    let report = data.provenance.report();
    assert!(!report.snapshot_served.is_empty());
    data.provenance.reset();
    let report = data.provenance.report();
    assert!(report.snapshot_served.is_empty());
    assert!(report.native_served.is_empty());
    assert_eq!(report.dropped_calls, 0);
}
