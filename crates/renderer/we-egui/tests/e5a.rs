//! E5a round-2 layout assertions: button boxes must cover label + padding,
//! alert boxes must cover their text + padding, `truncate`/`lines` must see
//! the container's width, and a `$lane` keeps its authored width.
use std::path::PathBuf;
use std::sync::Arc;

use indexmap::IndexMap;
use we_egui::{layout, paint, EditState, Layout, MeasureCx, Registry, StyleCx};
use we_expr::Value;
use we_template::{NodeId, ResolvedChild, ResolvedNode};

fn node(ty: &str, id: &str, props: &[(&str, Value)]) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from(id),
        ty: Arc::from(ty),
        props: props
            .iter()
            .map(|(k, v)| (Arc::from(*k), v.clone()))
            .collect::<IndexMap<Arc<str>, Value>>(),
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        transition: None,
    }
}

fn child(parent: &mut ResolvedNode, n: ResolvedNode) {
    parent.children.push(ResolvedChild::Node(Box::new(n)));
}

fn s(v: &str) -> Value {
    Value::Str(Arc::from(v))
}

fn tokens() -> we_style::TokenTable {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/schema-system/conformance/vectors/tokens/light.json");
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    we_style::TokenTable::from_json(&json).unwrap()
}

fn lay_out(root: &ResolvedNode, width: f32) -> Layout {
    let registry = Registry::with_builtins();
    let tokens = tokens();
    let scx = StyleCx {
        tokens: &tokens,
        ..StyleCx::empty()
    };
    let out = std::cell::RefCell::new(None);
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let cx = MeasureCx::new(ui.ctx());
        *out.borrow_mut() = Some(layout(
            &cx,
            &scx,
            &registry,
            root,
            egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(width, 800.0)),
        ));
    });
    harness.run();
    let out = out.borrow_mut().take().expect("layout ran");
    out
}

#[test]
fn button_rect_covers_label_and_padding() {
    let mut row = node("Row", "r", &[("direction", s("row"))]);
    child(&mut row, node("we-button", "r/b", &[("text", s("solid"))]));
    let layout = lay_out(&row, 400.0);
    let b = layout.rects.get(&NodeId::from("r/b")).copied().unwrap();

    // md: component-height 40, px space-400 = 16px a side. The galley for
    // "solid" at font-size-300 (16px) is ~30px — the box must cover it with
    // the padding outside the label, not a shrink-wrapped 40px square.
    assert!(
        (b.height() - 40.0).abs() < 0.5,
        "button height should be the md component height: {b:?}"
    );
    assert!(
        b.width() >= 32.0 + 24.0,
        "button rect must cover label + 2×16px padding: {b:?}"
    );
}

#[test]
fn loading_button_measures_spinner_and_label() {
    let mut row = node("Row", "r", &[("direction", s("row"))]);
    child(
        &mut row,
        node(
            "we-button",
            "r/b",
            &[("text", s("busy")), ("loading", Value::Bool(true))],
        ),
    );
    let layout = lay_out(&row, 400.0);
    let b = layout.rects.get(&NodeId::from("r/b")).copied().unwrap();
    assert!(
        b.width() >= 16.0 + 8.0 + 24.0 + 32.0,
        "loading button must cover spinner + gap + label + padding: {b:?}"
    );
}

#[test]
fn square_button_is_icon_sized() {
    let mut row = node("Row", "r", &[("direction", s("row"))]);
    child(
        &mut row,
        node(
            "we-button",
            "r/b",
            &[("square", Value::Bool(true)), ("label", s("close"))],
        ),
    );
    let layout = lay_out(&row, 400.0);
    let b = layout.rects.get(&NodeId::from("r/b")).copied().unwrap();
    assert!(
        (b.width() - 40.0).abs() < 0.5 && (b.height() - 40.0).abs() < 0.5,
        "square button is height² — no room for the label: {b:?}"
    );
}

#[test]
fn alert_rect_covers_text_and_padding() {
    let mut col = node("Column", "c", &[]);
    child(
        &mut col,
        node(
            "we-alert",
            "c/a",
            &[("text", s("an info alert")), ("tone", s("danger"))],
        ),
    );
    let layout = lay_out(&col, 400.0);
    let a = layout.rects.get(&NodeId::from("c/a")).copied().unwrap();

    // py space-300 = 12px a side over a 16px+ icon/text line — the alert is
    // much taller than its padding alone (the old leaf bug gave 24px).
    assert!(
        a.height() >= 16.0 + 24.0 - 0.5,
        "alert must cover icon/text + py: {a:?}"
    );
    assert!(
        a.height() < 16.0 + 24.0 + 24.0,
        "alert is one line of content, not a padded box around nothing: {a:?}"
    );
}

