//! Loading a bundle + snapshot into a [`Session`] — the two shapes the
//! other frontends read:
//!
//! - a flat store-bag snapshot (`we-app/tests/data/tree-snapshot.json`):
//!   the bundle's `tree` panel over `StoreBag::from_snapshot`, exactly as
//!   `we-cli` loads it;
//! - a `we-snapshot@2` recording (`fixtures/coasys/snapshot.json`): one
//!   recorded route's state through `OfflineData::from_route`, resolving
//!   the bundle's whole app root (`Runtime::app`) at that route's recorded
//!   path — what `we-app/tests/coasys_shots.rs` and
//!   `we-data/tests/real_snapshot.rs` resolve.
use std::sync::Arc;

use serde::Deserialize;
use serde_json::Value as Json;
use we_data::{OfflineData, StoreMap};
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{
    AppSpec, Bundle, LocalState, MountCx, NoParts, RootSpec, Runtime, SchemaNode, StaticHost,
    StoreBag,
};

/// The store map the recorded-route path overlays — the same file
/// `coasys_shots.rs` and `real_snapshot.rs` read.
pub const SEED_MAP: &str = include_str!("../../we-data/data/storemap-offline.json");

/// `we-snapshot@2`, the C2a recording format.
pub const FORMAT_V2: &str = "we-snapshot@2";

/// Whether `snapshot` is a per-route recording.
pub fn is_recording(snapshot: &Json) -> bool {
    snapshot["meta"]["format"].as_str() == Some(FORMAT_V2)
}

/// The `$`-types the catalog draws — the gate every frontend wires.
fn known_dollar(ty: &str) -> bool {
    we_catalog::entry(ty).is_some()
}

fn screen_schema(bundle: &Bundle) -> ScreenSchema {
    ScreenSchema {
        pages: bundle
            .pages
            .as_deref()
            .unwrap_or_default()
            .iter()
            .map(|p| p.id.clone())
            .collect(),
        ..ScreenSchema::default()
    }
}

/// The bundle's `tree` panel schema — the node `we-cli` renders.
pub fn tree_schema(bundle: &Bundle) -> Result<SchemaNode, String> {
    bundle
        .templates
        .as_deref()
        .unwrap_or_default()
        .first()
        .and_then(|t| t.meta.get("panels"))
        .and_then(|panels| panels.as_array())
        .and_then(|panels| {
            panels
                .iter()
                .find(|p| p.get("id").and_then(|i| i.as_str()) == Some("tree"))
                .or_else(|| panels.first())
        })
        .and_then(|panel| SchemaNode::deserialize(panel.get("node").cloned()?).ok())
        .ok_or_else(|| "bundle has no panels to render".to_string())
}

/// The flat-snapshot session: the tree panel at `route`, as `we-cli`.
pub fn tree_session(bundle: &Bundle, bag: StoreBag, route: &str) -> Result<Session, String> {
    let screen = ScreenState::desktop(screen_schema(bundle), route);
    Ok(Session::offline(
        RootSpec::Single {
            node: Box::new(tree_schema(bundle)?),
            cx: MountCx::explicit("tree"),
            declared: we_template::Declared::default(),
        },
        Arc::new(bag),
        screen,
    )
    .with_dollar_types(known_dollar))
}

/// `route` as a recorded route id: an id (`index`, `people`) as given, or
/// a path equal to one route's recorded `rust` path.
pub fn route_id(snapshot: &Json, route: &str) -> Result<String, String> {
    let routes = snapshot["routes"]
        .as_object()
        .ok_or("snapshot: no routes table")?;
    if routes.contains_key(route) {
        return Ok(route.to_string());
    }
    routes
        .iter()
        .find(|(_, r)| r["rust"].as_str() == Some(route))
        .map(|(id, _)| id.clone())
        .ok_or_else(|| {
            let ids: Vec<&str> = routes.keys().map(String::as_str).collect();
            format!(
                "snapshot: no recorded route {route:?} (recorded: {})",
                ids.join(", ")
            )
        })
}

/// The recorded-route session: route `route` (an id or a recorded path)
/// of `snapshot`, resolving the bundle's app root at its `rust` path.
pub fn recorded_session(bundle: &Bundle, snapshot: &Json, route: &str) -> Result<Session, String> {
    let id = route_id(snapshot, route)?;
    let map = StoreMap::parse(SEED_MAP).map_err(|e| format!("seed map: {e}"))?;
    let data = OfflineData::from_route(snapshot, &id, Some(&map))?;
    let spec = AppSpec {
        bundle: bundle.name.clone().into(),
        app: bundle.app.clone(),
        template: bundle.templates.as_deref().and_then(|t| t.first()).cloned(),
        pages: bundle.pages.clone().unwrap_or_default(),
        boot: bundle.boot_screen.clone(),
    };
    let path = snapshot["routes"][&id]["rust"]
        .as_str()
        .ok_or_else(|| format!("routes.{id}.rust is not a path"))?;
    let screen = ScreenState::desktop(screen_schema(bundle), path);
    // Locals belong to the core (E3c-1): the runtime owns them, the host
    // only answers `$invoke`s — as we-app's recorded-route harness does.
    let runtime = Runtime::app(spec, data.bag.clone(), LocalState::new())
        .with_sources(Some(data.source()), Arc::new(NoParts))
        .with_dollar_types(known_dollar);
    let host = Box::new(StaticHost::new(data.bag.clone()));
    Ok(Session::from_parts(runtime, host, screen))
}

/// Either shape from the files' text: a recording picks route `route` (an
/// id or recorded path), a flat snapshot (or none) renders the tree panel
/// at `route`.
pub fn session_from_text(
    bundle_text: &str,
    snapshot_text: Option<&str>,
    route: &str,
) -> Result<Session, String> {
    let bundle = Bundle::parse(bundle_text).map_err(|e| format!("bundle did not parse: {e}"))?;
    let Some(text) = snapshot_text else {
        return tree_session(&bundle, StoreBag::new(), route);
    };
    let json: Json = serde_json::from_str(text).map_err(|e| format!("snapshot parse: {e}"))?;
    if is_recording(&json) {
        recorded_session(&bundle, &json, route)
    } else {
        let bag = StoreBag::from_snapshot(&json).map_err(|e| format!("snapshot: {e}"))?;
        tree_session(&bundle, bag, route)
    }
}
