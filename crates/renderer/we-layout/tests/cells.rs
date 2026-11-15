//! The §6.1 pinned example, run through the real layout walk
//! ([`layout_unrounded`] — `layout()` with taffy's px-edge snap off): a
//! bordered, padded, gapped `Row` with two flex children, a `25%` child
//! and a nested `50%` child, projected onto a terminal's cell grid by
//! [`we_layout::cells::project`].
//!
//! Expected values are hand-computed from the one snapping rule,
//! `col(x) = floor(x / cell_w + 0.5)`, applied to each edge on its own.
//! The fractional px widths are asserted before snapping (to 1e-3), so a
//! pipeline that rounds to half-cells early cannot pass.

use std::collections::HashMap;
use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;
use we_layout::cells::project;
use we_layout::defaults::StyleCx;
use we_layout::{layout_unrounded, Layout, Measure, PartsSpec, Pos2, Rect, Size, Vec2};
use we_metrics::{tier_for_width, Breakpoints, CellProjection, CellRect, SizeTier, UnitMetrics};
use we_template::{NodeId, ResolvedChild, ResolvedNode};

/// The fixed-advance measure of the example: a text run `n` cells wide
/// wants `n * cell_w` px — a terminal `Measure`'s shape. No text sits in
/// the tree, so measurement never enters.
struct CellMeasure(CellProjection);

impl Measure for CellMeasure {
    fn parts_spec(&self, _node: &ResolvedNode) -> Option<PartsSpec> {
        None
    }

    fn measure(&self, _node: &ResolvedNode, _style: &we_style::Style, _avail: Size) -> Size {
        // The example's leaves carry explicit sizes and no content.
        Size::ZERO
    }

    fn measure_text(
        &self,
        _owner: &ResolvedNode,
        _style: &we_style::Style,
        text: &str,
        _avail: Size,
    ) -> Size {
        let (x, y) = self.0.text_extent(text.chars().count(), 1);
        Size::new(x, y)
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
        surfaces: Default::default(),
        transition: None,
    }
}

/// The §6.1 tree: `Row { width: 100%, border: 1px, padding: 1rem, gap:
/// 10px, align-items: start }` over a plain `div` root — the viewport
/// root, so the row's auto height is its content, not the `100vh` floor.
/// Border-box sizing throughout, as the DS props are.
fn tree() -> ResolvedNode {
    let mut root = node("div", "root", &[]);
    let mut row = node(
        "Row",
        "row",
        &[
            ("width", Value::from("100%")),
            ("border", Value::from("1px solid #000")),
            ("p", Value::from("1rem")),
            ("gap", Value::from("10px")),
            ("ay", Value::from("start")),
        ],
    );
    let a = node(
        "div",
        "a",
        &[("flex", Value::from("1")), ("height", Value::from("16px"))],
    );
    let mut b = node(
        "div",
        "b",
        &[("flex", Value::from("2")), ("height", Value::from("16px"))],
    );
    let c = node(
        "div",
        "c",
        &[
            ("width", Value::from("25%")),
            ("height", Value::from("16px")),
        ],
    );
    let d = node(
        "div",
        "d",
        &[
            ("width", Value::from("50%")),
            ("height", Value::from("16px")),
        ],
    );
    b.children = vec![ResolvedChild::Node(Box::new(d))];
    row.children = vec![
        ResolvedChild::Node(Box::new(a)),
        ResolvedChild::Node(Box::new(b)),
        ResolvedChild::Node(Box::new(c)),
    ];
    root.children = vec![ResolvedChild::Node(Box::new(row))];
    root
}

/// The unrounded walk — the px layout a terminal projects: taffy's
/// integer-edge snap is the egui painter's output convention, not the
/// projection's input.
fn run(root: &ResolvedNode, w: f32, h: f32, proj: CellProjection) -> Layout {
    let scx = StyleCx::empty();
    layout_unrounded(
        &CellMeasure(proj),
        &scx,
        root,
        Rect::from_min_size(Pos2::new(0.0, 0.0), Vec2::new(w, h)),
    )
}

