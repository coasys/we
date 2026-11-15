//! E3c-12b end-to-end: a non-default `StyleCx.metrics` reaches layout
//! (a `1rem`/`1ch`/`1ex`/`1lh` gap in the laid-out rects), style
//! resolution (`1rem`/`1ch`/`1ex`/`1lh` dimensions) and the egui text
//! run's font size — the metrics are plumbed through production, not a
//! test-only facade.
use std::cell::RefCell;
use std::sync::Arc;

use indexmap::IndexMap;
use we_egui::{layout, paint, style_of, EditState, MeasureCx, Registry, StyleCx};
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

/// `Column` over three 10px divs, the row `gap` authored through the
/// `styles` hatch — raw CSS, so `1lh` arrives as `Dimension::Lh`. (The
/// `gap` prop itself goes through `token_var`: `ch`/`ex` are raw-CSS
/// units but `lh` is not, so `gap: "1lh"` would emit an unset
/// `var(--we-space-1lh)` — a real authoring trap, out of scope here.)
fn gap_tree(gap: &str) -> ResolvedNode {
    let mut root = node("Column", "root", &[("ay", "start")]);
    let mut styles = IndexMap::new();
    styles.insert(Arc::from("gap"), we_expr::Value::from(gap));
    root.props
        .insert(Arc::from("styles"), we_expr::Value::from(styles));
    let a = node("div", "a", &[("height", "10px")]);
    let t = node("div", "t", &[("height", "10px")]);
    let b = node("div", "b", &[("height", "10px")]);
    root.children = vec![
        ResolvedChild::Node(Box::new(a)),
        ResolvedChild::Node(Box::new(t)),
        ResolvedChild::Node(Box::new(b)),
    ];
    root
}

/// A node's decls through `style_of`, then `pick`'s dimension folded by
/// `style_of`'s own `unit_metrics` — the pair `dim_px` makes when layout
/// offers the box. `ch`/`ex`/`lh` only fold in `Dimension::resolve` —
/// `to_px` refuses them by design — so this is the resolution the `1rem`
/// test's evaluator leg cannot express.
fn styled_px(
    props: &[(&str, &str)],
    pick: impl Fn(&we_style::Style) -> Option<we_style::Dimension>,
    metrics: UnitMetrics,
) -> Option<f32> {
    let table = TokenTable::new(IndexMap::new());
    let n = node("div", "x", props);
    let mut scx = StyleCx::empty();
    scx.tokens = &table;
    scx.metrics = metrics;
    let style = style_of(&n, &scx);
    let m = we_layout::defaults::unit_metrics(&scx);
    pick(&style).and_then(|d| d.resolve(None, &m, scx.viewport))
}

/// `gap: 1{unit}` through the egui pipeline twice — default metrics on
/// the first frame, `metrics` on the second — returning the laid-out
/// gap each frame, the two numbers the `1rem` test compares.
fn framed_gaps(unit: &str, metrics: UnitMetrics) -> (f32, f32) {
    let registry = Registry::with_builtins();
    let table = TokenTable::new(IndexMap::new());
    let gap = format!("1{unit}");
    let tree = gap_tree(&gap);
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
        out.borrow_mut().push(gap_before(&lay, "a", "t"));
    });
    harness.run_steps(2);
    let seen = out.borrow();
    (seen[0], seen[1])
}

/// `ch_em` — `1ch` folds `ch_em` of `font_px`. `font_px` stays the 14px
/// default so the ratio is the only moving part; `ch_em = 1.0` makes the
/// fold an integer so taffy's px-edge rounding cannot blur it.
#[test]
fn non_default_ch_em_reaches_style_and_layout() {
    // `ch_em = 1.0` (default 0.5): `1ch` is 14px configured, 7px under
    // the default — it must move in style resolution and in the laid-out
    // gap.
    let metrics = UnitMetrics {
        ch_em: 1.0,
        ..UnitMetrics::default()
    };
    let want = metrics.ch_em * metrics.font_px;

    let w = styled_px(&[("width", "1ch")], |s| s.layout.width, metrics).expect("1ch resolves");
    assert!(
        (w - want).abs() < 0.001,
        "1ch folds ch_em of font_px through style resolution, got {w}"
    );

    let (gap_default, gap_moved) = framed_gaps("ch", metrics);
    assert!(
        (gap_default - 0.5 * metrics.font_px).abs() < 0.001,
        "the default 1ch gap is 7px, got {gap_default}"
    );
    assert!(
        (gap_moved - want).abs() < 0.001,
        "ch_em=1.0 moves the layout gap to 14px, got {gap_moved}"
    );
}

