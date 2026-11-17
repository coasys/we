//! Paging moves the viewport even with a focused row: focus is brought
//! into view when it changes, not on every redraw.
#![cfg(not(target_arch = "wasm32"))]
mod common;

use crossterm::event::KeyCode;

fn long_list() -> we_tui::TuiApp {
    let rows: Vec<serde_json::Value> = (0..30)
        .map(|i| serde_json::json!({ "type": "we-button", "props": { "label": format!("Row{i:02}"), "onClick": [] } }))
        .collect();
    common::app(serde_json::json!({ "type": "Column", "children": rows }))
}

fn first_label(text: &str) -> Option<String> {
    text.lines().find_map(|l| {
        let i = l.find("Row")?;
        Some(l[i..i + 5].to_string())
    })
}

#[test]
fn page_down_with_a_focused_row_moves_the_viewport() {
    let mut app = long_list();
    common::frame(&mut app, 40, 12);
    common::key(&mut app, KeyCode::Tab); // Row00 has focus
    let top = common::frame(&mut app, 40, 12);
    assert_eq!(first_label(&top).as_deref(), Some("Row00"), "{top}");
    assert_eq!(app.scroll, 0);

    common::key(&mut app, KeyCode::PageDown);
    let paged = common::frame(&mut app, 40, 12);
    assert_eq!(app.scroll, 11, "one page of 11 content rows:\n{paged}");
    assert_ne!(first_label(&paged).as_deref(), Some("Row00"), "{paged}");
    // A second redraw with nothing pressed keeps it.
    let again = common::frame(&mut app, 40, 12);
    assert_eq!(app.scroll, 11, "{again}");

    common::key(&mut app, KeyCode::End);
    let end = common::frame(&mut app, 40, 12);
    assert!(end.contains("Row29"), "End shows the last row:\n{end}");

    // Moving focus brings the newly focused row into view again.
    common::key(&mut app, KeyCode::Tab); // Row01
    let back = common::frame(&mut app, 40, 12);
    assert!(back.contains("Row01"), "focus revealed:\n{back}");
}
