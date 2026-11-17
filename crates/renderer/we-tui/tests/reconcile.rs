//! A draft is the field's text only while the `value` prop is still the
//! one it was typed against (we-egui `inputs/mod.rs`, `seen`): a commit
//! ends it, and a write that moves the prop from outside wins over it.
#![cfg(not(target_arch = "wasm32"))]
mod common;

use crossterm::event::KeyCode;

#[test]
fn an_outside_write_after_a_commit_is_shown() {
    let mut app = common::app(serde_json::json!({
        "type": "Column",
        "$localState": { "v": { "type": "string", "initial": "start" } },
        "children": [
            {
                "type": "we-input",
                "props": {
                    "value": { "$": "local.v" },
                    "onChange": { "$setLocal": "v", "value": { "$": "event.detail" } }
                }
            },
            {
                "type": "we-button",
                "props": { "label": "Reset", "onClick": { "$setLocal": "v", "value": "outside" } }
            }
        ]
    }));
    common::frame(&mut app, 50, 20);
    common::key(&mut app, KeyCode::Tab); // the field
    common::type_str(&mut app, "X");
    common::key(&mut app, KeyCode::Enter); // commit → v = startX
    let text = common::frame(&mut app, 50, 20);
    assert!(text.contains("startX"), "committed:\n{text}");
    common::key(&mut app, KeyCode::Tab); // the button
    common::key(&mut app, KeyCode::Enter); // v = outside
    let text = common::frame(&mut app, 50, 20);
    assert!(
        text.contains("outside") && !text.contains("startX"),
        "the new value replaces the old draft:\n{text}"
    );
    assert!(app.drafts.is_empty(), "no draft left: {:?}", app.drafts);
    // Typing again starts from the new value.
    common::key(&mut app, KeyCode::BackTab);
    common::type_str(&mut app, "!");
    let text = common::frame(&mut app, 50, 20);
    assert!(text.contains("outside!"), "{text}");
}

#[test]
fn a_setter_that_rewrites_the_text_wins_over_the_draft() {
    // `onInput` stores the text upper-cased: the prop moves off what the
    // draft was typed against, so the field shows the stored value.
    let mut app = common::app(serde_json::json!({
        "type": "Column",
        "$localState": { "v": { "type": "string", "initial": "" } },
        "children": [{
            "type": "we-input",
            "props": {
                "value": { "$": "local.v" },
                "onInput": { "$setLocal": "v", "value": { "$": "upper(event.detail)" } }
            }
        }]
    }));
    common::frame(&mut app, 50, 10);
    common::key(&mut app, KeyCode::Tab);
    common::type_str(&mut app, "ab");
    let text = common::frame(&mut app, 50, 10);
    assert!(text.contains("[AB"), "the stored value shows:\n{text}");
}

#[test]
fn a_draft_for_a_field_that_left_the_tree_is_pruned() {
    // The field's own `onInput` unmounts it mid-edit: its draft must not
    // outlive it.
    let mut app = common::app(serde_json::json!({
        "type": "Column",
        "$localState": { "show": { "type": "boolean", "initial": true } },
        "children": [
            {
                "type": "$if",
                "props": {
                    "condition": { "$": "local.show" },
                    "then": {
                        "type": "we-input",
                        "props": { "value": "kept", "onInput": { "$setLocal": "show", "value": false } }
                    }
                }
            },
            { "type": "we-button", "props": { "label": "Other", "onClick": [] } }
        ]
    }));
    common::frame(&mut app, 50, 20);
    common::key(&mut app, KeyCode::Tab);
    common::type_str(&mut app, "x");
    assert_eq!(app.drafts.len(), 1);
    let text = common::frame(&mut app, 50, 20);
    assert!(!text.contains("kept"), "the field is gone:\n{text}");
    assert!(app.drafts.is_empty(), "pruned: {:?}", app.drafts);
}
