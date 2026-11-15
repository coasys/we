//! The egui [`Measure`] impl and the `layout` entry point — the taffy
//! engine, part specs and style resolution moved to `we_layout`. This shim
//! keeps the call sites (`layout(cx, scx, registry, root, rect)`) and the
//! egui-typed [`Layout`] the paint walk expects.
use std::collections::HashMap;
use std::sync::Arc;

use we_style::Style;
use we_template::{NodeId, ResolvedChild, ResolvedNode};

use crate::defaults::{store_view, unit_metrics, StyleCx};
use crate::{MeasureCx, Rect, Registry, Size};

/// `(node, part)` → rect — a widget's virtual chrome.
pub type Parts = HashMap<(NodeId, &'static str), Rect>;

/// The layout output: every resolved node's rect, every part rect, the text
/// children (painted by the frame, not a widget), scroll-container axes, and
/// the tree's size.
pub struct Layout {
    pub size: Size,
    pub rects: HashMap<NodeId, Rect>,
    /// Each laid-out node's resolved style — scopes already applied; paint
    /// reads these so a descendant's `var()` sees its ancestors' `tone`/
    /// `styles` custom properties.
    pub styles: HashMap<NodeId, Style>,
    /// `(node, part)` → rect — a widget's virtual chrome, plus a theme's
    /// generated `::before`/`::after` boxes.
    pub parts: Parts,
    /// The generated boxes' styles, keyed like their rects.
    pub pseudo: HashMap<(NodeId, &'static str), Style>,
    /// Text children in paint order, with the node they belong to.
    pub texts: Vec<TextSpan>,
    /// Nodes with `overflow: auto|scroll` — which axes scroll at paint.
    pub scroll: HashMap<NodeId, egui::Vec2>,
    /// Each scroll node's content extent — union of all descendant rects
    /// and their text spans, in base coordinates.
    pub scroll_content: HashMap<NodeId, Rect>,
    /// Nodes with `overflow: hidden|clip` — children clip to their rect.
    pub clip: HashMap<NodeId, egui::Vec2>,
    /// The percent bases each node's `calc`/`%` terms resolved against —
    /// `cb.0` is the containing-block width paint insets percent padding
    /// against. Paint never rebuilds the base itself.
    pub bases: HashMap<NodeId, we_layout::Bases>,
    /// `true` when the deferred-base solve hit its pass cap still moving
    /// — the returned build is honest but not settled.
    pub unconverged: bool,
    /// Every home lane's bounds, measured on this layout — what a drag
    /// resizing the lane clamps to ([`we_layout::lane::lane_bounds`]).
    pub lanes: HashMap<NodeId, we_layout::LaneBounds>,
}

/// A text child and where it landed.
pub struct TextSpan {
    /// The node the text hangs under (its resolved parent).
    pub node: NodeId,
    pub rect: Rect,
    pub text: Arc<str>,
}

/// The egui `Measure`: the registry answers `parts_spec`/`measure`, the
/// galley answers text.
struct EguiMeasure<'a> {
    cx: &'a MeasureCx<'a>,
    scx: &'a StyleCx<'a>,
    registry: &'a Registry,
}

impl<'a> we_layout::Measure for EguiMeasure<'a> {
    fn parts_spec(&self, node: &ResolvedNode) -> Option<we_layout::PartsSpec> {
        self.registry.widget_for(&node.ty).parts_spec(node)
    }

    fn measure(
        &self,
        node: &ResolvedNode,
        style: &Style,
        avail: we_layout::Size,
    ) -> we_layout::Size {
        let s = self.registry.widget_for(&node.ty).measure(
            self.cx,
            node,
            style,
            Size::new(avail.x, avail.y),
        );
        we_layout::Size::new(s.x, s.y)
    }

    fn text_children(&self, node: &ResolvedNode) -> we_layout::TextChildren {
        self.registry.widget_for(&node.ty).text_children(node)
    }

    fn synthesized_children(&self, node: &ResolvedNode) -> Vec<ResolvedChild> {
        self.registry
            .widget_for(&node.ty)
            .synthesized_children(node)
    }

    fn measure_text(
        &self,
        owner: &ResolvedNode,
        style: &Style,
        text: &str,
        avail: we_layout::Size,
    ) -> we_layout::Size {
        let text =
            crate::props::transform_text(style, text, crate::props::prop_bool(owner, "uppercase"));
        let truncate = crate::props::prop_bool(owner, "truncate");
        let lines = crate::props::prop_num(owner, "lines").map(|n| n.max(1.0) as usize);
        let font = crate::props::font_id(
            style,
            self.cx.ctx,
            self.scx.tokens.get("--we-font-family"),
            &unit_metrics(self.scx),
            self.scx.viewport,
        );
        if avail.x <= 0.0 {
            // MinContent: CSS's automatic minimum — the longest unbreakable
            // run, or the ellipsis when the owner truncates.
            let probe = if truncate {
                "…".to_string()
            } else {
                text.split_whitespace()
                    .max_by(|a, b| a.len().cmp(&b.len()))
                    .unwrap_or("")
                    .to_string()
            };
            let g = self
                .cx
                .ctx
                .fonts_mut(|f| f.layout_no_wrap(probe, font, egui::Color32::WHITE));
            return we_layout::Size::new(g.size().x, g.size().y);
        }
        // The same galley `paint` draws: wrapped at the offered width, the
        // owner's transform and `truncate`/`lines` clamps applied.
        let g = crate::text::text_job(&text, style, self.cx.ctx, avail.x, truncate, lines);
        we_layout::Size::new(g.size().x, g.size().y)
    }
}

/// Lay out `root` inside `rect` — the frame calls this when the resolve
/// revision or the rect changed, and keeps the [`Layout`] until then.
pub fn layout(
    cx: &MeasureCx,
    scx: &StyleCx,
    registry: &Registry,
    root: &ResolvedNode,
    rect: Rect,
) -> Layout {
    run(cx, scx, registry, root, rect, false, None)
}

/// The same, for a subtree that is not the page root — the overlay pass's
/// synthetic host column, whose `auto` height must be its content's, not
/// the `min-height: 100vh` floor `layout` gives the page root. `parent` is
/// the computed style the subtree's paint inherits (the overlay node's
/// effective style), so the measure sees the same typography.
pub fn layout_shrink(
    cx: &MeasureCx,
    scx: &StyleCx,
    registry: &Registry,
    root: &ResolvedNode,
    rect: Rect,
    parent: Option<&Style>,
) -> Layout {
    run(cx, scx, registry, root, rect, true, parent)
}

/// Register every font chain the tree will be measured in before the
/// first text is — the theme's base stack and each node's own resolved
/// `font-family` — so no several-name stack is measured or painted in a
/// provisional chain on the frame it appears (`fonts::prepare`). A stack
/// that only an ancestor's scoped `var()` produces is not seen here; it
/// still registers on first `resolve` and lands a pass later.
fn prepare_fonts(ctx: &egui::Context, scx: &StyleCx, root: &ResolvedNode) {
    fn walk(node: &ResolvedNode, scx: &StyleCx, out: &mut Vec<(String, Option<f32>)>) {
        let st = crate::defaults::style_of(node, scx);
        if let Some(f) = st.text.font_family.as_deref() {
            let entry = (f.to_string(), st.text.font_weight);
            if !out.contains(&entry) {
                out.push(entry);
            }
        }
        for child in &node.children {
            if let we_template::ResolvedChild::Node(n) = child {
                walk(n, scx, out);
            }
        }
    }
    let mut stacks: Vec<(String, Option<f32>)> = Vec::new();
    if let Some(base) = scx.tokens.get("--we-font-family") {
        stacks.push((base.to_string(), None));
    }
    walk(root, scx, &mut stacks);
    crate::fonts::prepare(ctx, stacks.iter().map(|(s, w)| (s.as_str(), *w)));
}

#[allow(clippy::too_many_arguments)]
fn run(
    cx: &MeasureCx,
    scx: &StyleCx,
    registry: &Registry,
    root: &ResolvedNode,
    rect: Rect,
    shrink: bool,
    parent: Option<&Style>,
) -> Layout {
    store_view(cx.ctx, scx);
    prepare_fonts(cx.ctx, scx, root);
    let m = EguiMeasure { cx, scx, registry };
    let rect = we_layout::Rect::from_min_size(
        we_layout::Pos2::new(rect.min.x, rect.min.y),
        we_layout::Vec2::new(rect.width(), rect.height()),
    );
    let out = if shrink {
        we_layout::layout_shrink(&m, scx, root, rect, parent)
    } else {
        we_layout::layout(&m, scx, root, rect)
    };
    let r = |r: we_layout::Rect| {
        egui::Rect::from_min_size(
            egui::pos2(r.min.x, r.min.y),
            egui::vec2(r.width(), r.height()),
        )
    };
    Layout {
        size: Size::new(out.size.x, out.size.y),
        rects: out.rects.into_iter().map(|(k, v)| (k, r(v))).collect(),
        styles: out.styles,
        pseudo: out.pseudo,
        parts: out.parts.into_iter().map(|(k, v)| (k, r(v))).collect(),
        texts: out
            .texts
            .into_iter()
            .map(|t| TextSpan {
                node: t.node,
                rect: r(t.rect),
                text: t.text,
            })
            .collect(),
        scroll: out
            .scroll
            .into_iter()
            .map(|(k, v)| (k, egui::vec2(v.x, v.y)))
            .collect(),
        scroll_content: out
            .scroll_content
            .into_iter()
            .map(|(k, v)| (k, r(v)))
            .collect(),
        clip: out
            .clip
            .into_iter()
            .map(|(k, v)| (k, egui::vec2(v.x, v.y)))
            .collect(),
        bases: out.bases,
        unconverged: out.unconverged,
        lanes: out.lanes,
    }
}