#[test]
fn truncate_sees_the_container_width() {
    let mut col = node("Column", "c", &[("width", s("120px"))]);
    child(
        &mut col,
        node(
            "we-text",
            "c/t",
            &[
                ("text", s("a much longer line than the card allows")),
                ("truncate", Value::Bool(true)),
            ],
        ),
    );
    let layout = lay_out(&col, 400.0);
    let t = layout.rects.get(&NodeId::from("c/t")).copied().unwrap();
    assert!(
        t.width() <= 120.0 + 0.5,
        "truncate must lay out at the column's width, not max-content: {t:?}"
    );
}

#[test]
fn truncate_ellipsizes_the_galley() {
    // `…` is a glyph, not text — assert the galley's last row ends with it,
    // and that the measured box is no wider than what was offered.
    let text = node(
        "we-text",
        "c/t",
        &[
            ("text", s("a much longer line than the card allows")),
            ("truncate", Value::Bool(true)),
        ],
    );
    let registry = Registry::with_builtins();
    let tokens = tokens();
    let scx = StyleCx {
        tokens: &tokens,
        ..StyleCx::empty()
    };
    let out = std::cell::RefCell::new(None);
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let cx = MeasureCx::new(ui.ctx());
        let style = we_egui::style_of(&text, &scx);
        let widget = registry.widget_for(&text.ty);
        let measured = widget.measure(&cx, &text, &style, we_egui::Size::new(120.0, f32::INFINITY));
        let g = we_egui::text_job(
            "a much longer line than the card allows",
            &style,
            ui.ctx(),
            120.0,
            true,
            None,
        );
        *out.borrow_mut() = Some((measured, g.size(), g.rows[0].glyphs.last().map(|g| g.chr)));
    });
    harness.run();
    let (measured, galley_size, last) = out.borrow_mut().take().expect("measured");
    assert_eq!(last, Some('…'), "truncated galley ends in an ellipsis");
    assert!(
        galley_size.x <= 120.5 && measured.x <= 120.5,
        "truncate measures/paints no wider than offered: {measured:?} {galley_size:?}"
    );
}

#[test]
fn lines_clamp_holds_two_rows() {
    let mut col = node("Column", "c", &[("width", s("120px"))]);
    child(
        &mut col,
        node(
            "we-text",
            "c/t",
            &[
                (
                    "text",
                    s("wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap"),
                ),
                ("lines", Value::Num(2.0)),
            ],
        ),
    );
    let layout = lay_out(&col, 400.0);
    let t = layout.rects.get(&NodeId::from("c/t")).copied().unwrap();
    // ~22px a row at font-size-300 + line-height: two rows clamped — not one
    // (a no-wrap measure) and not the whole paragraph (no clamp).
    assert!(
        t.height() > 30.0 && t.height() < 60.0,
        "lines: 2 must wrap and clamp at two rows: {t:?}"
    );
}

/// Layout + paint `root` in a kittest harness; returns the layout and the
/// position every painted galley landed at (`Shape::Text.pos`).
fn painted_galleys(root: &ResolvedNode, width: f32) -> (Layout, Vec<egui::Pos2>) {
    let registry = Registry::with_builtins();
    let tokens = tokens();
    let scx = StyleCx {
        tokens: &tokens,
        ..StyleCx::empty()
    };
    let out = std::cell::RefCell::new(None);
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let ctx = ui.ctx().clone();
        let cx = MeasureCx::new(&ctx);
        let lay = layout(
            &cx,
            &scx,
            &registry,
            root,
            egui::Rect::from_min_size(ui.cursor().min, egui::vec2(width, 800.0)),
        );
        let mut events = Vec::new();
        let mut edit = EditState::default();
        paint(ui, &registry, &scx, root, &lay, &mut events, &mut edit, 0.0);
        let layer = ui.layer_id();
        let galleys: Vec<egui::Pos2> = ctx.graphics(|g| {
            g.get(layer)
                .map(|list| {
                    list.all_entries()
                        .filter_map(|cs| match &cs.shape {
                            egui::Shape::Text(t) => Some(t.pos),
                            _ => None,
                        })
                        .collect()
                })
                .unwrap_or_default()
        });
        *out.borrow_mut() = Some((lay, galleys));
    });
    harness.run();
    let out = out.borrow_mut().take().expect("rendered");
    out
}

