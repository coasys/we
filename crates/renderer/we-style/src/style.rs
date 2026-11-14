//! `Style` and every field it carries — the plain data a resolved node's
//! design-system props become under one theme and viewport.
//!
//! Every field is `Option`: a prop the node did not set, or whose value the
//! token table and mini evaluator could not turn into a value, stays `None`.
//! `None` is "the browser would paint the property's initial or inherited
//! value" — the widget's own default. Nothing is ever guessed.

use std::borrow::Cow;
use std::sync::Arc;

use indexmap::IndexMap;

use crate::color::Color;
use crate::transition::Transition;

/// Viewport or available size in px — the crate's own copy (egui's `Vec2`
/// converts into this at the we-widgets boundary).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Size {
    pub width: f32,
    pub height: f32,
}

impl Size {
    pub const fn new(width: f32, height: f32) -> Self {
        Self { width, height }
    }
}

/// The component's container direction — the `direction` argument WE's
/// `buildLayoutStyles` takes (the prop named `direction` is a component input
/// and never reaches here).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Row,
    Column,
}

/// A CSS length or percentage. Percentages stay symbolic — the layout engine
/// resolves them against the box they are of.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Dimension {
    Auto,
    Px(f32),
    /// Fraction `0..1` (`55%` is `Percent(0.55)`).
    Percent(f32),
    Em(f32),
    Rem(f32),
    Vw(f32),
    Vh(f32),
    Vmin(f32),
    Vmax(f32),
    Ch(f32),
    Ex(f32),
    Lh(f32),
    /// A `calc()` sum that did not collapse to one unit — `calc(100% - 24px)`
    /// keeps a `percent` and a `px` term. Every term a scalar variant carries.
    Calc(Calc),
}

/// The terms of a `calc()` linear combination — coefficients per unit;
/// `percent` is a fraction (`1.0` is `100%`) as in [`Dimension::Percent`].
/// `calc((72px - 2rem) / 2)` is `{ px: 36.0, rem: -1.0, .. }`.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Calc {
    pub px: f32,
    pub percent: f32,
    pub em: f32,
    pub rem: f32,
    pub vw: f32,
    pub vh: f32,
    pub vmin: f32,
    pub vmax: f32,
    pub ch: f32,
    pub ex: f32,
    pub lh: f32,
}

impl Calc {
    /// The terms the metrics can fold — px + em + rem + the viewport units,
    /// exactly as the scalar variants' `to_px` resolves them. `percent` and
    /// the font-metric units (`ch`/`ex`/`lh`) stay out: the first belongs to
    /// the container, the rest to the layout engine's approximations.
    pub fn known_px(&self, font_px: f32, root_px: f32, viewport: Size) -> f32 {
        self.px
            + self.em * font_px
            + self.rem * root_px
            + self.vw / 100.0 * viewport.width
            + self.vh / 100.0 * viewport.height
            + self.vmin / 100.0 * viewport.width.min(viewport.height)
            + self.vmax / 100.0 * viewport.width.max(viewport.height)
    }

    /// Pixels, when every term resolves — i.e. no `percent`, `ch`, `ex` or
    /// `lh` remains.
    pub fn to_px(&self, font_px: f32, root_px: f32, viewport: Size) -> Option<f32> {
        if self.percent == 0.0 && self.ch == 0.0 && self.ex == 0.0 && self.lh == 0.0 {
            Some(self.known_px(font_px, root_px, viewport))
        } else {
            None
        }
    }

