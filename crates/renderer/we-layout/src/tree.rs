//! Layout: one taffy tree over the resolved tree, one [`Layout`] out.
//!
//! Every node's [`we_style::Style`] comes from [`style_of`] — the E4
//! resolution of props + defaults + theme — and this file maps
//! `Style.layout` onto taffy: direction, wrap, `ax`/`ay`, two-value `gap`,
//! padding, border widths, margin, sizes, flex, `align-self`, `position`+insets, `overflow`
//! (auto/scroll → scroll containers, hidden/clip → paint-time clipping),
//! `aspect-ratio`, `display: none`, and `Grid`'s `columns`/`minChildWidth`
//! as real grid tracks.
use std::collections::HashMap;
use std::sync::Arc;

use taffy::prelude::*;
use taffy::NodeId as TaffyId;
use we_expr::Value;
use we_style::{Dimension, Display as WsDisplay, ItemAlign, Overflow, Position, Style, Wrap};
use we_template::{NodeId, ResolvedChild, ResolvedNode};

use crate::defaults::{direction_of, style_of, StyleCx, FONT_PX, ROOT_PX};
use crate::{Pos2, Rect, Size, Vec2};

/// A virtual sub-rectangle layout computed for a widget — the caret, row and
/// children group of a `we-tree-item`, a `Card`'s header band. Keyed by
/// `(node, part name)`; widgets read them in paint through `PaintCx::parts`.
pub type Parts = HashMap<(NodeId, &'static str), Rect>;

/// How a part (or a container) lays out its children.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Row,
    Column,
}

/// Which resolved children a [`PartSpec`] group holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Pick {
    /// Children with no `slot` (and text children).
    Default,
    /// Children carrying this `slot` name.
    Named(Arc<str>),
}

/// One piece of a [`PartsSpec`]: either a named group that holds a [`Pick`]'s
/// children, or a fixed-size decorative box (`pick: None`), and either may
/// subdivide into `parts` of its own.
#[derive(Debug, Clone)]
pub struct PartSpec {
    /// Key into [`Parts`] — `"row"`, `"caret"`, `"children"`, …
    pub name: &'static str,
    /// Which resolved children fill this part — `None` for a decorative box.
    pub pick: Option<Pick>,
    pub direction: Direction,
    /// Fixed sizes for decorative boxes (`None` → sized by contents).
    pub width: Option<f32>,
    pub height: Option<f32>,
    /// Minimum height the part keeps even when empty (the tree row).
    pub min_height: f32,
    /// Space between this part's left edge and its children (tree indent).
    pub indent: f32,
    /// Align-items override for a part (e.g. `ay` on the tree row).
    pub align: Option<ItemAlign>,
    pub parts: Vec<PartSpec>,
}

impl PartSpec {
    /// A decorative fixed box — the tree-item's caret.
    pub fn fixed(name: &'static str, width: f32, height: f32) -> Self {
        Self {
            name,
            pick: None,
            direction: Direction::Column,
            width: Some(width),
            height: Some(height),
            min_height: 0.0,
            indent: 0.0,
            align: None,
            parts: vec![],
        }
    }

    /// A group holding `pick`'s children.
    pub fn group(name: &'static str, pick: Pick, direction: Direction) -> Self {
        Self {
            name,
            pick: Some(pick),
            direction,
            width: None,
            height: None,
            min_height: 0.0,
            indent: 0.0,
            align: None,
            parts: vec![],
        }
    }

    /// A group that subdivides — the tree-item's row = caret + label group.
    pub fn nested(name: &'static str, direction: Direction, parts: Vec<PartSpec>) -> Self {
        Self {
            name,
            pick: None,
            direction,
            width: None,
            height: None,
            min_height: 0.0,
            indent: 0.0,
            align: None,
            parts,
        }
    }

    /// Leading space inside the part (the tree's indent).
    pub fn indented(mut self, px: f32) -> Self {
        self.indent = px;
        self
    }

    /// Cross-axis alignment for the part's children.
    pub fn aligned(mut self, align: ItemAlign) -> Self {
        self.align = Some(align);
        self
    }

    /// A floor on the part's height even when it holds nothing.
    pub fn min_height(mut self, px: f32) -> Self {
        self.min_height = px;
        self
    }
}

/// A widget's virtual layout structure — [`Measure::parts_spec`]
/// answers `Some` when the node needs chrome its children do not provide
/// (the tree-item's row). `None` → children lay out directly inside `rect`.
#[derive(Debug, Clone)]
pub struct PartsSpec {
    pub direction: Direction,
    pub parts: Vec<PartSpec>,
}

/// Tree state passed parent → item: caret side, leading indent, and the
/// selected marker. Carried through layout (props live on `we-tree`, parts
/// live on `we-tree-item`).
#[derive(Debug, Clone, Default)]
pub struct TreeCfg {
    pub caret_end: bool,
    /// Extra left inset (`lead` prop, px).
    pub lead: f32,
    /// The tree's `selected` value — items compare it to their `value`.
    pub selected: Option<Value>,
}

/// The layout output: every resolved node's rect, every part rect, the text
/// children (painted by the frame, not a widget), scroll-container axes, the
/// resolved styles (measure and paint read the same answer — scopes already
/// applied), and the tree's size.
pub struct Layout {
    pub size: Size,
    pub rects: HashMap<NodeId, Rect>,
    /// Each laid-out node's resolved [`Style`] — the same values measure saw.
    /// Paint reads these so a descendant's `var()` resolves in the scope the
    /// tree walk established, not a scope-less re-resolution.
    pub styles: HashMap<NodeId, Style>,
    /// `(node, part)` → rect — a widget's virtual chrome.
    pub parts: Parts,
    /// Text children in paint order, with the node they belong to.
    pub texts: Vec<TextSpan>,
    /// Nodes with `overflow: auto|scroll` — which axes scroll at paint.
    pub scroll: HashMap<NodeId, Vec2>,
    /// Nodes with `overflow: hidden|clip` — children clip to their rect.
    pub clip: HashMap<NodeId, Vec2>,
}

/// A text child and where it landed.
pub struct TextSpan {
    /// The node the text hangs under (its resolved parent).
    pub node: NodeId,
    pub rect: Rect,
    pub text: Arc<str>,
}

