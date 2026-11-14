//! Percentage terms inside `calc()` resolve against the containing block
//! the way the browser does — width/max-width against the CB's width,
//! padding (every edge) against the CB *width* — instead of dropping the
//! percent term or resolving against a stale base.
//!
//! The TS oracle (`buildLayoutStyles`) passes the expressions through
//! verbatim: `calc(100% - 2 * var(--we-space-300))`, `calc(10% + 16px)`,
//! `calc(33.33% - 6px)` — the numbers below are what a browser computes
//! at a 400px containing block with `--we-space-300: 12px`.

use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_layout::defaults::StyleCx;
use we_layout::{layout, Measure, PartsSpec, Pos2, Rect, Size, Vec2};
use we_style::TokenTable;
use we_template::{NodeId, ResolvedChild, ResolvedNode};

/// Every node is a plain container — children lay out directly, leaves take
/// the room they're offered.
struct TestMeasure;

impl Measure for TestMeasure {
    fn parts_spec(&self, _node: &ResolvedNode) -> Option<PartsSpec> {
        None
    }

    fn measure(&self, _node: &ResolvedNode, _style: &we_style::Style, avail: Size) -> Size {
        Size::new(avail.x.min(10.0), avail.y.min(10.0))
    }

    fn measure_text(&self, _owner: &ResolvedNode, _style: &we_style::Style, _text: &str) -> Size {
        Size::new(10.0, 10.0)
    }
}

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
        [("--we-space-300", "12px")]
            .iter()
            .map(|(k, v)| (Arc::from(*k), Arc::from(*v)))
            .collect::<IndexMap<Arc<str>, Arc<str>>>(),
    )
}

fn run(root: &ResolvedNode, w: f32, h: f32) -> we_layout::Layout {
    let tokens = tokens();
    let scx = StyleCx {
        tokens: &tokens,
        ..StyleCx::empty()
    };
    layout(
        &TestMeasure,
        &scx,
        root,
        Rect::from_min_size(Pos2::new(0.0, 0.0), Vec2::new(w, h)),
    )
}

fn rect(out: &we_layout::Layout, id: &str) -> Rect {
    out.rects.get(&NodeId::from(id)).copied().unwrap()
}

/// `max-width: calc(100% - 2 * 12px)` at a 400px CB clamps a stretched
/// child to 376px.
#[test]
fn calc_percent_max_width() {
    let mut root = node("Column", "r", &[]);
    let child = node(
        "Column",
        "r/c",
        &[
            (
                "maxWidth",
                Value::from("calc(100% - 2 * var(--we-space-300))"),
            ),
            ("height", Value::from("10px")),
        ],
    );
    root.children = vec![ResolvedChild::Node(Box::new(child))];

    let out = run(&root, 400.0, 200.0);
    let c = rect(&out, "r/c");
    assert!(
        (c.width() - 376.0).abs() < 0.01,
        "calc(100% - 24px) at CB 400 must be 376, got {c:?}"
    );
}

/// `padding: calc(10% + 16px)` — every edge reads the CB *width* (top and
/// bottom included): 40 + 16 = 56px at CB 400, so the child lands at
/// (56, 56) and gets 400 - 112 = 288px of content width.
#[test]
fn calc_percent_padding_edges_use_cb_width() {
    let mut box_ = node("Column", "b", &[("p", Value::from("calc(10% + 16px)"))]);
    let child = node(
        "Column",
        "b/c",
        &[
            ("width", Value::from("100%")),
            ("height", Value::from("10px")),
        ],
    );
    box_.children = vec![ResolvedChild::Node(Box::new(child))];
    let mut root = node("Column", "r", &[]);
    root.children = vec![ResolvedChild::Node(Box::new(box_))];

    let out = run(&root, 400.0, 200.0);
    let c = rect(&out, "b/c");
    assert!(
        (c.min.x - 56.0).abs() < 0.01,
        "left pad must be 56 (10% of CB width 400 + 16), got {c:?}"
    );
    assert!(
        (c.min.y - 56.0).abs() < 0.01,
        "top pad must also read the CB width: 56, got {c:?}"
    );
    assert!(
        (c.width() - 288.0).abs() < 0.01,
        "content width must be 400 - 2*56 = 288, got {c:?}"
    );
}