    /// Pixels given the containing-block base the `percent` term resolves
    /// against — `None` when a percent term remains but no base was
    /// supplied (the caller keeps a placeholder rather than guess). The
    /// `ch`/`ex`/`lh` terms fold with the same approximations the layout
    /// and paint consumers shared before this policy existed here:
    /// `0.5 × font_px` for `ch`/`ex`, `1.4 × font_px` for `lh`.
    pub fn resolve(
        &self,
        percent_base: Option<f32>,
        font_px: f32,
        root_px: f32,
        viewport: Size,
    ) -> Option<f32> {
        let px = self.known_px(font_px, root_px, viewport)
            + (self.ch + self.ex) * 0.5 * font_px
            + self.lh * 1.4 * font_px;
        if self.percent == 0.0 {
            Some(px)
        } else {
            percent_base.map(|b| px + self.percent * b)
        }
    }
}

impl Dimension {
    /// Pixels, where the unit allows: `em` against `font_px`, `rem` against
    /// `root_px`, the viewport units against `viewport`. `Auto` and `Percent`
    /// have no fixed answer — they are `None`; a [`Calc`] answers only when
    /// every term it carries does.
    pub fn to_px(&self, font_px: f32, root_px: f32, viewport: Size) -> Option<f32> {
        Some(match *self {
            Dimension::Px(v) => v,
            Dimension::Em(v) => v * font_px,
            Dimension::Rem(v) => v * root_px,
            Dimension::Vw(v) => v / 100.0 * viewport.width,
            Dimension::Vh(v) => v / 100.0 * viewport.height,
            Dimension::Vmin(v) => v / 100.0 * viewport.width.min(viewport.height),
            Dimension::Vmax(v) => v / 100.0 * viewport.width.max(viewport.height),
            Dimension::Calc(c) => return c.to_px(font_px, root_px, viewport),
            Dimension::Auto
            | Dimension::Percent(_)
            | Dimension::Ch(_)
            | Dimension::Ex(_)
            | Dimension::Lh(_) => return None,
        })
    }

    /// Pixels given the base a percent resolves against — the
    /// containing-block content width for box edges (per CSS, every edge's
    /// `%` resolves against the CB *width*), or the property's axis base
    /// for sizes. `None` stays `None`; a percent-bearing value with no base
    /// stays unresolvable so no caller approximates a base silently.
    pub fn resolve(
        &self,
        percent_base: Option<f32>,
        font_px: f32,
        root_px: f32,
        viewport: Size,
    ) -> Option<f32> {
        Some(match *self {
            Dimension::Percent(p) => return percent_base.map(|b| p * b),
            Dimension::Ch(v) => v * 0.5 * font_px,
            Dimension::Ex(v) => v * 0.5 * font_px,
            Dimension::Lh(v) => v * 1.4 * font_px,
            Dimension::Calc(c) => return c.resolve(percent_base, font_px, root_px, viewport),
            _ => return self.to_px(font_px, root_px, viewport),
        })
    }
}

/// The four sides of a box — `top right bottom left` — or the four corners of
/// `border-radius` read `top-left top-right bottom-right bottom-left`.
#[derive(Debug, Clone, PartialEq)]
pub struct Edges<T> {
    pub top: T,
    pub right: T,
    pub bottom: T,
    pub left: T,
}

impl<T: Default> Default for Edges<T> {
    fn default() -> Self {
        Self {
            top: T::default(),
            right: T::default(),
            bottom: T::default(),
            left: T::default(),
        }
    }
}

impl<T> Edges<T> {
    pub fn new(top: T, right: T, bottom: T, left: T) -> Self {
        Self {
            top,
            right,
            bottom,
            left,
        }
    }

    pub fn map<U>(&self, f: impl Fn(&T) -> U) -> Edges<U> {
        Edges {
            top: f(&self.top),
            right: f(&self.right),
            bottom: f(&self.bottom),
            left: f(&self.left),
        }
    }

    pub fn as_slice(&self) -> [&T; 4] {
        [&self.top, &self.right, &self.bottom, &self.left]
    }
}

impl<T: PartialEq> Edges<Option<T>> {
    /// No side resolved to anything — the declaration paints nothing.
    pub fn all_unset(&self) -> bool {
        self.as_slice().iter().all(|s| s.is_none())
    }
}

