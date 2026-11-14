//! E5b widgets — one `egui_kittest` case per type, plus the interaction
//! contracts the brief pins: controlled inputs (prop wins), the modal's
//! close paths and input blocking, popover/menu dismissal, number-input
//! clamp-on-blur, and sortable's drop-only reorder.
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use egui_kittest::{
    kittest::{NodeT as _, Queryable},
    Harness,
};
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
        // Generated triggers may carry an icon — the media fonts keep a
        // missing glyph a paint detail, not a panic.
        .allow_missing_glyphs()
        .with_context_setup(|ctx| {
            ctx.set_fonts(egui::FontDefinitions::default());
            we_egui::install_media(ctx);
        })
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

/// B1 — the bundle's record-field shape: `value: row[field]` with ONLY an
/// onChange setter. No onInput handler means the prop cannot move while
/// typing, so the draft must live across ordinary repaints — the DOM
/// field keeps its own text (input.ts:276–285) — and blur/Enter commits
/// the typed text, not the stale prop.
#[test]
fn onchange_only_input_keeps_its_draft_until_commit() {
    let mut inp = node(
        "we-input",
        "in",
        props(&[("label", s("Name")), ("value", s("keep"))]),
    );
    inp.handlers = handlers(&["onChange"]);
    let (mut h, r) = rig(inp);
    h.run();
    let f = h.get_by_label("Name");
    f.click();
    f.type_text("x");
    h.step(); // an ordinary repaint — no handler write
    h.get_by_label("Name").type_text("y");
    h.step();
    assert_eq!(
        h.get_by_label("Name").value().as_deref(),
        Some("keepxy"),
        "the commit-only draft must survive frames without a prop write"
    );
    // Enter surrenders focus — the blur/commit path carries the draft.
    h.key_press(egui::Key::Enter);
    h.run();
    assert_detail(&r, "onChange", s("keepxy"));
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

/// B5 — the IME's Enter is not a submit. input.ts:296–304 forwards
/// `e.isComposing`; the bundle's "Find or ask" sends on
/// `Enter && !event.detail.isComposing`. A hardcoded `false` reports the
/// candidate-confirming keystroke as an ordinary submit, and the Rust
/// `enter && dirty → onChange` fires the send itself.
#[test]
fn ime_enter_reports_composing_and_does_not_submit() {
    let mut inp = node(
        "we-input",
        "in",
        props(&[("label", s("Ask")), ("value", s(""))]),
    );
    inp.handlers = handlers(&["onInput", "onChange", "onKeyDown"]);
    let (mut h, r) = rig(inp);
    h.run();
    let f = h.get_by_label("Ask");
    f.click();
    f.type_text("ka");
    h.step();
    // Composition opens (preedit) and the Enter confirming the candidate
    // arrives inside it — one frame, in order, like winit delivers them.
    h.input_mut()
        .events
        .push(egui::Event::Ime(egui::ImeEvent::Preedit {
            text: "か".into(),
            active_range_chars: None,
        }));
    h.input_mut().events.push(egui::Event::Key {
        key: egui::Key::Enter,
        physical_key: None,
        pressed: true,
        repeat: false,
        modifiers: Default::default(),
    });
    h.step();
    let kd = details(&r, "onKeyDown");
    let Value::Obj(m) = kd.last().expect("keydown fired") else {
        panic!("keydown payload not an object")
    };
    let Some(Value::Obj(d)) = m.get("detail") else {
        panic!("no detail")
    };
    assert!(
        d.get("isComposing").is_some_and(|v| v.strict_eq(&b(true))),
        "Enter inside a composition must report isComposing:true: {d:?}"
    );
    assert!(
        details(&r, "onChange").is_empty(),
        "an IME Enter must not commit/submit"
    );
    // Commit ends the composition; the following Enter submits for real.
    h.input_mut()
        .events
        .push(egui::Event::Ime(egui::ImeEvent::Commit("か".into())));
    h.step();
    h.key_press(egui::Key::Enter);
    h.run();
    let kd = details(&r, "onKeyDown");
    let Value::Obj(m) = kd.last().expect("keydown fired") else {
        panic!("keydown payload not an object")
    };
    let Some(Value::Obj(d)) = m.get("detail") else {
        panic!("no detail")
    };
    assert!(d.get("isComposing").is_some_and(|v| v.strict_eq(&b(false))));
    // The committed text is the field's — the clean Enter submits once,
    // with whatever the TextEdit now holds.
    let changes = details(&r, "onChange");
    assert_eq!(changes.len(), 1);
    let Some(Value::Obj(m)) = changes.last() else {
        panic!("onChange payload not an object")
    };
    assert!(
        m.get("detail")
            .is_some_and(|v| matches!(v, Value::Str(t) if !t.is_empty())),
        "onChange detail must be the field's text: {m:?}"
    );
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

/// B6 — the authored switch, not a foreign shortcut. textarea.ts:315–319:
/// `submitOnEnter` opts in; an unshifted, noncomposing Enter on nonblank
/// text dispatches `submit` and `preventDefault()` keeps the newline out;
/// Shift+Enter is the newline; a composing Enter confirms the candidate.
/// Rust answered Ctrl+Enter instead and never looked at the props.
#[test]
fn textarea_submit_on_enter_contract() {
    let mut ta = node(
        "we-textarea",
        "ta",
        props(&[
            ("label", s("Msg")),
            ("value", s("")),
            ("submitOnEnter", b(true)),
        ]),
    );
    ta.handlers = handlers(&["onInput", "onSubmit"]);
    let (mut h, r) = rig(ta);
    h.run();
    let f = h.get_by_label("Msg");
    f.click();
    f.type_text("hi");
    h.step();
    // Live input: the app's setter echoes `onInput` back into `value`
    // before the Enter, or the field has reverted to the prop.
    r.node
        .borrow_mut()
        .props
        .insert("value".into(), last_detail(&r, "onInput"));
    h.step();
    // Plain Enter submits the field's text — and preventDefault keeps the
    // newline out of it.
    h.key_press(egui::Key::Enter);
    h.step();
    let subs = details(&r, "onSubmit");
    assert_eq!(
        subs.len(),
        1,
        "submitOnEnter must submit on Enter: {subs:?}"
    );
    assert_detail(&r, "onSubmit", s("hi"));
    assert_detail(&r, "onInput", s("hi"));
    // Shift+Enter falls through to the newline — no submit.
    h.key_down_modifiers(egui::Modifiers::SHIFT, egui::Key::Enter);
    h.step();
    assert_eq!(details(&r, "onSubmit").len(), 1, "Shift+Enter is a newline");
    assert_detail(&r, "onInput", s("hi\n"));
}

/// B6 — the opt-in is real: without `submitOnEnter` an Enter is just a
/// newline, and Enter on whitespace carries nothing to send.
#[test]
fn textarea_submit_on_enter_opt_out_and_blank() {
    let mut ta = node(
        "we-textarea",
        "ta",
        props(&[("label", s("Msg")), ("value", s(""))]),
    );
    ta.handlers = handlers(&["onInput", "onSubmit"]);
    let (mut h, r) = rig(ta);
    h.run();
    let f = h.get_by_label("Msg");
    f.click();
    f.type_text("x");
    h.step();
    h.key_press(egui::Key::Enter);
    h.step();
    assert!(
        details(&r, "onSubmit").is_empty(),
        "no submitOnEnter → Enter is a newline"
    );
    // Opt in but blank: the guard sends nothing.
    let mut ta2 = node(
        "we-textarea",
        "ta2",
        props(&[
            ("label", s("Blank")),
            ("value", s("")),
            ("submitOnEnter", b(true)),
        ]),
    );
    ta2.handlers = handlers(&["onInput", "onSubmit"]);
    let (mut h2, r2) = rig(ta2);
    h2.run();
    let f2 = h2.get_by_label("Blank");
    f2.click();
    f2.type_text("   ");
    h2.step();
    h2.key_press(egui::Key::Enter);
    h2.step();
    assert!(
        details(&r2, "onSubmit").is_empty(),
        "whitespace submits nothing"
    );
    // …but preventDefault still ran: no newline either.
    assert_detail(&r2, "onInput", s("   "));
}

/// B6 — the IME's Enter is the candidate's, not a send (same composition
/// tracking as we-input).
#[test]
fn textarea_submit_on_enter_ignores_composing_enter() {
    let mut ta = node(
        "we-textarea",
        "ta",
        props(&[
            ("label", s("Msg")),
            ("value", s("")),
            ("submitOnEnter", b(true)),
        ]),
    );
    ta.handlers = handlers(&["onInput", "onSubmit"]);
    let (mut h, r) = rig(ta);
    h.run();
    let f = h.get_by_label("Msg");
    f.click();
    f.type_text("ka");
    h.step();
    h.input_mut()
        .events
        .push(egui::Event::Ime(egui::ImeEvent::Preedit {
            text: "か".into(),
            active_range_chars: None,
        }));
    h.input_mut().events.push(egui::Event::Key {
        key: egui::Key::Enter,
        physical_key: None,
        pressed: true,
        repeat: false,
        modifiers: Default::default(),
    });
    h.step();
    assert!(
        details(&r, "onSubmit").is_empty(),
        "a composing Enter confirms the candidate, never submits"
    );
}

/// B7 — input.ts:352 `?readonly`: focus, selection and key reporting stay
/// (it is not `disabled`), but nothing mutates the buffer — no `onInput`.
#[test]
fn input_readonly_keeps_focus_but_blocks_edits() {
    let mut inp = node(
        "we-input",
        "in",
        props(&[
            ("label", s("Name")),
            ("value", s("seed")),
            ("readonly", b(true)),
        ]),
    );
    inp.handlers = handlers(&["onInput", "onKeyDown"]);
    let (mut h, r) = rig(inp);
    h.run();
    let f = h.get_by_label("Name");
    f.click();
    f.type_text("x");
    h.step();
    assert!(
        details(&r, "onInput").is_empty(),
        "readonly: typing mutates nothing"
    );
    // …but the keys themselves still report, like the DOM element.
    h.key_press(egui::Key::A);
    h.step();
    assert!(
        !details(&r, "onKeyDown").is_empty(),
        "readonly keeps the field live: keydown still fires"
    );
}

/// B7 — textarea.ts:413 — the same `?readonly` on the multiline field,
/// Enter included: no newline lands, nothing reports.
#[test]
fn textarea_readonly_blocks_typing_and_enter() {
    let mut ta = node(
        "we-textarea",
        "ta",
        props(&[
            ("label", s("Body")),
            ("value", s("seed")),
            ("readonly", b(true)),
        ]),
    );
    ta.handlers = handlers(&["onInput"]);
    let (mut h, r) = rig(ta);
    h.run();
    let f = h.get_by_label("Body");
    f.click();
    f.type_text("x");
    h.key_press(egui::Key::Enter);
    h.run();
    assert!(
        details(&r, "onInput").is_empty(),
        "readonly: neither typing nor Enter mutates"
    );
}

/// B7 — input.ts:339, textarea.ts:401: `.value=${this.value ?? ''}` — a
/// missing or null value is an empty field, never the text "undefined"
/// (or "null"). `Value::to_text`, not `js_string`, is the conversion.
#[test]
fn inputs_show_nullish_value_as_empty() {
    // Undefined — the prop never resolved at all.
    let mut inp = node("we-input", "in", props(&[("label", s("N"))]));
    inp.handlers = handlers(&["onInput"]);
    let (mut h, r) = rig(inp);
    h.run();
    let f = h.get_by_label("N");
    f.click();
    f.type_text("a");
    h.run();
    assert_detail(&r, "onInput", s("a"));
    // Null — the record exists, the field does not yet.
    let mut ta = node(
        "we-textarea",
        "ta",
        props(&[("label", s("B")), ("value", Value::Null)]),
    );
    ta.handlers = handlers(&["onInput"]);
    let (mut h2, r2) = rig(ta);
    h2.run();
    let f2 = h2.get_by_label("B");
    f2.click();
    f2.type_text("b");
    h2.run();
    assert_detail(&r2, "onInput", s("b"));
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

/// B11 — a switch is a checkbox to assistive tech: its AccessKit node
/// must carry the `toggled` state, not just a label.
#[test]
fn switch_a11y_reports_checked_state() {
    let on = node(
        "we-switch",
        "sw/on",
        props(&[("label", s("On")), ("checked", b(true))]),
    );
    let off = node(
        "we-switch",
        "sw/off",
        props(&[("label", s("Off")), ("checked", b(false))]),
    );
    let mut col = node("Column", "col", props(&[]));
    col.children = vec![
        ResolvedChild::Node(Box::new(on)),
        ResolvedChild::Node(Box::new(off)),
    ];
    let (mut h, _r) = rig(col);
    h.run();
    assert_eq!(
        h.get_by_label("On").accesskit_node().toggled(),
        Some(egui::accesskit::Toggled::True),
        "checked switch must report toggled=true"
    );
    assert_eq!(
        h.get_by_label("Off").accesskit_node().toggled(),
        Some(egui::accesskit::Toggled::False),
        "unchecked switch must report toggled=false"
    );
}

/// B11 — disabled controls must describe themselves as disabled to
/// assistive tech, not enabled.
#[test]
fn disabled_controls_report_disabled_state() {
    let mut sw = node(
        "we-switch",
        "d/sw",
        props(&[
            ("label", s("Disabled switch")),
            ("checked", b(true)),
            ("disabled", b(true)),
        ]),
    );
    sw.handlers = handlers(&["onChange"]);
    let mut inp = node(
        "we-input",
        "d/in",
        props(&[("label", s("Disabled input")), ("disabled", b(true))]),
    );
    inp.handlers = handlers(&["onInput"]);
    let mut sel = node(
        "we-select",
        "d/sel",
        props(&[("label", s("Disabled select")), ("disabled", b(true))]),
    );
    sel.children = vec![];
    let mut col = node("Column", "col", props(&[]));
    col.children = vec![
        ResolvedChild::Node(Box::new(sw)),
        ResolvedChild::Node(Box::new(inp)),
        ResolvedChild::Node(Box::new(sel)),
    ];
    let (mut h, _r) = rig(col);
    h.run();
    for label in ["Disabled switch", "Disabled input", "Disabled select"] {
        assert!(
            h.get_by_label(label).accesskit_node().is_disabled(),
            "{label} must report disabled to a11y"
        );
    }
}

/// B11 — the control's own authored label names it, not an ancestor
/// `we-form-field`'s. The inherited label is a fallback for an unlabeled
/// control.
#[test]
fn control_label_beats_form_field_label() {
    let mut field = node("we-form-field", "ff", props(&[("label", s("Email"))]));
    let mut inp = node(
        "we-input",
        "ff/in",
        props(&[("label", s("Direct")), ("value", s(""))]),
    );
    inp.handlers = handlers(&["onInput"]);
    field.children = vec![ResolvedChild::Node(Box::new(inp))];
    let (mut h, _r) = rig(field);
    h.run();
    let inputs: Vec<_> = h
        .get_all_by_role(egui::accesskit::Role::TextInput)
        .collect();
    assert_eq!(inputs.len(), 1);
    assert_eq!(
        inputs[0].accesskit_node().label().as_deref(),
        Some("Direct"),
        "the control's own label wins over the field's"
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
    // …and off the vertical edges too — the dialog is content + chrome, not
    // the viewport less 64px (which is what a `min-height: 100vh` floor on
    // the overlay's host column made it: ~340 tall here, still "centred").
    assert!(
        dialog.height() < inside.height() + 200.0,
        "dialog not sized to content: {dialog:?} vs content {inside:?}"
    );
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

/// B2 — the authored bundle shape: popover children carry NAMED slots
/// (`slot="trigger"`/`slot="content"`, popover.ts:160–165). The named
/// trigger must anchor (in-flow rect, painted at rest); the named content
/// floats and only shows while open.
#[test]
fn popover_named_trigger_anchors_and_named_content_floats() {
    let mut pop = node("we-popover", "pop", props(&[]));
    let mut trig = node("we-button", "pop/t", props(&[("label", s("Open pop"))]));
    trig.slot = Some(Arc::from("trigger"));
    let mut body = node("we-button", "pop/b", props(&[("label", s("Pop body"))]));
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

/// B3 — a childless DropdownMenu gets the generated we-button trigger
/// (DropdownMenu.solid.tsx:441–463): a `triggerIcon` makes it icon-only
/// (`square`), so the accessible name is `triggerTitle`; the bundle's two
/// childless menus ("Who is on this", "Start a workflow on this") are
/// exactly this shape.
#[test]
fn childless_dropdown_menu_generates_an_icon_trigger() {
    let mut menu = node(
        "DropdownMenu",
        "menu",
        props(&[
            (
                "items",
                Value::List(Arc::new(vec![Value::Obj(Arc::new(props(&[
                    ("id", s("edit")),
                    ("label", s("Edit")),
                ])))])),
            ),
            ("triggerIcon", s("user-plus")),
            ("triggerTitle", s("Who is on this")),
        ]),
    );
    menu.handlers = handlers(&["onSelect"]);
    let (mut h, r) = rig(menu);
    h.run();
    // The generated icon-only trigger: clickable, named by the title.
    h.get_by_label("Who is on this").click();
    h.run();
    assert!(r.edit.borrow().is_open(&NodeId::from("menu")));
    h.get_by_label("Edit").click();
    h.run();
    let sel = details(&r, "onSelect");
    let Some(Value::Obj(m)) = sel.last() else {
        panic!("onSelect did not fire: {sel:?}")
    };
    assert!(m.get("id").is_some_and(|v| v.strict_eq(&s("edit"))));
    assert!(!r.edit.borrow().is_open(&NodeId::from("menu")));
}

/// B3 — no icon, no children: the trigger is a labeled soft button whose
/// text is `triggerLabel ?? 'Options'` (DropdownMenu.solid.tsx:417).
#[test]
fn childless_dropdown_menu_generates_a_labeled_trigger() {
    let mut menu = node(
        "DropdownMenu",
        "menu",
        props(&[
            (
                "items",
                Value::List(Arc::new(vec![Value::Obj(Arc::new(props(&[
                    ("id", s("go")),
                    ("label", s("Go")),
                ])))])),
            ),
            ("triggerLabel", s("Actions")),
        ]),
    );
    menu.handlers = handlers(&["onSelect"]);
    let (mut h, r) = rig(menu);
    h.run();
    h.get_by_label("Actions").click();
    h.run();
    assert!(r.edit.borrow().is_open(&NodeId::from("menu")));
    h.get_by_label("Go").click();
    h.run();
    let sel = details(&r, "onSelect");
    let Some(Value::Obj(m)) = sel.last() else {
        panic!("onSelect did not fire: {sel:?}")
    };
    assert!(m.get("id").is_some_and(|v| v.strict_eq(&s("go"))));
}

/// B4 — activation, not pointer coordinates: the DOM click a focused
/// trigger button gets on Enter opens the menu (a raw `any_click` watch
/// never sees it — egui reports it as the response's fake primary click).
#[test]
fn menu_trigger_opens_on_keyboard_enter() {
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
    h.key_press(egui::Key::Tab);
    h.key_press(egui::Key::Enter);
    h.run();
    assert!(
        r.edit.borrow().is_open(&NodeId::from("menu")),
        "Enter on the focused trigger must open the menu"
    );
}

/// B4 — a disabled trigger dispatches no click at all in the DOM, not even
/// to its popover parent: the pointer watch opened it anyway.
#[test]
fn disabled_trigger_does_not_open() {
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
    let trig = node(
        "we-button",
        "menu/trig",
        props(&[("label", s("Menu")), ("disabled", b(true))]),
    );
    menu.children = vec![ResolvedChild::Node(Box::new(trig))];
    let (mut h, r) = rig(menu);
    h.run();
    h.get_by_label("Menu").click();
    h.run();
    assert!(
        !r.edit.borrow().is_open(&NodeId::from("menu")),
        "a click on a disabled trigger must not open the menu"
    );
}

/// B4 — a click the modal layer swallows can't reach the trigger beneath:
/// the raw pointer watch ignored which layer was actually hit.
#[test]
fn modal_covered_trigger_does_not_toggle() {
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
    let trig = node(
        "we-button",
        "menu/trig",
        props(&[
            ("label", s("Menu")),
            ("width", n(300.0)),
            ("height", n(300.0)),
        ]),
    );
    menu.children = vec![ResolvedChild::Node(Box::new(trig))];
    let mut modal = node(
        "we-modal",
        "root/modal",
        props(&[("open", b(true)), ("title", s("Cover"))]),
    );
    modal.children = vec![ResolvedChild::Node(Box::new(node(
        "we-text",
        "root/modal/t",
        props(&[
            ("text", s("covering")),
            ("width", n(360.0)),
            ("height", n(360.0)),
        ]),
    )))];
    let mut root = node("Column", "root", props(&[]));
    root.children = vec![
        ResolvedChild::Node(Box::new(menu)),
        ResolvedChild::Node(Box::new(modal)),
    ];
    let (mut h, r) = rig(root);
    h.run();
    h.get_by_label("Menu").click();
    h.run();
    assert!(
        !r.edit.borrow().is_open(&NodeId::from("menu")),
        "the modal's layer must swallow the click"
    );
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

/// B8 — select.ts:438 `_select` early-returns on a disabled option: the
/// row renders (dimmed, `aria-disabled`) but chooses nothing — the same
/// click on a live option still emits.
#[test]
fn select_disabled_option_cannot_be_chosen() {
    let mut sel = node(
        "we-select",
        "sel",
        props(&[
            ("label", s("Pick")),
            ("value", s("")),
            (
                "options",
                Value::List(Arc::new(vec![
                    Value::Obj(Arc::new(props(&[("value", s("a")), ("label", s("Alpha"))]))),
                    Value::Obj(Arc::new(props(&[
                        ("value", s("b")),
                        ("label", s("Beta")),
                        ("disabled", b(true)),
                    ]))),
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
    assert!(
        details(&r, "onChange").is_empty(),
        "a disabled option selects nothing"
    );
    h.get_by_label("Alpha").click();
    h.run();
    assert_detail(&r, "onChange", s("a"));
}

/// B8 — a group is a heading whose own press only collapses it
/// (DropdownMenu.solid renderGroup): the entries under it carry the
/// selections, the caption never does.
#[test]
fn menu_group_is_a_heading_not_an_action() {
    let mut menu = node(
        "DropdownMenu",
        "menu",
        props(&[(
            "items",
            Value::List(Arc::new(vec![
                Value::Obj(Arc::new(props(&[
                    ("type", s("group")),
                    ("id", s("crew")),
                    ("label", s("Crew")),
                    (
                        "items",
                        Value::List(Arc::new(vec![Value::Obj(Arc::new(props(&[
                            ("id", s("ana")),
                            ("label", s("Ana")),
                        ])))])),
                    ),
                ]))),
                Value::Obj(Arc::new(props(&[("id", s("go")), ("label", s("Go"))]))),
            ])),
        )]),
    );
    menu.handlers = handlers(&["onSelect"]);
    let trig = node("we-button", "menu/trig", props(&[("label", s("Menu"))]));
    menu.children = vec![ResolvedChild::Node(Box::new(trig))];
    let (mut h, r) = rig(menu);
    h.run();
    h.get_by_label("Menu").click();
    h.run();
    // The caption collapses the group — it selects nothing.
    h.get_by_label("Crew").click();
    h.run();
    assert!(
        details(&r, "onSelect").is_empty(),
        "a group heading is not an action"
    );
    assert!(
        h.query_by_label("Ana").is_none(),
        "collapsed: the group's items leave the list"
    );
    assert!(r.edit.borrow().is_open(&NodeId::from("menu")));
    // Re-open the group; the entry under it selects.
    h.get_by_label("Crew").click();
    h.run();
    h.get_by_label("Ana").click();
    h.run();
    let sel = details(&r, "onSelect");
    let Some(Value::Obj(m)) = sel.last() else {
        panic!("onSelect did not fire: {sel:?}")
    };
    assert!(m.get("id").is_some_and(|v| v.strict_eq(&s("ana"))));
    assert!(!r.edit.borrow().is_open(&NodeId::from("menu")));
}

/// B8 — toggles keep the menu open (handleToggle never calls closeMenu)
/// and onSelect reports `checked` as it was *before* the press — the
/// bundle's handler flips it back (`!arg.checked`).
#[test]
fn menu_toggle_stays_open_and_reports_pre_press_checked() {
    let mut menu = node(
        "DropdownMenu",
        "menu",
        props(&[(
            "items",
            Value::List(Arc::new(vec![Value::Obj(Arc::new(props(&[
                ("type", s("toggle")),
                ("id", s("pin")),
                ("label", s("Pinned")),
                ("checked", b(true)),
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
    h.get_by_label("Pinned").click();
    h.run();
    let sel = details(&r, "onSelect");
    let Some(Value::Obj(m)) = sel.last() else {
        panic!("toggle did not report onSelect: {sel:?}")
    };
    assert!(
        m.get("id").is_some_and(|v| v.strict_eq(&s("pin"))),
        "payload is the item: {m:?}"
    );
    assert!(
        m.get("checked").is_some_and(|v| v.strict_eq(&b(true))),
        "checked reports the pre-press state: {m:?}"
    );
    assert!(
        r.edit.borrow().is_open(&NodeId::from("menu")),
        "a toggle must not close the menu"
    );
}

/// B8 — `hidden` entries hold their place off the list; `searchable` adds
/// the filter field (solid `matches`): labels narrow case-insensitively
/// and dividers stand down while a needle is active.
#[test]
fn menu_search_filters_and_hidden_stays_out() {
    let mut menu = node(
        "DropdownMenu",
        "menu",
        props(&[
            ("searchable", b(true)),
            ("searchPlaceholder", s("Find a member")),
            (
                "items",
                Value::List(Arc::new(vec![
                    Value::Obj(Arc::new(props(&[("id", s("a")), ("label", s("Alpha"))]))),
                    Value::Obj(Arc::new(props(&[("type", s("divider"))]))),
                    Value::Obj(Arc::new(props(&[("id", s("b")), ("label", s("Beta"))]))),
                    Value::Obj(Arc::new(props(&[
                        ("id", s("h")),
                        ("label", s("Ghost")),
                        ("hidden", b(true)),
                    ]))),
                ])),
            ),
        ]),
    );
    menu.handlers = handlers(&["onSelect"]);
    let trig = node("we-button", "menu/trig", props(&[("label", s("Menu"))]));
    menu.children = vec![ResolvedChild::Node(Box::new(trig))];
    let (mut h, _r) = rig(menu);
    h.run();
    h.get_by_label("Menu").click();
    h.run();
    assert!(
        h.query_by_label("Ghost").is_none(),
        "a hidden entry is off the list"
    );
    // The search field narrows the list — only Alpha survives "alp".
    h.get_by_label("Find a member").click();
    h.get_by_label("Find a member").type_text("alp");
    h.run();
    assert!(
        h.query_by_label("Alpha").is_some(),
        "the matching entry stays"
    );
    assert!(
        h.query_by_label("Beta").is_none(),
        "non-matching entries filter out"
    );
}

/// B9 — modal.ts:143–189: the default slot is the only scroll region —
/// `header`/`footer` slots pin outside it and the sheet caps at
/// `100dvh - 64px`. A form taller than the cap must scroll to its last
/// field, not paint past the sheet and the screen.
#[test]
fn tall_modal_scrolls_content_and_pins_header_footer() {
    let mut modal = node(
        "we-modal",
        "m",
        props(&[("open", b(true)), ("title", s("T"))]),
    );
    let mut head = node(
        "we-button",
        "m/head",
        props(&[("label", s("Head")), ("height", n(30.0))]),
    );
    head.slot = Some("header".into());
    let mut body = node(
        "Column",
        "m/body",
        props(&[("height", n(600.0)), ("flexShrink", n(0.0))]),
    );
    body.children = vec![ResolvedChild::Node(Box::new(node(
        "we-text",
        "m/body/deep",
        props(&[("text", s("deep")), ("height", n(580.0))]),
    )))];
    let mut foot = node(
        "we-button",
        "m/foot",
        props(&[("label", s("Foot")), ("height", n(30.0))]),
    );
    foot.slot = Some("footer".into());
    modal.children = vec![
        ResolvedChild::Node(Box::new(head)),
        ResolvedChild::Node(Box::new(body)),
        ResolvedChild::Node(Box::new(foot)),
    ];
    let (mut h, r) = rig(modal);
    h.run();
    // The footer is pinned inside the capped sheet — reachable, not 600px
    // down under a clipped content tail.
    let foot = h.get_by_label("Foot").rect();
    assert!(
        foot.max.y <= 400.0,
        "footer must pin inside the sheet, got {foot:?}"
    );
    assert!(h.query_by_label("Head").is_some(), "header still shows");
    // And the default region really scrolls: a wheel over the sheet moves
    // its stored offset rather than leaking to the page.
    let head = h.get_by_label("Head").rect();
    h.hover_at(egui::pos2(head.center().x, head.max.y + 60.0));
    h.event(egui::Event::MouseWheel {
        unit: egui::MouseWheelUnit::Point,
        delta: egui::vec2(0.0, -40.0),
        phase: egui::TouchPhase::Move,
        source: egui::MouseWheelSource::Wheel,
        modifiers: egui::Modifiers::NONE,
    });
    h.run();
    let y = match r.edit.borrow().field(&NodeId::from("m/~ms"), "_scroll") {
        Value::Obj(o) => match o.get("y") {
            Some(Value::Num(n)) => *n,
            _ => 0.0,
        },
        _ => 0.0,
    };
    assert!(y > 0.0, "the content region must scroll, got {y}");
    let foot_after = h.get_by_label("Foot").rect();
    assert_eq!(
        foot.min.y, foot_after.min.y,
        "the footer stays pinned while content scrolls"
    );
}

/// B9 — modal.ts:288–297: the chrome close button is drawn unless
/// `hideclosebutton` — ghost, square, `x`, top-right — and clicking it is
/// the same `close` the backdrop and Escape invoke.
#[test]
fn modal_default_close_button_emits_close() {
    let mut modal = node(
        "we-modal",
        "m",
        props(&[("open", b(true)), ("title", s("T"))]),
    );
    modal.handlers = handlers(&["close"]);
    let (mut h, r) = rig(modal);
    h.run();
    h.get_by_label("Close").click();
    h.run();
    assert_eq!(
        details(&r, "close").len(),
        1,
        "the close button must emit `close`"
    );
    // `hideclosebutton` takes it away (the confirmation modal owns its
    // exits).
    let mut modal2 = node(
        "we-modal",
        "m2",
        props(&[
            ("open", b(true)),
            ("title", s("T")),
            ("hideclosebutton", b(true)),
        ]),
    );
    modal2.handlers = handlers(&["close"]);
    let (mut h2, _r2) = rig(modal2);
    h2.run();
    assert!(
        h2.query_by_label("Close").is_none(),
        "hideclosebutton removes the chrome button"
    );
}

/// B9 — keyboard parity with the DOM: Tab inside the sheet reaches a field
/// below the fold, and the scroller brings it into view like the browser's
/// focus scroll. TS traps focus inside the dialog (OverlayElement.
/// trapFocus); the traversal half is what's tested here.
#[test]
fn modal_tab_focus_scrolls_offscreen_field_into_view() {
    let mut modal = node(
        "we-modal",
        "m",
        props(&[("open", b(true)), ("title", s("T"))]),
    );
    let mut body = node(
        "Column",
        "m/body",
        props(&[("height", n(600.0)), ("flexShrink", n(0.0))]),
    );
    body.children = vec![
        ResolvedChild::Node(Box::new(node(
            "Column",
            "m/body/pad",
            props(&[("height", n(540.0))]),
        ))),
        ResolvedChild::Node(Box::new(node(
            "we-input",
            "m/body/field",
            props(&[("label", s("Field")), ("value", s("")), ("height", n(28.0))]),
        ))),
    ];
    modal.children = vec![ResolvedChild::Node(Box::new(body))];
    let (mut h, r) = rig(modal);
    h.run();
    // Walk the focus until the deep field has it — the close button and
    // any header controls come first in egui's registration order.
    for _ in 0..6 {
        if h.query_by_label("Field").is_some_and(|f| f.is_focused()) {
            break;
        }
        h.key_press(egui::Key::Tab);
        h.run();
    }
    let field = h.get_by_label("Field");
    assert!(field.is_focused(), "Tab must reach the offscreen field");
    let rect = field.rect();
    assert!(
        rect.max.y <= 400.0,
        "focus must scroll the field into the sheet, got {rect:?}"
    );
    let y = match r.edit.borrow().field(&NodeId::from("m/~ms"), "_scroll") {
        Value::Obj(o) => match o.get("y") {
            Some(Value::Num(n)) => *n,
            _ => 0.0,
        },
        _ => 0.0,
    };
    assert!(y > 0.0, "the scroller must follow focus, got {y}");
}

/// B10 — overlay-element.ts keeps an `openOverlays` stack: a click inside
/// a nested child popup is inside the parent's logical containment and
/// must not light-dismiss the parent just because it landed outside the
/// parent's rectangle.
#[test]
fn nested_popup_click_keeps_parent_open() {
    let mut outer = node("we-popover", "outer", props(&[]));
    let otrig = node("we-button", "outer/trig", props(&[("label", s("Outer"))]));
    let mut body = node("Column", "outer/body", props(&[]));
    body.slot = Some(Arc::from("content"));
    let mut inner = node("we-popover", "inner", props(&[]));
    let itrig = node("we-button", "inner/trig", props(&[("label", s("Inner"))]));
    let mut item = node(
        "we-button",
        "inner/item",
        props(&[("label", s("Inner item"))]),
    );
    item.slot = Some(Arc::from("content"));
    inner.children = vec![
        ResolvedChild::Node(Box::new(itrig)),
        ResolvedChild::Node(Box::new(item)),
    ];
    body.children = vec![ResolvedChild::Node(Box::new(inner))];
    outer.children = vec![
        ResolvedChild::Node(Box::new(otrig)),
        ResolvedChild::Node(Box::new(body)),
    ];
    let (mut h, r) = rig(outer);
    h.run();
    h.get_by_label("Outer").click();
    h.run();
    h.get_by_label("Inner").click();
    h.run();
    assert!(h.query_by_label("Inner item").is_some());
    // A click inside the child's popup — outside the parent's rect — is
    // still inside the parent's containment: neither closes. The child's
    // panel anchors below its trigger (which sits inside the parent),
    // so a click just under it lands inside the child but below the
    // parent's bounds. (The a11y rect for popup children is unreliable —
    // click by coordinate.)
    let inner_trig = h.get_by_label("Inner").rect();
    let inside_child = egui::pos2(inner_trig.center().x, inner_trig.max.y + 20.0);
    h.drag_at(inside_child);
    h.step();
    h.drop_at(inside_child);
    h.run();
    assert!(
        r.edit.borrow().is_open(&NodeId::from("inner")),
        "a click inside the child popup keeps it open"
    );
    assert!(
        r.edit.borrow().is_open(&NodeId::from("outer")),
        "a click inside the child popup must not dismiss the parent"
    );
    // A click clear of the whole stack light-dismisses the family.
    h.drag_at(egui::pos2(390.0, 390.0));
    h.step();
    h.drop_at(egui::pos2(390.0, 390.0));
    h.run();
    assert!(!r.edit.borrow().is_open(&NodeId::from("inner")));
    assert!(!r.edit.borrow().is_open(&NodeId::from("outer")));
}

/// B10 — one Escape belongs to the topmost overlay only
/// (`isTopmostOverlay`): it closes the child, not the whole chain.
#[test]
fn escape_closes_only_the_topmost_popup() {
    let mut outer = node("we-popover", "outer", props(&[]));
    let otrig = node("we-button", "outer/trig", props(&[("label", s("Outer"))]));
    let mut body = node("Column", "outer/body", props(&[]));
    body.slot = Some(Arc::from("content"));
    let mut inner = node("we-popover", "inner", props(&[]));
    let itrig = node("we-button", "inner/trig", props(&[("label", s("Inner"))]));
    let mut item = node(
        "we-button",
        "inner/item",
        props(&[("label", s("Inner item"))]),
    );
    item.slot = Some(Arc::from("content"));
    inner.children = vec![
        ResolvedChild::Node(Box::new(itrig)),
        ResolvedChild::Node(Box::new(item)),
    ];
    body.children = vec![ResolvedChild::Node(Box::new(inner))];
    outer.children = vec![
        ResolvedChild::Node(Box::new(otrig)),
        ResolvedChild::Node(Box::new(body)),
    ];
    let (mut h, r) = rig(outer);
    h.run();
    h.get_by_label("Outer").click();
    h.run();
    h.get_by_label("Inner").click();
    h.run();
    h.key_press(egui::Key::Escape);
    h.run();
    assert!(
        !r.edit.borrow().is_open(&NodeId::from("inner")),
        "Escape dismisses the topmost popup"
    );
    assert!(
        r.edit.borrow().is_open(&NodeId::from("outer")),
        "Escape must not fall through to the parent"
    );
    h.key_press(egui::Key::Escape);
    h.run();
    assert!(
        !r.edit.borrow().is_open(&NodeId::from("outer")),
        "the next Escape reaches the parent once it is topmost"
    );
}

/// B10 — `open` is element state the prop syncs on change, not a lock:
/// Escape on a controlled popover still dismisses it (the DOM element
/// writes `this.open = false`), and a declared `close` handler hears
/// the request.
#[test]
fn controlled_popover_escape_dismisses_and_requests_close() {
    let mut pop = node("we-popover", "cpop", props(&[("open", b(true))]));
    pop.handlers = handlers(&["close"]);
    let trig = node("we-button", "cpop/trig", props(&[("label", s("Trig"))]));
    let mut body = node("we-button", "cpop/body", props(&[("label", s("Body"))]));
    body.slot = Some(Arc::from("content"));
    pop.children = vec![
        ResolvedChild::Node(Box::new(trig)),
        ResolvedChild::Node(Box::new(body)),
    ];
    let (mut h, r) = rig(pop);
    h.run();
    assert!(h.query_by_label("Body").is_some());
    h.key_press(egui::Key::Escape);
    h.run();
    assert_eq!(
        details(&r, "close").len(),
        1,
        "a controlled popover's dismiss requests `close`"
    );
    assert!(
        h.query_by_label("Body").is_none(),
        "the element's local open state drops like the DOM property"
    );
}

/// B10 — a popup over a modal is the topmost overlay: Escape belongs to
/// it and must not also run the modal's `close` underneath.
#[test]
fn escape_over_modal_closes_popup_not_modal() {
    let mut modal = node(
        "we-modal",
        "m",
        props(&[("open", b(true)), ("title", s("T"))]),
    );
    modal.handlers = handlers(&["close"]);
    let mut pop = node("we-popover", "m/p", props(&[]));
    let trig = node("we-button", "m/p/trig", props(&[("label", s("Trig"))]));
    let mut body = node("we-button", "m/p/body", props(&[("label", s("Body"))]));
    body.slot = Some(Arc::from("content"));
    pop.children = vec![
        ResolvedChild::Node(Box::new(trig)),
        ResolvedChild::Node(Box::new(body)),
    ];
    modal.children = vec![ResolvedChild::Node(Box::new(pop))];
    let (mut h, r) = rig(modal);
    h.run();
    h.get_by_label("Trig").click();
    h.run();
    assert!(h.query_by_label("Body").is_some());
    h.key_press(egui::Key::Escape);
    h.run();
    assert!(
        !r.edit.borrow().is_open(&NodeId::from("m/p")),
        "the topmost popup takes the Escape"
    );
    assert!(
        details(&r, "close").is_empty(),
        "the modal under the popup must not hear the same Escape"
    );
}
