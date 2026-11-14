//! The egui [`Measure`] impl and the `layout` entry point — the taffy
//! engine, part specs and style resolution moved to `we_layout`. This shim
//! keeps the call sites (`layout(cx, scx, registry, root, rect)`) and the
//! egui-typed [`Layout`] the paint walk expects.
use std::collections::HashMap;
use std::sync::Arc;

use we_style::Style;
use we_template::{NodeId, ResolvedNode};

use crate::defaults::{store_view, StyleCx, FONT_PX, ROOT_PX};
use crate::{MeasureCx, Rect, Registry, Size};

/// `(node, part)` → rect — a widget's virtual chrome.
pub type Parts = HashMap<(NodeId, &'static str), Rect>;

/// The layout output: every resolved node's rect, every part rect, the text
/// children (painted by the frame, not a widget), scroll-container axes, and
/// the tree's size.
pub struct Layout {
    pub size: Size,
    pub rects: HashMap<NodeId, Rect>,
    /// `(node, part)` → rect — a widget's virtual chrome.
    pub parts: Parts,
    /// Text children in paint order, with the node they belong to.
    pub texts: Vec<TextSpan>,
    /// Nodes with `overflow: auto|scroll` — which axes scroll at paint.
    pub scroll: HashMap<NodeId, egui::Vec2>,
    /// Nodes with `overflow: hidden|clip` — children clip to their rect.
    pub clip: HashMap<NodeId, egui::Vec2>,
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

    fn measure_text(&self, _owner: &ResolvedNode, style: &Style, text: &str) -> we_layout::Size {
        // Text is measured in its owner's font — `layout_no_wrap` matches the
        // paint path's single-line spans.
        let font = crate::props::font_id(style, FONT_PX, ROOT_PX, self.scx.viewport);
        let galley = self
            .cx
            .ctx
            .fonts_mut(|f| f.layout_no_wrap(text.to_string(), font, egui::Color32::WHITE));
        let size = galley.size();
        we_layout::Size::new(size.x, size.y)
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
    run(cx, scx, registry, root, rect, false)
}

/// The same, for a subtree that is not the page root — the overlay pass's
/// synthetic host column, whose `auto` height must be its content's, not
/// the `min-height: 100vh` floor `layout` gives the page root.
pub fn layout_shrink(
    cx: &MeasureCx,
    scx: &StyleCx,
    registry: &Registry,
    root: &ResolvedNode,
    rect: Rect,
) -> Layout {
    run(cx, scx, registry, root, rect, true)
}

fn run(
    cx: &MeasureCx,
    scx: &StyleCx,
    registry: &Registry,
    root: &ResolvedNode,
    rect: Rect,
    shrink: bool,
) -> Layout {
    store_view(cx.ctx, scx);
    let m = EguiMeasure { cx, scx, registry };
    let rect = we_layout::Rect::from_min_size(
        we_layout::Pos2::new(rect.min.x, rect.min.y),
        we_layout::Vec2::new(rect.width(), rect.height()),
    );
    let out = if shrink {
        we_layout::layout_shrink(&m, scx, root, rect)
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
        clip: out
            .clip
            .into_iter()
            .map(|(k, v)| (k, egui::vec2(v.x, v.y)))
            .collect(),
    }
}
