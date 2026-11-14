//! E5b widgets — one `egui_kittest` case per type, plus the interaction
//! contracts the brief pins: controlled inputs (prop wins), the modal's
//! close paths and input blocking, popover/menu dismissal, number-input
//! clamp-on-blur, and sortable's drop-only reorder.
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use egui_kittest::{kittest::Queryable, Harness};
use indexmap::IndexMap;
use we_egui::{layout, paint, EditState, MeasureCx, Registry, StyleCx, WidgetEvent};
use we_expr::Value;
use we_template::{HandlerRef, NodeId, ResolvedChild, ResolvedNode};

type Shared<T> = Rc<RefCell<T>>;

/// The recorded light token table — geometry props (`p="400"`, `gap="300"`)
/// resolve to real pixels through it; the kittest cases assert layout, not
/// colour.
fn tokens() -> we_style::TokenTable {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/schema-system/conformance/vectors/tokens/light.json");
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    we_style::TokenTable::from_json(&json).unwrap()
}

fn props(list: &[(&str, Value)]) -> IndexMap<Arc<str>, Value> {
    list.iter()
        .map(|(k, v)| (Arc::from(*k), v.clone()))
        .collect()
}

fn handlers(list: &[&str]) -> IndexMap<Arc<str>, HandlerRef> {
    list.iter()
        .map(|k| {
            (
                Arc::from(*k),
                HandlerRef {
                    tokens: vec![],
                    scope: Default::default(),
                },
            )
        })
        .collect()
}

fn node(ty: &str, id: &str, props: IndexMap<Arc<str>, Value>) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from(id),
        ty: Arc::from(ty),
        props,
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        transition: None,
    }
}

fn s(v: &str) -> Value {
    Value::Str(Arc::from(v))
}
fn n(v: f64) -> Value {
    Value::Num(v)
}
fn b(v: bool) -> Value {
    Value::Bool(v)
}

/// A live rig: the resolved tree re-lays-out and re-paints every frame, so
/// mutating `node` is how a "re-resolution" arrives, and `events` /
/// `edit` show what the widget reported and remembers.
struct Rig {
    node: Rc<RefCell<ResolvedNode>>,
    events: Shared<Vec<WidgetEvent>>,
    edit: Shared<EditState>,
}

fn rig(root: ResolvedNode) -> (Harness<'static>, Rig) {
    let events = Rc::new(RefCell::new(Vec::new()));
    let edit = Rc::new(RefCell::new(EditState::default()));
    let root = Rc::new(RefCell::new(root));
    let reg = Registry::with_builtins();
    let table = tokens();
    let (e, d, n) = (events.clone(), edit.clone(), root.clone());
    let harness = Harness::builder()
        .with_size(egui::vec2(400.0, 400.0))
        .with_context_setup(|ctx| ctx.set_fonts(egui::FontDefinitions::default()))
        .build_ui(move |ui| {
            let cx = MeasureCx::new(ui.ctx());
            let n = n.borrow();
            let rect = ui.available_rect_before_wrap();
            let scx = StyleCx {
                tokens: &table,
                viewport: we_style::Size::new(rect.width(), rect.height()),
                container_width: rect.width(),
            };
            let lay = layout(&cx, &scx, &reg, &n, rect);
            // Events accumulate across frames — a later re-paint does not
            // erase what an earlier interaction emitted.
            paint(
                ui,
                &reg,
                &scx,
                &n,
                &lay,
                &mut e.borrow_mut(),
                &mut d.borrow_mut(),
                0.0,
            );
        });
    (
        harness,
        Rig {
            node: root,
            events,
            edit,
        },
    )
}

fn details(rig: &Rig, handler: &str) -> Vec<Value> {
    rig.events
        .borrow()
        .iter()
        .filter(|e| e.handler.as_ref() == handler)
        .map(|e| e.value.clone())
        .collect()
}

/// `assert!(got.strict_eq(&expected))`, spelled for a `handler`'s last
/// `detail`.
fn assert_detail(rig: &Rig, handler: &str, expected: Value) {
    let got = last_detail(rig, handler);
    assert!(
        got.strict_eq(&expected),
        "{handler} detail: got {got:?}, want {expected:?}"
    );
}

