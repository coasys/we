//! The theme's `--we-font-family` reaches every text a widget paints, not
//! only buttons and text spans: the web input is `font: inherit` and the
//! form field's label, description and error are ordinary inherited text.
use std::cell::RefCell;
use std::sync::Arc;

use indexmap::IndexMap;
use we_egui::{layout, paint, EditState, MeasureCx, Registry, StyleCx};
use we_template::{NodeId, ResolvedChild, ResolvedNode};

fn node(ty: &str, id: &str, props: &[(&str, &str)]) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from(id),
        ty: Arc::from(ty),
        props: props
            .iter()
            .map(|(k, v)| (Arc::from(*k), we_expr::Value::from(*v)))
            .collect::<IndexMap<Arc<str>, we_expr::Value>>(),
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        transition: None,
    }
}

/// A form field (label + description) around an input holding `HELLO`.
fn field() -> ResolvedNode {
    let mut f = node(
        "we-form-field",
        "ff",
        &[("label", "LABEL"), ("description", "DESCRIPTION")],
    );
    let inp = node("we-input", "ff/in", &[("value", "HELLO")]);
    f.children = vec![ResolvedChild::Node(Box::new(inp))];
    f
}

/// Every text run the frame painted, with the family it was set in.
fn runs(
    root: &ResolvedNode,
    tokens: &[(&str, &str)],
    theme: &str,
) -> Vec<(String, egui::FontFamily)> {
    let registry = Registry::with_builtins();
    let table = we_style::TokenTable::new(
        tokens
            .iter()
            .map(|(k, v)| (Arc::from(*k), Arc::from(*v)))
            .collect(),
    );
    let out = RefCell::new(Vec::new());
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let ctx = ui.ctx().clone();
        we_egui::install_media(&ctx);
        let mut scx = StyleCx::empty();
        scx.tokens = &table;
        scx.theme = theme;
        let lay = layout(
            &MeasureCx::new(&ctx),
            &scx,
            &registry,
            root,
            egui::Rect::from_min_size(ui.cursor().min, egui::vec2(400.0, 600.0)),
        );
        let mut events = Vec::new();
        let mut edit = EditState::default();
        paint(ui, &registry, &scx, root, &lay, &mut events, &mut edit, 0.0);
        let layer = ui.layer_id();
        let found: Vec<(String, egui::FontFamily)> = ctx.graphics(|g| {
            g.get(layer)
                .map(|list| {
                    list.all_entries()
                        .filter_map(|cs| match &cs.shape {
                            egui::Shape::Text(t) => t.galley.job.sections.first().map(|sec| {
                                (t.galley.job.text.clone(), sec.format.font_id.family.clone())
                            }),
                            _ => None,
                        })
                        .collect()
                })
                .unwrap_or_default()
        });
        *out.borrow_mut() = found;
    });
    harness.run_steps(2);
    let taken = out.borrow().clone();
    taken
}

fn family_of(runs: &[(String, egui::FontFamily)], text: &str) -> egui::FontFamily {
    runs.iter()
        .find(|(t, _)| t == text)
        .unwrap_or_else(|| panic!("{text:?} painted; got {runs:?}"))
        .1
        .clone()
}

#[test]
fn retro_font_reaches_the_input_and_its_form_field() {
    let got = runs(
        &field(),
        &[("--we-font-family", "'VT323', monospace")],
        "retro",
    );
    // The retro stack's chain: VT323, then the monospace generic.
    let vt = egui::FontFamily::Name(Arc::from("VT323, monospace"));
    for text in ["HELLO", "LABEL", "DESCRIPTION"] {
        assert_eq!(family_of(&got, text), vt, "{text} is set in VT323");
    }
}

#[test]
fn a_theme_without_a_font_keeps_the_generic_family() {
    let got = runs(&field(), &[], "");
    for text in ["HELLO", "LABEL", "DESCRIPTION"] {
        assert_eq!(
            family_of(&got, text),
            egui::FontFamily::Proportional,
            "{text} stays proportional"
        );
    }
}