/// `width: calc(33.33% - 6px)` at CB 400 → 133.32 - 6 = 127.32px. Taffy
/// snaps every rect to the whole-pixel grid (`use_rounding` — the shipped
/// policy), so the used width lands on 127.
#[test]
fn calc_percent_width() {
    let mut root = node("Column", "r", &[]);
    let child = node(
        "Column",
        "r/c",
        &[
            ("width", Value::from("calc(33.33% - 6px)")),
            ("height", Value::from("10px")),
        ],
    );
    root.children = vec![ResolvedChild::Node(Box::new(child))];

    let out = run(&root, 400.0, 200.0);
    let c = rect(&out, "r/c");
    assert!(
        (c.width() - 127.32).abs() < 0.5,
        "calc(33.33% - 6px) at CB 400 must be 127.32 (pixel-snapped), got {c:?}"
    );
}

/// The base is the *parent's content box*, not the root frame: a 40px
/// padded wrapper inside the 400px root gives its child a 320px CB, so
/// `width: calc(50% - 5px)` computes 155 — not 195.
#[test]
fn calc_percent_uses_parent_content_box() {
    let mut wrapper = node("Column", "w", &[("p", Value::from("40px"))]);
    let child = node(
        "Column",
        "w/c",
        &[
            ("width", Value::from("calc(50% - 5px)")),
            ("height", Value::from("10px")),
        ],
    );
    wrapper.children = vec![ResolvedChild::Node(Box::new(child))];
    let mut root = node("Column", "r", &[]);
    root.children = vec![ResolvedChild::Node(Box::new(wrapper))];

    let out = run(&root, 400.0, 200.0);
    let c = rect(&out, "w/c");
    assert!(
        (c.width() - 155.0).abs() < 0.01,
        "calc(50% - 5px) against the 320px content box must be 155, got {c:?}"
    );
}

/// A narrowed root feeds its own resolved content box down: `width: 200px;
/// p: calc(10% + 16px)` at a 400px frame gives children a 200 - 2*56 = 88px
/// containing block — not the 400px frame the naive "root = CB" rule reads.
#[test]
fn calc_percent_uses_root_content_box_not_frame() {
    let mut root = node(
        "Column",
        "r",
        &[
            ("width", Value::from("200px")),
            ("p", Value::from("calc(10% + 16px)")),
        ],
    );
    let child = node(
        "Column",
        "r/c",
        &[
            ("width", Value::from("100%")),
            ("height", Value::from("10px")),
        ],
    );
    root.children = vec![ResolvedChild::Node(Box::new(child))];

    let out = run(&root, 400.0, 200.0);
    let c = rect(&out, "r/c");
    assert!(
        (c.width() - 88.0).abs() < 0.01,
        "100% of the root's 200 - 112 content box must be 88, got {c:?}"
    );
}

/// Dependency-order resolution, not iteration: four nested columns each
/// `width: calc(100% - 10px)` resolve 390 / 380 / 370 / 360 at a 400px
/// frame — each level's base is its *parent's resolved width*, a static
/// answer at arbitrary depth.
#[test]
fn calc_percent_nested_columns_resolve_in_order() {
    fn nest(ids: &[&str]) -> ResolvedChild {
        let mut n = node(
            "Column",
            ids[0],
            &[
                ("width", Value::from("calc(100% - 10px)")),
                ("height", Value::from("10px")),
            ],
        );
        if ids.len() > 1 {
            n.children = vec![nest(&ids[1..])];
        }
        ResolvedChild::Node(Box::new(n))
    }
    let mut root = node("Column", "r", &[]);
    root.children = vec![nest(&["c0", "c1", "c2", "c3"])];

    let out = run(&root, 400.0, 200.0);
    for (i, w) in [390.0_f32, 380.0, 370.0, 360.0].iter().enumerate() {
        let c = rect(&out, &format!("c{i}"));
        assert!(
            (c.width() - w).abs() < 0.01,
            "level {i}: calc(100% - 10px) must be {w}, got {c:?}"
        );
    }
}