/// A length in px, the way `Dimension::resolve` folds it without a percent
/// base — `ch`/`ex`/`lh` included, by the shared approximations.
fn dim_px(d: &Dimension, scx: &StyleCx) -> Option<f32> {
    d.resolve(None, FONT_PX, ROOT_PX, scx.viewport)
}

// A `calc` sum that still carries a percent needs its containing-block base.
// `base` comes from the previous layout pass's computed boxes (see
// `derive_bases`); while it is `None` the percent term alone stands in for
// the whole expression — the documented approximation, no invented base.
// Every prop family below resolves `Calc` through the same policy so
// measure and paint read one answer.

/// `Dimension` → taffy `Dimension` (sizes, flex basis).
fn dim(d: Option<&Dimension>, base: Option<f32>, scx: &StyleCx) -> taffy::Dimension {
    match d {
        Some(Dimension::Percent(p)) => taffy::Dimension::percent(*p),
        Some(Dimension::Calc(c)) if c.percent != 0.0 => {
            match c.resolve(base, FONT_PX, ROOT_PX, scx.viewport) {
                Some(v) => taffy::Dimension::length(v),
                None => taffy::Dimension::percent(c.percent),
            }
        }
        Some(d) => dim_px(d, scx)
            .map(taffy::Dimension::length)
            .unwrap_or(taffy::Dimension::auto()),
        None => taffy::Dimension::auto(),
    }
}

/// `Dimension` → taffy `LengthPercentage` (padding, gap).
fn lp(d: Option<&Dimension>, base: Option<f32>, scx: &StyleCx) -> LengthPercentage {
    match d {
        Some(Dimension::Percent(p)) => LengthPercentage::percent(*p),
        Some(Dimension::Calc(c)) if c.percent != 0.0 => {
            match c.resolve(base, FONT_PX, ROOT_PX, scx.viewport) {
                Some(v) => LengthPercentage::length(v),
                None => LengthPercentage::percent(c.percent),
            }
        }
        Some(d) => dim_px(d, scx)
            .map(LengthPercentage::length)
            .unwrap_or(LengthPercentage::length(0.0)),
        None => LengthPercentage::length(0.0),
    }
}

/// `Dimension` → taffy `LengthPercentageAuto` (insets, min/max) — `auto`
/// when unset, matching CSS.
fn lpa(d: Option<&Dimension>, base: Option<f32>, scx: &StyleCx) -> LengthPercentageAuto {
    match d {
        Some(Dimension::Percent(p)) => LengthPercentageAuto::percent(*p),
        Some(Dimension::Calc(c)) if c.percent != 0.0 => {
            match c.resolve(base, FONT_PX, ROOT_PX, scx.viewport) {
                Some(v) => LengthPercentageAuto::length(v),
                None => LengthPercentageAuto::percent(c.percent),
            }
        }
        Some(d) => dim_px(d, scx)
            .map(LengthPercentageAuto::length)
            .unwrap_or(LengthPercentageAuto::auto()),
        None => LengthPercentageAuto::auto(),
    }
}

/// Margins: unset is `0`, not `auto` — `auto` margins absorb free space and
/// center every child in a flex container.
fn lpa_margin(d: Option<&Dimension>, base: Option<f32>, scx: &StyleCx) -> LengthPercentageAuto {
    match d {
        Some(Dimension::Percent(p)) => LengthPercentageAuto::percent(*p),
        Some(Dimension::Auto) => LengthPercentageAuto::auto(),
        Some(Dimension::Calc(c)) if c.percent != 0.0 => {
            match c.resolve(base, FONT_PX, ROOT_PX, scx.viewport) {
                Some(v) => LengthPercentageAuto::length(v),
                None => LengthPercentageAuto::percent(c.percent),
            }
        }
        Some(d) => dim_px(d, scx)
            .map(LengthPercentageAuto::length)
            .unwrap_or(LengthPercentageAuto::length(0.0)),
        None => LengthPercentageAuto::length(0.0),
    }
}

/// `ItemAlign` on the main axis → `justify-content`.
fn justify(a: Option<&ItemAlign>) -> Option<JustifyContent> {
    Some(match a? {
        ItemAlign::Start => JustifyContent::START,
        ItemAlign::Center => JustifyContent::CENTER,
        ItemAlign::End => JustifyContent::END,
        ItemAlign::SpaceBetween => JustifyContent::SPACE_BETWEEN,
        ItemAlign::SpaceAround => JustifyContent::SPACE_AROUND,
        ItemAlign::SpaceEvenly => JustifyContent::SPACE_EVENLY,
        _ => return None,
    })
}

/// `ItemAlign` on the cross axis → `align-items` / `align-self`.
fn align(a: Option<&ItemAlign>) -> Option<AlignItems> {
    Some(match a? {
        ItemAlign::Start => AlignItems::START,
        ItemAlign::Center => AlignItems::CENTER,
        ItemAlign::End => AlignItems::END,
        ItemAlign::Stretch => AlignItems::STRETCH,
        ItemAlign::Baseline => AlignItems::BASELINE,
        _ => return None,
    })
}

/// `align-self` is a subset of `ItemAlign`.
fn align_self(a: Option<&ItemAlign>) -> Option<AlignSelf> {
    align(a).map(|a| match a {
        AlignItems::START => AlignSelf::START,
        AlignItems::CENTER => AlignSelf::CENTER,
        AlignItems::END => AlignSelf::END,
        AlignItems::STRETCH => AlignSelf::STRETCH,
        AlignItems::BASELINE => AlignSelf::BASELINE,
        _ => AlignSelf::STRETCH,
    })
}

/// `Overflow` → taffy's enum + whether it scrolls/clips.
fn overflow(o: &Overflow) -> (taffy::Overflow, bool, bool) {
    match o {
        Overflow::Auto | Overflow::Scroll => (taffy::Overflow::Scroll, true, false),
        Overflow::Hidden | Overflow::Clip => (taffy::Overflow::Hidden, false, true),
        _ => (taffy::Overflow::Visible, false, false),
    }
}

