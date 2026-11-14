//! Shared helpers for the synthetic-schema tests: a session over an inline
//! schema with no stores, one frame's text, a keypress.
#![allow(dead_code)]
use std::sync::Arc;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::backend::TestBackend;
use ratatui::layout::Rect;
use ratatui::Terminal;
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{RootSpec, SchemaNode, StoreBag};
use we_tui::palette::load_theme_set;
use we_tui::{buffer_text, TuiApp};

/// A `TuiApp` over `schema`, dark theme, at `/`.
pub fn app(schema: serde_json::Value) -> TuiApp {
    let schema: SchemaNode = serde_json::from_value(schema).expect("schema parses");
    let session = Session::offline(
        RootSpec::Single {
            node: Box::new(schema),
            id: "t".into(),
        },
        Arc::new(StoreBag::new()),
        ScreenState::desktop(ScreenSchema::default(), "/"),
    )
    .with_dollar_types(|ty| we_catalog::entry(ty).is_some());
    TuiApp::new(session, load_theme_set().theme("dark").0.clone(), true)
}

/// One frame's text.
pub fn frame(app: &mut TuiApp, w: u16, h: u16) -> String {
    let mut terminal = Terminal::new(TestBackend::new(w, h)).unwrap();
    terminal
        .draw(|f| {
            let area = f.area();
            app.render_into(f.buffer_mut(), area);
        })
        .unwrap();
    buffer_text(terminal.backend().buffer(), Rect::new(0, 0, w, h))
}

pub fn key(app: &mut TuiApp, code: KeyCode) {
    app.handle_key(KeyEvent::new(code, KeyModifiers::NONE));
}

pub fn type_str(app: &mut TuiApp, s: &str) {
    for c in s.chars() {
        key(app, KeyCode::Char(c));
    }
}
