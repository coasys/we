//! E3c-13, egui half: after each layout the frontend walks the tree and
//! reports every surface tag's **content-box** width — the box
//! `ResizeObserver` reports (`createSurface.ts:47`, `contentBoxSize`), so
//! a padded `$surface` binds its inside width, not the border box.
use std::sync::Arc;

use we_app::RendererApp;
use we_egui::Registry;
use we_screen::{ScreenSchema, ScreenState};
use we_template::{ResolvedChild, ResolvedNode, SchemaNode, StoreBag};

fn find<'a>(n: &'a ResolvedNode, ty: &str) -> Option<&'a ResolvedNode> {
    if n.ty.as_ref() == ty {
        return Some(n);
    }
    n.children.iter().find_map(|c| match c {
        ResolvedChild::Node(n) => find(n, ty),
        _ => None,
    })
}

/// 1000px of surface box with 120px of padding each side: the content box
/// is 760 — `sm`. Reporting the border rect (1000 — `md`) instead is the
/// sabotage this test exists to catch.
#[test]
fn egui_reports_the_surface_content_box() {
    let schema: SchemaNode = serde_json::from_value(serde_json::json!({
        "type": "Column",
        "props": { "width": "1000px" },
        "children": [{
            "type": "$surface",
            "props": { "width": "100%", "px": "120px" },
            "children": [{ "type": "Label", "props": {
                "t": { "$": "surface.tier" },
                "w": { "$": "surface.width" }
            }}]
        }]
    }))
    .expect("schema parses");
    let app = RendererApp::new(
        schema,
        "test",
        Arc::new(StoreBag::new()),
        ScreenState::desktop(ScreenSchema::default(), "/"),
        Registry::with_builtins(),
    );
    let mut harness =
        egui_kittest::Harness::new_ui_state(|ui, app: &mut RendererApp| app.frame_body(ui), app);
    harness.run_steps(5);

    let root = harness.state().session.runtime.resolved().unwrap().clone();
    let label = find(&root, "Label").expect("the label resolved");
    let w = label.props.get("w").expect("surface.width bound");
    let t = label.props.get("t").expect("surface.tier bound");
    assert_eq!(
        w.to_json().as_f64(),
        Some(760.0),
        "the report is the content box — 1000 − 2×120 padding: {w:?}"
    );
    assert_eq!(
        t.to_json().as_str(),
        Some("sm"),
        "760px is `sm` — the border box's `md` would be the wrong box"
    );
}

/// A harness of `w`×600 running `schema` as a single mount, settled.
fn settled(schema: serde_json::Value, w: f32) -> egui_kittest::Harness<'static, RendererApp> {
    let schema: SchemaNode = serde_json::from_value(schema).expect("schema parses");
    let app = RendererApp::new(
        schema,
        "test",
        Arc::new(StoreBag::new()),
        ScreenState::desktop(ScreenSchema::default(), "/"),
        Registry::with_builtins(),
    );
    let mut harness = egui_kittest::Harness::builder()
        .with_size(egui::Vec2::new(w, 600.0))
        .build_ui_state(|ui, app: &mut RendererApp| app.frame_body(ui), app);
    harness.run_steps(8);
    harness
}

fn labels(h: &egui_kittest::Harness<'static, RendererApp>) -> Vec<Option<f64>> {
    let root = h.state().session.runtime.resolved().unwrap().clone();
    let mut out = Vec::new();
    fn walk(n: &ResolvedNode, out: &mut Vec<Option<f64>>) {
        if n.ty.as_ref() == "Label" {
            out.push(n.props.get("w").and_then(|v| v.to_json().as_f64()));
        }
        for c in &n.children {
            if let ResolvedChild::Node(n) = c {
                walk(n, out);
            }
        }
    }
    walk(&root, &mut out);
    out
}

/// Lal U1: the host surface is the mount's boundary — the slot the app
/// hands the session (`createSurface.ts:29`: the host's own surfaces are
/// existing elements around the template). A root fragment opening with
/// text has no first node to carry a tag, so the host was never measured.
#[test]
fn egui_host_surface_of_a_text_first_fragment_is_the_slot() {
    let h = settled(
        serde_json::json!({ "children": [
            "heading",
            { "type": "Label", "props": { "w": { "$": "surface.width" } } }
        ]}),
        1000.0,
    );
    let w = labels(&h);
    let slot = h.state().layout().unwrap().size.x as f64;
    assert!(slot > 0.0, "the slot laid out");
    assert_eq!(
        w,
        vec![Some(slot)],
        "a text-first root still binds the slot's width"
    );
}

/// Lal U1: every root of a multi-root fragment reads the one boundary —
/// not the first root's own box.
#[test]
fn egui_host_surface_of_a_multi_root_fragment_is_the_slot() {
    let h = settled(
        serde_json::json!({ "children": [
            { "type": "Label", "props": { "width": "120px", "w": { "$": "surface.width" } } },
            { "type": "Label", "props": { "w": { "$": "surface.width" } } }
        ]}),
        1000.0,
    );
    let slot = h.state().layout().unwrap().size.x as f64;
    assert_eq!(
        labels(&h),
        vec![Some(slot), Some(slot)],
        "both roots read the slot, not the first root's 120px box"
    );
}

/// Lal U1: a root sizing itself off `surface.width` must not measure
/// itself. Reporting the root's own box alternates 1000, 700, 1000 … —
/// the boundary outside the template is what settles it.
#[test]
fn egui_root_reading_its_own_surface_width_settles() {
    let mut h = settled(
        serde_json::json!({
            "type": "Column",
            "props": { "width": { "$": "surface.width >= 900 ? '700px' : '1000px'" } },
            "children": [{ "type": "Label", "props": { "w": { "$": "surface.width" } } }]
        }),
        1200.0,
    );
    let resolves = h.state().session.stats().resolves;
    let before = labels(&h);
    h.run_steps(6);
    assert_eq!(
        h.state().session.stats().resolves,
        resolves,
        "no further resolves — the measure is settled, not oscillating"
    );
    assert_eq!(labels(&h), before);
    assert_eq!(
        before,
        vec![Some(1184.0)],
        "the host is the slot — 1200 less the panel's 2×8 margin — whatever width the root picked"
    );
}

/// Lal r2 P3: the producer's `set` guard. A settled frame re-reports
/// nothing — every report rides the inbox and wakes the session, so an
/// unguarded walk would wake egui on every frame it paints, forever.
#[test]
fn egui_steady_frames_report_nothing() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let mut h = settled(
        serde_json::json!({
            "type": "Column",
            "props": { "w": { "$": "surface.width" } },
            "children": [{
                "type": "$surface",
                "props": { "px": "120px" },
                "children": [{ "type": "Label", "props": { "w": { "$": "surface.width" } } }]
            }]
        }),
        1000.0,
    );
    let wakes = Arc::new(AtomicUsize::new(0));
    let w = wakes.clone();
    h.state_mut().session.set_waker(Arc::new(move || {
        w.fetch_add(1, Ordering::SeqCst);
    }));
    h.run_steps(5);
    assert_eq!(
        wakes.load(Ordering::SeqCst),
        0,
        "unmoved measures are not re-reported — nothing wakes the session"
    );
}