/// `display`.
#[derive(Debug, Clone, PartialEq)]
pub enum Display {
    Flex,
    None,
    Contents,
    Block,
    Inline,
    InlineBlock,
    Grid,
    Other(Arc<str>),
}

/// `flex-direction` — the direction after `reverse` is folded in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlexDirection {
    Row,
    RowReverse,
    Column,
    ColumnReverse,
}

/// `flex-wrap`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wrap {
    NoWrap,
    Wrap,
    WrapReverse,
}

/// `justify-content` / `align-items` / `align-self` — the alignment words the
/// axis maps emit (`flex-start`, `space-between`, `stretch`, …).
#[derive(Debug, Clone, PartialEq)]
pub enum ItemAlign {
    Auto,
    Start,
    Center,
    End,
    Stretch,
    SpaceBetween,
    SpaceAround,
    SpaceEvenly,
    Baseline,
    Other(Arc<str>),
}

/// `position`.
#[derive(Debug, Clone, PartialEq)]
pub enum Position {
    Static,
    Relative,
    Absolute,
    Fixed,
    Sticky,
    Other(Arc<str>),
}

/// `overflow`/`overflow-x`/`overflow-y`.
#[derive(Debug, Clone, PartialEq)]
pub enum Overflow {
    Visible,
    Hidden,
    Auto,
    Scroll,
    Clip,
    Other(Arc<str>),
}

/// `flex` shorthand, split.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Flex {
    pub grow: f32,
    pub shrink: f32,
    pub basis: Dimension,
}

/// `z-index`.
#[derive(Debug, Clone, PartialEq)]
pub enum ZIndex {
    Auto,
    Value(i32),
}

/// `scrollbar-width`.
#[derive(Debug, Clone, PartialEq)]
pub enum ScrollbarWidth {
    Auto,
    Thin,
    None,
    Length(Dimension),
}

/// `scrollbar-gutter`.
#[derive(Debug, Clone, PartialEq)]
pub enum ScrollbarGutter {
    Auto,
    Stable,
    StableBothEdges,
    Other(Arc<str>),
}

/// `text-align`.
#[derive(Debug, Clone, PartialEq)]
pub enum TextAlign {
    Left,
    Right,
    Center,
    Justify,
    Start,
    End,
    Other(Arc<str>),
}

/// `text-transform`.
#[derive(Debug, Clone, PartialEq)]
pub enum TextTransform {
    None,
    Uppercase,
    Lowercase,
    Capitalize,
    Other(Arc<str>),
}

/// `text-decoration` — the common single words; a multi-part value keeps its
/// text in `Other`.
#[derive(Debug, Clone, PartialEq)]
pub enum TextDecoration {
    None,
    Underline,
    LineThrough,
    Overline,
    Other(Arc<str>),
}

/// `white-space`.
#[derive(Debug, Clone, PartialEq)]
pub enum WhiteSpace {
    Normal,
    Nowrap,
    Pre,
    PreWrap,
    PreLine,
    Other(Arc<str>),
}

/// `overflow-wrap`.
#[derive(Debug, Clone, PartialEq)]
pub enum OverflowWrap {
    Normal,
    Anywhere,
    BreakWord,
    Other(Arc<str>),
}

/// `line-height`: a unitless ratio, a length, or `normal`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LineHeight {
    Normal,
    Ratio(f32),
    Length(Dimension),
}

/// `border-*-style`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BorderKind {
    None,
    Hidden,
    Solid,
    Dashed,
    Dotted,
    Double,
    Groove,
    Ridge,
    Inset,
    Outset,
}

/// One border side, split. `width: None` is the CSS `medium` default;
/// `color: None` is `currentColor`.
#[derive(Debug, Clone, PartialEq)]
pub struct BorderSide {
    pub width: Option<Dimension>,
    pub kind: BorderKind,
    pub color: Option<Color>,
}

