//! Unit tests for the pieces the vectors do not reach: the schema's typed
//! reads, the shell's isolation from the back stack (rule 10), `FilePrefs`
//! persistence and corruption, the `ScreenOp` name table, and `version`'s
//! one-bump-per-change contract.
use serde_json::json;
use we_screen::{
    Changed, FilePrefs, MemoryHistory, Navigator, ParamValue, PrefStore, ScreenOp, ScreenSchema,
    ScreenState, OP_NAMES,
};

fn screen(schema_json: serde_json::Value, start: &str) -> ScreenState {
    let schema = ScreenSchema::from_json(&schema_json);
    ScreenState::new(
        Navigator::new(schema, Box::new(MemoryHistory::new(start))),
        we_screen::DevicePrefs::new(Box::new(we_screen::MemoryPrefs::default())),
    )
}

// --- schema (brief test 4) -------------------------------------------------

#[test]
fn declared_param_with_bad_value_reads_absent() {
    // `tree` is a declared `boolean`; "yes" is not `true`/`false`.
    let mut s = screen(
        json!({ "params": { "tree": { "type": "boolean" } } }),
        "/space/abc/board?tree=yes",
    );
    assert_eq!(s.nav.param_typed("tree"), None);
    // …but the raw text is still there, as a string.
    assert_eq!(s.nav.param("tree"), Some("yes"));
    // A real `true` reads typed.
    s.nav.open("/space/abc/board?tree=true");
    assert_eq!(s.nav.param_typed("tree"), Some(ParamValue::Bool(true)));
}

#[test]
fn undeclared_param_reads_as_string() {
    let s = screen(json!({ "params": {} }), "/space/abc/board?foreign=x%20y");
    assert_eq!(s.nav.param("foreign"), Some("x y"));
    assert_eq!(
        s.nav.param_typed("foreign"),
        Some(ParamValue::Str("x y".to_string()))
    );
}

#[test]
fn identity_moves_to_the_declared_param() {
    let s = screen(
        json!({ "params": { "sel": { "type": "id", "identity": true } } }),
        "/space/abc/board?sel=r:9&id=other",
    );
    assert_eq!(s.nav.page_identity(), "/space/abc/board?sel=r:9");
    // And `id` alone, with no identity declared, is the TS default.
    let s2 = screen(json!({ "params": {} }), "/space/abc/board?id=other");
    assert_eq!(s2.nav.page_identity(), "/space/abc/board?id=other");
}

/// Counts warnings about our test param across the process — the "logged
/// once" half of `declared_param_with_bad_value_reads_absent`.
static TREE_WARNS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

