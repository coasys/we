//! The Coasys left rail at the size `ad4m tui` gives the renderer (160×45).
//!
//! The shell's rail is `72px` until a pointer hovers it. The terminal has no
//! hover, and it still paints the labels the GUI unmounts while closed — the
//! mark's alt "Coasys", and the nav labels. At 160 columns those labels fit
//! on one line. Narrower, a label that does not fit ends in an ellipsis
//! instead of breaking mid-word (`Coas` / `ys`).
#![cfg(not(target_arch = "wasm32"))]
mod common;

/// The rail as the Coasys shell sizes it when closed: 72px, fixed to the
/// left, full height, the mark, and the nav labels from #539.
fn coasys_rail() -> serde_json::Value {
    serde_json::json!({
        "type": "Column",
        "props": { "width": "100%", "height": "100%" },
        "children": [{
            "type": "Column",
            "props": {
                "width": "72px",
                "height": "100%",
                "position": "fixed",
                "top": "0",
                "left": "0",
                "px": "200",
                "borderRight": "1px solid neutral-300"
            },
            "children": [
                {
                    "type": "Row",
                    "props": { "height": "72px", "pl": "22px", "gap": "300", "ay": "center" },
                    "children": [{
                        "type": "we-image",
                        "props": { "alt": "Coasys", "width": "28px", "height": "28px" }
                    }]
                },
                { "type": "we-button", "props": { "variant": "ghost", "label": "Spaces", "width": "100%" } },
                { "type": "we-button", "props": { "variant": "ghost", "label": "Settings", "width": "100%" } },
                { "type": "we-button", "props": { "variant": "ghost", "label": "Profile", "width": "100%" } },
                {
                    "type": "DropdownMenu",
                    "props": {
                        "items": [
                            { "id": "about", "label": "About" },
                            { "id": "logout", "label": "Log out" }
                        ]
                    }
                }
            ]
        }]
    })
}

const LABELS: [&str; 5] = ["Coasys", "Spaces", "Settings", "Profile", "Log out"];

fn line_has(text: &str, label: &str) -> bool {
    text.lines().any(|line| line.contains(label))
}

/// `word` broken onto two lines the way a hard wrap splits it (`Coas` / `ys`).
fn split_mid_word(text: &str, word: &str) -> bool {
    if line_has(text, word) {
        return false;
    }
    let chars: Vec<char> = word.chars().collect();
    for i in 1..chars.len() {
        let head: String = chars[..i].iter().collect();
        let tail: String = chars[i..].iter().collect();
        if head.chars().count() < 2 || tail.chars().count() < 2 {
            continue;
        }
        let head_line = text.lines().position(|line| line.contains(&head));
        let tail_line = text.lines().position(|line| line.contains(&tail));
        if matches!((head_line, tail_line), (Some(h), Some(t)) if t == h + 1) {
            return true;
        }
    }
    false
}

#[test]
fn coasys_rail_labels_fit_on_one_line_at_160x45() {
    let mut app = common::app(coasys_rail());
    let text = common::frame(&mut app, 160, 45);
    for label in LABELS {
        assert!(
            line_has(&text, label),
            "{label:?} is not on one line at 160×45:\n{text}"
        );
    }
    assert!(
        !split_mid_word(&text, "Coasys"),
        "Coasys wrapped mid-word at 160×45:\n{text}"
    );
}

#[test]
fn coasys_rail_ellipsizes_instead_of_wrapping_mid_word_when_narrow() {
    let mut app = common::app(coasys_rail());
    // 32 columns: half the viewport is reserved for the page, so the 72px
    // rail cannot grow to the labels. What does not fit ends in `…`.
    let text = common::frame(&mut app, 32, 20);
    assert!(
        !split_mid_word(&text, "Coasys"),
        "Coasys wrapped mid-word at 32 columns:\n{text}"
    );
    let clipped = LABELS.iter().any(|label| !line_has(&text, label));
    if clipped {
        assert!(
            text.contains('…'),
            "a clipped label has no ellipsis:\n{text}"
        );
    }
}
