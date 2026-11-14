//! The input draft is we-tui's own: an input whose `value` is a literal
//! (nothing writes the typed text back into the tree) must still show what
//! was typed, before and after a re-resolve. `tree.rs`'s draft test cannot
//! tell — the find input's `onInput` round-trips the text into `value`.
use std::sync::Arc;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::backend::TestBackend;
use ratatui::layout::Rect;
use ratatui::Terminal;
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{SchemaNode, StoreBag};
use we_tui::draw::FocusKind;
use we_tui::palette::load_theme_set;
use we_tui::{buffer_text, TuiApp};

fn frame(app: &mut TuiApp, w: u16, h: u16) -> String {
    let mut terminal = Terminal::new(TestBackend::new(w, h)).unwrap();
    terminal
        .draw(|f| {
            let area = f.area();
            app.render_into(f.buffer_mut(), area);
        })
        .unwrap();
    buffer_text(terminal.backend().buffer(), Rect::new(0, 0, w, h))
}

#[test]
fn a_draft_shows_where_nothing_writes_value_back() {
    let schema: SchemaNode = serde_json::from_value(serde_json::json!({
        "type": "Column",
        "children": [{ "type": "we-input", "props": { "value": "seed" } }]
    }))
    .unwrap();
    let session = Session::new(
        schema,
        "t",
        Arc::new(StoreBag::new()),
        ScreenState::desktop(ScreenSchema::default(), "/"),
    )
    .with_dollar_types(|ty| we_catalog::entry(ty).is_some());
    let mut app = TuiApp::new(session, load_theme_set().theme("dark").0.clone(), true);
    frame(&mut app, 40, 6);
    let input = app
        .focusables
        .iter()
        .find(|f| matches!(f.kind, FocusKind::Input))
        .map(|f| f.id.clone())
        .expect("the input is focusable");
    app.handle_key(KeyEvent::new(KeyCode::Tab, KeyModifiers::NONE));
    assert_eq!(app.focus.as_ref(), Some(&input));
    for c in "xyz".chars() {
        app.handle_key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE));
    }
    let text = frame(&mut app, 40, 6);
    assert!(
        text.contains("seedxyz"),
        "draft seeded from value, typed onto:\n{text}"
    );
    let text = frame(&mut app, 40, 6);
    assert!(
        text.contains("seedxyz"),
        "draft survives a re-resolve:\n{text}"
    );
}