/// One `box-shadow` layer.
#[derive(Debug, Clone, PartialEq)]
pub struct Shadow {
    pub inset: bool,
    pub dx: Dimension,
    pub dy: Dimension,
    pub blur: Option<Dimension>,
    pub spread: Option<Dimension>,
    /// `None` is `currentColor`.
    pub color: Option<Color>,
}

/// `transform`: the parts we can apply, plus whatever else the authored value
/// carried (`scale(0.96)` and friends stay in `rest` for the painter).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Transform {
    pub translate: Option<[Dimension; 2]>,
    pub rotate_deg: Option<f32>,
    /// Anything after the translate/rotate — `scale(…)`, `skew(…)`.
    pub rest: Option<Arc<str>>,
}

/// `cursor`.
#[derive(Debug, Clone, PartialEq)]
pub enum Cursor {
    Auto,
    Default,
    Pointer,
    Text,
    Move,
    Grab,
    Grabbing,
    ZoomIn,
    ZoomOut,
    NotAllowed,
    Crosshair,
    Wait,
    Help,
    None,
    Other(Arc<str>),
}

/// `pointer-events`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PointerEvents {
    Auto,
    None,
}

/// `visibility`.
#[derive(Debug, Clone, PartialEq)]
pub enum Visibility {
    Visible,
    Hidden,
    Collapse,
    Other(Arc<str>),
}

/// `background-size` written by `bgFit`.
#[derive(Debug, Clone, PartialEq)]
pub enum BgFit {
    Cover,
    Contain,
    Fill,
    None,
    ScaleDown,
    Other(Arc<str>),
}

/// `background-image`: a URL, a gradient, or the faded composite a
/// `bgImageOpacity` produces — which keeps its pieces so the painter can
/// composite it however it can.
#[derive(Debug, Clone, PartialEq)]
pub enum BgImage {
    /// `url("…")` — the URL as written (`data:` URIs included: this renderer
    /// can decode them directly, no blob-URL indirection needed).
    Url(Arc<str>),
    /// A gradient expression, verbatim (egui has no native CSS gradients).
    Gradient(Arc<str>),
    /// `linear-gradient(<wash>, <wash>), <image>` from `bgImageOpacity`:
    /// the image layer text and the `color-mix()` wash text.
    Faded { image: Arc<str>, wash: Arc<str> },
}

/// `background-position`/`background-size` accompanying a [`BgImage`].
#[derive(Debug, Clone, PartialEq, Default)]
pub struct BgImageStyle {
    pub fit: Option<BgFit>,
    pub position: Option<Arc<str>>,
}

/// `tone`: the widget-level prop, passed through with the accent re-pointings
/// WE writes for it — the `--we-role-*` variables a `tone` declares on the
/// element, which in CSS inherit to descendants. A widget painting an
/// `accent`-ish value under a tone resolves it through [`Tone::vars`].
#[derive(Debug, Clone)]
pub struct Tone {
    /// The name as authored (`danger`, `neutral`, `accent`, `cyan`, …).
    pub name: Arc<str>,
    /// `--we-*` name → emitted value, in WE's emission order.
    pub vars: Arc<indexmap::IndexMap<Arc<str>, Arc<str>>>,
}

