//! The selected `we-tree-item` row paints the theme's tree `selected`
//! variant — its fill, a leading bar in its border colour and width, and
//! the tree radius — rather than egui's selection colour. Glow parity: the
//! Coasys tree's current row was saturated cyan; the web's is the raised
//! surface with a 3px mint bar.
use std::cell::RefCell;
use std::sync::Arc;

use indexmap::IndexMap;
use we_egui::{layout, paint, EditState, MeasureCx, Registry, StyleCx};
use we_expr::Value;
use we_style::TokenTable;
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
        surfaces: Default::default(),
    }
}

fn tokens() -> TokenTable {
    TokenTable::new(
        [
            ("--we-space-100", "4px"),
            ("--we-space-200", "8px"),
            ("--we-radius-300", "8px"),
            ("--we-role-text-muted", "rgb(199, 201, 220)"),
            ("--we-theme-tree-radius", "10px"),
            ("--we-theme-tree--selected-fill", "rgb(34, 38, 90)"),
            ("--we-theme-tree--selected-text", "rgb(255, 255, 255)"),
            ("--we-theme-tree--selected-border", "rgb(0, 255, 0)"),
            ("--we-theme-tree--selected-border-width", "3px"),
        ]
        .iter()
        .map(|(k, v)| (Arc::from(*k), Arc::from(*v)))
        .collect::<IndexMap<Arc<str>, Arc<str>>>(),
    )
}

struct Painted {
    row: egui::Rect,
    shapes: Vec<egui::epaint::ClippedShape>,
    selected_text: Option<we_style::Color>,
    other_text: Option<we_style::Color>,
}

fn painted(root: &ResolvedNode) -> Painted {
    let registry = Registry::with_builtins();
    let table = tokens();
    let out = RefCell::new(None);
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let ctx = ui.ctx().clone();
        let scx = StyleCx {
            tokens: &table,
            ..StyleCx::empty()
        };
        let lay = layout(
            &MeasureCx::new(&ctx),
            &scx,
            &registry,
            root,
            egui::Rect::from_min_size(ui.cursor().min, egui::vec2(300.0, 400.0)),
        );
        let mut events = Vec::new();
        let mut edit = EditState::default();
        paint(ui, &registry, &scx, root, &lay, &mut events, &mut edit, 0.0);
        let shapes = ctx.graphics(|g| {
            g.get(ui.layer_id())
                .map(|list| list.all_entries().cloned().collect())
                .unwrap_or_default()
        });
        let color = |id: &str| lay.styles[&NodeId::from(id)].text.color;
        *out.borrow_mut() = Some(Painted {
            row: lay.parts[&(NodeId::from("t/a"), "row")],
            shapes,
            selected_text: color("t/a"),
            other_text: color("t/b"),
        });
    });
    harness.run_steps(2);
    drop(harness);
    out.into_inner().unwrap()
}

fn rects(
    shapes: &[egui::epaint::ClippedShape],
    fill: egui::Color32,
) -> Vec<egui::epaint::RectShape> {
    shapes
        .iter()
        .filter_map(|cs| match &cs.shape {
            egui::Shape::Rect(r) if r.fill == fill => Some(r.clone()),
            _ => None,
        })
        .collect()
}

#[test]
fn the_selected_row_paints_the_themes_selected_variant() {
    let mut tree = node("we-tree", "t", &[("selected", Value::from("a"))]);
    for (id, value) in [("t/a", "a"), ("t/b", "b")] {
        let mut item = node("we-tree-item", id, &[("value", Value::from(value))]);
        item.children.push(ResolvedChild::Text(Arc::from(value)));
        tree.children.push(ResolvedChild::Node(Box::new(item)));
    }
    let p = painted(&tree);

    let fill = rects(&p.shapes, egui::Color32::from_rgb(34, 38, 90));
    let row = fill
        .iter()
        .find(|r| {
            (r.rect.min.y - p.row.min.y).abs() < 0.5 && (r.rect.max.y - p.row.max.y).abs() < 0.5
        })
        .unwrap_or_else(|| panic!("a selected fill over the row {:?}: {fill:?}", p.row));
    // Rounded on the trailing side, square where the bar is.
    assert_eq!(row.corner_radius.ne, 10);
    assert_eq!(row.corner_radius.nw, 0);

    let bar = rects(&p.shapes, egui::Color32::from_rgb(0, 255, 0));
    let bar = bar
        .iter()
        .find(|r| (r.rect.min.x - p.row.min.x).abs() < 0.5)
        .unwrap_or_else(|| panic!("a leading bar at {:?}: {bar:?}", p.row.min.x));
    assert!(
        (bar.rect.width() - 3.0).abs() < 0.01,
        "3px bar: {:?}",
        bar.rect
    );

    // The lit row's text is the variant's; the others stay muted.
    let rgb = |c: Option<we_style::Color>| c.map(|c| c.to_premultiplied());
    assert_eq!(
        rgb(p.selected_text),
        rgb(we_style::eval_color("rgb(255, 255, 255)"))
    );
    assert_eq!(
        rgb(p.other_text),
        rgb(we_style::eval_color("rgb(199, 201, 220)"))
    );
}