/// `gap` percentages resolve against the element's *own* content box —
/// so on an auto-height column the row-gap % is cyclic: CSS resolves it
/// to zero (css-sizing-3 cyclic percentages). `calc(50% + 10px)` between
/// two 100px children is therefore a 10px gap and a 210px column — not
/// the 420px a measured-box feedback loop produces.
#[test]
fn calc_row_gap_auto_height_is_cyclic() {
    // The gapped column sits under a plain root — `layout` floors the
    // *root's* height at the viewport, which would hide the column's own
    // content height otherwise.
    let mut col = node(
        "Column",
        "c",
        &[("gap", Value::from("calc(50% + 10px) 0px"))],
    );
    col.children = vec![
        ResolvedChild::Node(Box::new(node(
            "Column",
            "a",
            &[
                ("width", Value::from("100px")),
                ("height", Value::from("100px")),
            ],
        ))),
        ResolvedChild::Node(Box::new(node(
            "Column",
            "b",
            &[
                ("width", Value::from("100px")),
                ("height", Value::from("100px")),
            ],
        ))),
    ];
    let mut root = node("Column", "r", &[]);
    root.children = vec![ResolvedChild::Node(Box::new(col))];

    let out = run(&root, 400.0, 400.0);
    let b = rect(&out, "b");
    assert!(
        (b.min.y - 110.0).abs() < 0.01,
        "cyclic row-gap resolves to the 10px non-percent term: b at y=110, got {b:?}"
    );
    let c = rect(&out, "c");
    assert!(
        (c.height() - 210.0).abs() < 0.5,
        "column height = 100 + 10 + 100 = 210 (pixel-snapped), got {c:?}"
    );
}

/// The same gap on a definite-height column resolves against the real own
/// size: `calc(50% + 10px)` of 400 = a 210px gap, child `b` at y = 310.
/// (`flexShrink: 0` keeps the children's 100px — CSS would otherwise
/// shrink them to fit the 400px column, 100 + 210 + 100 > 400.)
#[test]
fn calc_row_gap_definite_height_resolves_own_size() {
    let mut root = node(
        "Column",
        "r",
        &[
            ("height", Value::from("400px")),
            ("gap", Value::from("calc(50% + 10px) 0px")),
        ],
    );
    root.children = vec![
        ResolvedChild::Node(Box::new(node(
            "Column",
            "a",
            &[
                ("width", Value::from("100px")),
                ("height", Value::from("100px")),
                ("flexShrink", Value::from(0.0)),
            ],
        ))),
        ResolvedChild::Node(Box::new(node(
            "Column",
            "b",
            &[
                ("width", Value::from("100px")),
                ("height", Value::from("100px")),
                ("flexShrink", Value::from(0.0)),
            ],
        ))),
    ];

    let out = run(&root, 400.0, 400.0);
    let b = rect(&out, "b");
    assert!(
        (b.min.y - 310.0).abs() < 0.01,
        "definite own height: row-gap = 50% of 400 + 10 = 210 → b at y=310, got {b:?}"
    );
}

/// A bare `50%` row-gap on an auto-height column is cyclic too — zero,
/// per the same CSS rule (not half of a measured feedback box).
#[test]
fn percent_row_gap_auto_height_is_cyclic() {
    let mut root = node("Column", "r", &[("gap", Value::from("50% 0px"))]);
    root.children = vec![
        ResolvedChild::Node(Box::new(node(
            "Column",
            "a",
            &[
                ("width", Value::from("100px")),
                ("height", Value::from("100px")),
            ],
        ))),
        ResolvedChild::Node(Box::new(node(
            "Column",
            "b",
            &[
                ("width", Value::from("100px")),
                ("height", Value::from("100px")),
            ],
        ))),
    ];

    let out = run(&root, 400.0, 400.0);
    let b = rect(&out, "b");
    assert!(
        (b.min.y - 100.0).abs() < 0.01,
        "cyclic 50% row-gap resolves to 0: b at y=100, got {b:?}"
    );
}