/// `Edge<Option<Dimension>>` → a taffy edge rect — `f` gets each edge's own
/// percent base (CB width for padding/margin — all four — and insets per
/// axis, per CSS).
fn edges(
    e: &we_style::Edges<Option<Dimension>>,
    scx: &StyleCx,
    f: impl Fn(Option<&Dimension>, Option<f32>, &StyleCx) -> taffy::prelude::LengthPercentageAuto,
    bx: Option<f32>,
    by: Option<f32>,
) -> taffy::Rect<taffy::prelude::LengthPercentageAuto> {
    taffy::Rect {
        left: f(e.left.as_ref(), bx, scx),
        right: f(e.right.as_ref(), bx, scx),
        top: f(e.top.as_ref(), by, scx),
        bottom: f(e.bottom.as_ref(), by, scx),
    }
}

/// The percent bases a previous layout pass measured for this node — the
/// affine `calc(…% ± px)` terms wait for them rather than drop a term.
/// `None` keeps the percent-placeholder approximation.
#[derive(Clone, Copy, Default)]
struct NodeBases {
    /// Containing-block box for this node's props — content box for in-flow,
    /// padding box for abs/fixed, the layout rect for the root.
    cb: (Option<f32>, Option<f32>),
    /// This node's own content box — `gap`'s percentages resolve against it.
    own: (Option<f32>, Option<f32>),
    /// The container's inner size along its main axis — `flex-basis` %'s base.
    basis: Option<f32>,
}

/// Which box a node's %-values resolve against — CSS containing-block rules.
struct Cb {
    /// The containing-block node — `None` = the layout rect (the root, or a
    /// float with no positioned ancestor).
    node: Option<NodeId>,
    /// Resolve against the padding box (abs/fixed children) rather than the
    /// content box (in-flow children).
    padding_box: bool,
    /// For `Content` cbs: the cb's height was definite when the walk built
    /// it — the gate CSS puts on height-resolving percentages.
    y_definite: bool,
    /// The containing flex container's main direction — `flex-basis`'s axis.
    main: Direction,
}

/// The taffy style a resolved node carries, translated from its resolved
/// [`Style`]. `Grid` gets a real grid track list; everything else is flex.
/// `base` is the node's [`NodeBases`] — `default()` on the first pass.
fn node_style(node: &ResolvedNode, style: &Style, scx: &StyleCx, base: NodeBases) -> taffy::Style {
    let l = &style.layout;
    let (sx, x_scroll, x_clip) = l
        .overflow_x
        .as_ref()
        .or(l.overflow.as_ref())
        .map(overflow)
        .unwrap_or((taffy::Overflow::Visible, false, false));
    let (sy, y_scroll, y_clip) = l
        .overflow_y
        .as_ref()
        .or(l.overflow.as_ref())
        .map(overflow)
        .unwrap_or((taffy::Overflow::Visible, false, false));

    let mut s = taffy::Style {
        display: match l.display {
            Some(WsDisplay::None) => Display::None,
            Some(WsDisplay::Grid) => Display::Grid,
            _ if node.ty.as_ref() == "Grid" => Display::Grid,
            _ => Display::Flex,
        },
        flex_direction: match l.direction {
            Some(we_style::FlexDirection::Row) => FlexDirection::Row,
            Some(we_style::FlexDirection::RowReverse) => FlexDirection::RowReverse,
            Some(we_style::FlexDirection::ColumnReverse) => FlexDirection::ColumnReverse,
            _ if direction_of(node) == we_style::Direction::Row => FlexDirection::Row,
            _ => FlexDirection::Column,
        },
        flex_wrap: match l.wrap {
            Some(Wrap::Wrap) => FlexWrap::Wrap,
            Some(Wrap::WrapReverse) => FlexWrap::WrapReverse,
            _ => FlexWrap::NoWrap,
        },
        justify_content: justify(l.justify.as_ref()).unwrap_or(JustifyContent::NORMAL),
        align_items: align(l.align.as_ref()).unwrap_or(AlignItems::NORMAL),
        align_self: align_self(l.align_self.as_ref()),
        gap: match &l.gap {
            // Style's gap is (row, column); taffy's Size is (width=col,
            // height=row). CSS gap percentages resolve against the element's
            // own content box — `own`, not the containing block.
            Some((row, col)) => taffy::Size {
                width: lp(Some(col), base.own.0, scx),
                height: lp(Some(row), base.own.1, scx),
            },
            None => taffy::Size {
                width: LengthPercentage::length(0.0),
                height: LengthPercentage::length(0.0),
            },
        },
        size: taffy::Size {
            width: dim(l.width.as_ref(), base.cb.0, scx),
            height: dim(l.height.as_ref(), base.cb.1, scx),
        },
        min_size: taffy::Size {
            width: lpa(l.min_width.as_ref(), base.cb.0, scx),
            height: lpa(l.min_height.as_ref(), base.cb.1, scx),
        },
        max_size: taffy::Size {
            width: lpa(l.max_width.as_ref(), base.cb.0, scx),
            height: lpa(l.max_height.as_ref(), base.cb.1, scx),
        },
        aspect_ratio: l.aspect_ratio,
        // Every padding edge's % resolves against the containing-block
        // *width* — the horizontal-writing-mode rule CSS applies to margins
        // and insets' inline edges too.
        padding: taffy::Rect {
            left: lp(l.padding.left.as_ref(), base.cb.0, scx),
            right: lp(l.padding.right.as_ref(), base.cb.0, scx),
            top: lp(l.padding.top.as_ref(), base.cb.0, scx),
            bottom: lp(l.padding.bottom.as_ref(), base.cb.0, scx),
        },
        // Border widths are real inset: children and measured content sit
        // inside them, and the border box grows by them (CSS border-box).
        border: taffy::Rect {
            left: border_lp(&style.paint.borders.left, scx),
            right: border_lp(&style.paint.borders.right, scx),
            top: border_lp(&style.paint.borders.top, scx),
            bottom: border_lp(&style.paint.borders.bottom, scx),
        },
        margin: edges(&l.margin, scx, lpa_margin, base.cb.0, base.cb.0),
        inset: edges(&l.inset, scx, lpa, base.cb.0, base.cb.1),
        position: match l.position {
            Some(Position::Relative) => taffy::Position::Relative,
            Some(Position::Absolute) | Some(Position::Fixed) | Some(Position::Sticky) => {
                // `fixed` and `sticky` behave as absolute in a retained
                // canvas — noted in NOTES.
                taffy::Position::Absolute
            }
            _ => taffy::Position::Relative,
        },
        overflow: taffy::Point { x: sx, y: sy },
        flex_grow: l.flex.map(|f| f.grow).unwrap_or(0.0),
        flex_shrink: l
            .flex_shrink
            .or_else(|| l.flex.map(|f| f.shrink))
            .unwrap_or(1.0),
        flex_basis: l
            .flex
            .map(|f| dim(Some(&f.basis), base.basis, scx))
            .unwrap_or(taffy::Dimension::auto()),
        ..Default::default()
    };
    let _ = (x_scroll, x_clip, y_scroll, y_clip); // scroll/clip recorded on Layout below

    if node.ty.as_ref() == "Grid" {
        s.display = Display::Grid;
        s.grid_template_columns = grid_columns(node);
        s.grid_auto_rows = vec![taffy::TrackSizingFunction::from_fr(1.0)];
        s.grid_auto_flow = taffy::GridAutoFlow::Row;
    }
    s
}