fn rect(out: &Layout, id: &str) -> Rect {
    *out.rects.get(&NodeId::from(id)).unwrap()
}

fn cell(cells: &HashMap<NodeId, CellRect>, id: &str) -> CellRect {
    cells[&NodeId::from(id)]
}

/// The px box within 1e-3 — the fractional evidence a snapped-only check
/// would miss.
fn assert_px(r: Rect, min_x: f32, max_x: f32, min_y: f32, max_y: f32) {
    let ok = (r.min.x - min_x).abs() < 0.001
        && (r.max.x - max_x).abs() < 0.001
        && (r.min.y - min_y).abs() < 0.001
        && (r.max.y - max_y).abs() < 0.001;
    assert!(
        ok,
        "expected [{min_x}, {max_x}) x [{min_y}, {max_y}), got {r:?}"
    );
}

/// The row's snapped span is exactly the sum of what its edges, children
/// and gaps snapped to (the edges telescope): left border+padding, A, a
/// gap, B, a gap, C, right padding+border.
fn assert_row_span(row: CellRect, a: CellRect, b: CellRect, c: CellRect) {
    let left = a.col - row.col;
    let gap_ab = b.col - (a.col + a.cols as i32);
    let gap_bc = c.col - (b.col + b.cols as i32);
    let right = (row.col + row.cols as i32) - (c.col + c.cols as i32);
    assert_eq!(
        (left, gap_ab, gap_bc, right),
        (2, 1, 1, 2),
        "border+padding edges snap to 2 cells, 10px gaps to 1"
    );
    assert_eq!(
        row.cols as i32,
        left + a.cols as i32 + gap_ab + b.cols as i32 + gap_bc + c.cols as i32 + right,
        "the row's snapped span telescopes"
    );
    // Sibling cells never overlap — they shared px edges.
    assert!(a.col + a.cols as i32 <= b.col);
    assert!(b.col + b.cols as i32 <= c.col);
}

/// viewport 80×24 cells → 640×384 px — the §6.1 example.
///
/// Content box: 640 − 2·1 − 2·16 = 606 px wide, starting at x = 17.
/// C = 25% of 606 = 151.5. A + B = 606 − 151.5 − 2·10 = 434.5
/// → A = 144.833…, B = 289.666….
/// 640 is the `sm` breakpoint itself — an equal width is the higher tier.
#[test]
fn pinned_80x24() {
    let proj = CellProjection {
        cell_w: 8.0,
        cell_h: 16.0,
    };
    assert_eq!(proj.viewport(80, 24), (640.0, 384.0));
    assert_eq!(tier_for_width(640.0, &Breakpoints::default()), SizeTier::Sm);

    let out = run(&tree(), 640.0, 384.0, proj);
    let cells = project(&out, &proj);

    // Fractional px geometry before the snap.
    assert_px(rect(&out, "row"), 0.0, 640.0, 0.0, 50.0);
    assert_px(rect(&out, "a"), 17.0, 161.8333, 17.0, 33.0);
    assert_px(rect(&out, "b"), 171.8333, 461.5, 17.0, 33.0);
    assert_px(rect(&out, "c"), 471.5, 623.0, 17.0, 33.0);
    // D = 50% of B's content box (no padding) — the nested percent.
    assert_px(rect(&out, "d"), 171.8333, 316.6667, 17.0, 33.0);

    assert!((rect(&out, "a").width() - 144.8333).abs() < 0.001);
    assert!((rect(&out, "b").width() - 289.6667).abs() < 0.001);
    assert!((rect(&out, "d").width() - 144.8333).abs() < 0.001);

    // The snapped cells — A [2,20) B [21,58) C [59,78) row [0,80),
    // every leaf at rows [1,2) under the row's [0,3).
    assert_eq!(
        cell(&cells, "row"),
        CellRect {
            col: 0,
            row: 0,
            cols: 80,
            rows: 3
        }
    );
    assert_eq!(
        cell(&cells, "a"),
        CellRect {
            col: 2,
            row: 1,
            cols: 18,
            rows: 1
        }
    );
    assert_eq!(
        cell(&cells, "b"),
        CellRect {
            col: 21,
            row: 1,
            cols: 37,
            rows: 1
        }
    );
    assert_eq!(
        cell(&cells, "c"),
        CellRect {
            col: 59,
            row: 1,
            cols: 19,
            rows: 1
        }
    );
    assert_eq!(
        cell(&cells, "d"),
        CellRect {
            col: 21,
            row: 1,
            cols: 19,
            rows: 1
        }
    );
    // The viewport root fills the whole grid (its `100vh` floor).
    assert_eq!(
        cell(&cells, "root"),
        CellRect {
            col: 0,
            row: 0,
            cols: 80,
            rows: 24
        }
    );

    assert_row_span(
        cell(&cells, "row"),
        cell(&cells, "a"),
        cell(&cells, "b"),
        cell(&cells, "c"),
    );
    // D sits inside B's snapped span.
    let (b, d) = (cell(&cells, "b"), cell(&cells, "d"));
    assert!(d.col >= b.col && d.col + d.cols as i32 <= b.col + b.cols as i32);
}

