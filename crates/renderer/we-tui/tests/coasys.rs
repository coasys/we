//! `we-tui` on C2a's recorded Coasys snapshot (`fixtures/coasys/snapshot.json`,
//! `we-snapshot@2`) with `bundles/coasys.bundle.json`: one recorded route at a
//! time, the bundle's whole app root, loaded through `we_tui::load` the way
//! `we-app/tests/coasys_shots.rs` resolves it.
//!
//! Expected labels come from the recording (a route's `members` and its query
//! captures) or from what the web screenshots show
//! (`we-app/tests/coasys_shots.observations.md`) — never from we-tui's output.
// Native only, as the crate is: on wasm32 we-tui builds empty.
#![cfg(not(target_arch = "wasm32"))]
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::backend::TestBackend;
use ratatui::layout::Rect;
use ratatui::Terminal;
use serde_json::Value as Json;
use we_tui::draw::FocusKind;
use we_tui::palette::load_theme_set;
use we_tui::{buffer_text, TuiApp};

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));
const SNAPSHOT: &str = include_str!("../../fixtures/coasys/snapshot.json");

fn truth() -> Json {
    serde_json::from_str(SNAPSHOT).expect("snapshot parses")
}

fn app(route: &str) -> TuiApp {
    let session = we_tui::load::session_from_text(BUNDLE, Some(SNAPSHOT), route)
        .unwrap_or_else(|e| panic!("route {route} loads: {e}"));
    let theme = load_theme_set().theme("dark").0.clone();
    TuiApp::new(session, theme, true)
}

/// A frame tall enough that a route's whole outlet fits without scrolling.
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

/// The rows a route captured for `name @ scope`.
fn rows(truth: &Json, route: &str, name: &str, scope: &str) -> Vec<Json> {
    truth["routes"][route]["queries"]
        .as_array()
        .and_then(|qs| qs.iter().find(|q| q["name"] == name && q["scope"] == scope))
        .and_then(|q| q["rows"].as_array())
        .cloned()
        .unwrap_or_else(|| panic!("the recording has no {name} @ {scope} on {route}"))
}

fn assert_shows(text: &str, needle: &str, why: &str) {
    assert!(
        text.contains(needle),
        "{needle:?} ({why}) not in frame:\n{text}"
    );
}

#[test]
fn the_recording_is_we_snapshot_v2() {
    let t = truth();
    assert!(we_tui::load::is_recording(&t));
    // A recorded path picks the same route as its id.
    assert_eq!(
        we_tui::load::route_id(&t, "/space/preview-coasys/people").unwrap(),
        "people"
    );
    assert!(we_tui::load::route_id(&t, "/nowhere").is_err());
}

#[test]
fn index_shows_the_space_tree_from_the_recording() {
    let t = truth();
    let mut app = app("index");
    let text = frame(&mut app, 160, 60);
    // The Calls group's badge counts the tree panel's recorded calls.
    let calls = rows(&t, "index", "calls", "template.meta.panels[tree].node");
    assert!(!calls.is_empty());
    let badge = format!("[{}]", calls.len());
    let calls_line = text
        .lines()
        .find(|l| l.contains("Calls"))
        .unwrap_or_else(|| panic!("Calls group not in frame:\n{text}"));
    assert!(
        calls_line.contains(&badge),
        "{badge} on the Calls row:\n{text}"
    );
    // The tree's groups, in order — the web shows them on every route.
    let mut prev = 0;
    for g in ["Feed", "Calls", "Workflows", "People", "Social DNA"] {
        let i = text
            .lines()
            .position(|l| l.contains(g))
            .unwrap_or_else(|| panic!("{g} not in frame:\n{text}"));
        assert!(i >= prev, "{g} out of order:\n{text}");
        prev = i;
    }
    assert_shows(&text, "Start a call", "the sidebar's bottom control");
    assert_shows(
        &text,
        "/space/preview-coasys",
        "the recorded path, status line",
    );
}

