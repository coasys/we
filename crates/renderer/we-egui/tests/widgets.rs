//! Per-type coverage for the E5a batch: every widget paints and is
//! AccessKit-discoverable; the evented ones (button, tag, tree) push
//! their handler payloads through `PaintCx::emit`.
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use egui_kittest::kittest::Queryable;
use indexmap::IndexMap;
use we_egui::{
    format_date, format_relative, layout, paint, parse_date, EditState, MeasureCx, Registry,
    StyleCx, WidgetEvent,
};
use we_template::{HandlerRef, NodeId, ResolvedChild, ResolvedNode, Scope};

type Shared = Rc<RefCell<(Vec<WidgetEvent>, EditState)>>;

fn node(ty: &str, id: &str, props: &[(&str, we_expr::Value)]) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from(id),
        ty: Arc::from(ty),
        props: props
            .iter()
            .map(|(k, v)| (Arc::from(*k), v.clone()))
            .collect::<IndexMap<Arc<str>, we_expr::Value>>(),
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        transition: None,
    }
}

fn s(v: &str) -> we_expr::Value {
    we_expr::Value::from(v)
}

fn b(v: bool) -> we_expr::Value {
    we_expr::Value::from(v)
}

fn handler() -> HandlerRef {
    HandlerRef {
        tokens: vec![],
        scope: Scope::default(),
    }
}

fn obj(pairs: &[(&str, we_expr::Value)]) -> we_expr::Value {
    we_expr::Value::from(
        pairs
            .iter()
            .map(|(k, v)| (Arc::from(*k), v.clone()))
            .collect::<IndexMap<Arc<str>, we_expr::Value>>(),
    )
}

/// Render `root` in a kittest harness; returns it plus the frame's events
/// and the widget-owned edit state.
fn render(root: ResolvedNode) -> (egui_kittest::Harness<'static>, Shared) {
    let registry = Registry::with_builtins();
    let state: Shared = Rc::new(RefCell::new((Vec::new(), EditState::default())));
    let state2 = state.clone();
    let harness = egui_kittest::Harness::new_ui(move |ui| {
        let ctx = ui.ctx().clone();
        we_egui::install_media(&ctx);
        let scx = StyleCx::empty();
        let lay = layout(
            &MeasureCx::new(&ctx),
            &scx,
            &registry,
            &root,
            egui::Rect::from_min_size(ui.cursor().min, egui::vec2(400.0, 600.0)),
        );
        let (events, edit) = &mut *state2.borrow_mut();
        paint(ui, &registry, &scx, &root, &lay, events, edit, 1_000.0);
    });
    (harness, state)
}

fn events(state: &Shared) -> Vec<(String, String)> {
    state
        .borrow()
        .0
        .iter()
        .map(|e| (e.node.as_str().to_string(), e.handler.to_string()))
        .collect()
}

#[test]
fn text_paints_and_is_labeled() {
    let n = node("we-text", "t", &[("text", s("hello world"))]);
    let (mut h, _) = render(n);
    h.run();
    h.get_by_label("hello world");
}

#[test]
fn link_paints_label() {
    let n = node(
        "we-link",
        "l",
        &[("text", s("click me")), ("href", s("https://x"))],
    );
    let (mut h, _) = render(n);
    h.run();
    h.get_by_label("click me");
}

#[test]
fn timestamp_shows_date() {
    let n = node(
        "we-timestamp",
        "ts",
        &[("value", s("2026-06-24T10:30:00Z"))],
    );
    let (mut h, _) = render(n);
    h.run();
    h.get_by_label("Jun 24, 2026");
}

#[test]
fn typewriter_types_text() {
    let n = node(
        "we-typewriter",
        "tw",
        &[
            ("text", s("pre ")),
            ("phrases", we_expr::Value::from(vec![s("abc")])),
        ],
    );
    let (mut h, _) = render(n);
    // The animation repaints every frame — step rather than run-to-settle.
    h.run_steps(2);
    h.get_by_label_contains("pre");
}

#[test]
fn media_widgets_paint() {
    for (ty, label, props) in [
        (
            "we-icon",
            "icon rocket",
            vec![("name", s("rocket")), ("size", we_expr::Value::from(24.0))],
        ),
        (
            "we-avatar",
            "AL",
            vec![
                ("name", s("Ada Lovelace")),
                ("size", we_expr::Value::from(32.0)),
            ],
        ),
        (
            "we-animated-icon",
            "animated icon circle-notch",
            vec![("name", s("circle-notch"))],
        ),
    ] {
        let n = node(ty, "m", &props);
        let (mut h, _) = render(n);
        h.run_steps(2);
        h.get_by_label(label);
    }
}

#[test]
fn avatar_stack_renders_members() {
    let n = node(
        "AvatarStack",
        "as",
        &[(
            "avatars",
            we_expr::Value::from(vec![
                obj(&[("id", s("a")), ("label", s("Ada"))]),
                obj(&[("id", s("b")), ("label", s("Grace"))]),
            ]),
        )],
    );
    let (mut h, _) = render(n);
    h.run();
    h.get_by_label("Ada");
}