/// The same tree at 100×30 (800×480 px) — still `sm`, and every px width
/// scales with the 766 px content box.
#[test]
fn same_tree_100x30() {
    let proj = CellProjection {
        cell_w: 8.0,
        cell_h: 16.0,
    };
    assert_eq!(proj.viewport(100, 30), (800.0, 480.0));
    assert_eq!(tier_for_width(800.0, &Breakpoints::default()), SizeTier::Sm);

    let out = run(&tree(), 800.0, 480.0, proj);
    let cells = project(&out, &proj);

    // Content box 800 − 34 = 766: C = 191.5, flex 554.5 → A 184.833…, B 369.666….
    assert_px(rect(&out, "row"), 0.0, 800.0, 0.0, 50.0);
    assert_px(rect(&out, "a"), 17.0, 201.8333, 17.0, 33.0);
    assert_px(rect(&out, "b"), 211.8333, 581.5, 17.0, 33.0);
    assert_px(rect(&out, "c"), 591.5, 783.0, 17.0, 33.0);
    assert_px(rect(&out, "d"), 211.8333, 396.6667, 17.0, 33.0);
    assert!((rect(&out, "a").width() - 184.8333).abs() < 0.001);
    assert!((rect(&out, "b").width() - 369.6667).abs() < 0.001);
    assert!((rect(&out, "d").width() - 184.8333).abs() < 0.001);

    assert_eq!(
        cell(&cells, "row"),
        CellRect {
            col: 0,
            row: 0,
            cols: 100,
            rows: 3
        }
    );
    assert_eq!(
        cell(&cells, "a"),
        CellRect {
            col: 2,
            row: 1,
            cols: 23,
            rows: 1
        }
    );
    assert_eq!(
        cell(&cells, "b"),
        CellRect {
            col: 26,
            row: 1,
            cols: 47,
            rows: 1
        }
    );
    assert_eq!(
        cell(&cells, "c"),
        CellRect {
            col: 74,
            row: 1,
            cols: 24,
            rows: 1
        }
    );
    assert_eq!(
        cell(&cells, "d"),
        CellRect {
            col: 26,
            row: 1,
            cols: 24,
            rows: 1
        }
    );
    assert_eq!(
        cell(&cells, "root"),
        CellRect {
            col: 0,
            row: 0,
            cols: 100,
            rows: 30
        }
    );

    assert_row_span(
        cell(&cells, "row"),
        cell(&cells, "a"),
        cell(&cells, "b"),
        cell(&cells, "c"),
    );
}