#[test]
fn index_at_120x40_names_the_space_and_each_call_on_its_own_row() {
    let t = truth();
    let mut app = app("index");
    let text = frame(&mut app, 120, 40);
    let lines: Vec<&str> = text.lines().collect();
    // Each recorded call, by its title, on the row of its own tree item —
    // the item whose value the bundle builds as `call|<id>`.
    let calls = rows(&t, "index", "calls", "template.meta.panels[tree].node");
    assert_eq!(calls.len(), 3);
    for call in &calls {
        let title = call["title"].as_str().unwrap();
        let value = format!("call|{}", call["id"].as_str().unwrap());
        let item = app
            .focusables
            .iter()
            .find(|f| matches!(&f.kind, FocusKind::TreeItem { value: v } if v.js_string() == value))
            .unwrap_or_else(|| panic!("{value} is a tree row:\n{text}"));
        assert!(item.rect.y < 39, "{title} row is on screen:\n{text}");
        let row = lines[item.rect.y as usize];
        assert!(
            row.contains(title),
            "{title:?} on its own row {row:?}:\n{text}"
        );
    }
    // The space's recorded name, whole.
    let space = t["routes"]["index"]["members"]["spaceStore"]["currentSpace"]["name"]
        .as_str()
        .expect("the recording names the space");
    assert_shows(&text, space, "the recorded space name, readable");
}

#[test]
fn people_shows_every_recorded_member_and_handle() {
    let t = truth();
    let mut app = app("people");
    let text = frame(&mut app, 160, 120);
    let profiles = t["routes"]["people"]["members"]["profileStore"]["profiles"]
        .as_array()
        .unwrap();
    // "all seven people are there" (observations, people).
    assert_eq!(profiles.len(), 7);
    for p in profiles {
        assert_shows(&text, p["name"].as_str().unwrap(), "a recorded profile");
        let handle = format!("@{}", p["handle"].as_str().unwrap());
        assert_shows(&text, &handle, "a recorded handle");
    }
}

#[test]
fn dna_shows_its_sections_and_signal_types() {
    let t = truth();
    let mut app = app("dna");
    let text = frame(&mut app, 160, 160);
    // "Signal types, Connection types, Task states and Involvement are all
    // present" (observations, dna).
    for heading in [
        "Signal types",
        "Connection types",
        "Task states",
        "Involvement",
    ] {
        assert_shows(&text, heading, "a DNA section the web shows");
    }
    for row in rows(&t, "dna", "signalTypes", "template.routes[/dna]") {
        let name = row["name"].as_str().unwrap();
        assert_shows(&text, name, "a recorded signal type");
    }
    for row in rows(&t, "dna", "relationshipTypes", "template.routes[/dna]") {
        let name = row["name"].as_str().unwrap();
        assert_shows(&text, name, "a recorded relationship type");
    }
}

#[test]
fn workflows_shows_the_list_and_the_prompt() {
    let mut app = app("workflows");
    let text = frame(&mut app, 160, 60);
    // "the Workflows heading, the Pilot 3 and Review 2 rows, 'Choose a
    // workflow…'" (observations, workflows) — the prompt stands beside the
    // list, outside the tree.
    assert_shows(&text, "Choose a workflow", "the empty-detail prompt");
    let outlet: String = text
        .lines()
        .map(|l| l.chars().skip(45).collect::<String>() + "\n")
        .collect();
    assert_shows(
        &outlet,
        "Pilot",
        "the list's first workflow, outside the tree",
    );
    assert_shows(
        &outlet,
        "Review",
        "the list's second workflow, outside the tree",
    );
}

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

#[test]
fn tab_and_enter_on_the_people_row_open_the_people_route() {
    let mut app = app("index");
    let before = frame(&mut app, 160, 60);
    let path0 = app.session.screen.nav.current_path();
    assert!(!path0.ends_with("/people"), "starts on {path0}");
    assert!(!before.contains("@mara"), "no member cards yet:\n{before}");

    let target = app
        .focusables
        .iter()
        .find(|f| {
            matches!(&f.kind, FocusKind::TreeItem { value } if value.js_string() == "group|people")
        })
        .map(|f| f.id.clone())
        .expect("the People group row is focusable");
    let mut steps = 0;
    while app.focus.as_ref() != Some(&target) && steps < 300 {
        app.handle_key(key(KeyCode::Tab));
        steps += 1;
    }
    assert_eq!(app.focus.as_ref(), Some(&target), "Tab reached People");
    app.handle_key(key(KeyCode::Enter));

    let after = frame(&mut app, 160, 120);
    assert!(
        app.session.screen.nav.current_path().ends_with("/people"),
        "Enter navigated: {}",
        app.session.screen.nav.current_path()
    );
    // The People page's member cards — a recorded handle — now show.
    assert_shows(&after, "@mara", "a member card on the People page");
}