/// A `calc` percent under a *flexed* parent — the containing block's
/// width is content-independent but only taffy knows it (a `Deferred`
/// base): the first build stands the percent term in, the measured pass
/// resolves it. Two `flex:1` columns in a 400px row give each a 200px
/// content box, so `calc(50% - 5px)` is 95px — not the placeholder's
/// 200px-ish answer.
#[test]
fn calc_percent_under_flexed_parent_resolves_after_measure() {
    let mut f = node("Column", "f", &[("flex", Value::from("1"))]);
    f.children = vec![ResolvedChild::Node(Box::new(node(
        "Column",
        "g",
        &[
            ("width", Value::from("calc(50% - 5px)")),
            ("height", Value::from("10px")),
        ],
    )))];
    let mut root = node("Row", "r", &[("width", Value::from("400px"))]);
    root.children = vec![
        ResolvedChild::Node(Box::new(f)),
        ResolvedChild::Node(Box::new(node("Column", "h", &[("flex", Value::from("1"))]))),
    ];

    let out = run(&root, 400.0, 400.0);
    let g = rect(&out, "g");
    assert!(
        (g.width() - 95.0).abs() < 0.5,
        "flexed column ~200px: 50% - 5 = 95, got {g:?}"
    );
    let b = out
        .bases
        .get(&NodeId::from("g"))
        .copied()
        .unwrap_or_default();
    assert!(
        b.cb.0.is_some_and(|v| (v - 200.0).abs() < 0.5),
        "g's containing block = the flexed column's measured width ~200, got {b:?}"
    );
}

/// A deferred base can *exist* and still be wrong: R's resolved width
/// moves F's measured width, so G's base is stale until the measured
/// values stop moving. Convergence is on the values `calc` consumed,
/// not on "every deferred key exists".
#[test]
fn calc_deferred_chain_converges_not_first_values() {
    // 400px Row → two `flex:1` Columns (200px each) → A holds Row R
    // (`calc(100% - 20px)`) → two `flex:1` Columns F,H → F holds G
    // (`calc(50% - 5px)`). Right answer: R=180 → F=90 → 0.5·90−5 = 40.
    // Stopping once values exist returns 45 (0.5·100−5 — the stale F
    // from the placeholder pass).
    let mut f = node(
        "Column",
        "f",
        &[("flex", Value::from("1")), ("minWidth", Value::from("0px"))],
    );
    f.children = vec![ResolvedChild::Node(Box::new(node(
        "Column",
        "g",
        &[
            ("width", Value::from("calc(50% - 5px)")),
            ("height", Value::from("10px")),
        ],
    )))];
    let mut r = node(
        "Row",
        "r",
        &[
            ("width", Value::from("calc(100% - 20px)")),
            ("height", Value::from("10px")),
        ],
    );
    r.children = vec![
        ResolvedChild::Node(Box::new(f)),
        ResolvedChild::Node(Box::new(node(
            "Column",
            "h",
            &[("flex", Value::from("1")), ("minWidth", Value::from("0px"))],
        ))),
    ];
    let mut a = node(
        "Column",
        "a",
        &[("flex", Value::from("1")), ("minWidth", Value::from("0px"))],
    );
    a.children = vec![ResolvedChild::Node(Box::new(r))];
    let mut root = node("Row", "root", &[]);
    root.children = vec![
        ResolvedChild::Node(Box::new(a)),
        ResolvedChild::Node(Box::new(node(
            "Column",
            "b",
            &[("flex", Value::from("1")), ("minWidth", Value::from("0px"))],
        ))),
    ];

    let out = run(&root, 400.0, 200.0);
    let g = rect(&out, "g");
    assert!(
        (g.width() - 40.0).abs() < 0.5,
        "two-stage deferred chain must converge: R=180 → F=90 → G=0.5·90−5=40, got {g:?}"
    );
}

