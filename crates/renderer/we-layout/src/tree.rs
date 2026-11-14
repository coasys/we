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
use taffy::{ExpandedLengthPercentage, ExpandedLengthPercentageAuto, NodeId as TaffyId};
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
    /// The percent bases each node's `calc`/`%` terms resolved against —
    /// `cb.0` is the containing-block width every edge % reads. `None` on
    /// an axis means the base was content-driven (the CSS cyclic fallback
    /// applied) or the source never laid out. Paint resolves its own
    /// insets against these — it never rebuilds a base from a parent rect.
    pub bases: HashMap<NodeId, Bases>,
    /// `true` when the deferred-base solve hit its pass cap with consumed
    /// bases still moving — a deep acyclic chain the budget did not
    /// finish, not a detected cycle. The returned build is honest (its
    /// `bases` are the values it actually used) but not settled.
    pub unconverged: bool,
}

/// The resolved percent bases of one node — what its `calc(…% …)` and
/// bare `%` terms computed against during the layout build.
#[derive(Debug, Clone, Copy, Default)]
pub struct Bases {
    /// The containing block (width, height): the parent's content box for
    /// in-flow children, the nearest positioned ancestor's padding box
    /// for abs/fixed, a grid cell, or the layout rect for the root.
    pub cb: (Option<f32>, Option<f32>),
    /// The node's own content box (width, height) — `gap`'s base.
    pub own: (Option<f32>, Option<f32>),
    /// The container's inner size along its main axis — `flex-basis`'s.
    pub basis: Option<f32>,
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

// ── Percent bases ─────────────────────────────────────────────────────────
//
// A percent term (`50%`, or `…%` inside `calc()`) needs the box it is of.
// The bases below are derived *statically*, top-down while the taffy tree
// is built: every node's containing block is computed from its parent's
// resolved inputs (style + containing block), never read back from a
// previous pass's measured boxes. Three states per axis:
//
//   Definite(v) — known at build; `calc` becomes `length(v-resolved)`.
//   Deferred    — only taffy can know it (a flexed main size, a grid
//                 track area): `calc` keeps its percent term as the
//                 placeholder on the build pass, and one measured pass
//                 resolves it (the base is content-independent by
//                 construction, so it converges — a base that keeps
//                 moving was cyclic and is forced `Indefinite`).
//   Indefinite  — content-driven: CSS's cyclic-percentage rule applies,
//                 so the term takes the property's fallback — `auto` for
//                 sizes/insets/basis, `0` for edges/margins/gap.
//
// `Layout::bases` exports the resolved bases so paint insets against the
// same numbers layout used — it never rebuilds a percent base itself.

/// One axis's percent base at style-build time.
#[derive(Clone, Copy, PartialEq, Debug)]
enum AxisBase {
    /// Known — `calc` resolves to a length against it.
    Definite(f32),
    /// Taffy determines it — measured after the pass, resolved on the next.
    Deferred,
    /// Content-driven — the CSS cyclic-percentage fallback applies.
    Indefinite,
}

impl AxisBase {
    /// `self` transformed when `Definite` — the state propagates unchanged.
    fn map(self, f: impl Fn(f32) -> f32) -> AxisBase {
        match self {
            AxisBase::Definite(v) => AxisBase::Definite(f(v)),
            other => other,
        }
    }

    /// `self − v` — a definite subtraction from a known base.
    fn sub(self, v: f32) -> AxisBase {
        self.map(|x| x - v)
    }

    /// `self − other`: subtracting anything content-driven makes the
    /// result content-driven too; anything minus `Deferred` defers.
    fn sub_state(self, other: AxisBase) -> AxisBase {
        match (self, other) {
            (AxisBase::Definite(a), AxisBase::Definite(b)) => AxisBase::Definite(a - b),
            (AxisBase::Indefinite, _) | (_, AxisBase::Indefinite) => AxisBase::Indefinite,
            _ => AxisBase::Deferred,
        }
    }

    /// `self + other` — same propagation as [`AxisBase::sub_state`].
    fn add_state(self, other: AxisBase) -> AxisBase {
        match (self, other) {
            (AxisBase::Definite(a), AxisBase::Definite(b)) => AxisBase::Definite(a + b),
            (AxisBase::Indefinite, _) | (_, AxisBase::Indefinite) => AxisBase::Indefinite,
            _ => AxisBase::Deferred,
        }
    }

    /// The value, when `Definite`.
    fn val(self) -> Option<f32> {
        match self {
            AxisBase::Definite(v) => Some(v),
            _ => None,
        }
    }
}

/// Which of a node's bases a deferred measurement belongs to — the key
/// the measured values map is indexed by.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum Axis {
    /// Containing-block width — the base every box edge's % resolves on.
    CbX,
    /// Containing-block height — size/inset %'s vertical base.
    CbY,
    /// The node's own content-box width/height — `gap`'s % base.
    OwnX,
    OwnY,
    /// The container's inner main-axis size — `flex-basis` %'s base.
    Basis,
}

/// The bases a node resolved against — the per-axis states its taffy
/// style was built with. [`Layout::bases`] stores them as resolved values.
#[derive(Clone, Copy)]
struct Axes {
    /// The node's containing block — in-flow parent's content box or the
    /// positioned ancestor's padding box.
    cb: (AxisBase, AxisBase),
    /// The node's own content box — `gap`'s base and its children's `cb`.
    own: (AxisBase, AxisBase),
    /// The container's inner main size — `flex-basis`'s base.
    basis: AxisBase,
}

impl Axes {
    /// The resolved bases this build used. A deferred axis a `calc`
    /// consumed exports the input measurement it resolved against —
    /// the base the returned geometry was computed with, converged or
    /// not. Any other deferred axis — a bare percent taffy resolved
    /// itself this pass, or a consumed base with no prior measurement
    /// (the percent term stood in) — exports the fresh measured box.
    /// Indefinite axes export `None` (paint insets against `0` there,
    /// matching the cyclic fallback).
    fn to_bases(
        self,
        id: &NodeId,
        consumed: &std::collections::HashSet<(NodeId, Axis)>,
        used: &HashMap<(NodeId, Axis), f32>,
        fresh: &HashMap<(NodeId, Axis), f32>,
    ) -> Bases {
        let v = |axis: Axis, b: AxisBase| match b {
            AxisBase::Definite(v) => Some(v),
            AxisBase::Deferred => {
                let k = (id.clone(), axis);
                if consumed.contains(&k) {
                    used.get(&k).or_else(|| fresh.get(&k)).copied()
                } else {
                    fresh.get(&k).copied()
                }
            }
            AxisBase::Indefinite => None,
        };
        Bases {
            cb: (v(Axis::CbX, self.cb.0), v(Axis::CbY, self.cb.1)),
            own: (v(Axis::OwnX, self.own.0), v(Axis::OwnY, self.own.1)),
            basis: v(Axis::Basis, self.basis),
        }
    }
}