/// Everything about how the box lays out — what a flex/taffy pass reads.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LayoutStyle {
    /// Emitted `display` — `Some(Display::Flex)` when nothing was asked.
    pub display: Option<Display>,
    /// `flex-direction` after `reverse`.
    pub direction: Option<FlexDirection>,
    pub wrap: Option<Wrap>,
    /// `justify-content` — the main axis (`ax` in a row, `ay` in a column).
    pub justify: Option<ItemAlign>,
    /// `align-items` — the cross axis.
    pub align: Option<ItemAlign>,
    /// `gap`: (row-gap, column-gap).
    pub gap: Option<(Dimension, Dimension)>,
    pub padding: Edges<Option<Dimension>>,
    pub margin: Edges<Option<Dimension>>,
    pub width: Option<Dimension>,
    pub height: Option<Dimension>,
    pub min_width: Option<Dimension>,
    pub min_height: Option<Dimension>,
    pub max_width: Option<Dimension>,
    pub max_height: Option<Dimension>,
    pub aspect_ratio: Option<f32>,
    pub flex: Option<Flex>,
    pub flex_shrink: Option<f32>,
    pub align_self: Option<ItemAlign>,
    pub position: Option<Position>,
    /// `top`/`right`/`bottom`/`left` offsets.
    pub inset: Edges<Option<Dimension>>,
    pub overflow: Option<Overflow>,
    pub overflow_x: Option<Overflow>,
    pub overflow_y: Option<Overflow>,
    pub scrollbar_width: Option<ScrollbarWidth>,
    pub scrollbar_gutter: Option<ScrollbarGutter>,
}

/// Everything about the text inside.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TextStyle {
    pub color: Option<Color>,
    pub font_size: Option<Dimension>,
    pub font_weight: Option<f32>,
    /// The font stack as text — `Fira Code, monospace` — or `None` when the
    /// token's variable is not declared by this theme.
    pub font_family: Option<Arc<str>>,
    pub line_height: Option<LineHeight>,
    pub letter_spacing: Option<Dimension>,
    pub align: Option<TextAlign>,
    pub transform: Option<TextTransform>,
    pub decoration: Option<TextDecoration>,
    pub white_space: Option<WhiteSpace>,
    pub overflow_wrap: Option<OverflowWrap>,
}

/// Everything painted on the box itself.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PaintStyle {
    /// `background-color`.
    pub bg: Option<Color>,
    /// `background-image` or the `--we-bg-image-*` composite.
    pub bg_image: Option<BgImage>,
    /// Companion `background-size`/`background-position`.
    pub bg_image_style: BgImageStyle,
    /// Explicit `border-{side}` declarations, plus the `border` shorthand
    /// folded into all four.
    pub borders: Edges<Option<BorderSide>>,
    /// A standalone `border-color` declaration (colours sides that have a style).
    pub border_color: Option<Color>,
    /// A standalone `border-width` declaration.
    pub border_width: Option<Dimension>,
    /// `border-radius` — `top`/`right`/`bottom`/`left` read as
    /// top-left/top-right/bottom-right/bottom-left.
    pub radius: Edges<Option<Dimension>>,
    /// `box-shadow` layers, in order. `Some(vec![])` is an explicit `none`.
    pub shadows: Option<Vec<Shadow>>,
    pub opacity: Option<f32>,
    pub z_index: Option<ZIndex>,
    pub cursor: Option<Cursor>,
    pub pointer_events: Option<PointerEvents>,
    pub visibility: Option<Visibility>,
    pub transform: Option<Transform>,
}

/// What a `hoverProps`-style bag may change — one slot per field, applied over
/// the pre-tier style. `None` in a slot means "the bag says nothing about it".
#[derive(Debug, Clone, Default)]
pub struct StylePatch {
    pub layout: LayoutStyle,
    pub text: TextStyle,
    pub paint: PaintStyle,
    pub unsupported: Vec<Arc<str>>,
}

/// The interactive state a patch answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateKind {
    Hover,
    Active,
    Focus,
    Disabled,
}