/// `Grid`'s template: `template` wins (a `repeat(N, …)` we can read), else
/// `minChildWidth` → `repeat(auto-fill, minmax(Npx, 1fr))`, else
/// `columns` → `repeat(N, 1fr)` — the three forms the bundle uses, matching
/// `Grid.solid.tsx`'s `finalizeStyle`. Anything else → one column.
fn grid_columns(node: &ResolvedNode) -> Vec<taffy::GridTemplateComponent<String>> {
    use taffy::{
        GridTemplateRepetition, MaxTrackSizingFunction, MinMax, MinTrackSizingFunction,
        RepetitionCount, TrackSizingFunction,
    };

    let fr = || TrackSizingFunction::from_fr(1.0);
    if let Some(tpl) = crate::props::prop_str(node, "template") {
        if let Some(tracks) = parse_template(tpl) {
            return tracks;
        }
    }
    if let Some(min) = crate::props::prop_num(node, "minChildWidth") {
        return vec![taffy::GridTemplateComponent::Repeat(
            GridTemplateRepetition {
                count: RepetitionCount::AutoFill,
                tracks: vec![MinMax {
                    min: MinTrackSizingFunction::from_length(min),
                    max: MaxTrackSizingFunction::from_fr(1.0),
                }],
                line_names: vec![],
            },
        )];
    }
    // `childAspect` (the TS solves it against the measured box) is
    // unsupported in E5a — falls through to `columns`. Listed in NOTES.
    let n = crate::props::prop_num(node, "columns")
        .unwrap_or(1.0)
        .max(1.0) as u16;
    vec![taffy::GridTemplateComponent::Repeat(
        GridTemplateRepetition {
            count: RepetitionCount::Count(n),
            tracks: vec![fr()],
            line_names: vec![],
        },
    )]
}

/// `repeat(3, 1fr)`-style templates — the one shape the bundle writes.
fn parse_template(tpl: &str) -> Option<Vec<taffy::GridTemplateComponent<String>>> {
    let t = tpl.trim();
    let inner = t.strip_prefix("repeat(")?.strip_suffix(')')?;
    let mut it = inner.splitn(2, ',');
    let count: u16 = it.next()?.trim().parse().ok()?;
    let track = it.next()?.trim();
    if track != "1fr" {
        return None;
    }
    Some(vec![taffy::GridTemplateComponent::Repeat(
        taffy::GridTemplateRepetition {
            count: taffy::RepetitionCount::Count(count),
            tracks: vec![taffy::TrackSizingFunction::from_fr(1.0)],
            line_names: vec![],
        },
    )])
}

/// A resolved border side → the taffy `border` edge: the same px
/// `props::content_rect` subtracts at paint, so the inset taffy keeps
/// outside measured content agrees with the inset paint keeps outside
/// painted content.
fn border_lp(side: &Option<we_style::BorderSide>, scx: &StyleCx) -> LengthPercentage {
    LengthPercentage::length(crate::props::border_side_px(
        side,
        FONT_PX,
        ROOT_PX,
        scx.viewport,
    ))
}

/// A part spec → taffy style.
fn part_style(spec: &PartSpec) -> taffy::Style {
    taffy::Style {
        display: Display::Flex,
        flex_direction: match spec.direction {
            Direction::Row => FlexDirection::Row,
            Direction::Column => FlexDirection::Column,
        },
        align_items: spec
            .align
            .as_ref()
            .and_then(|a| align(Some(a)))
            .unwrap_or(AlignItems::NORMAL),
        size: taffy::Size {
            width: spec
                .width
                .map(taffy::Dimension::length)
                .unwrap_or(taffy::Dimension::auto()),
            height: spec
                .height
                .map(taffy::Dimension::length)
                .unwrap_or(taffy::Dimension::auto()),
        },
        min_size: taffy::Size {
            width: LengthPercentageAuto::auto(),
            height: if spec.min_height > 0.0 {
                LengthPercentageAuto::length(spec.min_height)
            } else {
                LengthPercentageAuto::auto()
            },
        },
        padding: taffy::Rect {
            left: LengthPercentage::length(spec.indent),
            right: LengthPercentage::length(0.0),
            top: LengthPercentage::length(0.0),
            bottom: LengthPercentage::length(0.0),
        },
        flex_shrink: 0.0,
        ..Default::default()
    }
}