/// `event.detail` of the last `handler` event.
fn last_detail(rig: &Rig, handler: &str) -> Value {
    match details(rig, handler).last() {
        Some(Value::Obj(m)) => m.get("detail").cloned().unwrap_or(Value::Undefined),
        _ => Value::Undefined,
    }
}

// ---------- inputs -------------------------------------------------------

#[test]
fn input_emits_oninput_detail_and_shows_prop() {
    let mut inp = node(
        "we-input",
        "in",
        props(&[("label", s("Name")), ("value", s(""))]),
    );
    inp.handlers = handlers(&["onInput", "onChange", "onKeyDown"]);
    let (mut h, r) = rig(inp);
    h.run();
    let field = h.get_by_label("Name");
    field.click();
    field.type_text("ab");
    h.step();
    // The runtime accepts: the handler writes the detail back into `value`.
    r.node
        .borrow_mut()
        .props
        .insert("value".into(), last_detail(&r, "onInput"));
    h.run();
    assert_detail(&r, "onInput", s("ab"));
    assert_eq!(h.get_by_label("Name").value().as_deref(), Some("ab"));
}

#[test]
fn controlled_input_prop_wins_over_draft() {
    // The handler rejects the change: the prop comes back unchanged and the
    // buffer must follow it, not the draft.
    let mut inp = node(
        "we-input",
        "in",
        props(&[("label", s("Name")), ("value", s("keep"))]),
    );
    inp.handlers = handlers(&["onInput"]);
    let (mut h, r) = rig(inp);
    h.run();
    let f = h.get_by_label("Name");
    f.click();
    f.type_text("x");
    h.step();
    assert_detail(&r, "onInput", s("keepx"));
    // Re-resolve with the rejected prop → the draft is dropped.
    r.node.borrow_mut().props.insert("value".into(), s("keep"));
    h.run();
    assert_eq!(h.get_by_label("Name").value().as_deref(), Some("keep"));
    assert!(r.edit.borrow().draft(&NodeId::from("in")).is_none());
}

#[test]
fn input_keydown_reports_key_code_and_enter_commits_change() {
    let mut inp = node(
        "we-input",
        "in",
        props(&[("label", s("Name")), ("value", s(""))]),
    );
    inp.handlers = handlers(&["onInput", "onChange", "onKeyDown"]);
    let (mut h, r) = rig(inp);
    h.run();
    let f = h.get_by_label("Name");
    f.click();
    f.type_text("a");
    h.key_press(egui::Key::Enter);
    h.run();
    let kd = details(&r, "onKeyDown");
    let last = kd.last().and_then(|v| match v {
        Value::Obj(m) => m.get("detail").cloned(),
        _ => None,
    });
    let Some(Value::Obj(d)) = last else {
        panic!("onKeyDown did not fire: {kd:?}")
    };
    assert!(d.get("key").is_some_and(|v| v.strict_eq(&s("Enter"))));
    assert!(d.get("isComposing").is_some_and(|v| v.strict_eq(&b(false))));
    assert_detail(&r, "onChange", s("a"));
}

#[test]
fn textarea_emits_oninput() {
    let mut ta = node(
        "we-textarea",
        "ta",
        props(&[("label", s("Body")), ("value", s(""))]),
    );
    ta.handlers = handlers(&["onInput"]);
    let (mut h, r) = rig(ta);
    h.run();
    let f = h.get_by_label("Body");
    f.click();
    f.type_text("hi");
    h.step();
    r.node
        .borrow_mut()
        .props
        .insert("value".into(), last_detail(&r, "onInput"));
    h.run();
    assert_detail(&r, "onInput", s("hi"));
}