/// A percent term's resolution context: which node it belongs to and
/// which of its bases feeds it — the deferred-measurement key.
#[derive(Clone, Copy)]
struct PctBase<'a> {
    node: &'a NodeId,
    axis: Axis,
    base: AxisBase,
}

/// What a percent-bearing `calc` becomes in the taffy style.
enum PctCalc {
    /// Fully resolved — a concrete px value.
    Px(f32),
    /// The percent term alone stands in — a deferred base this pass has
    /// not measured yet.
    Percent(f32),
    /// The base is content-driven — the property's CSS cyclic fallback
    /// applies (percent → `auto`/`0`).
    Cyclic,
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

/// `Edges` — every resolved padding/margin edge's contribution to a
/// derived box state: a resolved length is definite, a surviving
/// `Percent` is that fraction of the base it resolved against.
fn lp_base(v: LengthPercentage, base: AxisBase) -> AxisBase {
    match v.expand() {
        ExpandedLengthPercentage::Length(v) => AxisBase::Definite(v),
        ExpandedLengthPercentage::Percent(p) => base.map(|b| p * b),
        _ => AxisBase::Indefinite,
    }
}

/// Same, for `LengthPercentageAuto` edges (margins/insets) — `auto` is
/// statically unknowable.
fn lpa_base(v: LengthPercentageAuto, base: AxisBase) -> AxisBase {
    match v.expand() {
        ExpandedLengthPercentageAuto::Length(v) => AxisBase::Definite(v),
        ExpandedLengthPercentageAuto::Percent(p) => base.map(|b| p * b),
        _ => AxisBase::Indefinite,
    }
}

/// `lpa_base` for a min/max bound — `auto` is no bound rather than an
/// indefinite one.
fn bound_base(v: LengthPercentageAuto, base: AxisBase) -> Option<AxisBase> {
    match v.expand() {
        ExpandedLengthPercentageAuto::Auto => None,
        other => Some(match other {
            ExpandedLengthPercentageAuto::Length(v) => AxisBase::Definite(v),
            ExpandedLengthPercentageAuto::Percent(p) => base.map(|b| p * b),
            _ => AxisBase::Indefinite,
        }),
    }
}

/// A definite used size clamped by definite min/max bounds — bounds that
/// are not `Definite` leave the state alone (the clamp is taffy's anyway).
fn clamp_used(v: AxisBase, lo: Option<AxisBase>, hi: Option<AxisBase>) -> AxisBase {
    let (Some(v), lo, hi) = (
        v.val(),
        lo.and_then(AxisBase::val),
        hi.and_then(AxisBase::val),
    ) else {
        return v;
    };
    let mut v = v;
    if let Some(lo) = lo {
        v = v.max(lo);
    }
    if let Some(hi) = hi {
        v = v.min(hi);
    }
    AxisBase::Definite(v)
}

/// `align-self`'s answer to the parent's stretch offer: an explicit
/// `Stretch` takes it, anything else explicit declines, `Auto`/unset
/// inherits the offer.
fn self_stretch(a: Option<&ItemAlign>, offer: bool) -> bool {
    match a {
        None | Some(ItemAlign::Auto) => offer,
        Some(ItemAlign::Stretch) => true,
        _ => false,
    }
}

/// The parent's `align-items` stretch offer — the flex default.
fn stretch_offer(a: Option<&ItemAlign>) -> bool {
    matches!(a, None | Some(ItemAlign::Auto) | Some(ItemAlign::Stretch))
}

/// A grid cell's share along one axis: `(content − (count−1)·gap) / count`.
fn cell_base(own: AxisBase, count: u32, gap: f32) -> AxisBase {
    own.map(|v| (v - (count.saturating_sub(1)) as f32 * gap).max(0.0) / count.max(1) as f32)
}

/// An auto-fill grid cell's share along the track axis — the column count
/// is `floor((content + gap) / (min + gap))`, only computable once the
/// container's used width is known → `Deferred` when it isn't.
fn autofill_base(own: AxisBase, min: f32, gap: f32) -> AxisBase {
    own.map(|v| {
        let n = ((v + gap) / (min + gap).max(f32::EPSILON)).floor().max(1.0);
        (v - (n - 1.0) * gap).max(0.0) / n
    })
}

/// Which box a deferred `CbX`/`CbY`/`Basis` reads back its measured
/// value from.
enum CbSrc {
    /// Parent's content box (in-flow) or positioned ancestor's padding
    /// box (abs/fixed). `None` = the layout rect.
    Box {
        node: Option<NodeId>,
        padding_box: bool,
    },
    /// A uniform grid cell: `(content − (count−1)·gap) / count`.
    Cell { node: NodeId, count: u32, gap: f32 },
    /// An auto-fill grid cell — the column count comes from the measured
    /// width: `floor((content + gap) / (min + gap))`.
    AutoCell { node: NodeId, min: f32, gap: f32 },
    /// An auto-fill grid *row* — the row count is `ceil(items / cols)`
    /// where `cols` follows the same measured-width formula as
    /// [`CbSrc::AutoCell`]; the share is `(content.y − (rows−1)·gap_y) /
    /// rows`.
    AutoRows {
        node: NodeId,
        min: f32,
        gap_x: f32,
        gap_y: f32,
        items: usize,
    },
}

/// Where a node's deferred bases read back — per-axis sources plus the
/// container's main axis for the `Basis` pick.
struct CbEntry {
    x: CbSrc,
    y: CbSrc,
    main: Direction,
}

/// One grid axis's cell recipe — `None` when the cell is statically
/// unknowable (mixed track sizes) and the axis falls back to
/// `Indefinite`.
#[derive(Clone, Copy)]
enum GridAxis {
    /// `repeat(n, 1fr)` — `count` uniform tracks with `gap`.
    Counted { count: u32, gap: f32 },
    /// `repeat(auto-fill, minmax(min, 1fr))` — count from the used width.
    AutoFill { min: f32, gap: f32 },
    /// The rows an `AutoFill` column recipe implies — `ceil(items /
    /// measured columns)` `1fr` shares; statically unknowable, so the
    /// cell base defers to the measured box.
    AutoRows {
        min: f32,
        gap_x: f32,
        gap_y: f32,
        items: usize,
    },
}

/// The grid axes a `Grid` node's children resolve against.
#[derive(Clone, Copy)]
struct GridAxes {
    x: Option<GridAxis>,
    y: Option<GridAxis>,
}

/// The parent's frame a child resolves against: its containing block, the
/// positioned ancestor's padding box, the containing flex container's
/// main axis (`flex-basis` axis), its `align-items` stretch offer, and —
/// for `Grid` — the cell recipe.
#[derive(Clone, Copy)]
struct ParentFrame<'a> {
    /// The resolved DOM parent — `None` for the layout root.
    id: Option<&'a NodeId>,
    /// The parent's content box — in-flow children's containing block.
    cb: (AxisBase, AxisBase),
    /// Nearest positioned ancestor — abs/fixed children's containing
    /// block is its padding box.
    positioned: Option<&'a NodeId>,
    /// That ancestor's padding-box dims.
    pb: (AxisBase, AxisBase),
    /// `Some` when the parent is a grid: children resolve against cells.
    grid_axes: Option<GridAxes>,
    /// The parent's flex direction — `flex-basis` resolves along it.
    main: Direction,
    /// `align-items` stretch offer per child axis (the parent's cross).
    stretch_x: bool,
    stretch_y: bool,
}