#[test]
fn padded_text_measures_and_paints_the_content_box() {
    // The browser's answer for a stretched, padded leaf: the border box
    // fills the 120px column, but the glyphs live inside the padding —
    // measure wraps them at the 80px content box (the padded text is
    // TALLER), and paint draws them at `rect.min + 20`. Round-3's
    // heights-match assertion locked the border-box bug in.
    let mut col = node("Column", "c", &[("width", s("120px"))]);
    let text = s("a much longer line than the card allows");
    child(&mut col, node("we-text", "c/a", &[("text", text.clone())]));
    child(
        &mut col,
        node("we-text", "c/b", &[("text", text), ("px", s("20px"))]),
    );
    let (layout, galleys) = painted_galleys(&col, 400.0);
    let a = layout.rects.get(&NodeId::from("c/a")).copied().unwrap();
    let b = layout.rects.get(&NodeId::from("c/b")).copied().unwrap();
    assert!(
        (b.width() - 120.0).abs() < 0.5,
        "the padded text still stretches to the column width: {b:?}"
    );
    assert!(
        b.height() > a.height() + 1.0,
        "padded text wraps at the 80px content box — taller than unpadded: {a:?} {b:?}"
    );
    // The painted galley's left edge sits at the content edge, 20px in.
    let pos = galleys
        .iter()
        .find(|p| (p.y - b.min.y).abs() < 0.5)
        .copied();
    let Some(pos) = pos else {
        panic!("no galley painted at {b:?}: {galleys:?}")
    };
    assert!(
        pos.x >= b.min.x + 19.5,
        "the galley's left edge is inside the 20px padding: {pos:?} vs {b:?}"
    );
}

/// A `we-text` whose content arrives as a text *child* — the bundle's
/// dominant shape (TS `this.text ?? <slot>`), not the `text` prop.
fn child_text_node(id: &str, text: &str, props: &[(&str, Value)]) -> ResolvedNode {
    let mut n = node("we-text", id, props);
    n.children.push(ResolvedChild::Text(Arc::from(text)));
    n
}

/// Layout + paint `root`; returns the layout and `(pos, text)` of every
/// painted galley.
fn painted_galley_texts(root: &ResolvedNode, width: f32) -> (Layout, Vec<(egui::Pos2, String)>) {
    let registry = Registry::with_builtins();
    let tokens = tokens();
    let scx = StyleCx {
        tokens: &tokens,
        ..StyleCx::empty()
    };
    let out = std::cell::RefCell::new(None);
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let ctx = ui.ctx().clone();
        let cx = MeasureCx::new(&ctx);
        let lay = layout(
            &cx,
            &scx,
            &registry,
            root,
            egui::Rect::from_min_size(ui.cursor().min, egui::vec2(width, 800.0)),
        );
        let mut events = Vec::new();
        let mut edit = EditState::default();
        paint(ui, &registry, &scx, root, &lay, &mut events, &mut edit, 0.0);
        let layer = ui.layer_id();
        let galleys: Vec<(egui::Pos2, String)> = ctx.graphics(|g| {
            g.get(layer)
                .map(|list| {
                    list.all_entries()
                        .filter_map(|cs| match &cs.shape {
                            egui::Shape::Text(t) => Some((t.pos, t.galley.text().to_string())),
                            _ => None,
                        })
                        .collect()
                })
                .unwrap_or_default()
        });
        *out.borrow_mut() = Some((lay, galleys));
    });
    harness.run();
    let out = out.borrow_mut().take().expect("rendered");
    out
}

