//! M1a: `/about` renders `→` (U+2192), which none of egui's bundled fonts
//! have, and kittest's default `MissingGlyphPolicy::Panic` turned that into
//! a crash. The font install registers Noto symbol fallbacks so every
//! symbol the bundle needs has a glyph (checked strictly, on `Panic`); the
//! policy for a codepoint no font has is the host's — tofu in production.
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

/// Layout + paint one `we-text` holding `text` in a harness with the given
/// glyph policy, returning which of `probe` the proportional family lacks.
fn render_text(text: &str, policy: egui::MissingGlyphPolicy, probe: &[char]) -> Vec<char> {
    let mut col = node("Column", "c", &[]);
    child(&mut col, node("we-text", "c/t", &[("text", s(text))]));
    let registry = Registry::with_builtins();
    let tokens = tokens();
    let scx = StyleCx {
        tokens: &tokens,
        ..StyleCx::empty()
    };
    let out = std::cell::RefCell::new(None);
    let mut builder = egui_kittest::Harness::builder().with_context_setup(we_egui::install_media);
    if policy == egui::MissingGlyphPolicy::Tofu {
        builder = builder.allow_missing_glyphs();
    }
    let mut harness = builder.build_ui(|ui| {
        // `frame_body`'s per-frame call: it must leave the policy alone.
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
        let font = egui::FontId::proportional(16.0);
        *out.borrow_mut() = Some(ctx.fonts_mut(|f| {
            probe
                .iter()
                .copied()
                .filter(|c| !f.has_glyph(&font, *c))
                .collect::<Vec<_>>()
        }));
    });
    harness.run();
    let missing = out.borrow_mut().take().expect("rendered");
    missing
}

/// Every non-ASCII character the shipped bundles and the Coasys fixtures
/// carry, plus the glyphs the widgets paint themselves (`◌` the avatar
/// fallback, `·`, `…`, `—`) and the symbol families the Noto subsets were
/// cut for: arrows, circled digits, geometric shapes, misc symbols, dingbat
/// and supplemental arrows. Variation selectors are left out — they select
/// a presentation and have no glyph of their own.
fn needed_symbols() -> Vec<char> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let mut files: Vec<PathBuf> = std::fs::read_dir(root.join("bundles"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    for f in ["fixture.json", "snapshot.json"] {
        files.push(root.join("crates/renderer/fixtures/coasys").join(f));
    }
    let mut set = std::collections::BTreeSet::new();
    for f in &files {
        for c in std::fs::read_to_string(f).unwrap().chars() {
            if !c.is_ascii() && !('\u{FE00}'..='\u{FE0F}').contains(&c) {
                set.insert(c);
            }
        }
    }
    set.extend(['◌', '·', '…', '—']);
    let ranges = [
        '\u{2190}'..='\u{2199}', // arrows
        '\u{2460}'..='\u{2473}', // circled digits 1–20
        '\u{25A0}'..='\u{25FF}', // geometric shapes (▸ ▾ ● ◌ …)
        '\u{2600}'..='\u{2609}', // misc symbols (★ ☆ …)
        '\u{2794}'..='\u{2794}', // heavy arrow
        '\u{2B05}'..='\u{2B07}', // supplemental arrows
    ];
    for r in ranges {
        set.extend(r);
    }
    assert!(files.len() >= 4, "bundles + fixtures found: {files:?}");
    set.into_iter().collect()
}

/// Strict coverage: under kittest's `Panic` policy every symbol the bundle,
/// the fixtures and the widgets need renders — and passes only because the
/// vendored Noto fallbacks supply them. egui's own fonts lack `→` and `◌`;
/// that is checked first, so a fallback that stops being registered fails
/// here as a panic naming the character.
#[test]
fn needed_symbols_render_strictly_through_the_noto_fallbacks() {
    let needed = needed_symbols();
    let default_missing = {
        let ctx = egui::Context::default();
        let mut out = ctx.run_ui(Default::default(), |_| {});
        out.textures_delta.clear();
        let font = egui::FontId::proportional(16.0);
        ctx.fonts_mut(|f| {
            needed
                .iter()
                .copied()
                .filter(|c| !f.has_glyph(&font, *c))
                .collect::<Vec<_>>()
        })
    };
    assert!(
        default_missing.contains(&'→') && default_missing.contains(&'◌'),
        "egui's bundled fonts alone must lack some needed symbols, or this test proves nothing: {default_missing:?}"
    );
    let text: String = needed.iter().collect();
    let missing = render_text(&text, egui::MissingGlyphPolicy::Panic, &needed);
    assert!(missing.is_empty(), "no font supplies {missing:?}");
}

/// A codepoint no font has degrades to tofu when the host asks for tofu —
/// which is what the production host does. U+10FFFE is a noncharacter.
#[test]
fn an_unknown_codepoint_is_tofu_under_the_tofu_policy() {
    let missing = render_text(
        "next → page \u{10FFFE}",
        egui::MissingGlyphPolicy::Tofu,
        &['→', '\u{10FFFE}'],
    );
    assert_eq!(missing, vec!['\u{10FFFE}'], "only the noncharacter is tofu");
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