/// One taffy node's bookkeeping: whose rect it becomes.
enum Ctx {
    Node(NodeId),
    Part(NodeId, &'static str),
    Text(NodeId, Arc<str>),
}

/// The width/height `widget.measure` gets: taffy's `AvailableSpace`, the
/// content box. `compute_leaf_layout` merges `known_dimensions` into it
/// before offering — when `known` is set, `space` is already
/// `Definite(known − padding − border)` — and adds the inset back onto the
/// measured size. Answering `known` (the border box) instead would wrap a
/// padded leaf's text over its own padding: `MinContent` still wraps as
/// hard as possible, `MaxContent`/unset still means the natural size.
fn offered(space: taffy::AvailableSpace) -> f32 {
    match space {
        taffy::AvailableSpace::Definite(w) => w,
        taffy::AvailableSpace::MinContent => 0.0,
        taffy::AvailableSpace::MaxContent => f32::INFINITY,
    }
}

/// An intrinsic axis a widget answered non-finitely (an unconstrained
/// divider's length) never reaches taffy — `auto`/stretch decides instead.
fn finite(v: f32) -> f32 {
    if v.is_finite() {
        v.max(0.0)
    } else {
        0.0
    }
}

/// The parent's frame a child resolves against: who its containing block
/// is, whether the parent's height is definite, the parent's flex
/// direction (its children's `flex-basis` axis), and the nearest
/// positioned ancestor abs/fixed children belong to.
#[derive(Clone, Copy)]
struct ParentFrame<'a> {
    /// The resolved DOM parent — `None` for the layout root.
    id: Option<&'a NodeId>,
    /// The parent's height resolved to a definite value — the gate CSS
    /// puts on height-resolving percentages.
    h_definite: bool,
    /// The parent's main axis is indefinite — the existing `flex-basis`
    /// fallback rule.
    main_indefinite: bool,
    /// The parent's flex direction.
    main: Direction,
    /// Nearest ancestor with a `position` prop — abs/fixed children's cb.
    positioned: Option<&'a NodeId>,
}

/// `LayoutStyle` fields that can carry `Dimension::Calc` — the walk skips
/// the extra base-resolving passes entirely when none appears.
fn pct_calc_in(l: &we_style::LayoutStyle) -> bool {
    let c = |d: &Option<Dimension>| matches!(d, Some(Dimension::Calc(c)) if c.percent != 0.0);
    let gap = l.gap.map(|(row, col)| {
        matches!(row, Dimension::Calc(c) if c.percent != 0.0)
            || matches!(col, Dimension::Calc(c) if c.percent != 0.0)
    });
    let basis = l
        .flex
        .map(|f| matches!(f.basis, Dimension::Calc(c) if c.percent != 0.0));
    c(&l.width)
        || c(&l.height)
        || c(&l.min_width)
        || c(&l.max_width)
        || c(&l.min_height)
        || c(&l.max_height)
        || c(&l.padding.left)
        || c(&l.padding.right)
        || c(&l.padding.top)
        || c(&l.padding.bottom)
        || c(&l.margin.left)
        || c(&l.margin.right)
        || c(&l.margin.top)
        || c(&l.margin.bottom)
        || c(&l.inset.left)
        || c(&l.inset.right)
        || c(&l.inset.top)
        || c(&l.inset.bottom)
        || gap.unwrap_or(false)
        || basis.unwrap_or(false)
}

struct Builder<'a> {
    tree: TaffyTree<Ctx>,
    m: &'a dyn Measure,
    scx: &'a StyleCx<'a>,
    /// `id` → resolved node — the measure function re-finds its widget.
    nodes: HashMap<NodeId, &'a ResolvedNode>,
    /// `id` → the style the tree walk resolved — measure and the `Layout`
    /// output read it so every consumer shares the scoped answer.
    styles: HashMap<NodeId, Style>,
    /// `id` → the bases the previous pass measured for it — empty on the
    /// first pass (percent terms keep their placeholder then).
    bases: &'a HashMap<NodeId, NodeBases>,
    /// `id` → its containing block — stable across passes (position and
    /// structure do not depend on resolved values).
    cb_of: &'a mut HashMap<NodeId, Cb>,
    /// Whether any node's style carried a percent `calc()` — when `false`
    /// after the first pass, the base machinery did nothing and no second
    /// pass is needed.
    needs_bases: bool,
    scroll: HashMap<NodeId, Vec2>,
    clip: HashMap<NodeId, Vec2>,
}

impl<'a> Builder<'a> {
    /// A part → a taffy node: `pick` children inside, nested parts inside, or
    /// an empty fixed box. `scx` is the owner's scope and `pf` its frame —
    /// parts are layout chrome, not DOM boxes, so the `pick` children keep
    /// the node's containing block (only the part's own direction changes).
    fn part_node(
        &mut self,
        owner: &NodeId,
        spec: &PartSpec,
        node: &'a ResolvedNode,
        tree: &TreeCfg,
        pf: &ParentFrame,
        scx: &StyleCx,
    ) -> Option<TaffyId> {
        let pf = ParentFrame {
            main: spec.direction,
            main_indefinite: matches!(spec.direction, Direction::Column) && !pf.h_definite,
            ..*pf
        };
        let mut kids = Vec::new();
        if let Some(pick) = &spec.pick {
            for child in node.children.iter().filter(|c| match (pick, c) {
                (Pick::Default, ResolvedChild::Node(n)) => n.slot.is_none(),
                (Pick::Default, ResolvedChild::Text(_)) => true,
                (Pick::Named(want), ResolvedChild::Node(n)) => {
                    n.slot.as_deref() == Some(want.as_ref())
                }
                (Pick::Named(_), ResolvedChild::Text(_)) => false,
            }) {
                if let Some(k) = self.child_node(node, child, tree, &pf, scx) {
                    kids.push(k);
                }
            }
        }
        for sub in &spec.parts {
            if let Some(k) = self.part_node(owner, sub, node, tree, &pf, scx) {
                kids.push(k);
            }
        }
        let ctx = Ctx::Part(owner.clone(), spec.name);
        if kids.is_empty() {
            Some(
                self.tree
                    .new_leaf_with_context(part_style(spec), ctx)
                    .unwrap(),
            )
        } else {
            let id = self
                .tree
                .new_with_children(part_style(spec), &kids)
                .unwrap();
            self.tree.set_node_context(id, Some(ctx)).unwrap();
            Some(id)
        }
    }

