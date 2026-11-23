//! The Coasys left rail at the size `ad4m tui` gives the renderer (160×45).
//!
//! The shell's rail is `72px` until a pointer hovers it. The terminal has no
//! hover, so the rail stays at that width and paints the labels the GUI
//! unmounts while closed. A label that fits is whole; one that does not ends
//! in an ellipsis on one line (`Settings` → `Settin…`), never a mid-word
//! split (`Coas` / `ys`) and never a clip with no ellipsis (`Set`). The page
//! beside the rail is laid out against that same edge and must stay visible.
#![cfg(not(target_arch = "wasm32"))]
mod common;

/// The closed Coasys rail, plus a page marker on the first cell past the
/// rail's painted edge.
///
/// `72px` is 9 cells. `px: 200` is one cell each side and the right border
/// is one more, so the collapsed rail's `│` lands on column 11. The marker
/// starts at `96px` (column 12): still beside the authored rail, and covered
/// if that rail paints any wider.
fn coasys_rail() -> serde_json::Value {
    serde_json::json!({
        "type": "Column",
        "props": { "width": "100%", "height": "100%" },
        "children": [
            {
                "type": "Column",
                "props": { "pl": "96px" },
                "children": [{ "type": "we-text", "children": ["PAGEBODY"] }]
            },
            {
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
            }
        ]
    })
}

const LABELS: [&str; 6] = [
    "Coasys", "Spaces", "Settings", "Profile", "About", "Log out",
];

/// Column of the collapsed rail's right border. See [`coasys_rail`].
const RAIL_BORDER_COL: usize = 11;

const PAGE: &str = "PAGEBODY";

/// `label` on one row: the whole word, or a `…` whose prefix belongs to
/// this label alone. A hard wrap (`Coas` / `ys`) is neither.
fn label_one_line(text: &str, label: &str) -> bool {
    let lines: Vec<&str> = text.lines().collect();
    for (i, line) in lines.iter().enumerate() {
        if line.contains(label) {
            return true;
        }
        let Some(prefix) = ellipsis_prefix(line, label) else {
            continue;
        };
        let rest = &label[prefix.len()..];
        let next = lines.get(i + 1).copied().unwrap_or("");
        if rest.is_empty() || !next_continues(next, rest) {
            return true;
        }
    }
    false
}

/// The longest suffix of the text before `…` that is a prefix of `label`
/// and of no other nav label. At least two characters, so `S…` cannot
/// stand in for both Spaces and Settings.
fn ellipsis_prefix(line: &str, label: &str) -> Option<String> {
    let idx = line.find('…')?;
    let before = &line[..idx];
    let mut best: Option<&str> = None;
    for (i, _) in before.char_indices() {
        let suffix = &before[i..];
        if suffix.chars().count() < 2 || !label.starts_with(suffix) {
            continue;
        }
        if best.is_none_or(|b| suffix.len() > b.len()) {
            best = Some(suffix);
        }
    }
    let prefix = best?;
    let owners = LABELS.iter().filter(|l| l.starts_with(prefix)).count();
    (owners == 1).then(|| prefix.to_string())
}

fn next_continues(next: &str, rest: &str) -> bool {
    next.trim_start().starts_with(rest)
}

fn assert_labels(text: &str) {
    for label in LABELS {
        assert!(
            label_one_line(text, label),
            "{label:?} is not on one line, full or ellipsized:\n{text}"
        );
    }
}

/// The page marker is intact, and every rail border is the collapsed one.
fn assert_page_clear(text: &str) {
    let line = text
        .lines()
        .find(|l| l.contains(PAGE))
        .unwrap_or_else(|| panic!("page marker missing or overlapped:\n{text}"));
    let start = line
        .find(PAGE)
        .map(|byte| line[..byte].chars().count())
        .expect("marker");
    assert!(
        start > RAIL_BORDER_COL,
        "page marker starts at column {start}, on the rail:\n{text}"
    );
    let mut borders = Vec::new();
    for (n, l) in text.lines().enumerate() {
        // Char index, not bytes: `…` is one cell and three bytes, and a
        // byte index would put the border of an ellipsized row two past
        // the border of the rows around it.
        if let Some(byte) = l.find('│') {
            borders.push((n, l[..byte].chars().count()));
        }
    }
    assert!(
        borders.iter().all(|(_, col)| *col == RAIL_BORDER_COL),
        "rail border left column {RAIL_BORDER_COL}: {borders:?}\n{text}"
    );
}

#[test]
fn coasys_rail_labels_fit_on_one_line_at_160x45() {
    let mut app = common::app(coasys_rail());
    let text = common::frame(&mut app, 160, 45);
    assert_labels(&text);
    assert_page_clear(&text);
}

#[test]
fn coasys_rail_ellipsizes_instead_of_wrapping_mid_word_when_narrow() {
    let mut app = common::app(coasys_rail());
    // 32 columns keeps the rail at its authored width. 45 rows is enough
    // for every label: at 20 rows Profile and Log out fall below the fold,
    // so a single `…` anywhere used to pass while those two were absent.
    let text = common::frame(&mut app, 32, 45);
    assert_labels(&text);
    assert_page_clear(&text);
}

/// `wrap` is the shared text wrapper. An overlong word in ordinary text
/// keeps every character on later rows. It does not become `head…` with
/// the tail dropped.
#[test]
fn ordinary_overlong_word_wraps_and_keeps_every_character() {
    let word = "Supercalifragilisticexpialidocious";
    // A Row child keeps the column's own width. The root is painted at the
    // viewport width, so a width on the root itself would not wrap the word.
    let mut app = common::app(serde_json::json!({
        "type": "Row",
        "props": { "ay": "start" },
        "children": [{
            "type": "Column",
            "props": { "width": "40px" },
            "children": [{
                "type": "we-text",
                // Height is measured before this column's width applies, so
                // the intrinsic box is only a couple of rows. Give the text
                // a tall box; paint then wraps at the column's 5 cells.
                "props": { "height": "96px" },
                "children": [word]
            }]
        }]
    }));
    let text = common::frame(&mut app, 20, 16);
    let body: String = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.contains("nodes") && !l.starts_with('/'))
        .collect();
    assert_eq!(
        body, word,
        "ordinary wrap dropped or ellipsized characters:\n{text}"
    );
}
