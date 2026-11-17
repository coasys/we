//! A lane drag belongs to the handle that was pressed, and ends when egui
//! stops dragging it — even where the lane was folded away mid-drag and
//! its handle never saw the release. The Coasys app at `people` under
//! glow, driven headless.

#[path = "support/frames.rs"]
mod frames;

use egui::{pos2, vec2, Event};
use frames::{button, Driver};
use we_screen::ScreenOp;

fn set_collapsed(d: &mut Driver, collapsed: bool) {
    d.app.session.apply_screen(ScreenOp::SetLaneCollapsed {
        lane: "tree".into(),
        collapsed,
    });
    d.frame(vec![]);
    d.frame(vec![]);
}

/// Folded away while its handle is held, the lane is not painted, so the
/// release never reaches its handle. Opened again, a press in the main
/// view — 300px from the handle — must not drag it from where the first
/// press began.
#[test]
fn a_lane_folded_while_held_lets_go_of_the_drag() {
    let mut d = Driver::new();
    let lane = d.lane("tree");
    let from = pos2(lane.max.x, lane.center().y);
    d.frame(vec![Event::PointerMoved(from)]);
    d.frame(vec![button(from, true)]);
    d.frame(vec![Event::PointerMoved(from + vec2(20.0, 0.0))]);
    d.frame(vec![Event::PointerMoved(from + vec2(30.0, 0.0))]);
    let dragged = d.lane("tree").width();
    assert_eq!(dragged, lane.width() + 30.0, "the drag took");
    set_collapsed(&mut d, true);
    assert_eq!(d.lane("tree").width(), 0.0, "the lane folded");
    d.frame(vec![button(from + vec2(30.0, 0.0), false)]);
    d.frame(vec![]);
    set_collapsed(&mut d, false);
    assert_eq!(d.lane("tree").width(), dragged, "open at the dragged width");
    let elsewhere = pos2(d.lane("tree").max.x + 300.0, lane.center().y);
    d.frame(vec![Event::PointerMoved(elsewhere)]);
    d.frame(vec![button(elsewhere, true)]);
    for i in 1..=3 {
        d.frame(vec![Event::PointerMoved(
            elsewhere + vec2(20.0 * i as f32, 0.0),
        )]);
        assert_eq!(
            d.lane("tree").width(),
            dragged,
            "move {i}: a press elsewhere leaves the lane alone"
        );
    }
    d.frame(vec![button(elsewhere + vec2(60.0, 0.0), false)]);
}