#[test]
fn select_emits_option_value() {
    let mut sel = node(
        "we-select",
        "sel",
        props(&[
            ("label", s("Pick")),
            ("value", s("a")),
            (
                "options",
                Value::List(Arc::new(vec![
                    Value::Obj(Arc::new(props(&[("value", s("a")), ("label", s("Alpha"))]))),
                    Value::Obj(Arc::new(props(&[("value", s("b")), ("label", s("Beta"))]))),
                ])),
            ),
        ]),
    );
    sel.handlers = handlers(&["onChange"]);
    let (mut h, r) = rig(sel);
    h.run();
    h.get_by_label("Pick").click();
    h.run();
    h.get_by_label("Beta").click();
    h.run();
    assert_detail(&r, "onChange", s("b"));
}

#[test]
fn switch_emits_next_state() {
    let mut sw = node(
        "we-switch",
        "sw",
        props(&[("label", s("Enable")), ("checked", b(false))]),
    );
    sw.handlers = handlers(&["onChange"]);
    let (mut h, r) = rig(sw);
    h.run();
    h.get_by_label("Enable").click();
    h.run();
    assert_detail(&r, "onChange", b(true));
}

#[test]
fn switch_pill_stays_inside_the_column() {
    // A switch in a padded column: the pill must start at the column's
    // inner edge, never spill left of it (it did — centred on the edge).
    let mut col = node("Column", "col", props(&[("p", s("400"))]));
    let sw = node(
        "we-switch",
        "sw",
        props(&[("label", s("Enable")), ("checked", b(true))]),
    );
    col.children = vec![ResolvedChild::Node(Box::new(sw))];
    let (mut h, _r) = rig(col);
    h.run();
    let col_rect = h.get_by_label("Column").rect();
    let sw_rect = h.get_by_label("Enable").rect();
    assert!(
        sw_rect.min.x >= col_rect.min.x + 16.0 - 0.01,
        "pill {sw_rect:?} must start at the column's inner edge {col_rect:?}"
    );
    assert!(
        sw_rect.min.x >= col_rect.min.x && sw_rect.max.x <= col_rect.max.x,
        "pill {sw_rect:?} must lie inside the column {col_rect:?}"
    );
}

#[test]
fn slider_drag_emits_oninput() {
    let mut sl = node(
        "we-slider",
        "sl",
        props(&[
            ("label", s("Amount")),
            ("value", n(0.0)),
            ("min", n(0.0)),
            ("max", n(100.0)),
        ]),
    );
    sl.handlers = handlers(&["onInput", "onChange"]);
    let (mut h, r) = rig(sl);
    h.run();
    let rect = h.get_by_label("Amount").rect();
    let target = egui::pos2(rect.min.x + rect.width() * 0.5, rect.center().y);
    h.drag_at(rect.left_center());
    h.step();
    h.hover_at(target);
    h.step();
    h.drop_at(target);
    h.run();
    let v = last_detail(&r, "onInput");
    let Value::Num(got) = v else {
        panic!("no onInput: {v:?}")
    };
    assert!((got - 50.0).abs() < 10.0, "slider near mid, got {got}");
}

#[test]
fn number_input_clamps_on_blur_not_keystroke() {
    let mut ni = node(
        "we-number-input",
        "ni",
        props(&[("label", s("Count")), ("value", n(0.0)), ("max", n(5.0))]),
    );
    ni.handlers = handlers(&["onChange"]);
    let (mut h, r) = rig(ni);
    h.run();
    let f = h.get_by_label("Count");
    f.click();
    f.type_text("9");
    h.step();
    // While typing: no onChange, the buffer keeps "9".
    assert!(details(&r, "onChange").is_empty());
    assert_eq!(h.get_by_label("Count").value().as_deref(), Some("09"));
    // Enter surrenders the single-line edit's focus — the blur path.
    h.key_press(egui::Key::Enter);
    h.run();
    // Blur commits, clamped to max.
    assert_detail(&r, "onChange", n(5.0));
}

#[test]
fn number_input_steppers_respect_bounds() {
    let mut ni = node(
        "we-number-input",
        "ni",
        props(&[
            ("label", s("Count")),
            ("value", n(5.0)),
            ("max", n(5.0)),
            ("step", n(1.0)),
        ]),
    );
    ni.handlers = handlers(&["onChange"]);
    let (mut h, r) = rig(ni);
    h.run();
    h.get_by_label("increment").click();
    h.run();
    assert_detail(&r, "onChange", n(5.0));
    h.get_by_label("decrement").click();
    h.run();
    assert_detail(&r, "onChange", n(4.0));
}