/// The first text run's family, whether it covers `c`, and the faces its
/// chain is registered with — all read on the same context.
fn coverage(
    root: &ResolvedNode,
    stack: &str,
    c: char,
    tofu: bool,
) -> (egui::FontFamily, bool, Vec<String>) {
    let registry = Registry::with_builtins();
    let table = we_style::TokenTable::new(
        [(
            Arc::<str>::from("--we-font-family"),
            Arc::<str>::from(stack),
        )]
        .into_iter()
        .collect(),
    );
    let out = RefCell::new(None);
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let ctx = ui.ctx().clone();
        we_egui::install_media(&ctx);
        if tofu {
            // The app's own policy (egui's default); kittest panics instead.
            ctx.set_missing_glyph_policy(egui::MissingGlyphPolicy::Tofu);
        }
        let mut scx = StyleCx::empty();
        scx.tokens = &table;
        let lay = layout(
            &MeasureCx::new(&ctx),
            &scx,
            &registry,
            root,
            egui::Rect::from_min_size(ui.cursor().min, egui::vec2(400.0, 600.0)),
        );
        let mut events = Vec::new();
        let mut edit = EditState::default();
        paint(ui, &registry, &scx, root, &lay, &mut events, &mut edit, 0.0);
        let layer = ui.layer_id();
        let fam = ctx.graphics(|g| {
            g.get(layer).and_then(|list| {
                list.all_entries().find_map(|cs| match &cs.shape {
                    egui::Shape::Text(t) => t
                        .galley
                        .job
                        .sections
                        .first()
                        .map(|s| s.format.font_id.family.clone()),
                    _ => None,
                })
            })
        });
        if let Some(fam) = fam {
            let covered = ctx.fonts_mut(|f| f.has_glyph(&egui::FontId::new(16.0, fam.clone()), c));
            let chain = ctx.fonts(|f| {
                f.definitions()
                    .families
                    .get(&fam)
                    .cloned()
                    .unwrap_or_default()
            });
            *out.borrow_mut() = Some((fam, covered, chain));
        }
    });
    harness.run_steps(3);
    let taken = out.borrow().clone();
    taken.expect("the text painted")
}

/// `'VT323', monospace` — VT323 carries no U+2192, so the arrow must come
/// from the generic `monospace` faces after it, as the browser's fallback
/// would. Under kittest's panic-on-missing-glyph policy this panicked.
#[test]
fn a_named_face_falls_back_to_its_generic_family() {
    let n = node("we-text", "t", &[("text", "A \u{2192} B")]);
    let (fam, covered, chain) = coverage(&n, "'VT323', monospace", '\u{2192}', false);
    assert!(covered, "{fam:?} covers U+2192");
    assert_eq!(
        chain.first().map(String::as_str),
        Some("vt323-latin"),
        "VT323 leads"
    );
    assert!(
        chain.iter().any(|f| f == "Hack"),
        "the monospace faces follow it: {chain:?}"
    );
}

/// An unassigned codepoint after the arrow, under the app's tofu policy:
/// the arrow from the fallback, the unknown one as a box, no panic.
#[test]
fn an_unknown_codepoint_renders_as_tofu_beside_the_fallback_arrow() {
    let n = node("we-text", "t", &[("text", "A \u{2192} B \u{10FFFD}")]);
    let (fam, covered, _) = coverage(&n, "'VT323', monospace", '\u{2192}', true);
    assert!(covered, "{fam:?} covers U+2192");
}

/// Later named entries are not dropped: `'VT323', 'DM Sans', sans-serif`
/// chains VT323, then DM Sans (whose latin-ext face has U+0115, which
/// VT323 lacks), then the sans generic.
#[test]
fn later_stack_entries_stay_in_the_chain() {
    let n = node("we-text", "t", &[("text", "\u{0115}")]);
    let (fam, covered, chain) = coverage(&n, "'VT323', 'DM Sans', sans-serif", '\u{0115}', false);
    assert!(covered, "{fam:?} covers U+0115");
    let at = |face: &str| chain.iter().position(|f| f == face);
    assert!(
        at("vt323-latin") < at("dm-sans-latin-ext")
            && at("dm-sans-latin-ext").is_some()
            && at("dm-sans-latin-ext") < at("Ubuntu-Light"),
        "VT323, then DM Sans, then the generic: {chain:?}"
    );
}