/// `ex_em` — `1ex` folds `ex_em` of `font_px`, same plumbing as `ch`.
#[test]
fn non_default_ex_em_reaches_style_and_layout() {
    // `ex_em = 1.5` (default 0.5): `1ex` is 21px configured, 7px under
    // the default.
    let metrics = UnitMetrics {
        ex_em: 1.5,
        ..UnitMetrics::default()
    };
    let want = metrics.ex_em * metrics.font_px;

    let w = styled_px(&[("width", "1ex")], |s| s.layout.width, metrics).expect("1ex resolves");
    assert!(
        (w - want).abs() < 0.001,
        "1ex folds ex_em of font_px through style resolution, got {w}"
    );

    let (gap_default, gap_moved) = framed_gaps("ex", metrics);
    assert!(
        (gap_default - 0.5 * metrics.font_px).abs() < 0.001,
        "the default 1ex gap is 7px, got {gap_default}"
    );
    assert!(
        (gap_moved - want).abs() < 0.001,
        "ex_em=1.5 moves the layout gap to 21px, got {gap_moved}"
    );
}

/// `lh_em` — `1lh` folds `lh_em` of `font_px`, and `line-height: 2lh`
/// is a length folding the same ratio. The painted `line-height` path
/// (`line_height_px`) goes through `to_px`, which refuses `lh` by
/// design, so style resolution and layout are the observable surfaces.
#[test]
fn non_default_lh_em_reaches_style_and_layout() {
    // `lh_em = 2.0` at `font_px = 15` (defaults 1.4, 14): `1lh` is 30px
    // configured, 19.6px under the default — `font_px` moves only so
    // both folds stay integers taffy's px-edge rounding cannot blur.
    let metrics = UnitMetrics {
        font_px: 15.0,
        lh_em: 2.0,
        ..UnitMetrics::default()
    };
    let want = metrics.lh_em * metrics.font_px;

    let w = styled_px(&[("width", "1lh")], |s| s.layout.width, metrics).expect("1lh resolves");
    assert!(
        (w - want).abs() < 0.001,
        "1lh folds lh_em of font_px through style resolution, got {w}"
    );
    let line = styled_px(
        &[("lineHeight", "2lh")],
        |s| match s.text.line_height {
            Some(we_style::LineHeight::Length(d)) => Some(d),
            _ => None,
        },
        metrics,
    )
    .expect("line-height: 2lh resolves");
    assert!(
        (line - 2.0 * want).abs() < 0.001,
        "line-height: 2lh folds lh_em of font_px, got {line}"
    );

    let (gap_default, gap_moved) = framed_gaps("lh", metrics);
    // The default metrics' `1lh` is 1.4·14 = 19.6 — taffy rounds the
    // laid-out edges to whole px, so the measured gap is 20.
    assert!(
        (gap_default - 19.6).abs() < 0.5,
        "the default 1lh gap is 19.6px (rounded), got {gap_default}"
    );
    assert!(
        (gap_moved - want).abs() < 0.001,
        "lh_em=2.0 moves the layout gap to 30px, got {gap_moved}"
    );
}

// ── E3c-12b P3/S1: theme font at the former direct-constant callers ─────
//
// Two paint/measure paths used to read the baked font/root-px
// constants and now read the folded `unit_metrics` view — an intended
// correction toward the web, where both follow the theme font:
//
// - tooltip.ts:89 — `font-size: var(--we-font-size-200, 14px);` — the
//   `content`-prop bubble rides the recorded font scale, not a fixed 14px.
//   (The web reads the -200 step; the port's `font_px` tracks the -300
//   step the theme records — what moves here is theme-following, which is
//   what this test pins.)
// - avatar.ts:233-235 — `// Handle custom size values (e.g., "20px",
//   "2rem")` → `this.style.setProperty('--we-avatar-size', this.size);` —
//   the browser resolves the authored `em`/`rem` against the live font,
//   so `Avatar::size_px` folds `view.metrics`, not a constant.

/// The `font_id.size` of every painted text run across ALL layers — the
/// tooltip's bubble paints on the overlay layer, which page-layer reads
/// miss. `(text, size)` pairs; the assertion picks its own run.
fn painted_text_sizes(root: &ResolvedNode, themed: &std::cell::Cell<bool>) -> Vec<(String, f32)> {
    let registry = Registry::with_builtins();
    let empty = TokenTable::new(IndexMap::new());
    // A theme recording `--we-font-size-300: 16px` — the scale's `1rem`
    // step that `unit_metrics` folds over `font_px`/`root_px`.
    let mut vars = IndexMap::new();
    vars.insert(Arc::from("--we-font-size-300"), Arc::from("16px"));
    let themed_tokens = TokenTable::new(vars);
    let out = RefCell::new(Vec::new());
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let ctx = ui.ctx().clone();
        we_egui::install_media(&ctx);
        let mut scx = StyleCx::empty();
        scx.tokens = if themed.get() { &themed_tokens } else { &empty };
        let lay = layout(
            &MeasureCx::new(&ctx),
            &scx,
            &registry,
            root,
            egui::Rect::from_min_size(ui.cursor().min, egui::vec2(400.0, 600.0)),
        );
        let mut events = Vec::new();
        let mut edit = EditState::default();
        paint(
            ui,
            &registry,
            &scx,
            &root,
            &lay,
            &mut events,
            &mut edit,
            0.0,
        );
        out.borrow_mut().clear();
        ctx.graphics_mut(|g| {
            for cs in g.drain(&[], &Default::default()) {
                if let egui::Shape::Text(t) = cs.shape {
                    if let Some(s) = t.galley.job.sections.first() {
                        out.borrow_mut()
                            .push((t.galley.text().to_string(), s.format.font_id.size));
                    }
                }
            }
        });
    });
    harness.run_steps(2);
    let seen = out.borrow().clone();
    seen
}

