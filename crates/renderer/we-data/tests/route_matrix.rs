//! The interim route matrix — the routes a live client exercises, resolved
//! against the corrected mini fixture. Each row asserts three things
//! independently of the Rust output: recognizable content (names the
//! fixture itself carries), which queries loaded (`QueryState::Rows`) —
//! including the answered-with-nothing list and the declared-but-unanswered
//! one — and where the reads came from (`snapshot_served`/`native_served`,
//! enumerated here from the bundle's expressions, not copied from a run).
//!
//! `linked` is the dependent query: it is declared inside the inspector's
//! per-field nodes under `$each local.card`, gated `when: row[field.name]`,
//! so its cell exists only after `card` rows arrive — the case the matrix
//! keeps honest on both sides.
use indexmap::IndexMap;
use std::collections::BTreeSet;

use we_data::{OfflineData, StoreMap};
use we_expr::Value;
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{AppSpec, Bundle, LocalState, ResolvedChild, ResolvedNode, SlotView, StaticHost};

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));
const MINI: &str = include_str!("data/coasys-mini.json");
const MAP: &str = include_str!("../data/storemap-offline.json");

/// The bundle + mini fixture + seed map, resolved through a real Session —
/// the same wiring `provenance.rs` uses.
fn session(route: &str) -> (Session, OfflineData) {
    let bundle = Bundle::parse(BUNDLE).expect("bundle parses");
    let json: serde_json::Value = serde_json::from_str(MINI).unwrap();
    let map = StoreMap::parse(MAP).expect("seed parses");
    let data = OfflineData::from_snapshot(&json, Some(&map)).expect("offline data builds");
    let locals = LocalState::new();
    let spec = AppSpec {
        bundle: bundle.name.clone().into(),
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
        host: Box::new(StaticHost::new(data.bag.clone())),
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

fn text_on(route: &str) -> (String, Session, OfflineData) {
    let (mut session, data) = session(route);
    let root = session.resolve().clone();
    let mut texts = Vec::new();
    find_text(&root, &mut texts);
    (texts.join("\n"), session, data)
}

/// The `name` field of each row, for rows that are objects carrying one.
fn row_names(rows: &[Value]) -> Vec<&str> {
    rows.iter()
        .filter_map(|r| match r {
            Value::Obj(o) => match o.get("name") {
                Some(Value::Str(s)) => Some(s.as_ref()),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

/// `name → cell view` for every held claim the resolve made — the hub's own
/// record of which `$queries` ran and how they were answered. Two cells
/// answering to one local name (two declarations asking different questions)
/// must agree: a name is not an identity, so one cell must not stand in for
/// the other and hide a mismatch.
fn cells(session: &Session) -> IndexMap<String, SlotView> {
    let mut by_name: IndexMap<String, (String, SlotView)> = IndexMap::new();
    for cell in session.runtime.hub().cells() {
        let Some(name) = cell.request.name_hint.clone() else {
            continue;
        };
        let view = cell.view;
        match by_name.get(name.as_ref()) {
            Some((key, held)) => assert_eq!(
                view_json(held),
                view_json(&view),
                "query {name}: two cells disagree — {key} vs {}",
                cell.key.as_str()
            ),
            None => {
                by_name.insert(name.to_string(), (cell.key.as_str().to_string(), view));
            }
        }
    }
    by_name.into_iter().map(|(n, (_, s))| (n, s)).collect()
}

/// A cell view as comparable JSON — `null` while loading.
fn view_json(view: &SlotView) -> serde_json::Value {
    if view.loaded {
        view.rows.iter().map(Value::to_json).collect()
    } else {
        serde_json::Value::Null
    }
}

/// The loaded rows of the named query — panics naming the query when it
/// never loaded.
fn rows<'a>(cells: &'a IndexMap<String, SlotView>, name: &str) -> &'a [Value] {
    match cells.get(name) {
        Some(view) if view.loaded => &view.rows,
        other => panic!("query {name}: expected loaded rows, got {other:?}"),
    }
}

fn native_served(data: &OfflineData) -> BTreeSet<String> {
    data.provenance.report().native_served.into_iter().collect()
}

fn snapshot_served(data: &OfflineData) -> BTreeSet<String> {
    data.provenance
        .report()
        .snapshot_served
        .into_iter()
        .collect()
}

// ── the routes ──────────────────────────────────────────────────────────────

/// `/` — the landing: spaces chrome reads profiles, the sidebar's sections
/// and the brand, through the `me` alias and the stores themselves.
#[test]
fn landing_serves_the_spaces_chrome() {
    let (text, _session, data) = text_on("/");
    assert!(
        text.contains("Demo Space") || !snapshot_served(&data).is_empty(),
        "landing resolves with snapshot data"
    );
    for member in [
        "profileStore.profiles",
        "spaceStore.orderedSidebarItems",
        "templateStore.brand",
    ] {
        assert!(snapshot_served(&data).contains(member), "{member} on /");
    }
    assert_eq!(
        native_served(&data),
        ["profileStore.ownProfile"]
            .into_iter()
            .map(str::to_string)
            .collect()
    );
}

/// `/space/demo` — every declared query the fixture answers loads rows;
/// `channelRecord` never compiles a cell because the space root is not a
/// channel (`when` gates it out — the gated case, distinct from an absent
/// answer). The rail's template picker renders the switcher choices.
#[test]
fn space_demo_loads_the_populated_queries() {
    let (text, session, _data) = text_on("/space/demo");
    assert!(text.contains("Demo Space"));
    // The rail picker — built-in default, then space, then mine; the
    // unselected built-in is filtered out.
    for choice in ["Starter", "Space Board", "My Own"] {
        assert!(text.contains(choice), "picker should list {choice}");
    }
    assert!(!text.contains("Minimal"));

    let cells = cells(&session);
    assert_eq!(rows(&cells, "anyCall").len(), 1, "anyCall populates");
    assert_eq!(rows(&cells, "calls").len(), 2);
    assert_eq!(rows(&cells, "signalTypes").len(), 2);
    assert_eq!(rows(&cells, "topics").len(), 1);
    assert_eq!(rows(&cells, "relationshipTypes").len(), 1);
    // `when: (params.channel || root) != root` — gated, not unanswered.
    assert!(
        !cells.contains_key("channelRecord"),
        "the space root is not a channel — channelRecord gates out"
    );
}

/// `/space/demo/channels` — `subChannels` is declared and compiles, but the
/// snapshot has no answer for it: `Loading` is the honest empty state.
#[test]
fn channels_leaves_the_unanswered_query_loading() {
    let (_text, session, _data) = text_on("/space/demo/channels");
    let cells = cells(&session);
    assert!(
        cells.get("subChannels").is_some_and(|v| !v.loaded),
        "subChannels is declared but the snapshot lacks it: {cells:?}"
    );
    // The queries the fixture does answer still load beside it.
    assert_eq!(rows(&cells, "signalTypes").len(), 2);
}

/// `/space/demo/calls` — the calls view loads the populated query; the
/// view itself renders counts and badges rather than names, so the rows
/// carry the recognizable content.
#[test]
fn calls_lists_the_fixture_rows() {
    let (text, session, _data) = text_on("/space/demo/calls");
    assert!(text.contains("Calls"));
    let cells = cells(&session);
    let calls = rows(&cells, "calls");
    assert_eq!(calls.len(), 2);
    assert_eq!(row_names(calls), vec!["Daily sync", "Design review"]);
}

/// `/space/demo/dna` — the SDNA sections: signal types, relationship types
/// and topics, all populated.
#[test]
fn dna_lists_the_types() {
    let (text, session, _data) = text_on("/space/demo/dna");
    let cells = cells(&session);
    assert_eq!(rows(&cells, "signalTypes").len(), 2);
    assert_eq!(rows(&cells, "relationshipTypes").len(), 1);
    assert_eq!(rows(&cells, "topics").len(), 1);
    for name in ["Like", "Pin", "Reply", "General"] {
        assert!(text.contains(name), "dna should show {name}");
    }
}

/// `/space/demo/workflows` — the workflows list reads the snapshot's
/// `workflowStore.workflows`, while the store-map's `derived` `expr` row
/// serves `workflowStore.canEdit` natively beside it.
#[test]
fn workflows_uses_the_expr_overlay() {
    let (text, _session, data) = text_on("/space/demo/workflows");
    assert!(text.contains("Workflows"));
    // The snapshot's workflows are the recognizable content — the view
    // renders their record counts.
    let workflows = data.member("workflowStore", "workflows");
    let Value::List(rows) = &workflows else {
        panic!("workflows should be a list, got {workflows:?}")
    };
    assert_eq!(row_names(rows), vec!["standup", "retro"]);
    let native = native_served(&data);
    assert!(
        native.contains("workflowStore.canEdit"),
        "canEdit is the seed's expr row: {native:?}"
    );
    assert!(
        snapshot_served(&data).contains("workflowStore.workflows"),
        "workflows stays snapshot"
    );
}

/// The inspector opened on a card: the populated queries load, the answered
/// `connections` loads *empty* (a successful nothing, not `Loading`), the
/// dependent `linked` cell appears only because `card` produced a row, and
/// the member natives + host functions all report.
#[test]
fn the_inspector_loads_populated_empty_and_dependent_queries() {
    let route = "/space/demo?card=call-1&cardType=CollectionBlock";

    // Closed, the panel never resolves — none of its cells exist, so the
    // dependent query cannot appear either.
    {
        let (mut session, _data) = session(route);
        session.resolve();
        let cells = cells(&session);
        for name in ["card", "connections", "involvements", "linked"] {
            assert!(
                !cells.contains_key(name),
                "inspector closed: {name} should have no cell"
            );
        }
    }

    let (mut session, data) = session(route);
    session.screen.shell.open_template_panel("inspector");
    session.screen.prefs.set(
        "we-local:inspector.reactionsSection",
        Some(&serde_json::json!(true)),
    );
    let root = session.resolve().clone();
    let mut texts = Vec::new();
    find_text(&root, &mut texts);
    let text = texts.join("\n");

    let cells = cells(&session);
    // Populated.
    assert_eq!(rows(&cells, "card").len(), 1, "the card loads");
    assert_eq!(rows(&cells, "involvements").len(), 2);
    // Answered with nothing — `Rows([])`, not `Loading`.
    assert_eq!(
        rows(&cells, "connections").len(),
        0,
        "connections answered with an empty list"
    );
    // The dependent query — its cell exists only inside the card rows'
    // field iteration, so it could not exist while `card` was unanswered.
    assert_eq!(
        rows(&cells, "linked").len(),
        1,
        "linked appears only after the card rows arrive"
    );

    assert!(text.contains("Daily sync"), "the inspector shows the card");

    let native = native_served(&data);
    for member in [
        "profileStore.ownProfile",
        "spaceStore.mutedDids",
        "spaceStore.offeredInvolvementTypes",
    ] {
        assert!(native.contains(member), "{member} should be native-served");
    }
    // All nine host functions the card's expressions can reach — the three
    // that stayed silent here (generatedRun, voices, voicesParam) take no
    // part in this route; the rest must all report.
    for f in [
        "involvement()",
        "involvementMenu()",
        "reactions()",
        "reactors()",
        "signalTally()",
        "signalTypesByUse()",
    ] {
        assert!(native.contains(f), "{f} should report; got {native:?}");
    }
    // The inputs the member natives read stay snapshot-served.
    let snapshot = snapshot_served(&data);
    for member in [
        "spaceStore.mutedAgents",
        "spaceStore.involvementTypes",
        "recordStore.displays",
    ] {
        assert!(
            snapshot.contains(member),
            "{member} should be snapshot-served"
        );
    }
}
