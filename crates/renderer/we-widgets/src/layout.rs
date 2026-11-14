//! Layout: one taffy tree over the resolved tree, one [`Layout`] out.
//!
//! `direction`, `gap`, `p*`, `width`, `height`, `flex`, `ax`, `ay` are read
//! off resolved props here — locally, on purpose. E4's style resolution
//! replaces the [`style_of`] boundary, not the tree walk. WE's numeric
//! strings are spacing tokens (`"300"` → 12px), JSON numbers are px,
//! `"N%"`/`"Npx"` are what they say — the same table the DS prop resolvers
//! apply.
use std::collections::HashMap;
use std::sync::Arc;

use taffy::prelude::*;
use taffy::NodeId as TaffyId;
use we_expr::Value;
use we_style::Style;
use we_template::{NodeId, ResolvedChild, ResolvedNode};

use crate::{MeasureCx, Rect, Registry, Size};

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
    /// Space between this part's left edge and its children (tree indent).
    pub indent: f32,
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
            indent: 0.0,
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
            indent: 0.0,
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
            indent: 0.0,
            parts,
        }
    }

    /// Leading space inside the part (the tree's indent).
    pub fn indented(mut self, px: f32) -> Self {
        self.indent = px;
        self
    }
}

/// A widget's virtual layout structure — [`crate::Widget::parts_spec`]
/// answers `Some` when the node needs chrome its children do not provide
/// (the tree-item's row). `None` → children lay out directly inside `rect`.
#[derive(Debug, Clone)]
pub struct PartsSpec {
    pub direction: Direction,
    pub parts: Vec<PartSpec>,
}

/// The layout output: every resolved node's rect, every part rect, the text
/// children (painted by the frame, not a widget), and the tree's size.
pub struct Layout {
    pub size: Size,
    pub rects: HashMap<NodeId, Rect>,
    /// `(node, part)` → rect — a widget's virtual chrome.
    pub parts: Parts,
    /// Text children in paint order, with the node they belong to.
    pub texts: Vec<TextSpan>,
}

/// A text child and where it landed.
pub struct TextSpan {
    /// The node the text hangs under (its resolved parent).
    pub node: NodeId,
    pub rect: Rect,
    pub text: Arc<str>,
}

/// The style boundary E4 replaces: today every node gets `Style::empty()`,
/// because DS props reach layout through [`node_style`] directly.
pub fn style_of(_node: &ResolvedNode) -> Style {
    Style::empty()
}

/// WE's spacing scale — `"100"` → 4px through `"1000"` → 96px (the same
/// token table the TS design-system resolvers apply).
fn token_px(s: &str) -> Option<f32> {
    Some(match s {
        "0" => 0.0,
        "50" => 2.0,
        "100" => 4.0,
        "200" => 8.0,
        "300" => 12.0,
        "400" => 16.0,
        "500" => 24.0,
        "600" => 32.0,
        "700" => 48.0,
        "800" => 64.0,
        "900" => 80.0,
        "1000" => 96.0,
        _ => return None,
    })
}

/// A length prop's raw px/percent/auto — token string, `"Npx"`, `"N%"`,
/// JSON number (px), or `"auto"`.
enum Len {
    Px(f32),
    Pct(f32),
    Auto,
}

fn len(value: Option<&Value>) -> Len {
    match value {
        Some(Value::Str(s)) => {
            let s = s.as_ref();
            if s == "auto" {
                Len::Auto
            } else if let Some(pct) = s.strip_suffix('%') {
                pct.parse::<f32>().map(|p| Len::Pct(p / 100.0)).unwrap_or(Len::Auto)
            } else if let Some(px) = s.strip_suffix("px") {
                px.parse::<f32>().map(Len::Px).unwrap_or(Len::Auto)
            } else if let Some(px) = token_px(s) {
                Len::Px(px)
            } else {
                s.parse::<f32>().map(Len::Px).unwrap_or(Len::Auto)
            }
        }
        Some(Value::Num(n)) => Len::Px(*n as f32),
        _ => Len::Auto,
    }
}

/// `gap`/`p*` → taffy `LengthPercentage`.
fn lp(value: Option<&Value>) -> LengthPercentage {
    match len(value) {
        Len::Px(px) => LengthPercentage::length(px),
        Len::Pct(p) => LengthPercentage::percent(p),
        Len::Auto => LengthPercentage::length(0.0),
    }
}

/// `min*`/`max*` → taffy `LengthPercentageAuto` (no content keywords there).
fn lpa(value: Option<&Value>) -> LengthPercentageAuto {
    match len(value) {
        Len::Px(px) => LengthPercentageAuto::length(px),
        Len::Pct(p) => LengthPercentageAuto::percent(p),
        Len::Auto => LengthPercentageAuto::auto(),
    }
}