/// A bare `Percent` padding goes straight to taffy — no `calc` term
/// consumed a deferred base — but paint still re-resolves the edge
/// against the exported `cb.0`, so the measured base must land in
/// `Layout::bases` even when the solve never rebuilds.
#[test]
fn percent_padding_under_deferred_base_exports_it() {
    // 400px Row → two `flex:1` Columns (200px each) → leaf `p: 10%`:
    // taffy reserves 20px/edge itself; paint needs cb.0 = 200, not None.
    let mut col = node(
        "Column",
        "a",
        &[("flex", Value::from("1")), ("minWidth", Value::from("0px"))],
    );
    col.children = vec![ResolvedChild::Node(Box::new(node(
        "Column",
        "leaf",
        &[("p", Value::from("10%"))],
    )))];
    let mut root = node("Row", "r", &[]);
    root.children = vec![
        ResolvedChild::Node(Box::new(col)),
        ResolvedChild::Node(Box::new(node(
            "Column",
            "b",
            &[("flex", Value::from("1")), ("minWidth", Value::from("0px"))],
        ))),
    ];

    let out = run(&root, 400.0, 200.0);
    let b = out
        .bases
        .get(&NodeId::from("leaf"))
        .copied()
        .unwrap_or_default();
    assert_eq!(
        b.cb.0,
        Some(200.0),
        "bare-percent padding's containing block must be exported — paint insets against it, got {b:?}"
    );
    // And taffy really reserved the padding — the unstretched axis shows
    // the intrinsic 10px content plus 20px per edge.
    let l = rect(&out, "leaf");
    assert!(
        (l.height() - 50.0).abs() < 0.5,
        "leaf border-box height = 10 + 2×20px padding = 50, got {l:?}"
    );
}

/// A declared main-axis size is the flex *base*, not the used size —
/// `flex-shrink` still moves it, and a child's percent resolves against
/// the used size taffy computed (the CSS §flexbox "definite used size"
/// rule).
#[test]
fn calc_child_of_shrunk_flex_item_reads_used_size() {
    // 400px Row, two `width:300px; min-width:0` columns — flex-shrink:1
    // is the CSS initial — shrink to 200px each. G's `calc(50% - 5px)`
    // resolves against 200: 95px, not the declared-300 answer 145.
    let item = |id: &str, child: Option<ResolvedNode>| {
        let mut n = node(
            "Column",
            id,
            &[
                ("width", Value::from("300px")),
                ("minWidth", Value::from("0px")),
            ],
        );
        if let Some(c) = child {
            n.children = vec![ResolvedChild::Node(Box::new(c))];
        }
        n
    };
    let g = node(
        "Column",
        "g",
        &[
            ("width", Value::from("calc(50% - 5px)")),
            ("height", Value::from("10px")),
        ],
    );
    let mut root = node("Row", "r", &[]);
    root.children = vec![
        ResolvedChild::Node(Box::new(item("a", Some(g)))),
        ResolvedChild::Node(Box::new(item("b", None))),
    ];

    let out = run(&root, 400.0, 200.0);
    let a = rect(&out, "a");
    assert!(
        (a.width() - 200.0).abs() < 0.5,
        "the 300px item shrank to 200, got {a:?}"
    );
    let g = rect(&out, "g");
    assert!(
        (g.width() - 95.0).abs() < 0.5,
        "child of a shrunk flex item resolves against the used 200px, not declared 300 — 95 expected, got {g:?}"
    );
}

/// A `display:none` child produces no grid item — the row recipe must
/// count laid-out children, not `node.children.len()`.
#[test]
fn grid_row_recipe_skips_hidden_children() {
    // 400px-tall Grid, one column, no gap: one visible + one `display:
    // none` child → the single 1fr row occupies 400px, so the visible
    // `calc(50% - 5px)` height is 195. Counting the hidden child makes
    // it a 2-row recipe → 95.
    let mut grid = node(
        "Grid",
        "grid",
        &[
            ("columns", Value::from(1.0)),
            ("height", Value::from("400px")),
        ],
    );
    grid.children = vec![
        ResolvedChild::Node(Box::new(node(
            "Column",
            "v",
            &[
                ("height", Value::from("calc(50% - 5px)")),
                ("width", Value::from("10px")),
            ],
        ))),
        ResolvedChild::Node(Box::new(node(
            "Column",
            "h",
            &[
                ("display", Value::from("none")),
                ("height", Value::from("10px")),
                ("width", Value::from("10px")),
            ],
        ))),
    ];
    let mut root = node("Column", "r", &[]);
    root.children = vec![ResolvedChild::Node(Box::new(grid))];

    let out = run(&root, 400.0, 400.0);
    let v = rect(&out, "v");
    assert!(
        (v.height() - 195.0).abs() < 0.5,
        "one visible item = one 400px row: 0.5·400−5 = 195, got {v:?}"
    );
}