struct CountingLogger;
impl log::Log for CountingLogger {
    fn enabled(&self, _: &log::Metadata<'_>) -> bool {
        true
    }
    fn log(&self, record: &log::Record<'_>) {
        // A param name no other test in this binary declares — a shared
        // counter would otherwise count their warnings too (the tests run
        // in parallel).
        if record.args().to_string().contains("\"wtree\"") {
            TREE_WARNS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
    }
    fn flush(&self) {}
}
static LOGGER: CountingLogger = CountingLogger;

#[test]
fn bad_declared_value_warns_once_not_per_read() {
    let _ = log::set_logger(&LOGGER);
    log::set_max_level(log::LevelFilter::Warn);
    let before = TREE_WARNS.load(std::sync::atomic::Ordering::Relaxed);
    let s = screen(
        json!({ "params": { "wtree": { "type": "boolean" } } }),
        "/space/abc/board?wtree=yes",
    );
    assert_eq!(s.nav.param_typed("wtree"), None);
    assert_eq!(s.nav.param_typed("wtree"), None);
    assert_eq!(s.nav.param_typed("wtree"), None);
    assert_eq!(
        TREE_WARNS.load(std::sync::atomic::Ordering::Relaxed) - before,
        1,
        "the rejected value should warn exactly once"
    );
}

#[test]
fn enum_param_rejects_values_off_the_list() {
    let s = screen(
        json!({ "params": { "view": { "type": "enum", "values": ["canvas"] } } }),
        "/space/abc/board?view=board",
    );
    assert_eq!(s.nav.param_typed("view"), None);
    let s = screen(
        json!({ "params": { "view": { "type": "enum", "values": ["canvas"] } } }),
        "/space/abc/board?view=canvas",
    );
    assert_eq!(
        s.nav.param_typed("view"),
        Some(ParamValue::Str("canvas".to_string()))
    );
}

// --- shell isolation (brief test 5, rule 10) --------------------------------

#[test]
fn shell_overlay_leaves_nav_and_history_alone() {
    let mut s = screen(json!({ "params": {} }), "/space/abc/board");
    s.apply(ScreenOp::Navigate {
        to: "~/wall".to_string(),
        query: None,
        base_depth: None,
        replace: false,
    });
    let (href, depth, index) = (s.nav.href(), s.nav.depth(), s.nav.index());
    s.apply(ScreenOp::OpenShellView {
        id: "settings".to_string(),
        path: None,
    });
    assert_eq!(
        (s.nav.href(), s.nav.depth(), s.nav.index()),
        (href, depth, index)
    );
    // Back does not close it.
    s.apply(ScreenOp::Back);
    assert!(s.shell.overlay.is_some(), "Back must not close an overlay");
    // CloseShellView does; the nav stays put.
    s.apply(ScreenOp::CloseShellView);
    assert!(s.shell.overlay.is_none());
    assert_eq!(s.nav.href(), "/space/abc/board");
}

#[test]
fn overlay_reopens_where_it_was_left() {
    let mut s = screen(json!({ "params": {} }), "/space/abc/board");
    s.apply(ScreenOp::OpenShellView {
        id: "settings".to_string(),
        path: Some("/account".to_string()),
    });
    // The overlay's own router moves — the shell hears about it.
    s.shell.remember_shell_path("/appearance");
    s.apply(ScreenOp::CloseShellView);
    s.apply(ScreenOp::OpenShellView {
        id: "settings".to_string(),
        path: None,
    });
    assert_eq!(
        s.shell.overlay.as_ref().map(|o| o.path.as_deref()),
        Some(Some("/appearance"))
    );
}

#[test]
fn open_template_panel_reveals_it() {
    let mut s = screen(json!({ "params": {} }), "/space/abc/board");
    s.shell.panels_hidden = true;
    s.apply(ScreenOp::OpenShellView {
        id: "settings".to_string(),
        path: None,
    });
    s.apply(ScreenOp::OpenTemplatePanel {
        id: "inspector".to_string(),
    });
    // `revealDock`: panels back up, overlay closed.
    assert!(s.shell.panels["inspector"].open);
    assert!(!s.shell.panels_hidden);
    assert!(s.shell.overlay.is_none());
}

#[test]
fn reset_template_layout_clears_the_layout_overrides() {
    // `ShellStore.tsx:4803` deletes this template's placement / closed-panel
    // / lane overrides wholesale, so the declaration rules again — in both
    // directions: a panel opened over a `open: false` declaration re-closes.
    let mut s = screen(json!({ "params": {} }), "/space/abc/board");
    s.shell.panels.insert(
        "inspector".to_string(),
        we_screen::PanelState {
            open: true,
            maximised: true,
            width: Some(600),
        },
    );
    s.apply(ScreenOp::SetLaneCollapsed {
        lane: "tree".to_string(),
        collapsed: true,
    });
    assert!(s.shell.layout_dirty);

    assert_eq!(s.apply(ScreenOp::ResetTemplateLayout), Changed::Yes);
    assert!(
        s.shell.panels.is_empty() && s.shell.lanes.is_empty() && !s.shell.layout_dirty,
        "reset must clear the overrides, not retain them: {:?}",
        s.shell.panels
    );
    // The reset affordance is really off: a second reset is a no-op.
    assert_eq!(s.apply(ScreenOp::ResetTemplateLayout), Changed::No);
}

#[test]
fn close_then_reset_restores_the_declaration() {
    // `closeTemplatePanel` records a closed marker even where the override
    // map held none (`ShellStore.tsx:4594` writes `closedPanels[key] = true`
    // unconditionally), and `resetTemplateLayout` deletes it — a
    // declaration-open panel (coasys's `tree`) returns to its declaration.
    let mut s = screen(json!({ "params": {} }), "/space/abc/board");
    assert_eq!(
        s.apply(ScreenOp::CloseTemplatePanel {
            id: "tree".to_string()
        }),
        Changed::Yes,
        "recording a new closed marker is a change"
    );
    assert!(s.shell.layout_dirty);
    // Closing an already-closed override changes nothing further.
    assert_eq!(
        s.apply(ScreenOp::CloseTemplatePanel {
            id: "tree".to_string()
        }),
        Changed::No
    );
    assert_eq!(s.apply(ScreenOp::ResetTemplateLayout), Changed::Yes);
    assert!(
        s.shell.panels.is_empty() && !s.shell.layout_dirty,
        "the closed marker is an override — reset deletes it: {:?}",
        s.shell.panels
    );
    // And the affordance is really off again: a second reset is a no-op.
    assert_eq!(s.apply(ScreenOp::ResetTemplateLayout), Changed::No);
}

#[test]
fn reset_template_layout_clears_a_default_valued_marker() {
    // A host/persisted closed override whose dirty flag was never set: the
    // maps are overrides (absent = the declaration rules), so a
    // `PanelState::default()` entry is still something to delete — the no-op
    // criterion is empty maps, not "all entries happen to read default".
    let mut s = screen(json!({ "params": {} }), "/space/abc/board");
    s.shell
        .panels
        .insert("tree".to_string(), we_screen::PanelState::default());
    assert!(!s.shell.layout_dirty);
    assert_eq!(s.apply(ScreenOp::ResetTemplateLayout), Changed::Yes);
    assert!(s.shell.panels.is_empty());
}

#[test]
fn space_settings_tab_defaults_to_about() {
    let mut s = screen(json!({ "params": {} }), "/space/abc/board");
    s.apply(ScreenOp::OpenSpaceSettings {
        tab: None,
        focus: None,
    });
    assert_eq!(
        s.shell.space_settings.as_ref().map(|d| d.tab.as_str()),
        Some("about")
    );
    s.apply(ScreenOp::ToggleSpaceSettings);
    assert!(s.shell.space_settings.is_none());
}

// --- prefs (brief test 6) ---------------------------------------------------

#[test]
fn file_prefs_survive_a_reload() {
    let dir = std::env::temp_dir().join(format!("we-screen-prefs-{}", std::process::id()));
    let path = dir.join("prefs.json");
    {
        let mut prefs = FilePrefs::load(&path);
        prefs.set("we-local:view-sort", Some("\"top\""));
    }
    let prefs = FilePrefs::load(&path);
    assert_eq!(prefs.get("we-local:view-sort").as_deref(), Some("\"top\""));
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn corrupt_prefs_file_reads_empty() {
    let dir = std::env::temp_dir().join(format!("we-screen-prefs-bad-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("prefs.json");
    std::fs::write(&path, "{ not json").unwrap();
    let prefs = FilePrefs::load(&path);
    assert_eq!(prefs.get("anything"), None);
    std::fs::remove_dir_all(&dir).ok();
}

// --- ScreenOp names + version (brief points) --------------------------------

#[test]
fn op_names_table_is_complete() {
    // The match in `name()` is exhaustive, so coverage is compile-checked;
    // this proves the table holds every variant's name exactly once.
    let ops = [
        ScreenOp::Navigate {
            to: String::new(),
            query: None,
            base_depth: None,
            replace: false,
        },
        ScreenOp::SetParam {
            name: String::new(),
            value: None,
            push: None,
        },
        ScreenOp::Back,
        ScreenOp::Forward,
        ScreenOp::Open {
            href: String::new(),
        },
        ScreenOp::OpenShellView {
            id: String::new(),
            path: None,
        },
        ScreenOp::CloseShellView,
        ScreenOp::OpenSpaceSettings {
            tab: None,
            focus: None,
        },
        ScreenOp::ToggleSpaceSettings,
        ScreenOp::OpenTemplatePanel { id: String::new() },
        ScreenOp::CloseTemplatePanel { id: String::new() },
        ScreenOp::SetLaneCollapsed {
            lane: String::new(),
            collapsed: false,
        },
        ScreenOp::SetDialog {
            name: "create_space".to_string(),
            open: true,
        },
        ScreenOp::SetCurrentTheme {
            theme: String::new(),
        },
        ScreenOp::ResetTemplateLayout,
        ScreenOp::SetPref {
            key: String::new(),
            value: None,
        },
    ];
    assert_eq!(ops.len(), OP_NAMES.len());
    for op in &ops {
        assert!(
            OP_NAMES.contains(&op.name()),
            "{:?} is missing from OP_NAMES",
            op.name()
        );
    }
    // And no name is duplicated.
    let mut unique = OP_NAMES.to_vec();
    unique.sort_unstable();
    unique.dedup();
    assert_eq!(unique.len(), OP_NAMES.len());
}

#[test]
fn version_moves_once_per_change_and_never_on_noops() {
    let mut s = screen(json!({ "params": {} }), "/space/abc/board");
    assert_eq!(s.version, 0);
    // A change: one bump.
    assert_eq!(
        s.apply(ScreenOp::Navigate {
            to: "~/wall".to_string(),
            query: None,
            base_depth: None,
            replace: false,
        }),
        Changed::Yes
    );
    assert_eq!(s.version, 1);
    // Navigate to the current address: rule 3 no-op, no bump.
    assert_eq!(
        s.apply(ScreenOp::Navigate {
            to: "/space/abc/wall".to_string(),
            query: None,
            base_depth: None,
            replace: false,
        }),
        Changed::No
    );
    assert_eq!(s.version, 1);
    // Back at the start of a fresh stack: no bump either.
    let mut s2 = screen(json!({ "params": {} }), "/space/abc/board");
    assert_eq!(s2.apply(ScreenOp::Back), Changed::No);
    assert_eq!(s2.version, 0);
    // Same-value writes: no bump.
    s2.apply(ScreenOp::SetCurrentTheme {
        theme: "light".to_string(),
    });
    let v = s2.version;
    s2.apply(ScreenOp::SetCurrentTheme {
        theme: "light".to_string(),
    });
    assert_eq!(s2.version, v);
}

#[test]
fn set_param_falls_to_the_declared_push_default() {
    // `tree` declares `push: true`; an op that does not say follows it.
    let mut s = screen(
        json!({ "params": { "tree": { "type": "boolean", "push": true } } }),
        "/space/abc/board",
    );
    s.apply(ScreenOp::SetParam {
        name: "tree".to_string(),
        value: Some("true".to_string()),
        push: None,
    });
    assert_eq!(s.nav.depth(), 2);
    // An explicit `push: false` overrides the declaration.
    s.apply(ScreenOp::SetParam {
        name: "tree".to_string(),
        value: Some("false".to_string()),
        push: Some(false),
    });
    assert_eq!(s.nav.depth(), 2);
    // And a param with no declared push replaces — `routeStore.setParam`'s
    // own default (nav.set-param-replace, in op form).
    let mut s2 = screen(
        json!({ "params": { "sel": { "type": "string" } } }),
        "/space/abc/board",
    );
    s2.apply(ScreenOp::SetParam {
        name: "sel".to_string(),
        value: Some("r:1".to_string()),
        push: None,
    });
    assert_eq!(s2.nav.depth(), 1);
}

#[test]
fn remembered_query_updates_on_every_report() {
    // rule 4: back and open report locations too — the remembered map hears
    // about them, and a bare-path navigate restores them.
    let mut s = screen(json!({ "params": {} }), "/space/abc/board?sort=top");
    s.apply(ScreenOp::Navigate {
        to: "~/wall".to_string(),
        query: None,
        base_depth: None,
        replace: false,
    });
    // `open` reporting a different query on `wall` is heard as well.
    s.apply(ScreenOp::Open {
        href: "/space/abc/wall?mode=grid".to_string(),
    });
    s.apply(ScreenOp::Navigate {
        to: "~/board".to_string(),
        query: None,
        base_depth: None,
        replace: false,
    });
    assert_eq!(s.nav.href(), "/space/abc/board?sort=top");
    s.apply(ScreenOp::Navigate {
        to: "~/wall".to_string(),
        query: None,
        base_depth: None,
        replace: false,
    });
    assert_eq!(s.nav.href(), "/space/abc/wall?mode=grid");
}

// --- the navigation boundary: `new URL(to, href)` semantics ----------------
// The pure `resolve_path` stays literal (paths.json pins it); these pin what
// the boundary then does — `recordNavigation.ts:150`'s `new URL(call.to,
// window.location.href)`, which `Navigator` must land identically.

#[test]
fn fragment_navigation_keeps_the_query() {
    // A bare `#fragment` stays on this page — pathname *and* search, not just
    // the path (`new URL('#top', href)` moves only the hash).
    let mut s = screen(
        json!({ "params": { "id": { "type": "id", "identity": true } } }),
        "/space/abc/board?id=we://r/1&sort=top",
    );
    s.apply(ScreenOp::Navigate {
        to: "#top".to_string(),
        query: None,
        base_depth: None,
        replace: false,
    });
    assert_eq!(s.nav.href(), "/space/abc/board?id=we://r/1&sort=top#top");
    assert_eq!(s.nav.page_identity(), "/space/abc/board?id=we://r/1");
    assert_eq!(s.nav.depth(), 2);
    // Back restores the whole pre-fragment address, query included.
    assert_eq!(s.apply(ScreenOp::Back), Changed::Yes);
    assert_eq!(s.nav.href(), "/space/abc/board?id=we://r/1&sort=top");
    assert_eq!(s.nav.page_identity(), "/space/abc/board?id=we://r/1");
}

#[test]
fn fragment_navigation_replaces_the_old_fragment() {
    let mut s = screen(json!({ "params": {} }), "/space/abc/board?sort=top#old");
    s.apply(ScreenOp::Navigate {
        to: "#new".to_string(),
        query: None,
        base_depth: None,
        replace: false,
    });
    assert_eq!(s.nav.href(), "/space/abc/board?sort=top#new");
}

#[test]
fn interior_dot_segments_resolve_at_the_url_boundary() {
    // The edge.double-dot-seg input, end to end: resolve_path answers
    // literally (paths.json pins that), and the navigation boundary —
    // new URL('/space/abc/board/a/../b', href) — lands on /space/abc/board/b.
    let mut s = screen(
        json!({ "params": { "id": { "type": "id", "identity": true } } }),
        "/space/abc/board?id=ad4m://obj/x",
    );
    assert_eq!(
        s.nav
            .resolve("a/../b", we_screen::PathBase { depth: 3, root: 2 }),
        "/space/abc/board/a/../b"
    );
    s.apply(ScreenOp::Navigate {
        to: "a/../b".to_string(),
        query: None,
        base_depth: Some(3),
        replace: false,
    });
    assert_eq!(s.nav.href(), "/space/abc/board/b");
    assert_eq!(s.nav.segments().join("/"), "space/abc/board/b");
    assert_eq!(s.nav.page_identity(), "/space/abc/board/b");
    // Back returns to the queried board.
    assert_eq!(s.apply(ScreenOp::Back), Changed::Yes);
    assert_eq!(s.nav.href(), "/space/abc/board?id=ad4m://obj/x");
}

#[test]
fn open_and_traverse_normalize_the_location() {
    // The same boundary covers every way a location arrives: a deep link,
    // a --route flag, a popstate — replaceState parses the text too.
    let mut s = screen(json!({ "params": {} }), "/space/abc/board");
    s.apply(ScreenOp::Open {
        href: "/x/../y?k=v".to_string(),
    });
    assert_eq!(s.nav.href(), "/y?k=v");
    // `..` cannot climb above the root.
    s.apply(ScreenOp::Open {
        href: "/a/../../b".to_string(),
    });
    assert_eq!(s.nav.href(), "/b");
    // And `.` segments drop the same way.
    s.apply(ScreenOp::Open {
        href: "/a/./b".to_string(),
    });
    assert_eq!(s.nav.href(), "/a/b");
}

// --- JS semantics: JSON.stringify property order --------------------------

#[test]
fn js_stringify_orders_integer_index_keys_first() {
    use indexmap::IndexMap;
    use std::sync::Arc;
    use we_expr::Value;
    // JS own-property order: canonical integer indices ascend first, the
    // rest keep insertion order — "01" is not an index.
    let mut o: IndexMap<Arc<str>, Value> = IndexMap::new();
    for (k, v) in [("2", "b"), ("1", "a"), ("x", "z"), ("10", "j"), ("01", "l")] {
        o.insert(Arc::from(k), Value::Str(v.into()));
    }
    let got = we_screen::js_json_stringify(&Value::Obj(Arc::new(o))).unwrap();
    assert_eq!(got, r#"{"1":"a","2":"b","10":"j","x":"z","01":"l"}"#);
}

#[test]
fn back_at_initial_clears_the_param_despite_member_order() {
    use indexmap::IndexMap;
    use std::sync::Arc;
    use we_expr::Value;
    // The mirror decides by JSON text — a value written ("2","1") is the
    // same default as one declared ("1","2") once JS orders the keys.
    let obj = |pairs: &[(&str, &str)]| {
        Value::Obj(Arc::new(
            pairs
                .iter()
                .map(|(k, v)| (Arc::from(*k), Value::Str((*v).into())))
                .collect::<IndexMap<Arc<str>, Value>>(),
        ))
    };
    let value = obj(&[("2", "b"), ("1", "a")]);
    let initial = obj(&[("1", "a"), ("2", "b")]);
    assert_eq!(
        we_screen::local_param_text("object", &value, &initial),
        None,
        "JSON.stringify equal — the value is back at its declared initial"
    );
}

#[test]
fn bag_reads_the_template_names_as_strings() {
    use we_expr::{Namespace, Value};
    let mut s = screen(
        json!({ "params": { "id": { "type": "id", "identity": true } } }),
        "/space/abc/board/cards?id=we://r/1",
    );
    s.apply(ScreenOp::SetDialog {
        name: "create_space".to_string(),
        open: true,
    });
    s.apply(ScreenOp::SetCurrentTheme {
        theme: "dark".to_string(),
    });
    let bag = s.bag();
    let nav = bag.get("nav");
    let shell = bag.get("shell");
    let theme = bag.get("theme");
    let Value::Namespace(nav) = nav else {
        panic!("nav should be a namespace")
    };
    let Value::Namespace(shell) = shell else {
        panic!("shell should be a namespace")
    };
    let Value::Namespace(theme) = theme else {
        panic!("theme should be a namespace")
    };
    // Params come back as the strings the URL carries — never typed values.
    let params = nav.get("params");
    let Value::Namespace(params) = params else {
        panic!("params should be a namespace")
    };
    let eq = |got: Value, want: &str| got.strict_eq(&Value::Str(want.into()));
    assert!(eq(params.get("id"), "we://r/1"));
    assert!(eq(nav.get("currentPath"), "/space/abc/board/cards"));
    assert!(eq(nav.get("page"), "/space/abc/board/cards?id=we://r/1"));
    assert!(eq(nav.get("spacePath"), "/space/abc"));
    assert!(shell.get("createSpaceOpen").strict_eq(&Value::Bool(true)));
    assert!(shell.get("joinSpaceOpen").strict_eq(&Value::Bool(false)));
    assert!(eq(theme.get("currentThemeId"), "dark"));
}