/// `width`/`height`/`flex-basis` → taffy `Dimension`.
fn dim(value: Option<&Value>) -> Dimension {
    match len(value) {
        Len::Px(px) => Dimension::length(px),
        Len::Pct(p) => Dimension::percent(p),
        Len::Auto => match value {
            Some(Value::Str(s)) => match s.as_ref() {
                "min-content" => Dimension::min_content(),
                "max-content" => Dimension::max_content(),
                _ => Dimension::auto(),
            },
            _ => Dimension::auto(),
        },
    }
}

/// `ay`/`align` names → taffy align-items.
fn align(value: Option<&Value>) -> Option<AlignItems> {
    let Value::Str(s) = value? else { return None };
    Some(match s.as_ref() {
        "start" | "top" | "left" => AlignItems::START,
        "center" => AlignItems::CENTER,
        "end" | "bottom" | "right" => AlignItems::END,
        "stretch" => AlignItems::STRETCH,
        "baseline" => AlignItems::BASELINE,
        _ => return None,
    })
}

/// `ax`/`justify` names → taffy justify-content.
fn justify(value: Option<&Value>) -> Option<JustifyContent> {
    let Value::Str(s) = value? else { return None };
    Some(match s.as_ref() {
        "start" | "top" | "left" => JustifyContent::START,
        "center" => JustifyContent::CENTER,
        "end" | "bottom" | "right" => JustifyContent::END,
        "space-between" | "between" => JustifyContent::SPACE_BETWEEN,
        "space-around" => JustifyContent::SPACE_AROUND,
        "space-evenly" => JustifyContent::SPACE_EVENLY,
        _ => return None,
    })
}

/// A prop lookup: `props[key]` as a resolved value.
fn prop<'a>(node: &'a ResolvedNode, key: &str) -> Option<&'a Value> {
    node.props.get(key)
}

/// `flex: "1"` (or `"1 0 auto"`) → grow.
fn flex_grow(node: &ResolvedNode) -> f32 {
    match prop(node, "flex") {
        Some(Value::Str(s)) => s
            .split_whitespace()
            .next()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0.0),
        Some(Value::Num(n)) => *n as f32,
        _ => 0.0,
    }
}

/// The taffy style a resolved node carries — DS props only; E4 keeps this
/// signature and replaces the table.
pub(crate) fn node_style(node: &ResolvedNode) -> taffy::Style {
    let direction = match prop(node, "direction") {
        Some(Value::Str(s)) if s.as_ref() == "row" => FlexDirection::Row,
        _ => FlexDirection::Column,
    };
    let gap = lp(prop(node, "gap").or_else(|| prop(node, "g")));
    taffy::Style {
        display: Display::Flex,
        flex_direction: direction,
        gap: taffy::Size {
            width: gap,
            height: gap,
        },
        size: taffy::Size {
            width: dim(prop(node, "width")),
            height: dim(prop(node, "height")),
        },
        min_size: taffy::Size {
            width: lpa(prop(node, "minWidth")),
            height: lpa(prop(node, "minHeight")),
        },
        max_size: taffy::Size {
            width: lpa(prop(node, "maxWidth")),
            height: lpa(prop(node, "maxHeight")),
        },
        padding: taffy::Rect {
            left: lp(prop(node, "pl").or_else(|| prop(node, "px")).or_else(|| prop(node, "p"))),
            right: lp(prop(node, "pr").or_else(|| prop(node, "px")).or_else(|| prop(node, "p"))),
            top: lp(prop(node, "pt").or_else(|| prop(node, "py")).or_else(|| prop(node, "p"))),
            bottom: lp(prop(node, "pb").or_else(|| prop(node, "py")).or_else(|| prop(node, "p"))),
        },
        // ax is the main axis, ay the cross — WE's DS prop rule.
        justify_content: justify(prop(node, "ax")).unwrap_or(JustifyContent::NORMAL),
        align_items: align(prop(node, "ay")).unwrap_or(AlignItems::NORMAL),
        align_self: align(prop(node, "align")),
        flex_grow: flex_grow(node),
        ..Default::default()
    }
}

/// A part spec → taffy style.
fn part_style(spec: &PartSpec) -> taffy::Style {
    taffy::Style {
        display: Display::Flex,
        flex_direction: match spec.direction {
            Direction::Row => FlexDirection::Row,
            Direction::Column => FlexDirection::Column,
        },
        size: taffy::Size {
            width: spec.width.map(Dimension::length).unwrap_or(Dimension::auto()),
            height: spec.height.map(Dimension::length).unwrap_or(Dimension::auto()),
        },
        padding: taffy::Rect {
            left: LengthPercentage::length(spec.indent),
            right: LengthPercentage::length(0.0),
            top: LengthPercentage::length(0.0),
            bottom: LengthPercentage::length(0.0),
        },
        ..Default::default()
    }
}

