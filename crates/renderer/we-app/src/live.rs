//! The Coasys app against a live executor (E7): the same app root
//! `coasys_app` renders from a recording, with the template's `$queries`
//! answered by [`we_ad4m::Ad4mQuerySource`] and the store map's live rows
//! served by [`we_ad4m::live::LiveMembers`]. Every other store member still
//! comes from the recorded snapshot, and [`LiveSpace::provenance`] says
//! which is which. Read-only: `$invoke`s answer from the snapshot's canned
//! replies or are dropped, as offline.
use std::sync::Arc;

use we_ad4m::live::{LiveMap, LiveMembers};
use we_ad4m::{Ad4mQuerySource, Connection, SourceStats, SpaceBinding, SpaceRow};
use we_data::{OfflineData, Provenance, StoreMap};
use we_egui::Registry;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{AppSpec, LocalState, NoParts, Runtime, SchemaNode, StaticHost};

use crate::{gallery, RendererApp};

const SNAPSHOT: &str = include_str!("../../fixtures/coasys/snapshot.json");
const SEED_MAP: &str = include_str!("../../we-data/data/storemap-offline.json");

/// One open space: the app, and what the debug panel reads about it.
pub struct LiveSpace {
    pub app: RendererApp,
    pub space: SpaceRow,
    pub provenance: Provenance,
    pub source: Arc<SourceStats>,
    /// The members a live row answers.
    pub live_members: Vec<String>,
    _live: LiveMembers,
}

/// The route a space's index renders at — `/space/<uuid>`, the key every
/// `Here` query reads.
pub fn space_route(space: &SpaceRow) -> String {
    format!("/space/{}", space.uuid)
}

/// The bundle's app root over `space` on `conn`, painted with `theme_id`.
/// The second value says the theme was not recorded and `dark` stood in.
pub fn live_space_app(
    bundle: &we_template::Bundle,
    conn: &Connection,
    space: SpaceRow,
    theme_id: &str,
) -> Result<(LiveSpace, bool), String> {
    let truth: serde_json::Value =
        serde_json::from_str(SNAPSHOT).map_err(|e| format!("snapshot parse: {e}"))?;
    let live_map = LiveMap::bundled();
    let mut map = StoreMap::parse(SEED_MAP).map_err(|e| format!("seed map: {e}"))?;
    map.members.extend(live_map.derived.members.clone());
    // The flat recording is the fallback for every member without a live
    // row. Its `queries` table is never consulted: the live source answers
    // every `$queries` entry.
    let data = OfflineData::from_snapshot(&truth, Some(&map))?;
    let mut binding = SpaceBinding::new(&space.uuid);
    if let Some(url) = &space.shared_url {
        binding = binding.also(url);
    }
    let live = LiveMembers::install(
        &data.bag,
        &data.provenance,
        &live_map,
        conn,
        &binding,
        space.shared_url.as_deref(),
    );
    let source = Arc::new(Ad4mQuerySource::new(conn.clone(), binding));
    let stats = source.stats();

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
        &space_route(&space),
    );
    let placeholder: SchemaNode =
        serde_json::from_value(serde_json::json!({ "type": "Column" })).unwrap();
    let registry = Registry::with_builtins();
    let types: std::collections::HashSet<&'static str> = registry.type_names().collect();
    let mut app = RendererApp::new(placeholder, "coasys", data.bag.clone(), screen, registry);
    let runtime = Runtime::app(spec, data.bag.clone(), LocalState::new())
        .with_sources(Some(source), Arc::new(NoParts))
        .with_dollar_types(move |ty| types.contains(ty));
    app.session.set_runtime(runtime);
    app.session.host = Box::new(StaticHost::new(data.bag.clone()));
    let set = gallery::load_theme_set();
    let (theme, fell_back) = set.theme(theme_id);
    app.theme = theme.clone();
    Ok((
        LiveSpace {
            app,
            space,
            provenance: data.provenance.clone(),
            source: stats,
            live_members: live.members().to_vec(),
            _live: live,
        },
        fell_back,
    ))
}