#[test]
fn number_input_row_shares_one_height() {
    // [−] [ text ] [+] is one band: the steppers are the row's height and
    // the field matches them, with every centre on the same line.
    let ni = node(
        "we-number-input",
        "ni",
        props(&[("label", s("Count")), ("value", n(3.0))]),
    );
    let (mut h, _r) = rig(ni);
    h.run();
    let minus = h.get_by_label("decrement").rect();
    let plus = h.get_by_label("increment").rect();
    let field = h.get_by_label("Count").rect();
    for (name, a, b) in [
        ("minus/field", minus, field),
        ("field/plus", field, plus),
        ("minus/plus", minus, plus),
    ] {
        assert!(
            (a.height() - b.height()).abs() < 0.5,
            "{name} heights differ: {a:?} vs {b:?}"
        );
        assert!(
            (a.center().y - b.center().y).abs() < 0.5,
            "{name} centres misaligned: {a:?} vs {b:?}"
        );
    }
    // The glyph itself sits on that line — the AccessKit `TextRun` child
    // carries the text row's real bounds.
    let run = h
        .get_all_by_role(egui::accesskit::Role::TextRun)
        .find(|n| n.value().as_deref() == Some("3"))
        .expect("a TextRun node for the field's value");
    let run = run.rect();
    assert!(
        (run.center().y - field.center().y).abs() < 1.0,
        "text baseline off the row: glyph {run:?} vs field {field:?}"
    );
    // WE centres the digit in the well (`text-align: center`); egui's atom
    // layout keeps a few px for the trailing slot, so it lands ~4px shy of
    // dead centre — assert it's close, and fully inside the field.
    assert!(
        (run.center().x - field.center().x).abs() < 6.0,
        "digit far from the field's centre: glyph {run:?} vs field {field:?}"
    );
    assert!(field.contains_rect(run), "glyph {run:?} outside {field:?}");
}

#[test]
fn form_field_passes_label_to_control() {
    let mut field = node(
        "we-form-field",
        "ff",
        props(&[("label", s("Email")), ("error", s("required"))]),
    );
    let mut inp = node("we-input", "ff/in", props(&[("value", s(""))]));
    inp.handlers = handlers(&["onInput"]);
    field.children = vec![ResolvedChild::Node(Box::new(inp))];
    let (mut h, _r) = rig(field);
    h.run();
    // The slotted control answers to the field's label.
    assert!(h.query_by_label("Email").is_some());
}

// ---------- overlays -----------------------------------------------------

fn modal_tree(open: bool) -> ResolvedNode {
    let mut root = node("Column", "root", props(&[]));
    let mut under = node(
        "we-button",
        "root/under",
        props(&[
            ("label", s("Under")),
            ("width", n(400.0)),
            ("height", n(400.0)),
        ]),
    );
    under.handlers = handlers(&["onClick"]);
    let mut modal = node(
        "we-modal",
        "root/modal",
        props(&[("open", b(open)), ("title", s("Dialog"))]),
    );
    modal.handlers = handlers(&["close"]);
    let mut inside = node(
        "we-button",
        "root/modal/in",
        props(&[("label", s("Inside"))]),
    );
    inside.handlers = handlers(&["onClick"]);
    modal.children = vec![ResolvedChild::Node(Box::new(inside))];
    root.children = vec![
        ResolvedChild::Node(Box::new(under)),
        ResolvedChild::Node(Box::new(modal)),
    ];
    root
}

#[test]
fn modal_closed_paints_nothing() {
    let (mut h, _r) = rig(modal_tree(false));
    h.run();
    assert!(h.query_by_label("Inside").is_none());
    assert!(h.query_by_label("Under").is_some());
}

