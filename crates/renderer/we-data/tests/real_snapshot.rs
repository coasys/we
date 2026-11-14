//! C2a's real snapshot: `crates/renderer/fixtures/coasys/snapshot.json`,
//! resolved through `Session` on every route the space template serves.
//!
//! **`#[ignore]`** — the file does not exist yet. C2a is recording it now;
//! when it lands, remove the ignore and this test pins that all eight routes
//! resolve without a panic. See `NOTES-e6.md` for what to check in the real
//! format (any field C2a added beyond `stores`/`queries`/`invokes`).
use we_data::OfflineData;
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{AppSpec, Bundle, LocalState, StaticHost};

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));
const SNAPSHOT_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/coasys/snapshot.json"
);

#[test]
#[ignore = "C2a's snapshot has not landed yet — see NOTES-e6.md"]
fn real_snapshot_resolves_every_space_route() {
    let text = std::fs::read_to_string(SNAPSHOT_PATH)
        .unwrap_or_else(|e| panic!("read {SNAPSHOT_PATH}: {e}"));
    let json: serde_json::Value = serde_json::from_str(&text).expect("snapshot parses");
    let data = OfflineData::from_snapshot(&json, None).expect("offline data builds");

    let bundle = Bundle::parse(BUNDLE).expect("bundle parses");
    for route in [
        "/",
        "/space/demo",
        "/space/demo/workflows",
        "/space/demo/channels",
        "/space/demo/calls",
        "/space/demo/people",
        "/space/demo/dna",
        "/space/demo/person?did=did:key:z6MkAda",
    ] {
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
        data.provenance.reset();
    }
}
