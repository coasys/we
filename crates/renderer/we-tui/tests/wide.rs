//! A glyph wider than its line must not stall wrapping: at width 1 a
//! two-cell character used to leave the hard-break loop pushing empty
//! heads forever. Rendering finishes, and the cell shows something.
#![cfg(not(target_arch = "wasm32"))]
mod common;

use std::sync::mpsc;
use std::time::Duration;

/// The frame text of `text` inside a box `cells` wide (a Row child keeps
/// its own width), or a failure if
/// rendering did not finish within a few seconds.
fn render_in_box(text: &'static str, cells: u16) -> String {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut app = common::app(serde_json::json!({
            "type": "Row",
            "props": { "ay": "start" },
            "children": [{
                "type": "Column",
                "props": { "width": format!("{}px", cells * 8) },
                "children": [{ "type": "we-text", "children": [text] }]
            }]
        }));
        let _ = tx.send(common::frame(&mut app, 20, 8));
    });
    rx.recv_timeout(Duration::from_secs(5))
        .unwrap_or_else(|_| panic!("rendering {text:?} at width {cells} did not finish"))
}

#[test]
fn a_wide_glyph_at_width_one_finishes_and_draws() {
    for text in ["界界", "🙂"] {
        let out = render_in_box(text, 1);
        let first = out.lines().next().unwrap_or("");
        assert!(
            !first.trim().is_empty(),
            "{text:?} at width 1 drew nothing:\n{out}"
        );
    }
}

#[test]
fn a_wide_glyph_at_width_two_finishes_and_draws_the_glyph() {
    let out = render_in_box("界界", 2);
    // Only the first line: the box's height is measured before its own
    // width applies (the cell layout's gap, NOTES "layout projection").
    let first = out.lines().next().unwrap_or("");
    assert!(first.starts_with('界'), "first line:\n{out}");
    assert!(!first.contains("界 界"), "wrapped at two cells:\n{out}");
}
