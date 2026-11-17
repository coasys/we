//! `we-tui` against the Coasys bundle + tree snapshot — the same oracle
//! `we-app`'s `tree.rs` drives egui with: the sidebar's labels, their
//! order, the tree's depth indent, an Enter that reaches `routeStore`,
//! an input draft that survives a re-resolve, and the unknown-widget
//! placeholder.
//!
//! Expected labels come from the snapshot (`spaceStore.currentSpace`,
//! `queries.*` counts) and the template's literals — never from what the
//! Rust printer happens to emit.
// Native only, as the crate is: on wasm32 we-tui builds empty.
#![cfg(not(target_arch = "wasm32"))]
use std::sync::Arc;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::backend::TestBackend;
use ratatui::layout::Rect;
use ratatui::Terminal;
use serde::Deserialize;
use we_screen::{ScreenSchema, ScreenState};
use we_session::Session;
use we_template::{Bundle, MountCx, RootSpec, SchemaNode, StoreBag};
use we_tui::draw::FocusKind;
use we_tui::palette::load_theme_set;
use we_tui::{buffer_text, KeyResult, TuiApp};

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));
const SNAPSHOT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../we-app/tests/data/tree-snapshot.json"
));

/// The app under test — the bundle's `tree` panel over the snapshot's
/// store bag, dark theme, `route` as the start href.
fn app(route: &str) -> TuiApp {
    let bundle = Bundle::parse(BUNDLE).expect("bundle parses");
    let schema: SchemaNode = SchemaNode::deserialize(
        bundle.templates.as_deref().unwrap()[0]
            .meta
            .get("panels")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p.get("id").and_then(|i| i.as_str()) == Some("tree"))
            .and_then(|p| p.get("node"))
            .cloned()
            .unwrap(),
    )
    .expect("tree panel parses");
    let bag = StoreBag::from_snapshot(&serde_json::from_str(SNAPSHOT).unwrap()).unwrap();
    let session = Session::offline(
        RootSpec::Single {
            node: Box::new(schema),
            cx: MountCx::explicit("tree"),
            declared: we_template::Declared::default(),
        },
        Arc::new(bag),
        ScreenState::desktop(ScreenSchema::default(), route),
    )
    .with_dollar_types(|ty| we_catalog::entry(ty).is_some());
    let set = load_theme_set();
    let theme = set.theme("dark").0.clone();
    TuiApp::new(session, theme, true)
}

/// One frame's text — `TestBackend` is the brief's oracle.
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

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

/// The line index containing `needle`, for order assertions.
fn line_of(text: &str, needle: &str) -> usize {
    text.lines()
        .position(|l| l.contains(needle))
        .unwrap_or_else(|| panic!("{needle:?} not in frame:\n{text}"))
}

#[test]
fn tree_panel_labels_order_and_indent() {
    let mut app = app("/space/demo");
    // A first frame so focusables resolve; the dump itself is the oracle.
    let text = frame(&mut app, 64, 44);

    // From the snapshot: the space's name and description, the find
    // placeholder the template authors literally, the section label.
    let snap: serde_json::Value = serde_json::from_str(SNAPSHOT).unwrap();
    let name = snap["stores"]["spaceStore"]["currentSpace"]["name"]
        .as_str()
        .unwrap();
    let desc = snap["stores"]["spaceStore"]["currentSpace"]["description"]
        .as_str()
        .unwrap();
    assert!(text.contains(name), "space name in frame:\n{text}");
    assert!(text.contains(desc), "space description in frame:\n{text}");
    assert!(text.contains("Find or ask"), "input placeholder:\n{text}");
    assert!(text.contains("SPACE"), "overline heading:\n{text}");

    // The group labels in sidebar order — the same list the egui test
    // checks (`tree_panel_paints`, `rows_are_discoverable`).
    let groups = [
        "Feed",
        "Calls",
        "Workflows",
        "People",
        "Social DNA",
        "Templates",
        "Themes",
    ];
    let mut prev = 0usize;
    for g in groups {
        let i = line_of(&text, g);
        assert!(
            i >= prev,
            "{g} out of order (line {i}, prev {prev}):\n{text}"
        );
        prev = i;
    }
    // Workflows are open in the snapshot's `openRows`, so their nested rows
    // paint too — and deeper than their parent. (Calls are one flat entry
    // in the sidebar now, with no rows under it.) Depth shows as leading
    // whitespace (byte offsets won't do — the rows hold multi-byte glyphs).
    let indent = |l: &str| l.chars().take_while(|c| c.is_whitespace()).count();
    let group_line = text
        .lines()
        .find(|l| l.contains("Workflows"))
        .unwrap_or_else(|| panic!("Workflows group in frame:\n{text}"));
    // A nested workflow row carries its own count badge ([3]).
    let nested_line = text
        .lines()
        .find(|l| l.contains("[3]"))
        .unwrap_or_else(|| panic!("nested workflow row in frame:\n{text}"));
    assert!(
        indent(nested_line) > indent(group_line),
        "nested workflow should indent deeper than its group:\n{text}"
    );
    // Badge counts come from the snapshot's query results: 2 workflows,
    // 2 members.
    assert!(text.contains("[2]"), "count badge in frame:\n{text}");
    assert!(text.contains("[12]"), "social-dna badge in frame:\n{text}");
    // The status line carries the route.
    assert!(
        text.contains("/space/demo"),
        "route in status line:\n{text}"
    );
}