    /// A resolved child → a taffy node: nodes recurse, text becomes a leaf
    /// measured by the galley. `scx` is the owner's scope, `pf` its frame.
    fn child_node(
        &mut self,
        owner: &'a ResolvedNode,
        child: &'a ResolvedChild,
        tree: &TreeCfg,
        pf: &ParentFrame,
        scx: &StyleCx,
    ) -> Option<TaffyId> {
        match child {
            ResolvedChild::Node(node) => self.resolved_node(node, tree, pf, scx),
            ResolvedChild::Text(text) => {
                // Text is measured in its owner's font — `layout_no_wrap`
                // matches the paint path's single-line spans.
                let style = self
                    .styles
                    .get(&owner.id)
                    .cloned()
                    .unwrap_or_else(|| style_of(owner, scx));
                let size = self.m.measure_text(owner, &style, text);
                Some(
                    self.tree
                        .new_leaf_with_context(
                            taffy::Style {
                                size: taffy::Size {
                                    width: taffy::Dimension::length(size.x),
                                    height: taffy::Dimension::length(size.y),
                                },
                                flex_shrink: 0.0,
                                ..Default::default()
                            },
                            Ctx::Text(owner.id.clone(), text.clone()),
                        )
                        .unwrap(),
                )
            }
        }
    }

    /// A resolved node → a taffy node + its children (or its parts).
    /// `tree` is the nearest `we-tree` ancestor's config, if any; `scx`
    /// carries the ancestors' custom-property scope and `pf` the parent's
    /// frame — this node's children resolve inside its own scope against
    /// its own box.
    fn resolved_node(
        &mut self,
        node: &'a ResolvedNode,
        tree: &TreeCfg,
        pf: &ParentFrame,
        scx: &StyleCx,
    ) -> Option<TaffyId> {
        let style = style_of(node, scx);

        // `display: none` removes the node AND its subtree from layout — no
        // rect, no parts, nothing painted.
        if matches!(style.layout.display, Some(WsDisplay::None)) {
            return None;
        }
        self.nodes.insert(node.id.clone(), node);
        self.needs_bases |= pct_calc_in(&style.layout);

        // This node's containing block — which box its percent terms
        // resolve against (absolute/fixed children take the nearest
        // positioned ancestor's padding box; in-flow children take their
        // parent's content box; the root takes the layout rect).
        self.cb_of.insert(
            node.id.clone(),
            if matches!(
                style.layout.position,
                Some(Position::Absolute) | Some(Position::Fixed) | Some(Position::Sticky)
            ) {
                Cb {
                    node: pf.positioned.cloned(),
                    padding_box: true,
                    y_definite: true,
                    main: pf.main,
                }
            } else {
                Cb {
                    node: pf.id.cloned(),
                    padding_box: false,
                    y_definite: pf.h_definite,
                    main: pf.main,
                }
            },
        );

        // Record scroll/clip axes on the layout output.
        let scrolls =
            |o: Option<&Overflow>| matches!(o, Some(Overflow::Auto) | Some(Overflow::Scroll));
        let clips =
            |o: Option<&Overflow>| matches!(o, Some(Overflow::Hidden) | Some(Overflow::Clip));
        let l = &style.layout;
        let sx = scrolls(l.overflow_x.as_ref().or(l.overflow.as_ref()));
        let sy = scrolls(l.overflow_y.as_ref().or(l.overflow.as_ref()));
        if sx || sy {
            self.scroll.insert(
                node.id.clone(),
                Vec2::new(if sx { 1.0 } else { 0.0 }, if sy { 1.0 } else { 0.0 }),
            );
        }
        let cx_axis = clips(l.overflow_x.as_ref().or(l.overflow.as_ref()));
        let cy_axis = clips(l.overflow_y.as_ref().or(l.overflow.as_ref()));
        if cx_axis || cy_axis {
            self.clip.insert(
                node.id.clone(),
                Vec2::new(
                    if cx_axis { 1.0 } else { 0.0 },
                    if cy_axis { 1.0 } else { 0.0 },
                ),
            );
        }

        // The tree config this node hands down: a `we-tree` starts a fresh
        // config from its props; everything else inherits.
        let tree = if node.ty.as_ref() == "we-tree" {
            TreeCfg {
                caret_end: crate::props::prop_str(node, "caret") == Some("end"),
                lead: crate::props::prop_num(node, "lead").unwrap_or(0.0) as f32,
                selected: node.props.get("selected").cloned(),
            }
        } else {
            tree.clone()
        };

        let base = self.bases.get(&node.id).copied().unwrap_or_default();
        let mut s = node_style(node, &style, self.scx, base);
        // CSS: a percentage `height` against an indefinite containing block
        // resolves to `auto` — the root is always `MinContent` here, so any
        // `height: N%` under it shrinks to content instead of collapsing.
        use taffy::ExpandedDimension as Ed;
        if matches!(s.size.height.expand(), Ed::Percent(_)) && !pf.h_definite {
            s.size.height = taffy::Dimension::auto();
        }
        // `flex: 1` is `flex-basis: 0` — a zero or % basis on an indefinite
        // main axis behaves as `content` in CSS; taffy would make it 0 and
        // collapse the child (the tree panel's `overflowY:auto` column).
        if pf.main_indefinite && matches!(s.flex_basis.expand(), Ed::Percent(_) | Ed::Length(0.0)) {
            s.flex_basis = taffy::Dimension::auto();
        }
        let h_definite = match s.size.height.expand() {
            Ed::Length(_) => true,
            Ed::Percent(_) => pf.h_definite,
            _ => false,
        };
        let mut spec = self.m.parts_spec(node);
        // `caret="end"` on the tree reorders the item's caret part to the row's
        // end; `lead` pads the row's left edge — part order/insets are
        // layout's call, and only it can see the ancestor.
        if node.ty.as_ref() == "we-tree-item" {
            if let Some(spec) = &mut spec {
                for part in &mut spec.parts {
                    if part.name == "row" {
                        if tree.caret_end {
                            part.parts.sort_by_key(|p| p.name == "caret");
                        }
                        part.indent += tree.lead;
                    }
                }
            }
        }
        // The children resolve inside this element's custom-property scope —
        // its `tone`'s re-pointings and `styles`' verbatim `--we-*` decls —
        // the way CSS inherits custom properties down the DOM.
        let scoped = StyleCx {
            scope: &style.scope,
            ..*scx
        };
        // …and their containing-block frame: this node's box, its flex
        // direction for `flex-basis`, and the updated positioned chain.
        let positioned = if style.layout.position.is_some() {
            Some(&node.id)
        } else {
            pf.positioned
        };
        let kids: Vec<TaffyId> = match spec {
            Some(spec) => {
                s.flex_direction = match spec.direction {
                    Direction::Row => FlexDirection::Row,
                    Direction::Column => FlexDirection::Column,
                };
                let pf = ParentFrame {
                    id: Some(&node.id),
                    h_definite,
                    main_indefinite: matches!(spec.direction, Direction::Column) && !h_definite,
                    main: spec.direction,
                    positioned,
                };
                spec.parts
                    .iter()
                    .filter_map(|part| self.part_node(&node.id, part, node, &tree, &pf, &scoped))
                    .collect()
            }
            None => {
                let pf = ParentFrame {
                    id: Some(&node.id),
                    h_definite,
                    main_indefinite: matches!(
                        s.flex_direction,
                        FlexDirection::Column | FlexDirection::ColumnReverse
                    ) && !h_definite,
                    main: match s.flex_direction {
                        FlexDirection::Row | FlexDirection::RowReverse => Direction::Row,
                        _ => Direction::Column,
                    },
                    positioned,
                };
                node.children
                    .iter()
                    .filter_map(|c| self.child_node(node, c, &tree, &pf, &scoped))
                    .collect()
            }
        };
        self.styles.insert(node.id.clone(), style);
        if kids.is_empty() {
            // A leaf: what the props leave `auto`, the widget's `measure`
            // answers at compute time against the space taffy actually
            // offers — padding/border land outside the content (CSS
            // content-box measure) and wrapping text lays out at the width
            // it is given, so `truncate`/`lines` have something to clamp to.
            Some(
                self.tree
                    .new_leaf_with_context(s, Ctx::Node(node.id.clone()))
                    .unwrap(),
            )
        } else {
            let id = self.tree.new_with_children(s, &kids).unwrap();
            self.tree
                .set_node_context(id, Some(Ctx::Node(node.id.clone())))
                .unwrap();
            Some(id)
        }
    }
}

