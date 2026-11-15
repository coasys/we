//! The Coasys app against a live executor (E7): the same app root
//! `coasys_app` renders from a recording, with the template's `$queries`
//! answered by [`we_ad4m::Ad4mQuerySource`] and the store map's live rows
//! served by [`we_ad4m::live::LiveMembers`].
//!
//! No recorded data inside a live space (Lal F4): every other member of the
//! recorded stores reads unavailable, except the few `data/connected.json`
//! allowlists — the bundle's themes and brand, and facts of connected mode
//! (booted, read-only). [`LiveSpace::provenance`] lists what was live, what
//! came from the bundle and what was unavailable. Read-only: every
//! `$invoke` is dropped. [`DataMode::DemoRecorded`] (`--demo-recorded`)
//! puts the whole recording back underneath, for demos only.
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
const CONNECTED: &str = include_str!("../data/connected.json");

/// What fills the members no live row answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DataMode {
    /// Nothing recorded: the allowlisted bundle members and the facts of
    /// connected mode, everything else unavailable. The default.
    #[default]
    Live,
    /// The whole recording underneath, recorded people and all — a demo
    /// mix, off unless asked for (`--demo-recorded`).
    DemoRecorded,
}

/// The recorded members a live space may read: the bundle's own.
pub fn bundle_allowlist() -> Vec<String> {
    let cfg: serde_json::Value = serde_json::from_str(CONNECTED).expect("connected.json parses");
    cfg["bundle"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m.as_str().map(str::to_string))
        .collect()
}

/// The members a live space answers with a fact of connected mode rather
/// than a recording (`data/connected.json`). Provenance counts them with the
/// bundle members, as "served by snapshot": both come from the bag's
/// document, and neither is recorded space data.
pub fn connected_facts() -> Vec<String> {
    let cfg: serde_json::Value = serde_json::from_str(CONNECTED).expect("connected.json parses");
    cfg["connected"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(k, _)| k.clone())
        .collect()
}

/// The store document a live space's bag is built from: the allowlisted
/// bundle members copied out of the recording and the connected facts, no
/// queries, no canned `$invoke` replies.
fn connected_doc(truth: &serde_json::Value) -> serde_json::Value {
    let cfg: serde_json::Value = serde_json::from_str(CONNECTED).expect("connected.json parses");
    let mut stores = serde_json::Map::new();
    let mut put = |path: &str, value: serde_json::Value| {
        let (store, member) = path.rsplit_once('.').unwrap_or((path, ""));
        stores
            .entry(store.to_string())
            .or_insert_with(|| serde_json::json!({}))
            .as_object_mut()
            .expect("a store is an object")
            .insert(member.to_string(), value);
    };
    for path in bundle_allowlist() {
        let (store, member) = path.rsplit_once('.').unwrap_or((&path, ""));
        if let Some(v) = truth["stores"][store].get(member) {
            put(&path, v.clone());
        }
    }
    if let Some(facts) = cfg["connected"].as_object() {
        for (path, v) in facts {
            put(path, v.clone());
        }
    }
    serde_json::json!({ "stores": stores, "queries": {}, "invokes": {} })
}

/// A recorded store with its recording left out: what it still holds
/// answers, and a read it cannot answer is noted unavailable.
#[derive(Debug)]
struct GapNs {
    store: Arc<str>,
    base: we_expr::Value,
    provenance: Provenance,
}

impl we_expr::Namespace for GapNs {
    fn get(&self, key: &str) -> we_expr::Value {
        let v = match &self.base {
            we_expr::Value::Namespace(ns) => ns.get(key),
            we_expr::Value::Obj(map) => map.get(key).cloned().unwrap_or(we_expr::Value::Undefined),
            _ => we_expr::Value::Undefined,
        };
        if v.is_undefined() {
            self.provenance
                .note_unavailable(format!("{}.{key}", self.store));
        }
        v
    }

    fn keys(&self) -> Vec<Arc<str>> {
        match &self.base {
            we_expr::Value::Namespace(ns) => ns.keys(),
            we_expr::Value::Obj(map) => map.keys().cloned().collect(),
            _ => vec![],
        }
    }
}

/// One open space: the app, and what the debug panel reads about it.
pub struct LiveSpace {
    pub app: RendererApp,
    pub space: SpaceRow,
    pub provenance: Provenance,
    pub source: Arc<SourceStats>,
    /// The members a live row answers.
    pub live_members: Vec<String>,
    /// What fills the members no live row answers.
    pub mode: DataMode,
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
    mode: DataMode,
) -> Result<(LiveSpace, bool), String> {
    let truth: serde_json::Value =
        serde_json::from_str(SNAPSHOT).map_err(|e| format!("snapshot parse: {e}"))?;
    let live_map = LiveMap::bundled();
    let mut map = StoreMap::parse(SEED_MAP).map_err(|e| format!("seed map: {e}"))?;
    map.members.extend(live_map.derived.members.clone());
    // The live source answers every `$queries` entry; what fills the
    // members no live row answers depends on the mode.
    let data = match mode {
        DataMode::Live => {
            let data = OfflineData::from_snapshot(&connected_doc(&truth), Some(&map))?;
            // Every recorded store answers what it still holds and notes
            // the rest unavailable.
            for store in truth["stores"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(k, _)| k)
            {
                let base = data.bag.root(store).unwrap_or(we_expr::Value::Undefined);
                data.bag.set_root(
                    store,
                    we_expr::Value::Namespace(Arc::new(GapNs {
                        store: store.as_str().into(),
                        base,
                        provenance: data.provenance.clone(),
                    })),
                );
            }
            data
        }
        DataMode::DemoRecorded => OfflineData::from_snapshot(&truth, Some(&map))?,
    };
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
            mode,
            _live: live,
        },
        fell_back,
    ))
}