#[test]
fn enter_on_a_tree_item_changes_route() {
    // `?view=canvas` makes group|dna's onSelect run setParam("dna","all")
    // — the same path the egui test clicks through.
    let mut app = app("/space/demo?view=canvas");
    frame(&mut app, 64, 44);
    assert!(app.session.screen().nav.param("dna").is_none());

    // The "Social DNA" row carries value "group|dna" — Tab to it through
    // the focusable list the frame collected.
    let target = app
        .focusables
        .iter()
        .find(|f| {
            matches!(&f.kind, FocusKind::TreeItem { value } if value.js_string() == "group|dna")
        })
        .map(|f| f.id.clone())
        .expect("group|dna row is focusable");
    let mut steps = 0;
    while app.focus.as_ref() != Some(&target) && steps < 200 {
        app.handle_key(key(KeyCode::Tab));
        steps += 1;
    }
    assert_eq!(app.focus.as_ref(), Some(&target), "Tab reached group|dna");

    app.handle_key(key(KeyCode::Enter));
    assert_eq!(app.session.screen().nav.param("dna"), Some("all"));

    // The section expands — the DNA kinds' labels appear (the oracle
    // labels read from the template: 'Signal types', 'Connection types'…).
    let text = frame(&mut app, 64, 44);
    for heading in ["Signal types", "Connection types", "Topics"] {
        assert!(
            text.contains(heading),
            "{heading} appears after Enter expands Social DNA:\n{text}"
        );
    }
}

#[test]
fn input_draft_survives_re_resolve() {
    let mut app = app("/space/demo");
    frame(&mut app, 64, 44);
    let input = app
        .focusables
        .iter()
        .find(|f| matches!(f.kind, FocusKind::Input))
        .map(|f| f.id.clone())
        .expect("the find input is focusable");
    let mut steps = 0;
    while app.focus.as_ref() != Some(&input) && steps < 200 {
        app.handle_key(key(KeyCode::Tab));
        steps += 1;
    }
    assert_eq!(app.focus.as_ref(), Some(&input), "Tab reached the input");

    for c in "xyz".chars() {
        app.handle_key(key(KeyCode::Char(c)));
    }
    // The onInput → $setLocal round-trip lands in the resolved tree; the
    // draft keeps showing regardless.
    let text = frame(&mut app, 64, 44);
    assert!(text.contains("xyz"), "typed draft in frame:\n{text}");
    // A second resolve — nothing retyped, the draft survives.
    let text = frame(&mut app, 64, 44);
    assert!(text.contains("xyz"), "draft survives a re-resolve:\n{text}");
    // And `q` doesn't quit while the input holds focus — it's typed.
    assert_eq!(app.handle_key(key(KeyCode::Char('q'))), KeyResult::Continue);
}

#[test]
fn unknown_widget_renders_placeholder() {
    let schema: SchemaNode = serde_json::from_value(serde_json::json!({
        "type": "Column",
        "children": [
            {"type": "we-text", "props": {"text": "before"}},
            {"type": "we-mystery"},
            {"type": "we-text", "props": {"text": "after"}}
        ]
    }))
    .unwrap();
    let session = Session::offline(
        RootSpec::Single {
            node: Box::new(schema),
            cx: MountCx::explicit("t"),
            declared: we_template::Declared::default(),
        },
        Arc::new(StoreBag::new()),
        ScreenState::desktop(ScreenSchema::default(), "/"),
    )
    .with_dollar_types(|ty| we_catalog::entry(ty).is_some());
    let set = load_theme_set();
    let mut app = TuiApp::new(session, set.theme("dark").0.clone(), true);
    let text = frame(&mut app, 40, 10);
    assert!(
        text.contains("[we-mystery]"),
        "unknown placeholder:\n{text}"
    );
    assert!(text.contains("before") && text.contains("after"));
}

#[test]
fn q_and_ctrl_c_quit() {
    let mut app = app("/space/demo");
    frame(&mut app, 64, 20);
    assert_eq!(app.handle_key(key(KeyCode::Char('q'))), KeyResult::Quit);
    assert_eq!(
        app.handle_key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL)),
        KeyResult::Quit
    );
}