/// The concrete values a widget measures and paints with — what the
/// design-system props on a node resolve to under the active theme.
#[derive(Debug, Clone, Default)]
pub struct Style {
    pub layout: LayoutStyle,
    pub text: TextStyle,
    pub paint: PaintStyle,
    /// `tone` — the widget-level prop, passed through untouched.
    pub tone: Option<Tone>,
    /// State overlays — applied only while the state holds, over `pretier`.
    pub hover: Option<Box<StylePatch>>,
    pub active: Option<Box<StylePatch>>,
    pub focus: Option<Box<StylePatch>>,
    pub disabled: Option<Box<StylePatch>>,
    /// The style before the viewport tier's bag applied — `Some` only when a
    /// tier changed something. States apply over this, matching the CSS
    /// mechanism where a state's var falls back to the base `--we-ds-*` var,
    /// never to a tier var.
    pub pretier: Option<Box<Style>>,
    /// `transition` shorthand entries.
    pub transitions: Vec<Transition>,
    /// `prop=value` strings this crate could not evaluate — the raw emitted
    /// text — plus `prop=?` for `styles` and custom-property leftovers.
    pub unsupported: Vec<Arc<str>>,
    /// Props on the node that are not design-system props (widget props like
    /// `text` or `variant`) — ignored by design, counted so a caller can show
    /// "resolve() saw N props it does not own".
    pub ignored_props: usize,
    /// The element's custom-property scope — its ancestors' `--we-*` values
    /// overlaid by its own (a `tone` writes 13; `styles` can write them
    /// verbatim), already substituted. What its descendants' `var()`s see —
    /// CSS custom-property inheritance hands this map down the DOM.
    pub scope: IndexMap<Arc<str>, Arc<str>>,
}

impl Style {
    /// The style a widget gets when nothing resolved — every prop absent.
    pub fn empty() -> Self {
        Style::default()
    }

    /// The patch for a state, if the node asked for one.
    pub fn state(&self, kind: StateKind) -> Option<&StylePatch> {
        match kind {
            StateKind::Hover => self.hover.as_deref(),
            StateKind::Active => self.active.as_deref(),
            StateKind::Focus => self.focus.as_deref(),
            StateKind::Disabled => self.disabled.as_deref(),
        }
    }

    /// The style while `kind` holds: the pre-tier base plus the state's patch.
    /// This is the CSS cascade's real behaviour — a state's `--we-ds-{state}-*`
    /// var falls back to the base `--we-ds-*` var, not to a tier var, so under
    /// hover every property is the state's or the *authored* value.
    pub fn with_state(&self, kind: StateKind) -> Cow<'_, Style> {
        let Some(patch) = self.state(kind) else {
            return Cow::Borrowed(self);
        };
        let mut out = self.pretier.as_deref().unwrap_or(self).clone();
        out.apply(patch);
        Cow::Owned(out)
    }

    /// Fold a patch's set fields over this style.
    pub fn apply(&mut self, patch: &StylePatch) {
        patch.layout.merge_into(&mut self.layout);
        patch.text.merge_into(&mut self.text);
        patch.paint.merge_into(&mut self.paint);
        self.unsupported.extend(patch.unsupported.iter().cloned());
    }
}

macro_rules! merge_edge {
    ($dst:expr, $src:expr) => {
        if $src.top.is_some() {
            $dst.top = $src.top.clone();
        }
        if $src.right.is_some() {
            $dst.right = $src.right.clone();
        }
        if $src.bottom.is_some() {
            $dst.bottom = $src.bottom.clone();
        }
        if $src.left.is_some() {
            $dst.left = $src.left.clone();
        }
    };
}