/// One taffy node's bookkeeping: whose rect it becomes.
enum Ctx {
    Node(NodeId),
    Part(NodeId, &'static str),
    Text(NodeId, Arc<str>),
}

struct Builder<'a> {
    tree: TaffyTree<Ctx>,
    cx: &'a MeasureCx<'a>,
    registry: &'a Registry,
}

impl<'a> Builder<'a> {
    /// A part → a taffy node: `pick` children inside, nested parts inside, or
    /// an empty fixed box.
    fn part_node(&mut self, owner: &NodeId, spec: &PartSpec, node: &ResolvedNode) -> TaffyId {
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
                kids.push(self.child_node(owner, child));
            }
        }
        for sub in &spec.parts {
            kids.push(self.part_node(owner, sub, node));
        }
        let ctx = Ctx::Part(owner.clone(), spec.name);
        if kids.is_empty() {
            self.tree.new_leaf_with_context(part_style(spec), ctx).unwrap()
        } else {
            let id = self.tree.new_with_children(part_style(spec), &kids).unwrap();
            self.tree.set_node_context(id, Some(ctx)).unwrap();
            id
        }
    }

    /// A resolved child → a taffy node: nodes recurse, text becomes a leaf
    /// measured by the galley.
    fn child_node(&mut self, owner: &NodeId, child: &ResolvedChild) -> TaffyId {
        match child {
            ResolvedChild::Node(node) => self.resolved_node(node),
            ResolvedChild::Text(text) => {
                let galley = self.cx.ctx.fonts_mut(|f| {
                    f.layout_no_wrap(
                        text.to_string(),
                        egui::FontId::default(),
                        egui::Color32::WHITE,
                    )
                });
                self.tree.new_leaf_with_context(
                    taffy::Style {
                        size: taffy::Size {
                            width: Dimension::length(galley.size().x),
                            height: Dimension::length(galley.size().y),
                        },
                        ..Default::default()
                    },
                    Ctx::Text(owner.clone(), text.clone()),
                )
                .unwrap()
            }
        }
    }

    /// A resolved node → a taffy node + its children (or its parts).
    fn resolved_node(&mut self, node: &ResolvedNode) -> TaffyId {
        let widget = self.registry.widget_for(&node.ty);
        let mut style = node_style(node);
        let kids: Vec<TaffyId> = match widget.parts_spec(node) {
            Some(spec) => {
                style.flex_direction = match spec.direction {
                    Direction::Row => FlexDirection::Row,
                    Direction::Column => FlexDirection::Column,
                };
                spec.parts
                    .iter()
                    .map(|part| self.part_node(&node.id, part, node))
                    .collect()
            }
            None => node
                .children
                .iter()
                .map(|c| self.child_node(&node.id, c))
                .collect(),
        };
        if kids.is_empty() {
            // A leaf: the widget's measured size fills whatever the props did
            // not pin down.
            let want = widget.measure(
                self.cx,
                node,
                &style_of(node),
                Size::new(f32::INFINITY, f32::INFINITY),
            );
            if style.size.width == Dimension::auto() {
                style.size.width = Dimension::length(want.x);
            }
            if style.size.height == Dimension::auto() {
                style.size.height = Dimension::length(want.y);
            }
            self.tree.new_leaf_with_context(style, Ctx::Node(node.id.clone())).unwrap()
        } else {
            let id = self.tree.new_with_children(style, &kids).unwrap();
            self.tree
                .set_node_context(id, Some(Ctx::Node(node.id.clone())))
                .unwrap();
            id
        }
    }
}

/// Lay out `root` inside `rect` — the frame calls this when the resolve
/// revision or the rect changed, and keeps the [`Layout`] until then.
pub fn layout(
    cx: &MeasureCx,
    registry: &Registry,
    root: &ResolvedNode,
    rect: Rect,
) -> Layout {
    let mut b = Builder {
        tree: TaffyTree::new(),
        cx,
        registry,
    };
    let root_id = b.resolved_node(root);
    let _ = b.tree.compute_layout(
        root_id,
        taffy::Size {
            width: AvailableSpace::Definite(rect.width()),
            // Height is content-sized: a WE panel scrolls, so `height: 100%`
            // children grow to their content rather than the viewport.
            height: AvailableSpace::MinContent,
        },
    );

    let mut out = Layout {
        size: Size::ZERO,
        rects: HashMap::new(),
        parts: Parts::new(),
        texts: Vec::new(),
    };
    collect(&b.tree, root_id, rect.min, &mut out);
    if let Some(r) = out.rects.get(&root.id) {
        out.size = r.size();
    }
    out
}

/// Walk the computed tree into the flat [`Layout`].
fn collect(tree: &TaffyTree<Ctx>, id: TaffyId, origin: egui::Pos2, out: &mut Layout) {
    let l = tree.layout(id).unwrap();
    let rect = Rect::from_min_size(
        origin + egui::vec2(l.location.x, l.location.y),
        egui::vec2(l.size.width, l.size.height),
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
