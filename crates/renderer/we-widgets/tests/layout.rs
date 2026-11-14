//! Taffy layout: a `Row` with `gap` and fixed children lands them at the
//! expected rects — the DS props reaching the tree walk.
use std::sync::Arc;

use indexmap::IndexMap;
use we_template::{NodeId, ResolvedChild, ResolvedNode};
use we_widgets::{layout, MeasureCx, Registry};

fn node(ty: &str, id: &str, props: &[(&str, we_expr::Value)]) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from(id),
        ty: Arc::from(ty),
        props: props
            .iter()
            .map(|(k, v)| (Arc::from(*k), v.clone()))
            .collect::<IndexMap<Arc<str>, we_expr::Value>>(),
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        transition: None,
    }
}

#[test]
fn row_with_gap_and_fixed_children() {
    // gap "300" is a spacing token → 12px; width "100px" → 100.
    let mut row = node(
        "Row",
        "r",
        &[
            ("direction", we_expr::Value::from("row")),
            ("gap", we_expr::Value::from("300")),
        ],
    );
    let a = node(
        "Column",
        "r/a",
        &[
            ("width", we_expr::Value::from("100px")),
            ("height", we_expr::Value::from("20px")),
        ],
    );

    let b = node(
        "Column",
        "r/b",
        &[
            ("width", we_expr::Value::from("40px")),
            ("height", we_expr::Value::from("20px")),
        ],
    );

    row.children = vec![
        ResolvedChild::Node(Box::new(a)),
        ResolvedChild::Node(Box::new(b)),
    ];

    // gap "300" resolves through the theme's `--we-space-300` token.
    let mut vars = IndexMap::new();
    vars.insert(Arc::from("--we-space-300"), Arc::from("12px"));
    let tokens = we_style::TokenTable::new(vars);
    let scx = we_widgets::StyleCx {
        tokens: &tokens,
        ..we_widgets::StyleCx::empty()
    };

    let registry = Registry::with_builtins();
    let out = std::cell::RefCell::new(None);
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let cx = MeasureCx::new(ui.ctx());
        *out.borrow_mut() = Some(layout(
            &cx,
            &scx,
            &registry,
            &row,
            egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(400.0, 100.0)),
        ));
    });
    harness.run();
    let layout = out.borrow_mut().take().expect("layout ran");

    let a = layout.rects.get(&NodeId::from("r/a")).copied().unwrap();
    let b = layout.rects.get(&NodeId::from("r/b")).copied().unwrap();
    assert_eq!(a.size(), egui::vec2(100.0, 20.0));
    assert_eq!(b.size(), egui::vec2(40.0, 20.0));
    assert!(
        (b.min.x - a.max.x - 12.0).abs() < 0.01,
        "gap must be 12px: a {a:?} b {b:?}"
    );
    assert_eq!(a.min, egui::pos2(0.0, 0.0));
}