/// An out-of-flow child makes no track either: `absolute`/`fixed`/
/// `sticky` children map to taffy `Position::Absolute`, so taffy lays
/// out one item and the row recipe must count only in-flow children.
#[test]
fn grid_row_recipe_skips_out_of_flow_children() {
    // 400px-tall Grid, one column, no gap: one in-flow item + one
    // `absolute` child → the single 1fr row occupies 400px, so the
    // visible `calc(50% - 5px)` height is 195. Counting the positioned
    // child makes it a 2-row recipe → 95.
    let mut grid = node(
        "Grid",
        "grid",
        &[
            ("columns", Value::from(1.0)),
            ("height", Value::from("400px")),
        ],
    );
    grid.children = vec![
        ResolvedChild::Node(Box::new(node(
            "Column",
            "v",
            &[
                ("height", Value::from("calc(50% - 5px)")),
                ("width", Value::from("10px")),
            ],
        ))),
        ResolvedChild::Node(Box::new(node(
            "Column",
            "a",
            &[
                ("position", Value::from("absolute")),
                ("height", Value::from("10px")),
                ("width", Value::from("10px")),
            ],
        ))),
    ];
    let mut root = node("Column", "r", &[]);
    root.children = vec![ResolvedChild::Node(Box::new(grid))];

    let out = run(&root, 400.0, 400.0);
    let v = rect(&out, "v");
    assert!(
        (v.height() - 195.0).abs() < 0.5,
        "one in-flow item = one 400px row: 0.5·400−5 = 195, got {v:?}"
    );
}

/// A `minChildWidth` grid's rows follow the *measured* column count:
/// `ceil(items / cols)` `1fr` shares of the grid's content height.
#[test]
fn grid_autofill_row_recipe_reads_measured_columns() {
    // 400px-tall, 400px-wide Grid with `minChildWidth: 100` and two
    // items → 4 columns, ceil(2/4) = 1 row of 400px → `calc(50% - 5px)`
    // height is 195. No recipe (the old `None` arm) leaves it cyclic —
    // auto height → the 10px intrinsic.
    let mut grid = node(
        "Grid",
        "grid",
        &[
            ("minChildWidth", Value::from(100.0)),
            ("height", Value::from("400px")),
        ],
    );
    grid.children = vec![
        ResolvedChild::Node(Box::new(node(
            "Column",
            "v",
            &[("height", Value::from("calc(50% - 5px)"))],
        ))),
        ResolvedChild::Node(Box::new(node(
            "Column",
            "w",
            &[("height", Value::from("10px"))],
        ))),
    ];
    let mut root = node("Column", "r", &[]);
    root.children = vec![ResolvedChild::Node(Box::new(grid))];

    let out = run(&root, 400.0, 400.0);
    let v = rect(&out, "v");
    assert!(
        (v.height() - 195.0).abs() < 0.5,
        "4 cols of 100 → 1 row of 400: 0.5·400−5 = 195, got {v:?}"
    );
}

/// Percentage *margins* share padding's rule: every edge resolves
/// against the containing block's *width* (CSS2.1 §8.3) — including
/// `margin-top`/`bottom`. The taffy adapter already does that; the
/// static box derivation must too.
#[test]
fn calc_vertical_percent_margins_use_cb_width() {
    // 400px-wide, 200px-tall Row, cross-stretched auto-height child
    // with `my: 10%`: margins are 40px each (10% of the 400 *width*),
    // leaving 120 — not the 160 a height-based derivation invents.
    // (The Row's `flexShrink:0` keeps its declared height a static
    // `Definite` so the margin bug shows as the wrong number, not a
    // collapsed `Indefinite`.)
    let mut child = node("Column", "c", &[("my", Value::from("10%"))]);
    child.children = vec![ResolvedChild::Node(Box::new(node(
        "Column",
        "g",
        &[
            ("height", Value::from("calc(100% - 10px)")),
            ("width", Value::from("10px")),
        ],
    )))];
    let mut row = node(
        "Row",
        "r",
        &[
            ("height", Value::from("200px")),
            ("flexShrink", Value::from("0")),
        ],
    );
    row.children = vec![ResolvedChild::Node(Box::new(child))];
    let mut root = node("Column", "root", &[]);
    root.children = vec![ResolvedChild::Node(Box::new(row))];

    let out = run(&root, 400.0, 400.0);
    let c = rect(&out, "c");
    assert!(
        (c.height() - 120.0).abs() < 0.5,
        "stretched height = 200 − 2×40 = 120, got {c:?}"
    );
    let g = rect(&out, "g");
    assert!(
        (g.height() - 110.0).abs() < 0.5,
        "grandchild height = 100%·120 − 10 = 110, got {g:?}"
    );
}