/// The context a node's own taffy style resolves in — the inputs its
/// percent terms and auto sizes key off.
struct NodeCx<'a> {
    id: &'a NodeId,
    /// The node's containing block (abs/content/cell already selected).
    cb: (AxisBase, AxisBase),
    /// The container's inner main size — `flex-basis`'s base.
    basis: AxisBase,
    /// The parent's main axis — decides whether an `auto` main size is
    /// flexed (deferred to taffy) or content-driven.
    main: Direction,
    /// `width: auto` stretches to the containing block (parent cross is
    /// width and the stretch offer held).
    fill_x: bool,
    /// `height: auto` stretches to the containing block (row parent's
    /// definite-height line, or a grid cell).
    fill_y: bool,
    /// In-flow — not `absolute`/`fixed`/`sticky`.
    in_flow: bool,
}

/// The node's own box states — what its `gap` resolves against and what
/// its children take as their containing block.
struct OwnBoxes {
    /// Content-box dims — in-flow children's `cb`, `gap`'s base.
    content: (AxisBase, AxisBase),
    /// Padding-box dims — a positioned node hands these to abs/fixed
    /// descendants.
    padding: (AxisBase, AxisBase),
}

/// Pick an axis of a box pair along `main` — `flex-basis`'s base.
fn main_pick(main: Direction, cb: (AxisBase, AxisBase)) -> AxisBase {
    match main {
        Direction::Row => cb.0,
        Direction::Column => cb.1,
    }
}

/// A resolved border side's px — always definite (border widths never
/// carry percent).
fn border_px(side: &Option<we_style::BorderSide>, scx: &StyleCx) -> f32 {
    crate::props::border_side_px(side, FONT_PX, ROOT_PX, scx.viewport)
}

/// A resolved `LengthPercentage` as px — `None` while it is still a
/// percent (the cell recipe needs a definite gap).
fn lp_px(v: LengthPercentage) -> Option<f32> {
    match v.expand() {
        ExpandedLengthPercentage::Length(v) => Some(v),
        _ => None,
    }
}

/// The grid cell recipes a `Grid` node's children resolve against:
/// `columns`/`template` (a `repeat(N, 1fr)`) give a static track count,
/// `minChildWidth` gives the auto-fill `min` (its row recipe reads the
/// measured column count back), anything else — or a row axis whose
/// count stays unknowable — is `None`, and that axis's percent bases
/// fall back to `Indefinite`. `n_items` is the *laid-out* child count
/// (auto rows split evenly).
fn grid_axes(node: &ResolvedNode, s: &taffy::Style, n_items: usize) -> GridAxes {
    let gap_x = lp_px(s.gap.width);
    let gap_y = lp_px(s.gap.height);
    let parsed_n = crate::props::prop_str(node, "template").and_then(|t| {
        let t = t.trim();
        let inner = t.strip_prefix("repeat(")?.strip_suffix(')')?;
        let mut it = inner.splitn(2, ',');
        let n: u32 = it.next()?.trim().parse().ok()?;
        (it.next()?.trim() == "1fr").then_some(n)
    });
    let x = if let Some(n) = parsed_n {
        gap_x.map(|gap| GridAxis::Counted { count: n, gap })
    } else if let Some(min) = crate::props::prop_num(node, "minChildWidth") {
        gap_x.map(|gap| GridAxis::AutoFill {
            min: min as f32,
            gap,
        })
    } else {
        let n = crate::props::prop_num(node, "columns")
            .unwrap_or(1.0)
            .max(1.0) as u32;
        gap_x.map(|gap| GridAxis::Counted { count: n, gap })
    };
    let y = match &x {
        Some(GridAxis::Counted { count, .. }) => gap_y.map(|gap| GridAxis::Counted {
            count: n_items.div_ceil(*count as usize).max(1) as u32,
            gap,
        }),
        Some(GridAxis::AutoFill { min, gap: gap_x }) => gap_y.map(|gap_y| GridAxis::AutoRows {
            min: *min,
            gap_x: *gap_x,
            gap_y,
            items: n_items.max(1),
        }),
        _ => None,
    };
    GridAxes { x, y }
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

struct Builder<'a> {
    tree: TaffyTree<Ctx>,
    m: &'a dyn Measure,
    scx: &'a StyleCx<'a>,
    /// `id` → resolved node — the measure function re-finds its widget.
    nodes: HashMap<NodeId, &'a ResolvedNode>,
    /// `id` → the style the tree walk resolved — measure and the `Layout`
    /// output read it so every consumer shares the scoped answer.
    styles: HashMap<NodeId, Style>,
    /// `(id, axis)` → the measured value a deferred base got on the last
    /// pass — empty on the first (placeholder) build.
    vals: &'a HashMap<(NodeId, Axis), f32>,
    /// `(id, axis)` consumed by a `calc` this pass — the set whose
    /// measured movement decides convergence.
    consumed: std::collections::HashSet<(NodeId, Axis)>,
    /// `(id, axis)` found cyclic — forced `Indefinite` permanently (a
    /// deferred base that kept moving was really content-driven).
    forced: &'a std::collections::HashSet<(NodeId, Axis)>,
    /// `id` → which of its bases are `Deferred` — the read-back list.
    deferred: HashMap<NodeId, Vec<Axis>>,
    /// `id` → where its deferred bases read measured values back.
    cb_of: HashMap<NodeId, CbEntry>,
    /// `id` → the bases its style resolved against — `Layout::bases`.
    axes: HashMap<NodeId, Axes>,
    scroll: HashMap<NodeId, Vec2>,
    clip: HashMap<NodeId, Vec2>,
}

impl<'a> Builder<'a> {
    /// `Indefinite` when the axis kept moving between earlier passes and
    /// was found cyclic.
    fn force_cyclic(&self, node: &NodeId, axis: Axis, base: AxisBase) -> AxisBase {
        if matches!(base, AxisBase::Deferred) && self.forced.contains(&(node.clone(), axis)) {
            AxisBase::Indefinite
        } else {
            base
        }
    }

    /// The px a percent-bearing `calc` resolves against — `None` for a
    /// cyclic base (`Indefinite`) and for a deferred base not yet
    /// measured (the caller stands the percent term in and flags the
    /// measured pass).
    fn pct_px(&mut self, b: PctBase) -> Option<f32> {
        match b.base {
            AxisBase::Definite(v) => Some(v),
            AxisBase::Indefinite => None,
            AxisBase::Deferred => {
                self.consumed.insert((b.node.clone(), b.axis));
                self.vals.get(&(b.node.clone(), b.axis)).copied()
            }
        }
    }