#[test]
fn button_click_emits_on_click() {
    let mut n = node("we-button", "b", &[("text", s("press"))]);
    n.handlers.insert(Arc::from("onClick"), handler());
    let (mut h, st) = render(n);
    h.run();
    h.get_by_label("press").click();
    h.run();
    assert_eq!(events(&st), vec![("b".to_string(), "onClick".to_string())]);
}

#[test]
fn disabled_button_does_not_emit() {
    let mut n = node(
        "we-button",
        "b",
        &[("text", s("nope")), ("disabled", b(true))],
    );
    n.handlers.insert(Arc::from("onClick"), handler());
    let (mut h, st) = render(n);
    h.run();
    h.get_by_label("nope").click();
    h.run();
    assert!(events(&st).is_empty());
}

#[test]
fn tag_dismiss_emits() {
    let mut tag = node(
        "we-tag",
        "tag",
        &[("text", s("t")), ("dismissible", b(true))],
    );
    tag.handlers.insert(Arc::from("onDismiss"), handler());
    let (mut h, st) = render(tag);
    h.run();
    h.get_by_label("dismiss").click();
    h.run();
    assert_eq!(
        events(&st),
        vec![("tag".to_string(), "onDismiss".to_string())]
    );
}

#[test]
fn tree_select_emits() {
    let mut tree = node("we-tree", "tree", &[("selected", s("a"))]);
    let mut parent = node(
        "we-tree-item",
        "i1",
        &[("label", s("parent")), ("value", s("a")), ("open", b(true))],
    );
    let mut child = node(
        "we-tree-item",
        "i2",
        &[("label", s("kid")), ("value", s("b"))],
    );
    child.slot = Some("children".into());
    child.handlers.insert(Arc::from("onSelect"), handler());
    parent.children = vec![ResolvedChild::Node(Box::new(child))];
    parent.handlers.insert(Arc::from("onSelect"), handler());
    tree.children = vec![ResolvedChild::Node(Box::new(parent))];
    let (mut h, st) = render(tree);
    h.run();
    h.get_by_label("kid").click();
    h.run();
    let evs = events(&st);
    assert!(
        evs.contains(&("i2".to_string(), "onSelect".to_string())),
        "select emitted: {evs:?}"
    );
}

#[test]
fn placeholders_paint() {
    for ty in ["GraphView", "we-video", "EditableImage"] {
        let n = node(ty, "p", &[]);
        let (mut h, _) = render(n);
        h.run();
        h.get_by_label(ty);
    }
}

// ---- pure-function tables -------------------------------------------------

#[test]
fn timestamp_formats() {
    let ms = parse_date(&s("2026-06-24T10:30:00Z")).unwrap();
    assert_eq!(format_date(ms, "medium", None), "Jun 24, 2026");
    // Under a minute is "now" (no seconds tier — a documented approximation).
    assert_eq!(format_relative(ms - 30_000.0, ms, "long"), "now");
    assert_eq!(format_relative(ms - 120_000.0, ms, "long"), "2 minutes ago");
    assert_eq!(format_relative(ms - 3_600_000.0, ms, "long"), "1 hour ago");
    assert_eq!(format_relative(ms + 86_400_000.0, ms, "short"), "tomorrow");
    assert_eq!(format_relative(ms - 86_400_000.0, ms, "long"), "yesterday");
}

#[test]
fn grid_columns_land() {
    // An auto-width grid shrink-wraps its tracks (CSS rules); pin the width
    // so `repeat(2, 1fr)` splits the 200px box.
    let mut grid = node(
        "Grid",
        "g",
        &[
            ("columns", we_expr::Value::from(2.0)),
            ("gap", s("8px")),
            ("width", s("200px")),
        ],
    );
    for (id, txt) in [("g/a", "one"), ("g/b", "two")] {
        let mut c = node("div", id, &[("height", s("20px"))]);
        c.children = vec![ResolvedChild::Text(Arc::from(txt))];
        grid.children.push(ResolvedChild::Node(Box::new(c)));
    }
    let registry = Registry::with_builtins();
    let out = RefCell::new(None);
    let mut h = egui_kittest::Harness::new_ui(|ui| {
        let cx = MeasureCx::new(ui.ctx());
        *out.borrow_mut() = Some(layout(
            &cx,
            &StyleCx::empty(),
            &registry,
            &grid,
            egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(200.0, 100.0)),
        ));
    });
    h.run();
    let lay = out.borrow_mut().take().unwrap();
    let a = lay.rects[&NodeId::from("g/a")];
    let b = lay.rects[&NodeId::from("g/b")];
    // Two equal columns: a in the left half, b in the right.
    assert!(a.max.x <= 101.0, "a {a:?}");
    assert!(b.min.x >= 99.0, "b {b:?}");
}