/// An explicit `position: static` is the CSS default — it does not
/// establish a containing block for absolutely-positioned descendants
/// (CSS2.1 §10.1: the CB is "the padding edge of the nearest positioned
/// ancestor", and `static` is not positioned).
#[test]
fn calc_abs_child_skips_explicit_static_wrapper() {
    // `relative` 400px ancestor → 200px `static` wrapper → abs child
    // `calc(50% - 5px)`. The CB is the relative ancestor's padding box
    // (400 → 195); an explicit `static` counted → the wrapper's 200 → 95.
    let mut wrapper = node(
        "Column",
        "w",
        &[
            ("position", Value::from("static")),
            ("width", Value::from("200px")),
            ("height", Value::from("100px")),
        ],
    );
    wrapper.children = vec![ResolvedChild::Node(Box::new(node(
        "Column",
        "g",
        &[
            ("position", Value::from("absolute")),
            ("width", Value::from("calc(50% - 5px)")),
            ("height", Value::from("10px")),
        ],
    )))];
    let mut rel = node(
        "Column",
        "rel",
        &[
            ("position", Value::from("relative")),
            ("width", Value::from("400px")),
            ("height", Value::from("300px")),
        ],
    );
    rel.children = vec![ResolvedChild::Node(Box::new(wrapper))];
    let mut root = node("Column", "r", &[]);
    root.children = vec![ResolvedChild::Node(Box::new(rel))];

    let out = run(&root, 400.0, 400.0);
    let g = rect(&out, "g");
    assert!(
        (g.width() - 195.0).abs() < 0.5,
        "abs child resolves against the relative ancestor's 400px padding box — 195, got {g:?}"
    );
}

/// An absolutely-positioned child's containing block is its positioned
/// ancestor's *padding* box: `p: calc(10% + 16px)` inside a `relative`
/// 400px parent padded 40 resolves against 400 (56px), not the 320px
/// content box an in-flow child would read.
#[test]
fn calc_abs_child_uses_positioned_padding_box() {
    let mut root = node(
        "Column",
        "r",
        &[
            ("position", Value::from("relative")),
            ("p", Value::from("40px")),
        ],
    );
    let mut abs = node(
        "Column",
        "abs",
        &[
            ("position", Value::from("absolute")),
            ("left", Value::from("0px")),
            ("top", Value::from("0px")),
            ("p", Value::from("calc(10% + 16px)")),
            ("width", Value::from("200px")),
            ("height", Value::from("200px")),
        ],
    );
    abs.children = vec![ResolvedChild::Node(Box::new(node(
        "Column",
        "abs/c",
        &[
            ("width", Value::from("100%")),
            ("height", Value::from("10px")),
        ],
    )))];
    root.children = vec![ResolvedChild::Node(Box::new(abs))];

    let out = run(&root, 400.0, 400.0);
    // The exported bases say what the child's percent terms resolved
    // against — paint reads this instead of re-deriving a base.
    let b = out
        .bases
        .get(&NodeId::from("abs"))
        .copied()
        .unwrap_or_default();
    assert_eq!(
        b.cb.0,
        Some(400.0),
        "abs containing block = positioned ancestor's padding box (400), got {b:?}"
    );
    let c = rect(&out, "abs/c");
    assert!(
        (c.min.x - 56.0).abs() < 0.01 && (c.width() - 88.0).abs() < 0.01,
        "abs padding = 10% of 400 + 16 = 56 → content 200 - 112 = 88 at x=56, got {c:?}"
    );
}