/// Square 10×10 cells at 60×24 (600×240 px, tier `base`): the two axes
/// are projected separately — the same px edges land on different cell
/// numbers.
#[test]
fn square_cells_project_axes_separately() {
    let proj = CellProjection {
        cell_w: 10.0,
        cell_h: 10.0,
    };
    assert_eq!(proj.viewport(60, 24), (600.0, 240.0));
    assert_eq!(
        tier_for_width(600.0, &Breakpoints::default()),
        SizeTier::Base
    );

    let out = run(&tree(), 600.0, 240.0, proj);
    let cells = project(&out, &proj);

    // Content box 600 − 34 = 566: C = 141.5, flex 404.5 → A 134.833…, B 269.666….
    assert_px(rect(&out, "row"), 0.0, 600.0, 0.0, 50.0);
    assert_px(rect(&out, "a"), 17.0, 151.8333, 17.0, 33.0);
    assert_px(rect(&out, "b"), 161.8333, 431.5, 17.0, 33.0);
    assert_px(rect(&out, "c"), 441.5, 583.0, 17.0, 33.0);
    assert_px(rect(&out, "d"), 161.8333, 296.6667, 17.0, 33.0);
    assert!((rect(&out, "a").width() - 134.8333).abs() < 0.001);
    assert!((rect(&out, "b").width() - 269.6667).abs() < 0.001);
    assert!((rect(&out, "d").width() - 134.8333).abs() < 0.001);

    // The x edges snap on a 10px grid, the y edges on the same 10px grid —
    // the axes share the cell size here but snap independently: leaves
    // start at row 2, not the column their x edge found.
    assert_eq!(
        cell(&cells, "row"),
        CellRect {
            col: 0,
            row: 0,
            cols: 60,
            rows: 5
        }
    );
    assert_eq!(
        cell(&cells, "a"),
        CellRect {
            col: 2,
            row: 2,
            cols: 13,
            rows: 1
        }
    );
    assert_eq!(
        cell(&cells, "b"),
        CellRect {
            col: 16,
            row: 2,
            cols: 27,
            rows: 1
        }
    );
    assert_eq!(
        cell(&cells, "c"),
        CellRect {
            col: 44,
            row: 2,
            cols: 14,
            rows: 1
        }
    );
    assert_eq!(
        cell(&cells, "d"),
        CellRect {
            col: 16,
            row: 2,
            cols: 14,
            rows: 1
        }
    );
    assert_eq!(
        cell(&cells, "root"),
        CellRect {
            col: 0,
            row: 0,
            cols: 60,
            rows: 24
        }
    );

    assert_row_span(
        cell(&cells, "row"),
        cell(&cells, "a"),
        cell(&cells, "b"),
        cell(&cells, "c"),
    );
}

/// A box narrower than half a cell snaps to zero wide and is not drawn —
/// the projection answers `cols: 0` rather than inventing a column.
#[test]
fn sub_half_cell_sliver_projects_zero_wide() {
    let proj = CellProjection {
        cell_w: 8.0,
        cell_h: 16.0,
    };
    let mut root = node("div", "root", &[("p", Value::from("6px"))]);
    root.children = vec![ResolvedChild::Node(Box::new(node(
        "div",
        "sliver",
        &[
            ("width", Value::from("3px")),
            ("height", Value::from("10px")),
        ],
    )))];
    let out = run(&root, 640.0, 384.0, proj);
    // px [6, 9) — both edges snap to column 1.
    assert_px(rect(&out, "sliver"), 6.0, 9.0, 6.0, 16.0);
    let sliver = cell(&project(&out, &proj), "sliver");
    assert_eq!(sliver.cols, 0, "a sub-half-cell box is not drawn");
}

