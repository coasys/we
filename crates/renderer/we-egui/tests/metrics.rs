//! E3c-12b end-to-end: a non-default `StyleCx.metrics` reaches layout
//! (a `1rem` gap in the laid-out rects), `we-style`'s evaluator (a
//! `1rem` dimension) and the egui text run's font size — the metrics are
//! plumbed through production, not a test-only facade.
use std::cell::RefCell;
use std::sync::Arc;

use indexmap::IndexMap;
use we_egui::{layout, paint, EditState, MeasureCx, Registry, StyleCx};
use we_metrics::UnitMetrics;
use we_style::{Direction, Size, StyleInput, TokenTable};
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

/// `Column { gap: 1rem }` over a 10px child, a `we-text` set at
/// `font-size: 1rem`, and another 10px child — the gap and the text size
/// both read the one metric.
fn tree() -> ResolvedNode {
    let mut root = node("Column", "root", &[("gap", "1rem"), ("ay", "start")]);
    let a = node("div", "a", &[("height", "10px")]);
    let mut t = node("we-text", "t", &[("text", "HELLO")]);
    let mut styles = IndexMap::new();
    styles.insert(Arc::from("font-size"), we_expr::Value::from("1rem"));
    t.props
        .insert(Arc::from("styles"), we_expr::Value::from(styles));
    let b = node("div", "b", &[("height", "10px")]);
    root.children = vec![
        ResolvedChild::Node(Box::new(a)),
        ResolvedChild::Node(Box::new(t)),
        ResolvedChild::Node(Box::new(b)),
    ];
    root
}

/// The first painted text run's font size on the root layer.
fn painted_font_size(ui: &egui::Ui) -> Option<f32> {
    let ctx = ui.ctx();
    let layer = ui.layer_id();
    ctx.graphics(|g| {
        g.get(layer).and_then(|list| {
            list.all_entries().find_map(|cs| match &cs.shape {
                egui::Shape::Text(t) => {
                    t.galley.job.sections.first().map(|s| s.format.font_id.size)
                }
                _ => None,
            })
        })
    })
}

/// Gap between `a`'s bottom and `t`'s top in the laid-out rects.
fn gap_before(lay: &we_egui::Layout, before: &str, after: &str) -> f32 {
    let b = lay.rects[&NodeId::from(before)];
    let a = lay.rects[&NodeId::from(after)];
    a.min.y - b.max.y
}

#[test]
fn non_default_metrics_reach_layout_style_and_text() {
    // `1rem`: 16px under the default, 20px configured — one number that
    // must move in all three places.
    let metrics = UnitMetrics {
        root_px: 20.0,
        ..UnitMetrics::default()
    };

    // `we-style`'s evaluator: `width: 1rem` resolves through
    // `input.metrics.root_px`.
    let tokens = TokenTable::new(IndexMap::new());
    let mut bag = we_style::Bag::new();
    bag.insert(Arc::from("width"), we_expr::Value::from("1rem"));
    let mut input = StyleInput::new(&tokens, Direction::Column);
    input.metrics = metrics;
    let style = we_style::resolve(&bag, &input);
    let w = style
        .layout
        .width
        .expect("width resolved")
        .to_px(&metrics, Size::new(0.0, 0.0))
        .expect("rem resolves");
    assert_eq!(w, 20.0, "1rem under root_px=20 in the evaluator");

    // The egui pipeline, once per frame: the default metrics on the
    // first frame, the configured ones on the second. The laid-out gap
    // and the painted run's font size must move.
    let registry = Registry::with_builtins();
    let table = TokenTable::new(IndexMap::new());
    let tree = tree();
    let out = RefCell::new(Vec::new());
    let frame = std::cell::Cell::new(0usize);
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let ctx = ui.ctx().clone();
        we_egui::install_media(&ctx);
        let m = if frame.get() == 0 {
            UnitMetrics::default()
        } else {
            metrics
        };
        frame.set(frame.get() + 1);
        let mut scx = StyleCx::empty();
        scx.tokens = &table;
        scx.metrics = m;
        let lay = layout(
            &MeasureCx::new(&ctx),
            &scx,
            &registry,
            &tree,
            egui::Rect::from_min_size(ui.cursor().min, egui::vec2(400.0, 600.0)),
        );
        let gap = gap_before(&lay, "a", "t");
        let mut events = Vec::new();
        let mut edit = EditState::default();
        paint(
            ui,
            &registry,
            &scx,
            &tree,
            &lay,
            &mut events,
            &mut edit,
            0.0,
        );
        let size = painted_font_size(ui);
        out.borrow_mut().push((gap, size));
    });
    harness.run_steps(2);
    let seen = out.borrow();
    let (gap_default, size_default) = seen[0];
    let (gap_moved, size_moved) = seen[1];
    assert!(
        (gap_default - 16.0).abs() < 0.001,
        "the default 1rem gap is 16px, got {gap_default}"
    );
    assert!(
        (gap_moved - 20.0).abs() < 0.001,
        "root_px=20 moves the layout gap to 20px, got {gap_moved}"
    );
    assert_eq!(size_default, Some(16.0), "the default 1rem text is 16px");
    assert_eq!(
        size_moved,
        Some(20.0),
        "root_px=20 moves the painted font size to 20px"
    );
}
