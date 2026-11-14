//! `we-tui` — the terminal frontend: load the bundle + snapshot through
//! [`we_session::Session`] exactly like `we-cli`, then paint the resolved
//! tree as terminal cells with the keyboard driving it.
//!
//! usage: we-tui [--bundle <path>] [--snapshot <path>] [--route <href or recorded route id>]
//!               [--theme <name>] [--dump] [--size <WxH>]
#![forbid(unsafe_code)]

use std::io::stdout;
use std::time::Duration;

use crossterm::event::{self, Event};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::Terminal;
use we_tui::palette::{load_theme_set, truecolor_env};
use we_tui::{buffer_text, KeyResult, TuiApp};

const DEFAULT_BUNDLE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
);

fn arg(flag: &str, default: Option<String>) -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        if a == flag {
            return args.next();
        }
    }
    default
}

fn has(flag: &str) -> bool {
    std::env::args().any(|a| a == flag)
}

/// `--size 100x40` → `(100, 40)`; malformed pairs fall back to the default.
fn size_arg() -> (u16, u16) {
    let default = (100, 40);
    let Some(s) = arg("--size", None) else {
        return default;
    };
    let Some((w, h)) = s.split_once('x') else {
        return default;
    };
    match (w.parse(), h.parse()) {
        (Ok(w), Ok(h)) => (w, h),
        _ => default,
    }
}

fn main() {
    let bundle_path = arg("--bundle", Some(DEFAULT_BUNDLE.to_string())).unwrap();
    let text = std::fs::read_to_string(&bundle_path)
        .unwrap_or_else(|e| panic!("cannot read bundle {bundle_path}: {e}"));
    let snapshot = arg("--snapshot", None).map(|path| {
        std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read snapshot {path}: {e}"))
    });
    // A we-snapshot@2 recording takes a route id (`index`, `people`) or a
    // recorded path and defaults to its landing route; a flat snapshot
    // keeps we-cli's `/space/demo`.
    let recording = snapshot
        .as_deref()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(t).ok())
        .is_some_and(|j| we_tui::load::is_recording(&j));
    let default_route = if recording { "index" } else { "/space/demo" };
    let route = arg("--route", Some(default_route.to_string())).unwrap();
    let session = we_tui::load::session_from_text(&text, snapshot.as_deref(), &route)
        .unwrap_or_else(|e| panic!("{e}"));

    // `--theme <name>` picks one of the six recorded tables; an unknown
    // name falls back to `dark` — ThemeSet's documented behaviour.
    let set = load_theme_set();
    let theme_name = arg("--theme", Some("dark".to_string())).unwrap();
    let (theme, fell_back) = set.theme(&theme_name);
    if fell_back {
        eprintln!(
            "we-tui: theme {theme_name:?} unknown — using {:?}",
            theme.id
        );
    }
    let theme = theme.clone();

    let mut app = TuiApp::new(session, theme, truecolor_env());

    if has("--dump") {
        let (w, h) = size_arg();
        let area = Rect::new(0, 0, w, h);
        let mut buf = Buffer::empty(area);
        app.render_into(&mut buf, area);
        print!("{}", buffer_text(&buf, area));
        return;
    }

    // Interactive: raw mode + the alternate screen, redraw on every event
    // and on a 100ms tick (a resize or an op landing redraws too).
    let mut out = stdout();
    enable_raw_mode().expect("raw mode");
    execute!(out, EnterAlternateScreen).expect("alternate screen");
    let backend = CrosstermBackend::new(out);
    let mut terminal = Terminal::new(backend).expect("terminal");
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| loop {
        app.session.poll();
        terminal
            .draw(|f| {
                let area = f.area();
                app.render_into(f.buffer_mut(), area);
            })
            .expect("draw");
        match event::poll(Duration::from_millis(100)) {
            Ok(true) => match event::read() {
                Ok(Event::Key(key)) => {
                    if matches!(key.kind, event::KeyEventKind::Release) {
                        continue;
                    }
                    if app.handle_key(key) == KeyResult::Quit {
                        break Ok(());
                    }
                }
                Ok(_) => {}
                Err(e) => break Err(e),
            },
            Ok(false) => {}
            Err(e) => break Err(e),
        }
    }));
    let _ = disable_raw_mode();
    let _ = execute!(terminal.backend_mut(), LeaveAlternateScreen);
    let _ = terminal.show_cursor();
    match result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => eprintln!("we-tui: terminal error: {e}"),
        Err(payload) => std::panic::resume_unwind(payload),
    }
}