/// A rect whose right/bottom edges snap *before* its left/top — an
/// inverted box, a negative cell size or a NaN edge can all produce one —
/// projects to zero cells on that axis, not 65535. Taffy never hands one
/// out, so the guard is for the painter that consumes `CellRect`s, not
/// the layout walk.
#[test]
fn reversed_spans_project_zero_cells() {
    let proj = CellProjection {
        cell_w: 8.0,
        cell_h: 16.0,
    };
    let mut rects = HashMap::new();
    // x [48, 32) → cols [6, 4); y [48, 16) → rows [3, 1).
    rects.insert(
        NodeId::from("rev"),
        Rect {
            min: Pos2::new(48.0, 48.0),
            max: Pos2::new(32.0, 16.0),
        },
    );
    // x [0, 8) fine; y reversed [32, 16) → rows [2, 1).
    rects.insert(
        NodeId::from("rev-y"),
        Rect {
            min: Pos2::new(0.0, 32.0),
            max: Pos2::new(8.0, 16.0),
        },
    );
    let out = Layout {
        size: Size::ZERO,
        rects,
        styles: HashMap::new(),
        parts: HashMap::new(),
        pseudo: HashMap::new(),
        texts: vec![],
        scroll: HashMap::new(),
        scroll_content: HashMap::new(),
        clip: HashMap::new(),
        bases: HashMap::new(),
        content_boxes: HashMap::new(),
        unconverged: false,
        lanes: Default::default(),
    };
    let cells = project(&out, &proj);
    let rev = cell(&cells, "rev");
    assert_eq!(rev.cols, 0, "a reversed x span is zero cells, got {rev:?}");
    assert_eq!(rev.rows, 0, "a reversed y span is zero cells, got {rev:?}");
    let rev_y = cell(&cells, "rev-y");
    assert_eq!(rev_y.cols, 1);
    assert_eq!(rev_y.rows, 0, "got {rev_y:?}");
}

/// The far end of the same clamp: a span wider than u16::MAX cells
/// saturates at 65535 rather than wrapping or panicking.
#[test]
fn huge_spans_saturate_at_u16_max() {
    let proj = CellProjection {
        cell_w: 8.0,
        cell_h: 16.0,
    };
    let mut rects = HashMap::new();
    rects.insert(
        NodeId::from("huge"),
        Rect {
            min: Pos2::new(0.0, 0.0),
            max: Pos2::new(8.0 * 70000.0, 16.0 * 70000.0),
        },
    );
    let out = Layout {
        size: Size::ZERO,
        rects,
        styles: HashMap::new(),
        parts: HashMap::new(),
        pseudo: HashMap::new(),
        texts: vec![],
        scroll: HashMap::new(),
        scroll_content: HashMap::new(),
        clip: HashMap::new(),
        bases: HashMap::new(),
        content_boxes: HashMap::new(),
        unconverged: false,
        lanes: Default::default(),
    };
    let huge = cell(&project(&out, &proj), "huge");
    assert_eq!((huge.cols, huge.rows), (u16::MAX, u16::MAX));
}

/// `em` is not in the worked tree: a `2em` width is the font metric made
/// visible — `UnitMetrics::default().font_px` is the number the deleted
/// `we_layout::defaults` font constant stood in for.
#[test]
fn em_resolves_against_unit_metrics_font_px() {
    assert_eq!(UnitMetrics::default().font_px, 14.0);
    let proj = CellProjection {
        cell_w: 8.0,
        cell_h: 16.0,
    };
    let mut root = node("div", "root", &[]);
    root.children = vec![ResolvedChild::Node(Box::new(node(
        "div",
        "leaf",
        &[
            ("width", Value::from("2em")),
            ("height", Value::from("10px")),
        ],
    )))];
    let out = run(&root, 640.0, 384.0, proj);
    let w = rect(&out, "leaf").width();
    assert!(
        (w - 2.0 * UnitMetrics::default().font_px).abs() < 0.001,
        "2em = 2 * font_px, got {w}"
    );
}
