//! The rail's `transition: width 300 ease-in-out` (250 ms under glow)
//! plays out when hover widens it: the frames in between draw it at sizes
//! between the two, eased; it ends exactly at the width the template asks
//! for; and the app asks for frames only while it is moving.

#[path = "support/frames.rs"]
mod frames;

use egui::{pos2, Event};
use frames::Driver;

/// Run frames until the rail stops asking for them (or `cap` is hit),
/// returning the rail's width on each and whether each asked for another.
fn settle(d: &mut Driver, first: Vec<Event>, cap: usize) -> Vec<(f32, bool)> {
    let mut out = Vec::new();
    let mut events = first;
    for _ in 0..cap {
        let f = d.frame(std::mem::take(&mut events));
        out.push((d.rail().width(), f.repaint));
        if !f.repaint {
            break;
        }
    }
    out
}

#[test]
fn hovering_the_rail_eases_it_open_and_stops_asking_for_frames() {
    let mut d = Driver::new();
    assert_eq!(d.rail().width(), 72.0, "collapsed at rest");
    let frames = settle(&mut d, vec![Event::PointerMoved(pos2(30.0, 400.0))], 60);
    let widths: Vec<f32> = frames.iter().map(|(w, _)| *w).collect();
    assert_eq!(
        *widths.last().unwrap(),
        256.0,
        "ends at the expanded width: {widths:?}"
    );
    let between = widths.iter().filter(|w| **w > 72.0 && **w < 256.0).count();
    // 250 ms at the driver's 60 frames a second is 15 frames; most of them
    // draw an in-between width.
    assert!(
        between >= 10,
        "drawn in between on {between} frames: {widths:?}"
    );
    assert!(
        widths.windows(2).all(|w| w[1] >= w[0]),
        "never narrows on the way open: {widths:?}"
    );
    // Eased in and out: the first and last steps are smaller than the
    // middle one.
    let steps: Vec<f32> = widths
        .windows(2)
        .map(|w| w[1] - w[0])
        .filter(|s| *s > 0.0)
        .collect();
    let mid = steps[steps.len() / 2];
    assert!(
        steps[0] < mid && *steps.last().unwrap() < mid,
        "eased: {steps:?}"
    );

    let last = frames.last().unwrap();
    assert!(!last.1, "the settled frame asks for no other");
    let idle = d.frame(vec![]);
    assert!(!idle.repaint, "nothing moving, nothing asked for");
    assert_eq!(idle.counters.layout_passes, 0, "and nothing laid out");

    // Leaving closes it the same way, back to exactly the collapsed width.
    let back = settle(&mut d, vec![Event::PointerMoved(pos2(900.0, 400.0))], 60);
    let widths: Vec<f32> = back.iter().map(|(w, _)| *w).collect();
    assert_eq!(*widths.last().unwrap(), 72.0, "{widths:?}");
    assert!(
        widths.iter().filter(|w| **w > 72.0 && **w < 256.0).count() >= 10,
        "{widths:?}"
    );
}
