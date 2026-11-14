//! C2a's real snapshot: `crates/renderer/fixtures/coasys/snapshot.json`,
//! resolved through `Session` on every route the space template serves.
//!
//! **`#[ignore]`** — the file does not exist yet. C2a is recording it now;
//! when it lands, remove the ignore. The test is a gate, not a smoke test:
//! it fails on `{}` (no route identifiers, no stores, no query rows) and on
//! a snapshot whose space claims a route the `queries` table has no rows
//! for. See `NOTES-e6.md` for what to check in the real format (any field
//! C2a added beyond `stores`/`queries`/`invokes` — a `routes` list here is
//! honoured as extra claimed routes).
use we_data::{OfflineData, StoreMap};
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{AppSpec, Bundle, LocalState, QueryState, StaticHost};

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));
const SNAPSHOT_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/coasys/snapshot.json"
);
const SEED_MAP: &str = include_str!("../data/storemap-offline.json");

/// The route identifier the snapshot claims: `stores.spaceStore.spacePath`,
/// or `/space/{root}` when only `root` was captured. `{}` fails here — it
/// names no space at all.
fn claimed_space_path(json: &serde_json::Value) -> String {
    let space = json
        .pointer("/stores/spaceStore")
        .expect("snapshot.stores.spaceStore — a space snapshot names the space it captured");
    space
        .get("spacePath")
        .and_then(|p| p.as_str())
        .map(str::to_string)
        .or_else(|| {
            space
                .get("root")
                .and_then(|r| r.as_str())
                .map(|r| format!("/space/{r}"))
        })
        .expect("spaceStore.spacePath or .root names the space's routes")
}

/// The routes the snapshot claims: every space-template route built on the
/// captured path, plus any explicit `routes` list C2a added. A `person`
/// route is included only when the snapshot carries a did to feed it.
fn claimed_routes(json: &serde_json::Value, space_path: &str) -> Vec<String> {
    let mut routes = vec![
        "/".to_string(),
        space_path.to_string(),
        format!("{space_path}/workflows"),
        format!("{space_path}/channels"),
        format!("{space_path}/calls"),
        format!("{space_path}/people"),
        format!("{space_path}/dna"),
    ];
    let did = json
        .pointer("/stores/spaceStore/members")
        .and_then(|m| m.as_array())
        .and_then(|m| m.first())
        .and_then(|m| m.get("did"))
        .and_then(|d| d.as_str())
        .or_else(|| {
            json.pointer("/stores/sessionStore/me/did")
                .and_then(|d| d.as_str())
        });
    if let Some(did) = did {
        routes.push(format!("{space_path}/person?did={did}"));
    }
    if let Some(extra) = json.get("routes").and_then(|r| r.as_array()) {
        routes.extend(extra.iter().filter_map(|r| r.as_str()).map(str::to_string));
    }
    routes
}

#[test]
#[ignore = "C2a's snapshot has not landed yet — run once it exists"]
fn real_snapshot_resolves_every_space_route() {
    let text = std::fs::read_to_string(SNAPSHOT_PATH).unwrap_or_else(|e| {
        panic!(
            "{SNAPSHOT_PATH} is absent ({e}) — C2a produces this file; the \
             test is #[ignore]d only while it is missing, so run it with \
             --ignored once the file exists"
        )
    });
    let json: serde_json::Value = serde_json::from_str(&text).expect("snapshot parses");
    let map = StoreMap::parse(SEED_MAP).expect("seed parses");
    let data = OfflineData::from_snapshot(&json, Some(&map)).expect("offline data builds");

    let space_path = claimed_space_path(&json);
    let routes = claimed_routes(&json, &space_path);

    // The space's claims must be backed by rows somewhere — a snapshot
    // whose queries are all absent or empty resolves fallback UI, not the
    // space it claims.
    let any_rows = json
        .get("queries")
        .and_then(|q| q.as_object())
        .map(|q| {
            q.values()
                .any(|v| v.as_array().is_some_and(|rows| !rows.is_empty()))
        })
        .unwrap_or(false);
    assert!(
        any_rows,
        "the snapshot claims {space_path} but no `queries` entry carries a row"
    );

    let bundle = Bundle::parse(BUNDLE).expect("bundle parses");
    for route in &routes {
        let locals = LocalState::new();
        let spec = AppSpec {
            app: bundle.app.as_ref().map(|t| t.node.clone()),
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
        let mut session = Session {
            runtime: we_template::Runtime::app(spec, data.bag.clone(), locals.clone()),
            host: StaticHost::new(data.bag.clone(), locals),
            screen,
        };
        session.resolve();
        data.provenance
            .absorb_dropped(std::mem::take(&mut session.host.dropped));
        let report = data.provenance.report();
        let answered = session
            .runtime
            .pool()
            .cells()
            .iter()
            .filter(|c| matches!(c.state(), QueryState::Rows(rows) if !rows.is_empty()))
            .count();
        assert!(
            !report.snapshot_served.is_empty() || answered > 0,
            "{route}: nothing snapshot-served and no query rows — a snapshot \
             that lacks this route's data resolves empty UI here"
        );
        data.provenance.reset();
    }
}