/// What a frontend supplies so [`layout`] can size the tree — the widget's
/// parts breakdown, a leaf's intrinsic size, and a text run's single-line
/// size. All answers are in the frontend's own unit (egui: px).
pub trait Measure {
    /// The virtual chrome `node` needs laid out — `None` (the usual) lays
    /// children out directly.
    fn parts_spec(&self, node: &ResolvedNode) -> Option<PartsSpec>;
    /// The size a leaf wants in `avail` room, at the content box (padding
    /// and border land outside — taffy offers the content box).
    fn measure(&self, node: &ResolvedNode, style: &Style, avail: Size) -> Size;
    /// A text child's single-line size in its owner's resolved style —
    /// matches the paint path's single-line spans.
    fn measure_text(&self, owner: &ResolvedNode, owner_style: &Style, text: &str) -> Size;
}

/// The measured boxes a pass produced — `(content, padding)` dims per node.
fn collect_boxes(tree: &TaffyTree<Ctx>, id: TaffyId, out: &mut HashMap<NodeId, (Size, Size)>) {
    let l = tree.layout(id).unwrap();
    if let Some(Ctx::Node(n)) = tree.get_node_context(id) {
        let bx = l.border.left + l.border.right;
        let by = l.border.top + l.border.bottom;
        let px = l.padding.left + l.padding.right;
        let py = l.padding.top + l.padding.bottom;
        let padding_box = Size::new(l.size.width - bx, l.size.height - by);
        out.insert(
            n.clone(),
            (
                Size::new(padding_box.x - px, padding_box.y - py),
                padding_box,
            ),
        );
    }
    for child in tree.children(id).unwrap_or_default() {
        collect_boxes(tree, child, out);
    }
}

/// Each node's percent bases from the last pass's measured boxes — CSS
/// containing-block rules: in-flow children resolve against the parent's
/// content box (height only when the parent was definite), abs/fixed
/// against the nearest positioned ancestor's padding box, `gap` against
/// the element's own content box, `flex-basis` along the container's main
/// axis.
fn derive_bases(
    cb_of: &HashMap<NodeId, Cb>,
    boxes: &HashMap<NodeId, (Size, Size)>,
    rect: &Rect,
) -> HashMap<NodeId, NodeBases> {
    cb_of
        .iter()
        .map(|(id, cb)| {
            let dims = cb
                .node
                .as_ref()
                .and_then(|p| boxes.get(p))
                .map(|(c, p)| if cb.padding_box { *p } else { *c })
                .unwrap_or(Size::new(rect.width(), rect.height()));
            let x = Some(dims.x);
            let y = (cb.padding_box || cb.y_definite).then_some(dims.y);
            let basis = match cb.main {
                Direction::Row => x,
                Direction::Column => y,
            };
            let own = boxes
                .get(id)
                .map(|(c, _)| (Some(c.x), Some(c.y)))
                .unwrap_or_default();
            (
                id.clone(),
                NodeBases {
                    cb: (x, y),
                    own,
                    basis,
                },
            )
        })
        .collect()
}

/// Two base sets are the same when every entry agrees to a hairline —
/// sub-0.01px wobble is AA noise, not a moved base.
fn bases_eq(a: &HashMap<NodeId, NodeBases>, b: &HashMap<NodeId, NodeBases>) -> bool {
    let eq = |x: Option<f32>, y: Option<f32>| match (x, y) {
        (Some(x), Some(y)) => (x - y).abs() < 0.01,
        (None, None) => true,
        _ => false,
    };
    a.len() == b.len()
        && a.iter().all(|(id, n)| {
            b.get(id).is_some_and(|m| {
                eq(n.cb.0, m.cb.0)
                    && eq(n.cb.1, m.cb.1)
                    && eq(n.basis, m.basis)
                    && eq(n.own.0, m.own.0)
                    && eq(n.own.1, m.own.1)
            })
        })
}

/// Lay out `root` inside `rect` — the frame calls this when the resolve
/// revision or the rect changed, and keeps the [`Layout`] until then.
///
/// Percent terms inside `calc()` resolve against their containing block's
/// used size, which only exists after a layout — so a tree carrying any
/// `calc(…% ± …)` gets extra passes: the first measures with the
/// percent-term placeholder, each next rebuilds with the terms resolved
/// against the bases the previous pass measured, until the bases stop
/// moving (or the cap). A tree with no percent `calc()` runs exactly one
/// pass, as before.
///
/// The root's containing block is the viewport: `width: auto` fills it —
/// block-box behaviour, not a shrink-wrapped flex item. Same downward:
/// `height: auto` still paints the whole viewport (`min-height: 100vh`),
/// so a `bg` root covers the empty tail of a short panel.
pub fn layout(m: &dyn Measure, scx: &StyleCx, root: &ResolvedNode, rect: Rect) -> Layout {
    layout_impl(m, scx, root, rect, true)
}