    /// A percent-bearing `calc` under `b`'s base → its taffy-side fate.
    fn pct_calc(&mut self, c: &we_style::Calc, b: PctBase) -> PctCalc {
        match self.pct_px(b) {
            Some(v) => PctCalc::Px(
                c.resolve(Some(v), FONT_PX, ROOT_PX, self.scx.viewport)
                    .unwrap_or(0.0),
            ),
            None if b.base == AxisBase::Indefinite => PctCalc::Cyclic,
            None => PctCalc::Percent(c.percent),
        }
    }

    /// `Dimension` → taffy `Dimension` (sizes, flex basis).
    fn dim(&mut self, d: Option<&Dimension>, b: PctBase) -> taffy::Dimension {
        match d {
            Some(Dimension::Percent(p)) => match b.base {
                AxisBase::Indefinite => taffy::Dimension::auto(),
                _ => taffy::Dimension::percent(*p),
            },
            Some(Dimension::Calc(c)) if c.percent != 0.0 => match self.pct_calc(c, b) {
                PctCalc::Px(v) => taffy::Dimension::length(v),
                PctCalc::Percent(p) => taffy::Dimension::percent(p),
                PctCalc::Cyclic => taffy::Dimension::auto(),
            },
            Some(d) => dim_px(d, self.scx)
                .map(taffy::Dimension::length)
                .unwrap_or(taffy::Dimension::auto()),
            None => taffy::Dimension::auto(),
        }
    }

    /// `Dimension` → taffy `LengthPercentage` (padding).
    fn lp(&mut self, d: Option<&Dimension>, b: PctBase) -> LengthPercentage {
        match d {
            Some(Dimension::Percent(p)) => match b.base {
                AxisBase::Indefinite => LengthPercentage::length(0.0),
                _ => LengthPercentage::percent(*p),
            },
            Some(Dimension::Calc(c)) if c.percent != 0.0 => match self.pct_calc(c, b) {
                PctCalc::Px(v) => LengthPercentage::length(v),
                PctCalc::Percent(p) => LengthPercentage::percent(p),
                PctCalc::Cyclic => LengthPercentage::length(
                    c.resolve(Some(0.0), FONT_PX, ROOT_PX, self.scx.viewport)
                        .unwrap_or(0.0),
                ),
            },
            Some(d) => dim_px(d, self.scx)
                .map(LengthPercentage::length)
                .unwrap_or(LengthPercentage::length(0.0)),
            None => LengthPercentage::length(0.0),
        }
    }

    /// `Dimension` → taffy `LengthPercentageAuto` (insets, min/max) —
    /// `auto` when unset or cyclic, matching CSS.
    fn lpa(&mut self, d: Option<&Dimension>, b: PctBase) -> LengthPercentageAuto {
        match d {
            Some(Dimension::Percent(p)) => match b.base {
                AxisBase::Indefinite => LengthPercentageAuto::auto(),
                _ => LengthPercentageAuto::percent(*p),
            },
            Some(Dimension::Calc(c)) if c.percent != 0.0 => match self.pct_calc(c, b) {
                PctCalc::Px(v) => LengthPercentageAuto::length(v),
                PctCalc::Percent(p) => LengthPercentageAuto::percent(p),
                PctCalc::Cyclic => LengthPercentageAuto::auto(),
            },
            Some(d) => dim_px(d, self.scx)
                .map(LengthPercentageAuto::length)
                .unwrap_or(LengthPercentageAuto::auto()),
            None => LengthPercentageAuto::auto(),
        }
    }

    /// Margins: unset is `0`, not `auto` — `auto` margins absorb free
    /// space and center every child in a flex container. A `calc` whose
    /// base is cyclic keeps its non-percent terms, like a length edge.
    fn lpa_margin(&mut self, d: Option<&Dimension>, b: PctBase) -> LengthPercentageAuto {
        match d {
            Some(Dimension::Percent(p)) => match b.base {
                AxisBase::Indefinite => LengthPercentageAuto::length(0.0),
                _ => LengthPercentageAuto::percent(*p),
            },
            Some(Dimension::Auto) => LengthPercentageAuto::auto(),
            Some(Dimension::Calc(c)) if c.percent != 0.0 => match self.pct_calc(c, b) {
                PctCalc::Px(v) => LengthPercentageAuto::length(v),
                PctCalc::Percent(p) => LengthPercentageAuto::percent(p),
                PctCalc::Cyclic => LengthPercentageAuto::length(
                    c.resolve(Some(0.0), FONT_PX, ROOT_PX, self.scx.viewport)
                        .unwrap_or(0.0),
                ),
            },
            Some(d) => dim_px(d, self.scx)
                .map(LengthPercentageAuto::length)
                .unwrap_or(LengthPercentageAuto::length(0.0)),
            None => LengthPercentageAuto::length(0.0),
        }
    }

    /// `gap`: CSS resolves its percentages against the element's *own*
    /// content box — the axis `b` carries, `Indefinite` when the used
    /// size is content-driven (the cyclic rule → `0`).
    fn gap_lp(&mut self, d: Option<&Dimension>, b: PctBase) -> LengthPercentage {
        match d {
            Some(Dimension::Percent(p)) => match b.base {
                AxisBase::Definite(v) => LengthPercentage::length(p * v),
                AxisBase::Deferred => LengthPercentage::percent(*p),
                AxisBase::Indefinite => LengthPercentage::length(0.0),
            },
            Some(Dimension::Calc(c)) if c.percent != 0.0 => match self.pct_calc(c, b) {
                PctCalc::Px(v) => LengthPercentage::length(v),
                PctCalc::Percent(p) => LengthPercentage::percent(p),
                PctCalc::Cyclic => LengthPercentage::length(
                    c.resolve(Some(0.0), FONT_PX, ROOT_PX, self.scx.viewport)
                        .unwrap_or(0.0),
                ),
            },
            Some(d) => dim_px(d, self.scx)
                .map(LengthPercentage::length)
                .unwrap_or(LengthPercentage::length(0.0)),
            None => LengthPercentage::length(0.0),
        }
    }

    /// `Edge<Option<Dimension>>` → a taffy edge rect — `f` gets each
    /// edge's own percent base (CB width for margins — all four — and
    /// insets per axis, per CSS).
    fn edges(
        &mut self,
        e: &we_style::Edges<Option<Dimension>>,
        f: fn(&mut Self, Option<&Dimension>, PctBase) -> LengthPercentageAuto,
        bx: PctBase,
        by: PctBase,
    ) -> taffy::Rect<LengthPercentageAuto> {
        taffy::Rect {
            left: f(self, e.left.as_ref(), bx),
            right: f(self, e.right.as_ref(), bx),
            top: f(self, e.top.as_ref(), by),
            bottom: f(self, e.bottom.as_ref(), by),
        }
    }

