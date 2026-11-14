//! M1a: a missing glyph must never panic a render. `/about` renders `→`
//! (U+2192) — none of egui's bundled fonts have it, and kittest's default
//! `MissingGlyphPolicy::Panic` turned that into a crash. The renderer's
//! font install is expected to (a) register a fallback font with the
//! symbols the bundle uses and (b) set the tofu policy itself, every frame,
//! so a missing glyph degrades to a box instead of a panic.
use std::path::PathBuf;
use std::sync::Arc;

use indexmap::IndexMap;
use we_egui::{layout, paint, EditState, MeasureCx, Registry, StyleCx};
use we_expr::Value;
use we_template::{NodeId, ResolvedChild, ResolvedNode};

fn node(ty: &str, id: &str, props: &[(&str, Value)]) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from(id),
        ty: Arc::from(ty),
        props: props
            .iter()
            .map(|(k, v)| (Arc::from(*k), v.clone()))
            .collect::<IndexMap<Arc<str>, Value>>(),
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        transition: None,
    }
}

fn child(parent: &mut ResolvedNode, n: ResolvedNode) {
    parent.children.push(ResolvedChild::Node(Box::new(n)));
}

fn s(v: &str) -> Value {
    Value::Str(Arc::from(v))
}

fn tokens() -> we_style::TokenTable {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/schema-system/conformance/vectors/tokens/light.json");
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    we_style::TokenTable::from_json(&json).unwrap()
}

#[test]
fn missing_glyphs_never_panic_and_common_symbols_draw() {
    let mut col = node("Column", "c", &[]);
    // `→` is the /about panic; U+10FFFE is a noncharacter no font has —
    // it must degrade to tofu, not crash.
    child(
        &mut col,
        node("we-text", "c/t", &[("text", s("next → page \u{10FFFE}"))]),
    );
    let registry = Registry::with_builtins();
    let tokens = tokens();
    let scx = StyleCx {
        tokens: &tokens,
        ..StyleCx::empty()
    };
    let out = std::cell::RefCell::new(None);
    // No `.allow_missing_glyphs()` — kittest's Panic policy is exactly what
    // the app hits; install_media must override it itself.
    let mut harness = egui_kittest::Harness::builder()
        .with_context_setup(we_egui::install_media)
        .build_ui(|ui| {
            // `frame_body`'s per-frame call — the policy reasserts here, on
            // top of kittest's Panic default.
            we_egui::install_media(ui.ctx());
            let ctx = ui.ctx().clone();
            let cx = MeasureCx::new(&ctx);
            let lay = layout(
                &cx,
                &scx,
                &registry,
                &col,
                egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(400.0, 800.0)),
            );
            let mut events = Vec::new();
            let mut edit = EditState::default();
            paint(ui, &registry, &scx, &col, &lay, &mut events, &mut edit, 0.0);
            *out.borrow_mut() =
                Some(ctx.fonts_mut(|f| f.has_glyph(&egui::FontId::proportional(16.0), '→')));
        });
    harness.run();
    assert!(
        out.borrow_mut().take().unwrap_or(false),
        "a fallback font must supply → (U+2192)"
    );
}

/// Layout + paint `root`; returns the layout and every shape painted on
/// every layer — `drain` spans the overlay layers `g.get(layer)` misses.
fn all_shapes(root: &ResolvedNode, width: f32) -> (we_egui::Layout, Vec<egui::Shape>) {
    let registry = Registry::with_builtins();
    let tokens = tokens();
    let scx = StyleCx {
        tokens: &tokens,
        ..StyleCx::empty()
    };
    let out = std::cell::RefCell::new(None);
    let mut harness = egui_kittest::Harness::builder()
        .allow_missing_glyphs()
        .with_context_setup(we_egui::install_media)
        .build_ui(|ui| {
            let ctx = ui.ctx().clone();
            let cx = MeasureCx::new(&ctx);
            let lay = layout(
                &cx,
                &scx,
                &registry,
                root,
                egui::Rect::from_min_size(ui.cursor().min, egui::vec2(width, 800.0)),
            );
            let mut events = Vec::new();
            let mut edit = EditState::default();
            paint(ui, &registry, &scx, root, &lay, &mut events, &mut edit, 0.0);
            let shapes = ctx.graphics_mut(|g| {
                g.drain(&[], &Default::default())
                    .into_iter()
                    .map(|cs| cs.shape)
                    .collect::<Vec<_>>()
            });
            *out.borrow_mut() = Some((lay, shapes));
        });
    harness.run();
    let out = out.borrow_mut().take().expect("rendered");
    out
}

/// The web draws nothing for a closed `AgentChatSheet`: the host element
/// has no box and its contents live behind `open`. The placeholder must
/// match — zero in-flow footprint, zero paint — while `open` still shows
/// what the sheet holds (stage 5 owns the real panel).
#[test]
fn closed_sheet_takes_no_space_and_paints_nothing() {
    let mut col = node("Column", "c", &[]);
    child(&mut col, node("AgentChatSheet", "c/s", &[]));
    child(&mut col, node("we-text", "c/t", &[("text", s("below"))]));
    let (lay, shapes) = all_shapes(&col, 400.0);
    let sheet = lay.rects.get(&NodeId::from("c/s")).copied().unwrap();
    assert!(
        sheet.height() < 0.5,
        "a closed sheet has no vertical box (stretch leaves it a 0h bar): {sheet:?}"
    );
    let text = lay.rects.get(&NodeId::from("c/t")).copied().unwrap();
    assert!(
        text.min.y <= sheet.max.y + 1.0,
        "the sibling lands on the sheet's zero-height edge — no 64px bar: {text:?}"
    );
    assert!(
        !shapes
            .iter()
            .any(|shape| matches!(shape, egui::Shape::Text(t)
            if t.galley.text().contains("AgentChatSheet"))),
        "a closed sheet paints no label: {shapes:?}"
    );
}

#[test]
fn open_sheet_paints_its_card_on_the_overlay() {
    let mut col = node("Column", "c", &[]);
    let mut sheet = node(
        "AgentChatSheet",
        "c/s",
        &[("open", we_expr::Value::Bool(true))],
    );
    child(
        &mut sheet,
        node("we-text", "c/s/b", &[("text", s("sheet body"))]),
    );
    child(&mut col, sheet);
    let (_lay, shapes) = all_shapes(&col, 400.0);
    assert!(
        shapes
            .iter()
            .any(|shape| matches!(shape, egui::Shape::Text(t)
            if t.galley.text().contains("sheet body"))),
        "an open sheet paints its contents on the overlay layer: {shapes:?}"
    );
}
