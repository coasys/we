//! B1/B12 round 2 — the input contract through the REAL loop: a schema's
//! `$localState`, `$setLocal` handlers dispatched by `Session`, the
//! Runtime re-resolving, and the next frame's prop flowing back into the
//! field. The we-egui unit tests echo props by hand; this one does not.
use std::sync::Arc;

use egui_kittest::kittest::Queryable;
use we_app::RendererApp;
use we_egui::Registry;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{ResolvedChild, ResolvedNode, SchemaNode, StoreBag};

fn app() -> RendererApp {
    let schema: SchemaNode = serde_json::from_value(serde_json::json!({
        "type": "Column",
        "meta": { "name": "live", "description": "", "icon": "pencil" },
        "$localState": {
            "name": { "type": "string", "initial": "" },
            "saved": { "type": "string", "initial": "" }
        },
        "children": [
            { "type": "we-input", "props": {
                "label": "Live",
                "value": { "$": "local.name" },
                "onInput": { "$setLocal": "name", "value": { "$": "event.detail" } }
            } },
            { "type": "we-text", "children": [{ "$": "`live:${local.name}`" }] },
            { "type": "we-input", "props": {
                "label": "Commit",
                "value": { "$": "local.saved" },
                "onChange": { "$setLocal": "saved", "value": { "$": "event.detail" } }
            } },
            { "type": "we-text", "children": [{ "$": "`saved:${local.saved}`" }] }
        ]
    }))
    .expect("schema parses");
    RendererApp::new(
        schema,
        "live",
        Arc::new(StoreBag::default()),
        ScreenState::desktop(ScreenSchema::default(), "/"),
        Registry::with_builtins(),
    )
}

/// Every text child in the resolved tree, flattened.
fn texts(n: &ResolvedNode, out: &mut Vec<String>) {
    for c in &n.children {
        match c {
            ResolvedChild::Node(x) => texts(x, out),
            ResolvedChild::Text(t) => out.push(t.to_string()),
        }
    }
}

fn resolved_texts(h: &egui_kittest::Harness<'_, RendererApp>) -> Vec<String> {
    let root = h.state().session.runtime().resolved().unwrap().clone();
    let mut out = Vec::new();
    texts(&root, &mut out);
    out
}

#[test]
fn live_input_round_trips_through_local_state() {
    let mut h =
        egui_kittest::Harness::new_ui_state(|ui, app: &mut RendererApp| app.frame_body(ui), app());
    h.run();
    h.get_by_label("Live").click();
    h.run();
    h.get_by_label("Live").type_text("abc");
    h.run();
    let t = resolved_texts(&h);
    assert!(
        t.iter().any(|s| s == "live:abc"),
        "local.name follows the typing: {t:?}"
    );
    assert_eq!(
        h.get_by_label("Live").value().as_deref(),
        Some("abc"),
        "the field shows the value the Runtime fed back"
    );
}

#[test]
fn commit_only_input_keeps_its_draft_then_commits_through_local_state() {
    let mut h =
        egui_kittest::Harness::new_ui_state(|ui, app: &mut RendererApp| app.frame_body(ui), app());
    h.run();
    h.get_by_label("Commit").click();
    h.run();
    h.get_by_label("Commit").type_text("xyz");
    h.run();
    // No onInput: the Runtime has not heard yet, and the draft survives
    // the re-resolve frames (the prop is still "").
    let t = resolved_texts(&h);
    assert!(
        t.iter().any(|s| s == "saved:"),
        "nothing committed yet: {t:?}"
    );
    assert_eq!(h.get_by_label("Commit").value().as_deref(), Some("xyz"));
    h.key_press(egui::Key::Enter);
    h.run();
    let t = resolved_texts(&h);
    assert!(
        t.iter().any(|s| s == "saved:xyz"),
        "Enter commits through onChange: {t:?}"
    );
    assert_eq!(h.get_by_label("Commit").value().as_deref(), Some("xyz"));
}