    /// The taffy style a resolved node carries, translated from its
    /// resolved [`Style`] — direction, wrap, `ax`/`ay`, gap, padding,
    /// border, margin, sizes, flex, `align-self`, position + insets,
    /// overflow, aspect-ratio, `display: none`, and `Grid`'s track list.
    /// Every percent/`calc` term resolves against `ncx`'s statically
    /// derived bases; the returned [`OwnBoxes`] reports the box states
    /// the node hands to its children (and `gap` resolved against).
    fn node_style(
        &mut self,
        node: &ResolvedNode,
        style: &Style,
        ncx: &NodeCx,
    ) -> (taffy::Style, OwnBoxes) {
        let l = &style.layout;
        let (sx, ..) = l
            .overflow_x
            .as_ref()
            .or(l.overflow.as_ref())
            .map(overflow)
            .unwrap_or((taffy::Overflow::Visible, false, false));
        let (sy, ..) = l
            .overflow_y
            .as_ref()
            .or(l.overflow.as_ref())
            .map(overflow)
            .unwrap_or((taffy::Overflow::Visible, false, false));
        let cbx = PctBase {
            node: ncx.id,
            axis: Axis::CbX,
            base: ncx.cb.0,
        };
        let cby = PctBase {
            node: ncx.id,
            axis: Axis::CbY,
            base: ncx.cb.1,
        };
        let basis = PctBase {
            node: ncx.id,
            axis: Axis::Basis,
            base: ncx.basis,
        };

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
            gap: taffy::Size {
                width: LengthPercentage::length(0.0),
                height: LengthPercentage::length(0.0),
            },
            size: taffy::Size {
                width: self.dim(l.width.as_ref(), cbx),
                height: self.dim(l.height.as_ref(), cby),
            },
            min_size: taffy::Size {
                width: self.lpa(l.min_width.as_ref(), cbx),
                height: self.lpa(l.min_height.as_ref(), cby),
            },
            max_size: taffy::Size {
                width: self.lpa(l.max_width.as_ref(), cbx),
                height: self.lpa(l.max_height.as_ref(), cby),
            },
            aspect_ratio: l.aspect_ratio,
            // Every padding edge's % resolves against the containing-block
            // *width* — the horizontal-writing-mode rule CSS applies to
            // margins and insets' inline edges too.
            padding: taffy::Rect {
                left: self.lp(l.padding.left.as_ref(), cbx),
                right: self.lp(l.padding.right.as_ref(), cbx),
                top: self.lp(l.padding.top.as_ref(), cbx),
                bottom: self.lp(l.padding.bottom.as_ref(), cbx),
            },
            // Border widths are real inset: children and measured content
            // sit inside them, and the border box grows by them.
            border: taffy::Rect {
                left: border_lp(&style.paint.borders.left, self.scx),
                right: border_lp(&style.paint.borders.right, self.scx),
                top: border_lp(&style.paint.borders.top, self.scx),
                bottom: border_lp(&style.paint.borders.bottom, self.scx),
            },
            margin: self.edges(&l.margin, Self::lpa_margin, cbx, cbx),
            inset: self.edges(&l.inset, Self::lpa, cbx, cby),
            position: match l.position {
                Some(Position::Relative) => taffy::Position::Relative,
                Some(Position::Absolute) | Some(Position::Fixed) | Some(Position::Sticky) => {
                    // `fixed` and `sticky` behave as absolute in a retained
                    // canvas — noted in NOTES. This is the one CSS
                    // deviation: a browser keeps a sticky item in flow. The
                    // grid recipe's `n_items` follows this mapping.
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
                .map(|f| self.dim(Some(&f.basis), basis))
                .unwrap_or(taffy::Dimension::auto()),
            ..Default::default()
        };
        use taffy::ExpandedDimension as Ed;
        // `flex: 1` is `flex-basis: 0` — a zero basis on an indefinite
        // main axis behaves as `content` in CSS; taffy would make it 0
        // and collapse the child (the tree panel's `overflowY:auto`
        // column). A percent basis already fell back to `auto` in `dim`.
        if matches!(ncx.basis, AxisBase::Indefinite)
            && matches!(s.flex_basis.expand(), Ed::Length(0.0))
        {
            s.flex_basis = taffy::Dimension::auto();
        }
        if node.ty.as_ref() == "Grid" {
            s.display = Display::Grid;
            s.grid_template_columns = grid_columns(node);
            s.grid_auto_rows = vec![taffy::TrackSizingFunction::from_fr(1.0)];
            s.grid_auto_flow = taffy::GridAutoFlow::Row;
        }

        // ── The node's own box states ─────────────────────────────────
        // `length`/`percent` sizes carry their state; `auto` is
        // content-driven unless it stretches (`fill_*`) or taffy flexes
        // it on the parent's main (grow + a non-auto basis, which is
        // content-independent → `Deferred`).
        let flexed = s.flex_grow > 0.0
            && !matches!(s.flex_basis.expand(), Ed::Auto)
            && !matches!(ncx.basis, AxisBase::Indefinite);
        let auto_w = matches!(s.size.width.expand(), Ed::Auto);
        let auto_h = matches!(s.size.height.expand(), Ed::Auto);
        let ml = lpa_base(s.margin.left, ncx.cb.0);
        let mr = lpa_base(s.margin.right, ncx.cb.0);
        // Every margin edge's percent resolves against the CB *width* —
        // margins share padding's inline-base rule (CSS2.1 §8.3); the
        // taffy margin adapter gets `cbx` for all four edges already.
        let mt = lpa_base(s.margin.top, ncx.cb.0);
        let mb = lpa_base(s.margin.bottom, ncx.cb.0);
        // A *declared* main size is the flex base, not the used size —
        // `flex-shrink`/`grow` can still move it, and CSS §flexbox calls
        // the flexed result definite for a child's % — so read it back.
        // `auto` main sizes stay content-driven: a percent child fed
        // into the measured box is the R2-3 cyclic equation.
        let main_w_flexed = ncx.in_flow
            && matches!(ncx.main, Direction::Row)
            && (s.flex_grow > 0.0 || s.flex_shrink > 0.0);
        let main_h_flexed = ncx.in_flow
            && matches!(ncx.main, Direction::Column)
            && (s.flex_grow > 0.0 || s.flex_shrink > 0.0);
        let mut own_w = match s.size.width.expand() {
            Ed::Length(_) | Ed::Percent(_) if main_w_flexed => AxisBase::Deferred,
            Ed::Length(v) => AxisBase::Definite(v),
            Ed::Percent(p) => ncx.cb.0.map(|b| p * b),
            Ed::Auto => {
                if !ncx.in_flow {
                    AxisBase::Indefinite
                } else if ncx.fill_x {
                    ncx.cb.0.sub_state(ml).sub_state(mr)
                } else if matches!(ncx.main, Direction::Row) && flexed {
                    AxisBase::Deferred
                } else {
                    AxisBase::Indefinite
                }
            }
            _ => AxisBase::Indefinite,
        };
        let mut own_h = match s.size.height.expand() {
            Ed::Length(_) | Ed::Percent(_) if main_h_flexed => AxisBase::Deferred,
            Ed::Length(v) => AxisBase::Definite(v),
            Ed::Percent(p) => ncx.cb.1.map(|b| p * b),
            Ed::Auto => {
                if !ncx.in_flow {
                    AxisBase::Indefinite
                } else if ncx.fill_y {
                    ncx.cb.1.sub_state(mt).sub_state(mb)
                } else if matches!(ncx.main, Direction::Column) && flexed {
                    AxisBase::Deferred
                } else {
                    AxisBase::Indefinite
                }
            }
            _ => AxisBase::Indefinite,
        };
        // `aspect-ratio` turns one definite used size into the other's —
        // a deferred source defers it too (the measured value carries
        // taffy's transfer); only `Indefinite` leaves the axis alone.
        if let Some(r) = l.aspect_ratio {
            if auto_h {
                own_h = match own_w {
                    AxisBase::Definite(w) => AxisBase::Definite(w / r),
                    AxisBase::Deferred => AxisBase::Deferred,
                    AxisBase::Indefinite => own_h,
                };
            }
            if auto_w {
                own_w = match own_h {
                    AxisBase::Definite(h) => AxisBase::Definite(h * r),
                    AxisBase::Deferred => AxisBase::Deferred,
                    AxisBase::Indefinite => own_w,
                };
            }
        }
        // Definite min/max bounds clamp a definite used size; a bound
        // that is not `Definite` leaves the state to taffy anyway.
        own_w = clamp_used(
            own_w,
            bound_base(s.min_size.width, ncx.cb.0),
            bound_base(s.max_size.width, ncx.cb.0),
        );
        own_h = clamp_used(
            own_h,
            bound_base(s.min_size.height, ncx.cb.1),
            bound_base(s.max_size.height, ncx.cb.1),
        );
        // An axis that kept moving between passes was really cyclic.
        own_w = self.force_cyclic(ncx.id, Axis::OwnX, own_w);
        own_h = self.force_cyclic(ncx.id, Axis::OwnY, own_h);
        let pad_x = lp_base(s.padding.left, ncx.cb.0).add_state(lp_base(s.padding.right, ncx.cb.0));
        let pad_y = lp_base(s.padding.top, ncx.cb.0).add_state(lp_base(s.padding.bottom, ncx.cb.0));
        let bx = border_px(&style.paint.borders.left, self.scx)
            + border_px(&style.paint.borders.right, self.scx);
        let by = border_px(&style.paint.borders.top, self.scx)
            + border_px(&style.paint.borders.bottom, self.scx);
        let content = (
            own_w.sub(bx).sub_state(pad_x),
            own_h.sub(by).sub_state(pad_y),
        );
        let padding = (own_w.sub(bx), own_h.sub(by));

        // `gap` resolves against the element's *own* content box — the
        // cyclic-percentage case CSS names (an auto-height column's
        // row-gap % feeds its own measured height → `0`).
        if let Some((row, col)) = &l.gap {
            // Style's gap is (row, column); taffy's Size is (width=col,
            // height=row).
            s.gap = taffy::Size {
                width: self.gap_lp(
                    Some(col),
                    PctBase {
                        node: ncx.id,
                        axis: Axis::OwnX,
                        base: content.0,
                    },
                ),
                height: self.gap_lp(
                    Some(row),
                    PctBase {
                        node: ncx.id,
                        axis: Axis::OwnY,
                        base: content.1,
                    },
                ),
            };
        }
        (s, OwnBoxes { content, padding })
    }

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
        // A part's box dims are definite props (`width`/`height` − its
        // `indent` is inset); its children keep the positioned chain.
        let pf = ParentFrame {
            id: pf.id,
            cb: (
                spec.width
                    .map(|w| AxisBase::Definite((w - spec.indent).max(0.0)))
                    .unwrap_or(AxisBase::Indefinite),
                spec.height
                    .map(AxisBase::Definite)
                    .unwrap_or(AxisBase::Indefinite),
            ),
            positioned: pf.positioned,
            pb: pf.pb,
            grid_axes: None,
            main: spec.direction,
            stretch_x: matches!(spec.direction, Direction::Column)
                && stretch_offer(spec.align.as_ref()),
            stretch_y: matches!(spec.direction, Direction::Row)
                && stretch_offer(spec.align.as_ref()),
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

        // This node's containing block — the box its percent terms resolve
        // against — and where a deferred one reads back a measured value.
        // abs/fixed children take the nearest positioned ancestor's padding
        // box; grid children take their cell; in-flow children take the
        // parent's content box (the layout rect for the root).
        let l = &style.layout;
        let abs = matches!(
            l.position,
            Some(Position::Absolute) | Some(Position::Fixed) | Some(Position::Sticky)
        );
        let parent = pf.id.cloned();
        let (cb, src_x, src_y) = if abs {
            let src = || CbSrc::Box {
                node: pf.positioned.cloned(),
                padding_box: true,
            };
            (pf.pb, src(), src())
        } else if let Some(g) = pf.grid_axes {
            let cell = |cb: AxisBase, axis: Option<&GridAxis>| -> (AxisBase, CbSrc) {
                match axis {
                    Some(GridAxis::Counted { count, gap }) => (
                        cell_base(cb, *count, *gap),
                        CbSrc::Cell {
                            node: parent.clone().unwrap(),
                            count: *count,
                            gap: *gap,
                        },
                    ),
                    Some(GridAxis::AutoFill { min, gap }) => (
                        autofill_base(cb, *min, *gap),
                        CbSrc::AutoCell {
                            node: parent.clone().unwrap(),
                            min: *min,
                            gap: *gap,
                        },
                    ),
                    Some(GridAxis::AutoRows {
                        min,
                        gap_x,
                        gap_y,
                        items,
                    }) => (
                        // The row count needs the measured column count —
                        // statically unknowable, knowable once measured.
                        match cb {
                            AxisBase::Indefinite => AxisBase::Indefinite,
                            _ => AxisBase::Deferred,
                        },
                        CbSrc::AutoRows {
                            node: parent.clone().unwrap(),
                            min: *min,
                            gap_x: *gap_x,
                            gap_y: *gap_y,
                            items: *items,
                        },
                    ),
                    _ => (
                        AxisBase::Indefinite,
                        CbSrc::Box {
                            node: parent.clone(),
                            padding_box: false,
                        },
                    ),
                }
            };
            let (x, sx) = cell(pf.cb.0, g.x.as_ref());
            let (y, sy) = cell(pf.cb.1, g.y.as_ref());
            ((x, y), sx, sy)
        } else {
            let src = || CbSrc::Box {
                node: parent.clone(),
                padding_box: false,
            };
            (pf.cb, src(), src())
        };
        let cbx = self.force_cyclic(&node.id, Axis::CbX, cb.0);
        let cby = self.force_cyclic(&node.id, Axis::CbY, cb.1);
        let basis = self.force_cyclic(&node.id, Axis::Basis, main_pick(pf.main, cb));
        self.cb_of.insert(
            node.id.clone(),
            CbEntry {
                x: src_x,
                y: src_y,
                main: pf.main,
            },
        );

        // Record scroll/clip axes on the layout output.
        let scrolls =
            |o: Option<&Overflow>| matches!(o, Some(Overflow::Auto) | Some(Overflow::Scroll));
        let clips =
            |o: Option<&Overflow>| matches!(o, Some(Overflow::Hidden) | Some(Overflow::Clip));
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

        // The node's taffy style + its own box states — every percent and
        // `calc` term resolves against the statically derived bases.
        let in_flow = !abs;
        let ncx = NodeCx {
            id: &node.id,
            cb: (cbx, cby),
            basis,
            main: pf.main,
            fill_x: in_flow && self_stretch(l.align_self.as_ref(), pf.stretch_x),
            fill_y: in_flow && self_stretch(l.align_self.as_ref(), pf.stretch_y),
            in_flow,
        };
        let (mut s, own) = self.node_style(node, &style, &ncx);

        // The bases this build resolved against — exported on `Layout` so
        // paint insets against the same values, never a rebuilt one.
        self.axes.insert(
            node.id.clone(),
            Axes {
                cb: (cbx, cby),
                own: own.content,
                basis,
            },
        );
        for (axis, b) in [
            (Axis::CbX, cbx),
            (Axis::CbY, cby),
            (Axis::OwnX, own.content.0),
            (Axis::OwnY, own.content.1),
            (Axis::Basis, basis),
        ] {
            if matches!(b, AxisBase::Deferred) {
                self.deferred.entry(node.id.clone()).or_default().push(axis);
            }
        }

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
        // …and their containing-block frame: this node's content box, the
        // updated positioned chain (a positioned node hands abs/fixed
        // descendants its *padding* box), its flex direction for
        // `flex-basis`, its stretch offer, and — for a `Grid` — the cell
        // recipe. `position: static` is the CSS default, not a positioned
        // box — an explicit one must behave exactly like an unset one.
        let is_positioned = matches!(
            style.layout.position,
            Some(Position::Relative)
                | Some(Position::Absolute)
                | Some(Position::Fixed)
                | Some(Position::Sticky)
        );
        let positioned = if is_positioned {
            Some(&node.id)
        } else {
            pf.positioned
        };
        let pb = if is_positioned { own.padding } else { pf.pb };
        let is_grid = matches!(s.display, Display::Grid);
        // The grid recipe counts items taffy lays out *in flow* — a
        // `display: none` child is skipped below and makes no track, and
        // an `absolute`/`fixed`/`sticky` child maps to taffy's
        // `Position::Absolute`: still a taffy child, but out of flow, so
        // it makes no track either. Counting either splits the row
        // shares too thin. Sticky is in flow in CSS; it is excluded here
        // because the recipe must predict the tracks taffy builds, and the
        // adapter's `position` mapping above sends sticky to Absolute.
        let n_items = || -> usize {
            node.children
                .iter()
                .filter(|c| match c {
                    ResolvedChild::Text(_) => true,
                    ResolvedChild::Node(n) => {
                        let l = &style_of(n, &scoped).layout;
                        !matches!(l.display, Some(WsDisplay::None))
                            && !matches!(
                                l.position,
                                Some(Position::Absolute)
                                    | Some(Position::Fixed)
                                    | Some(Position::Sticky)
                            )
                    }
                })
                .count()
        };
        let kids: Vec<TaffyId> = match spec {
            Some(spec) => {
                s.flex_direction = match spec.direction {
                    Direction::Row => FlexDirection::Row,
                    Direction::Column => FlexDirection::Column,
                };
                let ga = is_grid.then(|| grid_axes(node, &s, n_items()));
                let pf = ParentFrame {
                    id: Some(&node.id),
                    cb: own.content,
                    positioned,
                    pb,
                    grid_axes: ga,
                    main: spec.direction,
                    stretch_x: is_grid || matches!(spec.direction, Direction::Column),
                    stretch_y: is_grid || matches!(spec.direction, Direction::Row),
                };
                spec.parts
                    .iter()
                    .filter_map(|part| self.part_node(&node.id, part, node, &tree, &pf, &scoped))
                    .collect()
            }
            None => {
                let main = match s.flex_direction {
                    FlexDirection::Row | FlexDirection::RowReverse => Direction::Row,
                    _ => Direction::Column,
                };
                let ga = is_grid.then(|| grid_axes(node, &s, n_items()));
                let pf = ParentFrame {
                    id: Some(&node.id),
                    cb: own.content,
                    positioned,
                    pb,
                    grid_axes: ga,
                    main,
                    stretch_x: is_grid
                        || (matches!(main, Direction::Column) && stretch_offer(l.align.as_ref())),
                    stretch_y: is_grid
                        || (matches!(main, Direction::Row) && stretch_offer(l.align.as_ref())),
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

/// The measured value one [`CbSrc`] produced on the last pass — `None`
/// when the source node was not laid out (`display: none`, a stale id).
fn cb_px(
    src: &CbSrc,
    y_axis: bool,
    boxes: &HashMap<NodeId, (Size, Size)>,
    rect: &Rect,
) -> Option<f32> {
    match src {
        CbSrc::Box { node, padding_box } => {
            let dims = node
                .as_ref()
                .and_then(|n| boxes.get(n))
                .map(|(c, p)| if *padding_box { *p } else { *c })
                .unwrap_or(Size::new(rect.width(), rect.height()));
            Some(if y_axis { dims.y } else { dims.x })
        }
        CbSrc::Cell { node, count, gap } => boxes.get(node).map(|(c, _)| {
            let d = if y_axis { c.y } else { c.x };
            (d - (count.saturating_sub(1)) as f32 * gap).max(0.0) / (*count).max(1) as f32
        }),
        CbSrc::AutoCell { node, min, gap } => boxes.get(node).map(|(c, _)| {
            let n = ((c.x + gap) / (min + gap).max(f32::EPSILON))
                .floor()
                .max(1.0);
            (c.x - (n - 1.0) * gap).max(0.0) / n
        }),
        CbSrc::AutoRows {
            node,
            min,
            gap_x,
            gap_y,
            items,
        } => boxes.get(node).map(|(c, _)| {
            let cols = ((c.x + gap_x) / (min + gap_x).max(f32::EPSILON))
                .floor()
                .max(1.0);
            let rows = (*items as f32 / cols).ceil().max(1.0);
            (c.y - (rows - 1.0) * gap_y).max(0.0) / rows
        }),
    }
}

/// The measured values every deferred base got this pass — `(id, axis)`
/// keyed, ready to feed the next build.
fn derive_deferred(
    deferred: &HashMap<NodeId, Vec<Axis>>,
    cb_of: &HashMap<NodeId, CbEntry>,
    boxes: &HashMap<NodeId, (Size, Size)>,
    rect: &Rect,
) -> HashMap<(NodeId, Axis), f32> {
    let mut out = HashMap::new();
    for (id, axes) in deferred {
        let Some(e) = cb_of.get(id) else { continue };
        for axis in axes {
            let v = match axis {
                Axis::OwnX => boxes.get(id).map(|(c, _)| c.x),
                Axis::OwnY => boxes.get(id).map(|(c, _)| c.y),
                Axis::CbX => cb_px(&e.x, false, boxes, rect),
                Axis::CbY => cb_px(&e.y, true, boxes, rect),
                Axis::Basis => cb_px(
                    match e.main {
                        Direction::Row => &e.x,
                        Direction::Column => &e.y,
                    },
                    matches!(e.main, Direction::Column),
                    boxes,
                    rect,
                ),
            };
            if let Some(v) = v {
                out.insert((id.clone(), *axis), v);
            }
        }
    }
    out
}

/// Hairline agreement for one measured axis — sub-0.01px wobble is AA
/// noise, not a moved base.
fn axis_moved(a: Option<&f32>, b: Option<&f32>) -> bool {
    match (a, b) {
        (Some(x), Some(y)) => (x - y).abs() >= 0.01,
        (None, None) => false,
        _ => true,
    }
}

/// Two measured-value maps are the same when they cover the same axes at
/// hairline agreement — the repeat-state that means the feedback looped.
fn vals_eq(a: &HashMap<(NodeId, Axis), f32>, b: &HashMap<(NodeId, Axis), f32>) -> bool {
    a.len() == b.len() && a.iter().all(|(k, v)| !axis_moved(Some(v), b.get(k)))
}

/// Lay out `root` inside `rect` — the frame calls this when the resolve
/// revision or the rect changed, and keeps the [`Layout`] until then.
///
/// Percent bases derive *statically* during the build (see the
/// "Percent bases" section above): definite bases resolve `calc` to a
/// length on the spot, deferred ones keep their percent term and read a
/// measured value back on the next build. A deep acyclic chain settles
/// in a handful of passes; a repeated measured state means the base was
/// content-driven all along, so it is forced `Indefinite` and takes the
/// CSS cyclic fallback. A chain still moving at the pass cap is neither:
/// [`Layout::unconverged`] marks it, and its `bases` stay the values the
/// returned build consumed. A tree with no deferred percent `calc()`
/// runs exactly one pass, as before.
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
    /// Deep acyclic chains settle in a handful of passes; the cap
    /// bounds whatever does not — a repeated measured state is cyclic
    /// and lands on the CSS fallback, while a chain still moving at
    /// the cap returns its last build flagged `unconverged`.
    const MAX_PASSES: usize = 8;
    let mut vals: HashMap<(NodeId, Axis), f32> = HashMap::new();
    let mut forced: std::collections::HashSet<(NodeId, Axis)> = std::collections::HashSet::new();
    let mut history: Vec<HashMap<(NodeId, Axis), f32>> = Vec::new();
    // The last pass's still-moving consumed axes — non-empty when the
    // cap stopped an unfinished solve, i.e. `out.unconverged`.
    let mut moving: Vec<(NodeId, Axis)> = Vec::new();
    let mut out = Layout {
        size: Size::ZERO,
        rects: HashMap::new(),
        styles: HashMap::new(),
        parts: Parts::new(),
        texts: Vec::new(),
        scroll: HashMap::new(),
        clip: HashMap::new(),
        bases: HashMap::new(),
        unconverged: false,
    };

    for pass in 0..=MAX_PASSES {
        // The extra slot exists so a cycle detected on the last regular
        // pass still gets its fallback build; without a forced axis the
        // cap is the cap — an acyclic chain returns its last build
        // flagged `unconverged` rather than a misclassified indefinite.
        if pass == MAX_PASSES && forced.is_empty() {
            break;
        }
        let mut b = Builder {
            tree: TaffyTree::new(),
            m,
            scx,
            nodes: HashMap::new(),
            styles: HashMap::new(),
            vals: &vals,
            consumed: std::collections::HashSet::new(),
            forced: &forced,
            deferred: HashMap::new(),
            cb_of: HashMap::new(),
            axes: HashMap::new(),
            scroll: HashMap::new(),
            clip: HashMap::new(),
        };
        let root_id = b
            .resolved_node(
                root,
                &TreeCfg::default(),
                &ParentFrame {
                    id: None,
                    // The root's containing block is the layout rect — its
                    // height is content-driven (a WE panel scrolls), so
                    // `height: N%` children shrink to their content rather
                    // than stretching to the viewport.
                    cb: (AxisBase::Definite(rect.width()), AxisBase::Indefinite),
                    positioned: None,
                    pb: (
                        AxisBase::Definite(rect.width()),
                        AxisBase::Definite(rect.height()),
                    ),
                    grid_axes: None,
                    main: Direction::Column,
                    stretch_x: true,
                    stretch_y: false,
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
            consumed,
            deferred,
            cb_of,
            axes,
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

        // The measured bases this pass produced — the movement check
        // needs the real numbers every pass, so the walk runs whenever
        // anything deferred exists.
        let new_vals = if deferred.is_empty() {
            HashMap::new()
        } else {
            let mut boxes = HashMap::new();
            collect_boxes(&tree, root_id, &mut boxes);
            derive_deferred(&deferred, &cb_of, &boxes, &rect)
        };
        let mut next = Layout {
            size: Size::ZERO,
            rects: HashMap::new(),
            styles,
            parts: Parts::new(),
            texts: Vec::new(),
            scroll,
            clip,
            // The bases this build resolved against: a deferred axis a
            // `calc` consumed exports the input measurement it was
            // resolved with — paint insets against the same value the
            // geometry used, even when the solve stopped unconverged.
            // A deferred base nobody's `calc` consumed — bare percent
            // padding is the case paint re-resolves — exports the fresh
            // measured box; it is real, just never a rebuild trigger.
            bases: axes
                .iter()
                .map(|(id, a)| (id.clone(), a.to_bases(id, &consumed, &vals, &new_vals)))
                .collect(),
            unconverged: false,
        };
        collect(&tree, root_id, rect.min, &mut next);
        if let Some(r) = next.rects.get(&root.id) {
            next.size = r.size();
        }
        out = next;
        // Convergence is on the measured values `calc` consumed — a
        // deferred key that *exists* but moved is not resolved. The
        // last build still saves its `out` above.
        moving = consumed
            .iter()
            .filter(|k| axis_moved(vals.get(*k), new_vals.get(*k)))
            .cloned()
            .collect();
        if moving.is_empty() || pass == MAX_PASSES {
            break;
        }
        if history.iter().any(|h| vals_eq(h, &new_vals)) {
            // The measured state repeated an earlier one — the feedback
            // looped. Those bases were content-driven all along: force
            // them `Indefinite` so the extra build lands the CSS cyclic
            // fallback.
            forced.extend(moving.drain(..));
            continue;
        }
        history.push(std::mem::replace(&mut vals, new_vals));
    }
    // Bases still moving when the loop stopped means the cap cut an
    // unfinished solve — not a detected cycle. The returned build is
    // honest (`bases` are the values it consumed) but must say so.
    out.unconverged = !moving.is_empty();
    if out.unconverged {
        log::debug!(
            "we-layout: deferred percent bases still moving at the {MAX_PASSES}-pass cap ({} axes); returning the last build flagged unconverged",
            moving.len()
        );
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
