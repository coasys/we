//! `display: none` removes a node and its whole subtree, as we-layout
//! does: nothing is painted, no room is taken, and the keyboard never
//! lands on a control inside it.
#![cfg(not(target_arch = "wasm32"))]
mod common;

use crossterm::event::KeyCode;

fn schema() -> serde_json::Value {
    serde_json::json!({
        "type": "Column",
        "props": { "gap": "400" },
        "children": [
            { "type": "we-button", "props": { "label": "Alpha", "onClick": [] } },
            { "type": "we-button", "props": { "label": "Ghost", "display": "none", "onClick": [] } },
            {
                "type": "Column",
                "props": { "display": "none" },
                "children": [
                    { "type": "we-button", "props": { "label": "Phantom", "onClick": [] } }
                ]
            },
            { "type": "we-button", "props": { "label": "Omega", "onClick": [] } }
        ]
    })
}

#[test]
fn a_hidden_control_is_never_drawn_or_focused() {
    let mut app = common::app(schema());
    let text = common::frame(&mut app, 40, 40);
    for hidden in ["Ghost", "Phantom"] {
        assert!(!text.contains(hidden), "{hidden} painted:\n{text}");
    }
    assert!(text.contains("Alpha") && text.contains("Omega"), "{text}");
    assert_eq!(
        app.focusables.len(),
        2,
        "only Alpha and Omega are focusable: {:?}",
        app.focusables
    );
    // Tab round the whole ring twice: every stop shows Alpha or Omega
    // under the cursor, never a hidden label.
    for _ in 0..4 {
        common::key(&mut app, KeyCode::Tab);
        let text = common::frame(&mut app, 40, 40);
        let f = app
            .focusables
            .iter()
            .find(|f| Some(&f.id) == app.focus.as_ref())
            .expect("focus lands on a painted control");
        let row = text.lines().nth(f.rect.y as usize).unwrap_or("");
        assert!(
            row.contains("Alpha") || row.contains("Omega"),
            "focus on row {row:?}:\n{text}"
        );
        for hidden in ["Ghost", "Phantom"] {
            assert!(!text.contains(hidden), "{hidden} painted:\n{text}");
        }
    }
}

#[test]
fn a_hidden_node_takes_no_room() {
    // The same column with the hidden nodes left out is the oracle.
    let mut bare = common::app(serde_json::json!({
        "type": "Column",
        "props": { "gap": "400" },
        "children": [
            { "type": "we-button", "props": { "label": "Alpha", "onClick": [] } },
            { "type": "we-button", "props": { "label": "Omega", "onClick": [] } }
        ]
    }));
    let want = common::frame(&mut bare, 40, 40);
    let mut app = common::app(schema());
    let text = common::frame(&mut app, 40, 40);
    let row = |t: &str| t.lines().position(|l| l.contains("Omega"));
    assert_eq!(
        row(&text),
        row(&want),
        "Omega where it is without them:\n{text}"
    );
}
