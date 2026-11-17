//! How wide a home lane (`$lane`) may be — `PanelLane`'s `clamp`, worked
//! out from a finished layout so the drag that resizes a lane and the
//! layout that draws a kept width bound it the same way.
//!
//! The widest a lane may be is its row less what it leaves for the rest
//! ([`LANE_LEAVES_PX`]) and less the other lanes in the row as they are
//! drawn, and no wider than its `maxWidth`. Its `minWidth` (120 absent)
//! wins over that room: a lane too wide for a small window is the narrow
//! layout's job (`PanelLane.tsx`, `measureRoom` and `clamp`).
use std::collections::HashMap;

use we_style::Display;
use we_template::{NodeId, ResolvedChild, ResolvedNode};

use crate::props::prop_num;
use crate::Layout;

/// What a lane leaves the rest of its row when dragged wider
/// (`PanelLane`'s `LANE_LEAVES_PX`).
pub const LANE_LEAVES_PX: f32 = 360.0;

/// The narrowest and widest one lane may be drawn.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LaneBounds {
    pub min: f32,
    pub max: f32,
}

impl LaneBounds {
    /// `width` held to the bounds, the minimum winning over the room.
    pub fn clamp(&self, width: f32) -> f32 {
        width.min(self.max).max(self.min)
    }
}

/// Every lane in `root`'s tree with its bounds, measured on `layout`: its
/// layout parent's width (past `display: contents` wrappers) less the
/// other lanes inside that parent — not this one's ancestors or
/// descendants — less [`LANE_LEAVES_PX`].
pub fn lane_bounds(root: &ResolvedNode, layout: &Layout) -> HashMap<NodeId, LaneBounds> {
    let mut lanes = Vec::new();
    collect(root, &mut Vec::new(), &mut lanes);
    let width = |id: &NodeId| layout.rects.get(id).map_or(0.0, |r| r.width());
    let contents = |id: &NodeId| {
        layout
            .styles
            .get(id)
            .is_some_and(|s| s.layout.display == Some(Display::Contents))
    };
    let mut out = HashMap::new();
    for (lane, chain) in &lanes {
        let Some(row) = chain.iter().rev().find(|a| !contents(a)) else {
            continue;
        };
        let others: f32 = lanes
            .iter()
            .filter(|(other, other_chain)| {
                other.id != lane.id
                    && other_chain.contains(row)
                    && !other_chain.contains(&lane.id)
                    && !chain.contains(&other.id)
            })
            .map(|(other, _)| width(&other.id))
            .sum();
        let room = (width(row) - others - LANE_LEAVES_PX).max(0.0);
        let min = prop_num(lane, "minWidth").unwrap_or(120.0) as f32;
        let max = prop_num(lane, "maxWidth").map_or(f32::INFINITY, |m| m as f32);
        out.insert(
            lane.id.clone(),
            LaneBounds {
                min,
                max: max.min(room),
            },
        );
    }
    out
}

/// Every `$lane` under `node`, each with the ids of its ancestors.
fn collect<'n>(
    node: &'n ResolvedNode,
    chain: &mut Vec<NodeId>,
    out: &mut Vec<(&'n ResolvedNode, Vec<NodeId>)>,
) {
    if node.ty.as_ref() == "$lane" {
        out.push((node, chain.clone()));
    }
    chain.push(node.id.clone());
    for child in &node.children {
        if let ResolvedChild::Node(n) = child {
            collect(n, chain, out);
        }
    }
    chain.pop();
}

/// `root` with every kept lane width (`laneWidth`) that its bounds do not
/// allow replaced by the width they do — `None` when every kept width
/// fits. Layout draws the tree it returns, as `PanelLane` draws
/// `clamp(held)`.
pub(crate) fn clamp_kept_widths(
    root: &ResolvedNode,
    bounds: &HashMap<NodeId, LaneBounds>,
) -> Option<ResolvedNode> {
    fn fits(node: &ResolvedNode, bounds: &HashMap<NodeId, LaneBounds>) -> bool {
        let own = match (prop_num(node, "laneWidth"), bounds.get(&node.id)) {
            (Some(w), Some(b)) if node.ty.as_ref() == "$lane" => {
                (b.clamp(w as f32) - w as f32).abs() < 0.5
            }
            _ => true,
        };
        own && node.children.iter().all(|c| match c {
            ResolvedChild::Node(n) => fits(n, bounds),
            ResolvedChild::Text(_) => true,
        })
    }
    fn rewrite(node: &mut ResolvedNode, bounds: &HashMap<NodeId, LaneBounds>) {
        if node.ty.as_ref() == "$lane" {
            if let (Some(w), Some(b)) = (prop_num(node, "laneWidth"), bounds.get(&node.id)) {
                let held = b.clamp(w as f32);
                node.props
                    .insert("laneWidth".into(), we_expr::Value::from(held as f64));
            }
        }
        for child in &mut node.children {
            if let ResolvedChild::Node(n) = child {
                rewrite(n, bounds);
            }
        }
    }
    if fits(root, bounds) {
        return None;
    }
    let mut out = root.clone();
    rewrite(&mut out, bounds);
    Some(out)
}