#[test]
fn modal_opens_and_inside_click_stays() {
    let (mut h, r) = rig(modal_tree(true));
    h.run();
    h.get_by_label("Inside").click();
    h.run();
    // The inside click fired the button's handler, never `close`.
    assert!(details(&r, "close").is_empty());
    assert_eq!(details(&r, "onClick").len(), 1);
}

#[test]
fn modal_escape_and_backdrop_emit_close() {
    let (mut h, r) = rig(modal_tree(true));
    h.run();
    h.key_press(egui::Key::Escape);
    h.run();
    assert_eq!(details(&r, "close").len(), 1);
    // Backdrop corner.
    h.drag_at(egui::pos2(5.0, 5.0));
    h.step();
    h.drop_at(egui::pos2(5.0, 5.0));
    h.run();
    assert_eq!(details(&r, "close").len(), 2);
}

#[test]
fn modal_centres_and_sizes_to_content() {
    let (mut h, _r) = rig(modal_tree(true));
    h.run();
    let inside = h.get_by_label("Inside").rect();
    // The dialog carries its title as its label.
    let dialog = h.get_by_label("Dialog").rect();
    // Centred in the 400×400 rig.
    assert!(
        (dialog.center().x - 200.0).abs() < 1.0 && (dialog.center().y - 200.0).abs() < 1.0,
        "dialog not centred: {dialog:?}"
    );
    // Sized to its content, not a full-bleed bar: a gutter off every edge.
    assert!(dialog.min.x > 0.0 && dialog.max.x < 400.0, "{dialog:?}");
    // Taller than its content — padding and the title row are inside.
    assert!(
        dialog.height() > inside.height() + 80.0,
        "dialog {dialog:?} vs content {inside:?}"
    );
    // …and the content sits below the title strip, inside the dialog.
    assert!(dialog.contains_rect(inside));
    assert!(
        inside.min.y > dialog.min.y + 40.0,
        "content {inside:?} overlaps the title strip of {dialog:?}"
    );
}

#[test]
fn modal_blocks_clicks_under_it() {
    let (mut h, r) = rig(modal_tree(true));
    h.run();
    // Screen centre sits inside the modal's frame — the full-bleed button
    // beneath must not see the click.
    h.drag_at(egui::pos2(200.0, 200.0));
    h.step();
    h.drop_at(egui::pos2(200.0, 200.0));
    h.run();
    assert!(details(&r, "onClick").iter().all(|_| !r
        .events
        .borrow()
        .iter()
        .any(|e| e.node.as_str() == "root/under")),);
    assert!(r
        .events
        .borrow()
        .iter()
        .all(|e| e.node.as_str() != "root/under"));
}

#[test]
fn popover_opens_on_trigger_and_closes_outside() {
    let mut pop = node("we-popover", "pop", props(&[]));
    let trig = node("we-button", "pop/trig", props(&[("label", s("Open pop"))]));
    let mut body = node("we-button", "pop/body", props(&[("label", s("Pop body"))]));
    body.slot = Some(Arc::from("content"));
    body.handlers = handlers(&["onClick"]);
    pop.children = vec![
        ResolvedChild::Node(Box::new(trig)),
        ResolvedChild::Node(Box::new(body)),
    ];
    let (mut h, r) = rig(pop);
    h.run();
    assert!(h.query_by_label("Pop body").is_none());
    h.get_by_label("Open pop").click();
    h.run();
    assert!(h.query_by_label("Pop body").is_some());
    assert!(r.edit.borrow().is_open(&NodeId::from("pop")));
    h.drag_at(egui::pos2(390.0, 390.0));
    h.step();
    h.drop_at(egui::pos2(390.0, 390.0));
    h.run();
    assert!(!r.edit.borrow().is_open(&NodeId::from("pop")));
}

