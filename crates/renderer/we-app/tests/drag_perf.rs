//! What dragging a lane splitter costs, counted rather than timed: the
//! Coasys app at the `people` route under glow, 1280x800, driven through
//! `RendererApp::frame_body` in a bare `egui::Context` — no window, no
//! renderer, so nothing here waits on a GPU.
//!
//! - a layout resolves each node's style once, not once more to find the
//!   fonts it needs;
//! - the width a drag asks for is drawn on the frame the pointer moved —
//!   written through the lane's `onResize` before that frame resolves —
//!   so the frame egui runs after it has nothing left to lay out;
//! - re-laying the tree out for a new lane width resolves the lane's own
//!   style and looks every other node's up;
//! - the gradients of boxes a drag resizes are not rasterised again on
//!   every frame of it, nor uploaded: they are drawn stretched until the
//!   size holds, then exactly once.

#[path = "support/frames.rs"]
mod frames;

use egui::{pos2, vec2, Event};
use frames::{button, Driver};

#[test]
fn a_layout_resolves_each_style_once() {
    let mut d = Driver::new();
    let lane = d.lane("tree");
    let from = pos2(lane.max.x, lane.center().y);
    d.frame(vec![Event::PointerMoved(from)]);
    d.frame(vec![button(from, true)]);
    let f = d.frame(vec![Event::PointerMoved(from + vec2(30.0, 0.0))]);
    let f = if f.counters.layout_passes == 0 {
        d.frame(vec![])
    } else {
        f
    };
    assert_eq!(f.counters.layout_passes, 1, "the drag re-laid the tree out");
    let nodes = d.app.layout().unwrap().styles.len() as u64;
    // One per laid-out node, plus the handful of probes layout makes (a
    // grid counting its items, the tree's selected-row colour).
    assert!(
        f.counters.style_resolves < nodes + nodes / 4,
        "{} style resolves for {nodes} laid-out nodes",
        f.counters.style_resolves
    );
}

#[test]
fn a_drag_draws_its_width_on_the_frame_the_pointer_moved() {
    let mut d = Driver::new();
    let start = d.lane("tree");
    let from = pos2(start.max.x, start.center().y);
    d.frame(vec![Event::PointerMoved(from)]);
    d.frame(vec![button(from, true)]);
    for i in 1..=8 {
        let travel = 7.0 * i as f32;
        d.frame(vec![Event::PointerMoved(from + vec2(travel, 0.0))]);
        assert_eq!(
            d.lane("tree").width(),
            start.width() + travel,
            "move {i}: the frame the pointer moved draws the width it asks for"
        );
        // The follow-up frame egui asks for after any input: the drag's
        // write already landed, so nothing is re-resolved or re-laid out.
        let after = d.frame(vec![]);
        assert_eq!(
            after.counters.layout_passes, 0,
            "move {i}: nothing left to lay out"
        );
    }
    let end = from + vec2(56.0, 0.0);
    d.frame(vec![button(end, false)]);
    d.frame(vec![]);
    assert_eq!(d.lane("tree").width(), start.width() + 56.0);
    assert_eq!(
        d.app.session.screen().shell.lanes["tree"].width,
        Some((start.width() + 56.0) as u32),
        "the width is in shell state, written by the lane's own handler"
    );
}

#[test]
fn a_drag_frame_resolves_only_the_dragged_lanes_style() {
    let mut d = Driver::new();
    let lane = d.lane("tree");
    let from = pos2(lane.max.x, lane.center().y);
    d.frame(vec![Event::PointerMoved(from)]);
    d.frame(vec![button(from, true)]);
    d.frame(vec![Event::PointerMoved(from + vec2(5.0, 0.0))]);
    let f = d.frame(vec![Event::PointerMoved(from + vec2(10.0, 0.0))]);
    assert_eq!(f.counters.layout_passes, 1, "the move re-laid the tree out");
    assert_eq!(
        f.counters.style_resolves, 1,
        "only the lane, whose laneWidth moved, resolves its style again"
    );
}

#[test]
fn a_drag_rasterises_no_gradient_until_the_width_holds() {
    let mut d = Driver::new();
    let lane = d.lane("tree");
    let from = pos2(lane.max.x, lane.center().y);
    d.frame(vec![Event::PointerMoved(from)]);
    d.frame(vec![button(from, true)]);
    // The first frame of a resize may draw its boxes exactly.
    d.frame(vec![Event::PointerMoved(from + vec2(4.0, 0.0))]);
    for i in 2..=20 {
        let f = d.frame(vec![Event::PointerMoved(from + vec2(4.0 * i as f32, 0.0))]);
        assert_eq!(f.gradients, 0, "move {i}: no gradient rasterised");
        // A glyph text newly wrapped into may land in the font atlas; a
        // gradient texture is a megabyte.
        assert!(f.upload < 4096, "move {i}: {} bytes uploaded", f.upload);
        assert_eq!(d.lane("tree").width(), lane.width() + 4.0 * i as f32);
    }
    let end = from + vec2(80.0, 0.0);
    // Held: the release (at the last move's width) and the frames after it
    // draw the resized boxes exactly, and then nothing is left to do.
    let mut settled = d.frame(vec![button(end, false)]).gradients;
    for _ in 0..4 {
        settled += d.frame(vec![]).gradients;
    }
    assert!(settled >= 1, "the held size is rasterised exactly");
    let quiet = d.frame(vec![]);
    assert_eq!(
        (quiet.gradients, quiet.repaint),
        (0, false),
        "and then quiet"
    );
}
