//! The input contract we-egui keeps (`inputs/input.rs`,
//! `inputs/number_input.rs`): typing emits `onInput {detail: text}`; Enter
//! or leaving the field commits `onChange` — once, only when something was
//! typed since the last commit; a `we-number-input` commits a JSON number,
//! clamped to its bounds, and never commits text that is not a number; a
//! `readonly` field takes no edits.
#![cfg(not(target_arch = "wasm32"))]
mod common;

use crossterm::event::KeyCode;
use we_tui::TuiApp;

/// A text field whose `onChange` stores the committed text and counts the
/// commits, then a button to Tab to.
fn text_form() -> TuiApp {
    common::app(serde_json::json!({
        "type": "Column",
        "$localState": {
            "saved": { "type": "string", "initial": "" },
            "commits": { "type": "number", "initial": 0 }
        },
        "children": [
            {
                "type": "we-input",
                "props": {
                    "value": "",
                    "onChange": [
                        { "$setLocal": "saved", "value": { "$": "event.detail" } },
                        { "$setLocal": "commits", "value": { "$": "local.commits + 1" } }
                    ]
                }
            },
            { "type": "we-text", "children": [{ "$": "`saved=${local.saved} commits=${local.commits}`" }] },
            { "type": "we-button", "props": { "label": "Next", "onClick": [] } }
        ]
    }))
}

/// Tab onto the field — the first focusable in every form here.
fn focus_field(app: &mut TuiApp) {
    common::frame(app, 60, 30);
    let id = app
        .focusables
        .first()
        .map(|f| f.id.clone())
        .expect("the field is focusable");
    for _ in 0..10 {
        if app.focus.as_ref() == Some(&id) {
            return;
        }
        common::key(app, KeyCode::Tab);
    }
    panic!("Tab never reached the field");
}

#[test]
fn enter_commits_the_typed_text_once() {
    let mut app = text_form();
    focus_field(&mut app);
    common::type_str(&mut app, "abc");
    let before = common::frame(&mut app, 60, 30);
    assert!(
        before.contains("saved= commits=0"),
        "typing alone commits nothing:\n{before}"
    );
    common::key(&mut app, KeyCode::Enter);
    let text = common::frame(&mut app, 60, 30);
    assert!(
        text.contains("saved=abc commits=1"),
        "Enter commits:\n{text}"
    );
    // Nothing typed since: a second Enter is not a second change.
    common::key(&mut app, KeyCode::Enter);
    let text = common::frame(&mut app, 60, 30);
    assert!(
        text.contains("saved=abc commits=1"),
        "clean Enter is no commit:\n{text}"
    );
}

#[test]
fn leaving_the_field_with_tab_commits() {
    let mut app = text_form();
    focus_field(&mut app);
    common::type_str(&mut app, "hello");
    common::key(&mut app, KeyCode::Tab);
    let text = common::frame(&mut app, 60, 30);
    assert!(
        text.contains("saved=hello commits=1"),
        "blur commits:\n{text}"
    );
    // Coming back and leaving again without typing commits nothing more.
    common::key(&mut app, KeyCode::BackTab);
    common::key(&mut app, KeyCode::Tab);
    let text = common::frame(&mut app, 60, 30);
    assert!(
        text.contains("saved=hello commits=1"),
        "clean blur:\n{text}"
    );
}

/// A number field holding `local.n`; the text shows `n + 1`, which is a sum
/// only when `n` is a number (a string `"12"` would print `121`).
fn number_form() -> TuiApp {
    common::app(serde_json::json!({
        "type": "Column",
        "$localState": {
            "n": { "type": "number", "initial": 5 },
            "commits": { "type": "number", "initial": 0 }
        },
        "children": [
            {
                "type": "we-number-input",
                "props": {
                    "value": { "$": "local.n" },
                    "max": 100,
                    "onChange": [
                        { "$setLocal": "n", "value": { "$": "event.detail" } },
                        { "$setLocal": "commits", "value": { "$": "local.commits + 1" } }
                    ]
                }
            },
            { "type": "we-text", "children": [{ "$": "`next=${local.n + 1} commits=${local.commits}`" }] },
            { "type": "we-button", "props": { "label": "Next", "onClick": [] } }
        ]
    }))
}

#[test]
fn a_number_input_commits_a_number() {
    let mut app = number_form();
    focus_field(&mut app);
    common::key(&mut app, KeyCode::Backspace); // the seeded "5"
    common::type_str(&mut app, "12");
    common::key(&mut app, KeyCode::Enter);
    let text = common::frame(&mut app, 60, 30);
    assert!(
        text.contains("next=13 commits=1"),
        "12 committed as a number:\n{text}"
    );

    // Out of bounds clamps to max, on blur.
    common::type_str(&mut app, "00");
    common::key(&mut app, KeyCode::Tab);
    let text = common::frame(&mut app, 60, 30);
    assert!(
        text.contains("next=101 commits=2"),
        "1200 clamps to 100:\n{text}"
    );
}

#[test]
fn a_number_input_never_commits_text() {
    let mut app = number_form();
    focus_field(&mut app);
    common::key(&mut app, KeyCode::Backspace);
    common::type_str(&mut app, "x1");
    common::key(&mut app, KeyCode::Enter);
    let text = common::frame(&mut app, 60, 30);
    assert!(text.contains("next=6 commits=0"), "Enter on x1:\n{text}");
    common::key(&mut app, KeyCode::Tab);
    let text = common::frame(&mut app, 60, 30);
    assert!(text.contains("next=6 commits=0"), "blur on x1:\n{text}");
    assert!(
        text.contains('5'),
        "the field shows its value again:\n{text}"
    );
}

#[test]
fn a_readonly_field_takes_no_edits() {
    let mut app = common::app(serde_json::json!({
        "type": "Column",
        "$localState": { "seen": { "type": "string", "initial": "none" } },
        "children": [
            {
                "type": "we-input",
                "props": {
                    "value": "fixed",
                    "readonly": true,
                    "onInput": { "$setLocal": "seen", "value": { "$": "event.detail" } }
                }
            },
            { "type": "we-text", "children": [{ "$": "`seen=${local.seen}`" }] }
        ]
    }));
    focus_field(&mut app);
    common::type_str(&mut app, "zz");
    common::key(&mut app, KeyCode::Backspace);
    let text = common::frame(&mut app, 60, 30);
    assert!(text.contains("seen=none"), "no onInput:\n{text}");
    assert!(text.contains("fixed") && !text.contains("fixedz"), "{text}");
}