/// The same walk for a subtree that is not the page root — the overlay
/// pass's synthetic host column is the caller. `width: auto` still fills
/// `rect` (a block box fills its containing block), but `height: auto`
/// stays content-sized: the `min-height: 100vh` floor is the page root's
/// alone, so `sub.size` is the real content box a dialog centres.
pub fn layout_shrink(m: &dyn Measure, scx: &StyleCx, root: &ResolvedNode, rect: Rect) -> Layout {
    layout_impl(m, scx, root, rect, false)
}

fn layout_impl(
    m: &dyn Measure,
    scx: &StyleCx,
    root: &ResolvedNode,
    rect: Rect,
    viewport_root: bool,
) -> Layout {
    let mut cb_of = HashMap::new();
    let mut bases: HashMap<NodeId, NodeBases> = HashMap::new();
    let mut out = Layout {
        size: Size::ZERO,
        rects: HashMap::new(),
        styles: HashMap::new(),
        parts: Parts::new(),
        texts: Vec::new(),
        scroll: HashMap::new(),
        clip: HashMap::new(),
    };

    for _pass in 0..4 {
        let mut b = Builder {
            tree: TaffyTree::new(),
            m,
            scx,
            nodes: HashMap::new(),
            styles: HashMap::new(),
            bases: &bases,
            cb_of: &mut cb_of,
            needs_bases: false,
            scroll: HashMap::new(),
            clip: HashMap::new(),
        };
        let root_id = b
            .resolved_node(
                root,
                &TreeCfg::default(),
                &ParentFrame {
                    id: None,
                    h_definite: false,
                    main_indefinite: true,
                    main: Direction::Column,
                    positioned: None,
                },
                scx,
            )
            .expect("root lays out");

        // The root's containing block is the viewport: `width: auto` fills
        // it — block-box behaviour, not a shrink-wrapped flex item. Same
        // downward: `height: auto` still paints the whole viewport
        // (`min-height: 100vh`), so a `bg` root covers the empty tail of a
        // short panel. `viewport_root` withholds that floor: a floating
        // host's `auto` height is its content.
        let mut root_style = b.tree.style(root_id).unwrap().clone();
        let mut touch = false;
        if matches!(
            root_style.size.width.expand(),
            taffy::ExpandedDimension::Auto
        ) {
            root_style.size.width = taffy::Dimension::length(rect.width());
            touch = true;
        }
        if viewport_root
            && matches!(
                root_style.size.height.expand(),
                taffy::ExpandedDimension::Auto
            )
        {
            root_style.min_size.height =
                taffy::prelude::LengthPercentageAuto::length(rect.height());
            touch = true;
        }
        if touch {
            let _ = b.tree.set_style(root_id, root_style);
        }

        let Builder {
            mut tree,
            nodes,
            styles,
            needs_bases,
            scroll,
            clip,
            ..
        } = b;
        let _ = tree.compute_layout_with_measure(
            root_id,
            taffy::Size {
                width: AvailableSpace::Definite(rect.width()),
                // Height is content-sized: a WE panel scrolls, so
                // `height: 100%` children grow to their content rather than
                // the viewport.
                height: AvailableSpace::MinContent,
            },
            |inputs, _taffy_id, ctx, style| {
                let node = match ctx {
                    Some(Ctx::Node(id)) => nodes.get(id).copied(),
                    _ => None,
                };
                let Some(node) = node else {
                    // Text spans and decorative parts pin their size in the
                    // style — a zero measure leaves those sizes to rule.
                    return taffy::compute::compute_leaf_layout(
                        inputs,
                        style,
                        |_, _| 0.0,
                        |_, _| taffy::Size::ZERO,
                    );
                };
                let wstyle = styles
                    .get(&node.id)
                    .expect("a laid-out node resolved a style");
                taffy::compute::compute_leaf_layout(
                    inputs,
                    style,
                    |_, _| 0.0,
                    |_known, space| {
                        let avail = Size::new(offered(space.width), offered(space.height));
                        let s = m.measure(node, wstyle, avail);
                        taffy::Size {
                            width: finite(s.x),
                            height: finite(s.y),
                        }
                    },
                )
            },
        );

        let mut next = Layout {
            size: Size::ZERO,
            rects: HashMap::new(),
            styles,
            parts: Parts::new(),
            texts: Vec::new(),
            scroll,
            clip,
        };
        collect(&tree, root_id, rect.min, &mut next);
        if let Some(r) = next.rects.get(&root.id) {
            next.size = r.size();
        }
        out = next;
        if !needs_bases {
            break;
        }
        let mut boxes = HashMap::new();
        collect_boxes(&tree, root_id, &mut boxes);
        let new_bases = derive_bases(&cb_of, &boxes, &rect);
        if bases_eq(&new_bases, &bases) {
            break;
        }
        bases = new_bases;
    }
    out
}

/// Walk the computed tree into the flat [`Layout`].
fn collect(tree: &TaffyTree<Ctx>, id: TaffyId, origin: Pos2, out: &mut Layout) {
    let l = tree.layout(id).unwrap();
    let rect = Rect::from_min_size(
        origin + Vec2::new(l.location.x, l.location.y),
        Vec2::new(l.size.width, l.size.height),
    );
    match tree.get_node_context(id) {
        Some(Ctx::Node(node)) => {
            out.rects.insert(node.clone(), rect);
        }
        Some(Ctx::Part(owner, name)) => {
            out.parts.insert((owner.clone(), name), rect);
        }
        Some(Ctx::Text(owner, text)) => {
            out.texts.push(TextSpan {
                node: owner.clone(),
                rect,
                text: text.clone(),
            });
        }
        None => {}
    }
    for child in tree.children(id).unwrap_or_default() {
        collect(tree, child, rect.min, out);
    }
}
