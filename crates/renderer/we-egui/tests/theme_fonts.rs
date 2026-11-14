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
    let vt = egui::FontFamily::Name(Arc::from("VT323"));
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