/// A1 — the same words via the `text` prop and via a text child must lay out
/// identically (TS `this.text ?? <slot>`: the child is the content, not an
/// anonymous box beside it).
#[test]
fn child_text_matches_the_text_prop_geometry() {
    let mut col = node("Column", "c", &[("width", s("120px"))]);
    child(
        &mut col,
        node(
            "we-text",
            "c/a",
            &[("text", s("wrap wrap wrap wrap wrap wrap"))],
        ),
    );
    child(
        &mut col,
        child_text_node("c/b", "wrap wrap wrap wrap wrap wrap", &[]),
    );
    let layout = lay_out(&col, 400.0);
    let a = layout.rects.get(&NodeId::from("c/a")).copied().unwrap();
    let b = layout.rects.get(&NodeId::from("c/b")).copied().unwrap();
    assert!(
        (a.size() - b.size()).length() < 0.5,
        "child text must lay out like the text prop: {a:?} vs {b:?}"
    );
    // The child text is the widget's own galley — no second span leaks into
    // `layout.texts` (that second owner is what double-painted).
    assert!(
        !layout
            .texts
            .iter()
            .any(|t| t.node == NodeId::from("c/b")),
        "absorbed child text must not also emit a span: {:?}",
        layout
            .texts
            .iter()
            .map(|t| (&t.node, &t.text))
            .collect::<Vec<_>>()
    );
}

/// A1 — `truncate` on a `we-text` with a text child must clamp at the row's
/// offered width (a raw nonshrinking span runs over the row and covers the
/// action beside it).
#[test]
fn truncated_child_text_stays_inside_a_narrow_row() {
    let mut row = node(
        "Row",
        "r",
        &[("direction", s("row")), ("width", s("200px"))],
    );
    child(
        &mut row,
        child_text_node(
            "r/t",
            "a much longer line than the row allows",
            &[("truncate", Value::Bool(true))],
        ),
    );
    child(&mut row, node("we-button", "r/b", &[("text", s("act"))]));
    let layout = lay_out(&row, 400.0);
    let t = layout.rects.get(&NodeId::from("r/t")).copied().unwrap();
    let b = layout.rects.get(&NodeId::from("r/b")).copied().unwrap();
    assert!(
        t.max.x <= 200.5,
        "truncated child text must not overrun the 200px row: {t:?}"
    );
    assert!(
        t.max.x <= b.min.x + 0.5,
        "the title must not cover the action: {t:?} vs {b:?}"
    );
}

/// A1 — `lines: 2` clamps child text the way `lines_clamp_holds_two_rows`
/// clamps the prop path.
#[test]
fn lines_clamp_applies_to_child_text() {
    let mut col = node("Column", "c", &[("width", s("120px"))]);
    child(
        &mut col,
        child_text_node(
            "c/t",
            "wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap wrap",
            &[("lines", Value::Num(2.0))],
        ),
    );
    let layout = lay_out(&col, 400.0);
    let t = layout.rects.get(&NodeId::from("c/t")).copied().unwrap();
    assert!(
        t.height() > 30.0 && t.height() < 60.0,
        "lines: 2 on child text must wrap and clamp at two rows: {t:?}"
    );
}

/// A1 — the child text paints exactly once, and transformed: `uppercase`
/// turns it into the galley TS renders, and only one galley carries it.
#[test]
fn child_text_paints_once_and_transformed() {
    let mut col = node("Column", "c", &[]);
    child(
        &mut col,
        child_text_node("c/t", "a child label", &[("uppercase", Value::Bool(true))]),
    );
    let (_layout, galleys) = painted_galley_texts(&col, 400.0);
    let hits: Vec<_> = galleys
        .iter()
        .filter(|(_, t)| t.to_lowercase().contains("a child label"))
        .collect();
    assert_eq!(
        hits.len(),
        1,
        "child text must paint once — the widget's galley, not a raw span: {galleys:?}"
    );
    assert!(
        hits[0].1.contains("A CHILD LABEL"),
        "uppercase must reach the painted galley: {galleys:?}"
    );
}

#[test]
fn lane_keeps_its_authored_width() {
    let mut row = node(
        "Row",
        "r",
        &[("direction", s("row")), ("height", s("80px"))],
    );
    let mut lane = node(
        "$lane",
        "r/l",
        &[("width", Value::Num(120.0)), ("bg", s("surface"))],
    );
    child(&mut lane, node("we-text", "r/l/t", &[("text", s("lane"))]));
    child(&mut row, lane);
    let layout = lay_out(&row, 400.0);
    let l = layout.rects.get(&NodeId::from("r/l")).copied().unwrap();
    assert!(
        (l.width() - 120.0).abs() < 0.5 && (l.height() - 80.0).abs() < 0.5,
        "$lane is a real widget: width 120 in an 80px row: {l:?}"
    );
}