#[test]
fn dropdown_menu_item_fires_once_and_closes() {
    let mut menu = node(
        "DropdownMenu",
        "menu",
        props(&[(
            "items",
            Value::List(Arc::new(vec![Value::Obj(Arc::new(props(&[
                ("id", s("edit")),
                ("label", s("Edit")),
            ])))])),
        )]),
    );
    menu.handlers = handlers(&["onSelect"]);
    let trig = node("we-button", "menu/trig", props(&[("label", s("Menu"))]));
    menu.children = vec![ResolvedChild::Node(Box::new(trig))];
    let (mut h, r) = rig(menu);
    h.run();
    h.get_by_label("Menu").click();
    h.run();
    h.get_by_label("Edit").click();
    h.run();
    let sel = details(&r, "onSelect");
    assert_eq!(sel.len(), 1);
    let Value::Obj(m) = &sel[0] else {
        panic!("payload not an object")
    };
    assert!(m.get("id").is_some_and(|v| v.strict_eq(&s("edit"))));
    assert!(!r.edit.borrow().is_open(&NodeId::from("menu")));
}

// ---------- pickers + sortable -------------------------------------------

#[test]
fn date_picker_emits_iso() {
    let mut dp = node(
        "we-date-picker",
        "dp",
        props(&[("label", s("When")), ("value", s("2026-01-15"))]),
    );
    dp.handlers = handlers(&["onChange"]);
    let (mut h, r) = rig(dp);
    h.run();
    h.get_by_label("When").click();
    h.run();
    h.get_by_label("20").click();
    h.run();
    assert_detail(&r, "onChange", s("2026-01-20"));
}

#[test]
fn color_picker_emits_swatch() {
    let mut cp = node(
        "we-color-picker",
        "cp",
        props(&[
            ("label", s("Tint")),
            ("value", s("#000000")),
            (
                "swatches",
                Value::List(Arc::new(vec![s("#ff0000"), s("#00ff00")])),
            ),
        ]),
    );
    cp.handlers = handlers(&["onChange"]);
    let (mut h, r) = rig(cp);
    h.run();
    h.get_by_label("Tint").click();
    h.run();
    h.get_by_label("#00ff00").click();
    h.run();
    assert_detail(&r, "onChange", s("#00ff00"));
}

#[test]
fn icon_picker_searches_and_emits() {
    let mut ip = node(
        "we-icon-picker",
        "ip",
        props(&[("label", s("Icon")), ("value", s(""))]),
    );
    ip.handlers = handlers(&["onChange"]);
    let (mut h, r) = rig(ip);
    h.run();
    h.get_by_label("Icon").click();
    h.run();
    h.get_by_label("trash").click();
    h.run();
    assert_detail(&r, "onChange", s("trash"));
}

#[test]
fn sortable_drop_emits_new_order() {
    let mut sort = node("we-sortable", "sort", props(&[]));
    sort.handlers = handlers(&["onReorder"]);
    for (i, id) in ["0", "1", "2"].iter().enumerate() {
        let mut item = node(
            "we-button",
            &format!("sort/{i}"),
            props(&[
                ("weId", s(id)),
                ("label", s(&format!("Item {id}"))),
                ("height", n(30.0)),
            ]),
        );
        item.handlers = handlers(&["onClick"]);
        sort.children.push(ResolvedChild::Node(Box::new(item)));
    }
    let (mut h, r) = rig(sort);
    h.run();
    let r0 = h.get_by_label("Item 0").rect();
    let r2 = h.get_by_label("Item 2").rect();
    let from = egui::pos2(r0.min.x + 8.0, r0.center().y); // the drag grip
    let to = egui::pos2(r2.center().x, r2.center().y + 10.0);
    h.drag_at(from);
    h.step();
    for t in [0.25, 0.5, 0.75, 1.0] {
        h.hover_at(from.lerp(to, t));
        h.step();
    }
    h.drop_at(to);
    h.run();
    let Value::Obj(m) = details(&r, "onReorder")
        .last()
        .cloned()
        .unwrap_or(Value::Undefined)
    else {
        panic!("no onReorder")
    };
    let Some(Value::List(order)) = m.get("detail") else {
        panic!("no detail list: {m:?}")
    };
    let got: Vec<String> = order.iter().map(|v| v.js_string()).collect();
    assert_eq!(got, vec!["1".to_string(), "2".to_string(), "0".to_string()]);
}
