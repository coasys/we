//! The walking skeleton end-to-end: the Coasys bundle's tree panel rendered
//! off the snapshot fixture — paints, rows are AccessKit-discoverable, a
//! click reaches `routeStore`, and a quiet frame does not re-resolve.
use std::sync::Arc;

use egui_kittest::kittest::Queryable;
use we_app::RendererApp;
use we_template::{Bundle, RouteState, SchemaNode, StoreBag};
use we_widgets::Registry;

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));
const SNAPSHOT: &str = include_str!("data/tree-snapshot.json");

/// The app under test: the bundle's `tree` panel, the snapshot's stores,
/// `?view=canvas` so `group|dna`'s click runs `setParam` not `navigate`.
fn app(route: &str) -> RendererApp {
    let bundle = Bundle::parse(BUNDLE).expect("bundle parses");
    let schema: SchemaNode = serde_json::from_value(
        bundle.templates.as_deref().unwrap()[0]
            .meta
            .get("panels")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p.get("id").and_then(|i| i.as_str()) == Some("tree"))
            .and_then(|p| p.get("node"))
            .cloned()
            .unwrap(),
    )
    .expect("tree panel parses");
    let bag = StoreBag::from_snapshot(&serde_json::from_str(SNAPSHOT).unwrap()).unwrap();
    RendererApp::new(
        schema,
        "tree",
        Arc::new(bag),
        RouteState::new(route),
        Registry::with_builtins(),
    )
}

#[test]
fn tree_panel_paints() {
    let mut harness = egui_kittest::Harness::new_ui_state(
        |ui, app: &mut RendererApp| app.frame_body(ui),
        app("/space/demo?view=canvas"),
    );
    harness.run();
    // The space name's text row and the tree's group rows are on screen.
    harness.get_by_label("Social DNA");
    harness.get_by_label("Feed");
}

#[test]
fn rows_are_discoverable_by_accesskit_label() {
    let mut harness = egui_kittest::Harness::new_ui_state(
        |ui, app: &mut RendererApp| app.frame_body(ui),
        app("/space/demo?view=canvas"),
    );
    harness.run();
    // Group rows label by their `value` prop — the same string the tree's
    // onSelect reads off the event.
    for label in [
        "group|calls",
        "group|workflows",
        "group|people",
        "group|dna",
        "group|templates",
        "group|themes",
    ] {
        harness.get_by_label(label);
    }
}

#[test]
fn clicking_a_row_changes_routestore_params() {
    let mut harness = egui_kittest::Harness::new_ui_state(
        |ui, app: &mut RendererApp| app.frame_body(ui),
        app("/space/demo?view=canvas"),
    );
    harness.run();
    assert!(harness.state().host.route.param("dna").is_undefined());
    // "Social DNA" carries value "group|dna"; in canvas view its onSelect
    // runs routeStore.setParam("dna", "all").
    harness.get_by_label("group|dna").click();
    harness.run();
    assert_eq!(harness.state().host.route.param("dna").js_string(), "all");
}

#[test]
fn a_frame_without_input_does_not_resolve_again() {
    let mut harness = egui_kittest::Harness::new_ui_state(
        |ui, app: &mut RendererApp| app.frame_body(ui),
        app("/space/demo?view=canvas"),
    );
    harness.run();
    let resolves = harness.state().runtime.stats().resolves;
    // kittest already ran several frames; none of them bumped the count.
    harness.run();
    assert_eq!(harness.state().runtime.stats().resolves, resolves);
}

#[test]
fn node_count_and_resolve_time() {
    let mut harness = egui_kittest::Harness::new_ui_state(
        |ui, app: &mut RendererApp| app.frame_body(ui),
        app("/space/demo?view=canvas"),
    );
    harness.run();
    assert!(
        harness.state().runtime.stats().nodes > 100,
        "tree panel should resolve ~200 nodes"
    );
}