impl LayoutStyle {
    pub(crate) fn merge_into(&self, dst: &mut LayoutStyle) {
        if self.display.is_some() {
            dst.display = self.display.clone();
        }
        if self.direction.is_some() {
            dst.direction = self.direction;
        }
        if self.wrap.is_some() {
            dst.wrap = self.wrap;
        }
        if self.justify.is_some() {
            dst.justify = self.justify.clone();
        }
        if self.align.is_some() {
            dst.align = self.align.clone();
        }
        if self.gap.is_some() {
            dst.gap = self.gap;
        }
        merge_edge!(dst.padding, self.padding);
        merge_edge!(dst.margin, self.margin);
        if self.width.is_some() {
            dst.width = self.width;
        }
        if self.height.is_some() {
            dst.height = self.height;
        }
        if self.min_width.is_some() {
            dst.min_width = self.min_width;
        }
        if self.min_height.is_some() {
            dst.min_height = self.min_height;
        }
        if self.max_width.is_some() {
            dst.max_width = self.max_width;
        }
        if self.max_height.is_some() {
            dst.max_height = self.max_height;
        }
        if self.aspect_ratio.is_some() {
            dst.aspect_ratio = self.aspect_ratio;
        }
        if self.flex.is_some() {
            dst.flex = self.flex;
        }
        if self.flex_shrink.is_some() {
            dst.flex_shrink = self.flex_shrink;
        }
        if self.align_self.is_some() {
            dst.align_self = self.align_self.clone();
        }
        if self.position.is_some() {
            dst.position = self.position.clone();
        }
        merge_edge!(dst.inset, self.inset);
        if self.overflow.is_some() {
            dst.overflow = self.overflow.clone();
        }
        if self.overflow_x.is_some() {
            dst.overflow_x = self.overflow_x.clone();
        }
        if self.overflow_y.is_some() {
            dst.overflow_y = self.overflow_y.clone();
        }
        if self.scrollbar_width.is_some() {
            dst.scrollbar_width = self.scrollbar_width.clone();
        }
        if self.scrollbar_gutter.is_some() {
            dst.scrollbar_gutter = self.scrollbar_gutter.clone();
        }
    }
}

impl TextStyle {
    pub(crate) fn merge_into(&self, dst: &mut TextStyle) {
        if self.color.is_some() {
            dst.color = self.color;
        }
        if self.font_size.is_some() {
            dst.font_size = self.font_size;
        }
        if self.font_weight.is_some() {
            dst.font_weight = self.font_weight;
        }
        if self.font_family.is_some() {
            dst.font_family = self.font_family.clone();
        }
        if self.line_height.is_some() {
            dst.line_height = self.line_height;
        }
        if self.letter_spacing.is_some() {
            dst.letter_spacing = self.letter_spacing;
        }
        if self.align.is_some() {
            dst.align = self.align.clone();
        }
        if self.transform.is_some() {
            dst.transform = self.transform.clone();
        }
        if self.decoration.is_some() {
            dst.decoration = self.decoration.clone();
        }
        if self.white_space.is_some() {
            dst.white_space = self.white_space.clone();
        }
        if self.overflow_wrap.is_some() {
            dst.overflow_wrap = self.overflow_wrap.clone();
        }
    }
}

impl PaintStyle {
    pub(crate) fn merge_into(&self, dst: &mut PaintStyle) {
        if self.bg.is_some() {
            dst.bg = self.bg;
        }
        if self.bg_image.is_some() {
            dst.bg_image = self.bg_image.clone();
        }
        if self.bg_image_style.fit.is_some() {
            dst.bg_image_style.fit = self.bg_image_style.fit.clone();
        }
        if self.bg_image_style.position.is_some() {
            dst.bg_image_style.position = self.bg_image_style.position.clone();
        }
        merge_edge!(dst.borders, self.borders);
        if self.border_color.is_some() {
            dst.border_color = self.border_color;
        }
        if self.border_width.is_some() {
            dst.border_width = self.border_width;
        }
        merge_edge!(dst.radius, self.radius);
        if self.shadows.is_some() {
            dst.shadows = self.shadows.clone();
        }
        if self.opacity.is_some() {
            dst.opacity = self.opacity;
        }
        if self.z_index.is_some() {
            dst.z_index = self.z_index.clone();
        }
        if self.cursor.is_some() {
            dst.cursor = self.cursor.clone();
        }
        if self.pointer_events.is_some() {
            dst.pointer_events = self.pointer_events;
        }
        if self.visibility.is_some() {
            dst.visibility = self.visibility.clone();
        }
        if self.transform.is_some() {
            dst.transform = self.transform.clone();
        }
    }
}
