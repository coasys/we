//! `we-input` is the web primitive's field: a 40px row (`md`) with `px`
//! 300, the `start` slot's icon at its left padding and the text after it.
//! Glow parity: the Coasys tree's "Find or ask" drew as a flat line-high
//! strip with the magnifier in the middle of it.
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
    }
}

fn tokens() -> TokenTable {
    TokenTable::new(
        [
            ("--we-space-200", "8px"),
            ("--we-space-300", "12px"),
            ("--we-radius-300", "8px"),
            ("--we-component-height-md", "40px"),
            ("--we-size-sm", "16px"),
            ("--we-role-border", "#333333"),
            ("--we-role-field", "#111111"),
        ]
        .iter()
        .map(|(k, v)| (Arc::from(*k), Arc::from(*v)))
        .collect::<IndexMap<Arc<str>, Arc<str>>>(),
    )
}

type Rects = std::collections::HashMap<NodeId, egui::Rect>;

fn lay_out(root: &ResolvedNode) -> Rects {
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
            egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(240.0, 600.0)),
        );
        *out.borrow_mut() = Some(lay.rects.clone());
    });
    harness.run_steps(1);
    drop(harness);
    out.into_inner().unwrap()
}

#[test]
fn a_start_icon_sits_at_the_fields_left_padding() {
    let mut icon = node(
        "we-icon",
        "icon",
        &[
            ("name", Value::from("magnifying-glass")),
            ("mr", Value::from("200")),
        ],
    );
    icon.slot = Some(Arc::from("start"));
    let mut input = node(
        "we-input",
        "input",
        &[("placeholder", Value::from("Find or ask"))],
    );
    input.children = vec![ResolvedChild::Node(Box::new(icon))];
    let mut col = node("Column", "col", &[]);
    col.children = vec![ResolvedChild::Node(Box::new(input))];

    let rects = lay_out(&col);
    let field = rects[&NodeId::from("input")];
    let icon = rects[&NodeId::from("icon")];
    assert_eq!(field.height(), 40.0, "field {field:?}");
    assert_eq!(field.width(), 240.0, "field {field:?}");
    // px 300 + the 1px border.
    assert_eq!(icon.min.x, 13.0, "icon {icon:?} in field {field:?}");
    assert_eq!(
        icon.center().y,
        field.center().y,
        "icon {icon:?} in field {field:?}"
    );
}

/// Where the placeholder's text shapes start, and the icon's rect.
fn painted_text(root: &ResolvedNode) -> (f32, egui::Rect) {
    let registry = Registry::with_builtins();
    let table = tokens();
    let out = RefCell::new((f32::INFINITY, egui::Rect::NOTHING));
    let mut harness = egui_kittest::Harness::builder()
        .with_context_setup(we_egui::install_media)
        .build_ui(|ui| {
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
                egui::Rect::from_min_size(ui.cursor().min, egui::vec2(240.0, 600.0)),
            );
            let mut events = Vec::new();
            let mut edit = EditState::default();
            paint(ui, &registry, &scx, root, &lay, &mut events, &mut edit, 0.0);
            let left = ctx.graphics(|g| {
                g.get(ui.layer_id())
                    .map(|list| {
                        list.all_entries()
                            .filter_map(|cs| match &cs.shape {
                                egui::Shape::Text(t) if t.galley.text() == "Find or ask" => {
                                    Some(t.visual_bounding_rect().min.x)
                                }
                                _ => None,
                            })
                            .fold(f32::INFINITY, f32::min)
                    })
                    .unwrap_or(f32::INFINITY)
            });
            *out.borrow_mut() = (left, lay.rects[&NodeId::from("icon")]);
        });
    harness.run_steps(2);
    let taken = *out.borrow();
    taken
}

#[test]
fn the_text_starts_after_the_start_icon() {
    let mut icon = node(
        "we-icon",
        "icon",
        &[
            ("name", Value::from("magnifying-glass")),
            ("mr", Value::from("200")),
        ],
    );
    icon.slot = Some(Arc::from("start"));
    let mut input = node(
        "we-input",
        "input",
        &[("placeholder", Value::from("Find or ask"))],
    );
    input.children = vec![ResolvedChild::Node(Box::new(icon))];

    let (text_left, icon) = painted_text(&input);
    // The icon's `mr` 200 (8px) separates it from the text.
    assert!(
        text_left >= icon.max.x + 8.0 - 0.5,
        "placeholder starts at {text_left}, icon {icon:?}"
    );
}

/// The field's corners follow the theme's input radius (glow: 14px), the
/// `radiusGroup` the TS primitive reads.
#[test]
fn the_field_takes_the_themes_input_radius() {
    let mut entries: IndexMap<Arc<str>, Arc<str>> = IndexMap::new();
    entries.insert(Arc::from("--we-theme-input-radius"), Arc::from("14px"));
    entries.insert(Arc::from("--we-radius-300"), Arc::from("8px"));
    let table = TokenTable::new(entries);
    let scx = StyleCx {
        tokens: &table,
        ..StyleCx::empty()
    };
    let style = we_egui::style_of(&node("we-input", "input", &[]), &scx);
    let r = format!("{:?}", style.paint.radius.top);
    assert!(r.contains("14"), "radius {:?}", style.paint.radius);
}