/// A prop-only `we-tooltip` (`content` is the content slot's fallback —
/// no `slot="content"` child) held open by its `open` prop.
#[test]
fn tooltip_fallback_text_follows_the_theme_font() {
    let mut tip = node("we-tooltip", "t", &[("content", "just text")]);
    tip.props
        .insert(Arc::from("open"), we_expr::Value::Bool(true));
    tip.children = vec![ResolvedChild::Node(Box::new(node(
        "we-button",
        "t/b",
        &[("text", "hover me")],
    )))];

    let themed = std::cell::Cell::new(false);
    let default_sizes = painted_text_sizes(&tip, &themed);
    themed.set(true);
    let themed_sizes = painted_text_sizes(&tip, &themed);

    let find = |sizes: &[(String, f32)]| {
        sizes
            .iter()
            .find(|(t, _)| t.contains("just text"))
            .map(|(_, s)| *s)
    };
    // `unit_metrics.font_px`: 14 under the default metrics, 16 under a
    // theme recording `--we-font-size-300: 16px` — the tooltip.ts:89
    // `var(--we-font-size-200, 14px)` answer moves with the theme font.
    assert_eq!(
        find(&default_sizes),
        Some(14.0),
        "the fallback text paints at the default font_px: {default_sizes:?}"
    );
    assert_eq!(
        find(&themed_sizes),
        Some(16.0),
        "the fallback text follows the themed font_px: {themed_sizes:?}"
    );
}

/// `Avatar::size_px` is the read `AvatarStack::measure` lays out (the
/// stack's style pins no width/height, so taffy asks for the measure) —
/// its `em`/`rem` fold is observable as the stack's square rect.
/// `size: "2em"` is `2·font_px`; `size: "2rem"` is `2·root_px`.
#[test]
fn avatar_relative_size_follows_the_theme_font() {
    let mut root = node("Column", "r", &[("ay", "start")]);
    root.children = vec![
        ResolvedChild::Node(Box::new(node("AvatarStack", "em", &[("size", "2em")]))),
        ResolvedChild::Node(Box::new(node("AvatarStack", "rem", &[("size", "2rem")]))),
    ];

    // Frame 1's table records `--we-font-size-300: 13px` — the cyberpunk
    // fold — so `font_px`/`root_px` both move: `2em` 28 → 26 and `2rem`
    // 32 → 26.
    let registry = Registry::with_builtins();
    let empty = TokenTable::new(IndexMap::new());
    let mut vars = IndexMap::new();
    vars.insert(Arc::from("--we-font-size-300"), Arc::from("13px"));
    let themed_tokens = TokenTable::new(vars);
    let frame = std::cell::Cell::new(0usize);
    let out = RefCell::new(Vec::new());
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let ctx = ui.ctx().clone();
        we_egui::install_media(&ctx);
        let mut scx = StyleCx::empty();
        scx.tokens = if frame.get() == 0 {
            &empty
        } else {
            &themed_tokens
        };
        frame.set(frame.get() + 1);
        let lay = layout(
            &MeasureCx::new(&ctx),
            &scx,
            &registry,
            &root,
            egui::Rect::from_min_size(ui.cursor().min, egui::vec2(400.0, 600.0)),
        );
        // Paint too: `size_px` also reads the paint-time view — the stash
        // `store_view` leaves is what measure read through `view_of`.
        let mut events = Vec::new();
        let mut edit = EditState::default();
        paint(
            ui,
            &registry,
            &scx,
            &root,
            &lay,
            &mut events,
            &mut edit,
            0.0,
        );
        out.borrow_mut().push((
            lay.rects[&NodeId::from("em")].height(),
            lay.rects[&NodeId::from("rem")].height(),
        ));
    });
    harness.run_steps(2);
    let seen = out.borrow();
    let (em_default, rem_default) = seen[0];
    let (em_themed, rem_themed) = seen[1];
    // avatar.ts:233-235 hands the authored length to the browser's font
    // metrics: `2em` under the default font_px (14) is 28, under the
    // theme's 13px fold 26; `2rem` under root_px 16 is 32, under 13px 26.
    assert_eq!(em_default, 28.0, "2em under default font_px: {em_default}");
    assert_eq!(em_themed, 26.0, "2em under themed font_px: {em_themed}");
    assert_eq!(
        rem_default, 32.0,
        "2rem under default root_px: {rem_default}"
    );
    assert_eq!(rem_themed, 26.0, "2rem under themed root_px: {rem_themed}");
}
