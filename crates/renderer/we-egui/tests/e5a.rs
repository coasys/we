//! E5a round-2 layout assertions: button boxes must cover label + padding,
//! alert boxes must cover their text + padding, `truncate`/`lines` must see
//! the container's width, and a `$lane` keeps its authored width.
use std::path::PathBuf;
use std::sync::Arc;

use egui_kittest::kittest::Queryable;
use indexmap::IndexMap;
use we_egui::{layout, paint, EditState, Layout, MeasureCx, Registry, StyleCx, WidgetEvent};
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

/// The media fonts + tofu policy the icon/identicon/image paths need —
/// a missing glyph is a paint detail, not a test failure.
fn harness_ui<'a>(run: impl FnMut(&mut egui::Ui) + 'a) -> egui_kittest::Harness<'a> {
    egui_kittest::Harness::builder()
        // The image loader's ⚠ has no glyph in the test fonts — a paint
        // detail, not a failure. install_media supplies the rest.
        .allow_missing_glyphs()
        .with_context_setup(|ctx| we_egui::install_media(ctx))
        .build_ui(run)
}
fn lay_out(root: &ResolvedNode, width: f32) -> Layout {
    let registry = Registry::with_builtins();
    let tokens = tokens();
    let scx = StyleCx {
        tokens: &tokens,
        ..StyleCx::empty()
    };
    let out = std::cell::RefCell::new(None);
    let mut harness = harness_ui(|ui| {
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
    let mut harness = harness_ui(|ui| {
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
    let mut harness = harness_ui(|ui| {
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
    let mut harness = harness_ui(|ui| {
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
        !layout.texts.iter().any(|t| t.node == NodeId::from("c/b")),
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

// ---------- A2: we-avatar props ----------------------------------------

/// Every painted shape on `root`'s layer — the galley helper's sibling for
/// the avatar's non-text content (image, identicon cells, ring strokes).
fn painted_shapes(root: &ResolvedNode, width: f32) -> (Layout, Vec<egui::Shape>) {
    let registry = Registry::with_builtins();
    let tokens = tokens();
    let scx = StyleCx {
        tokens: &tokens,
        ..StyleCx::empty()
    };
    let out = std::cell::RefCell::new(None);
    let mut harness = harness_ui(|ui| {
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
        let shapes: Vec<egui::Shape> = ctx.graphics(|g| {
            g.get(layer)
                .map(|list| list.all_entries().map(|cs| cs.shape.clone()).collect())
                .unwrap_or_default()
        });
        *out.borrow_mut() = Some((lay, shapes));
    });
    harness.run();
    let out = out.borrow_mut().take().expect("rendered");
    out
}

/// A2 — `size` is the TS tier vocabulary, not a bare number:
/// `avatarSize` in `1-tokens/src/size.ts` and the `size=` attribute rules in
/// avatar.ts. Custom sizes are CSS lengths; numbers are px.
#[test]
fn avatar_size_tiers_resolve_to_the_ts_scale() {
    let cases: Vec<(Value, f32)> = vec![
        (s("xxs"), 16.0),
        (s("xs"), 24.0),
        (s("sm"), 32.0),
        (s("md"), 40.0),
        (s("lg"), 48.0),
        (s("xl"), 64.0),
        (s("xxl"), 80.0),
        (s("20px"), 20.0),
        (Value::Num(20.0), 20.0),
    ];
    let mut col = node("Column", "c", &[]);
    for (i, (size, _)) in cases.iter().enumerate() {
        child(
            &mut col,
            node("we-avatar", &format!("c/a{i}"), &[("size", size.clone())]),
        );
    }
    let layout = lay_out(&col, 400.0);
    for (i, (_, want)) in cases.iter().enumerate() {
        let r = layout
            .rects
            .get(&NodeId::from(format!("c/a{i}").as_str()))
            .copied()
            .unwrap();
        assert!(
            (r.width() - want).abs() < 0.5 && (r.height() - want).abs() < 0.5,
            "size #{i} should be {want}px: {r:?}"
        );
    }
    // No `size` at all → `--we-avatar-size` = md = 40px.
    let layout = lay_out(&node("we-avatar", "a", &[]), 400.0);
    let r = layout.rects.get(&NodeId::from("a")).copied().unwrap();
    assert!(
        (r.width() - 40.0).abs() < 0.5,
        "the default avatar is md = 40px: {r:?}"
    );
}

/// A2 — `initials` is a name to *derive* letters from (`derivedInitials` in
/// avatar.ts): first char of the first word plus first char of the last,
/// uppercase; a single word gives one letter. It is not a literal string —
/// "Nico Luck" paints "NL", never "Nic".
#[test]
fn avatar_initials_derive_first_and_last_letters() {
    for (init, want) in [("Nico Luck", "NL"), ("Flux", "F"), (" ada  b. ", "AB")] {
        let av = node("we-avatar", "a", &[("initials", s(init))]);
        let (_layout, galleys) = painted_galley_texts(&av, 400.0);
        assert!(
            galleys.iter().any(|(_, t)| t.trim() == want),
            "{init:?} should paint {want:?}: {galleys:?}"
        );
        assert!(
            !galleys.iter().any(|(_, t)| t.trim() == init.trim()),
            "the initials prop is a source string, not the literal letters: {galleys:?}"
        );
    }
}

/// A2 — `image` is the picture prop (avatar.ts `this.image`; `url`/`src`
/// are accepted spellings), and a picture outranks initials and hash in
/// `renderContent`.
#[test]
fn avatar_image_prop_supplies_the_picture() {
    // A 1px svg — the point is an Image shape, not a decode. (PNG is not a
    // registered loader in this workspace: egui_extras' `image` dep is
    // default-features=false — `webp`/`svg` are what load.)
    const SVG: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E";
    let av = node(
        "we-avatar",
        "a",
        &[
            ("image", s(SVG)),
            ("initials", s("Nico Luck")),
            ("hash", s("did:key:z6Mk")),
        ],
    );
    let (_layout, shapes) = painted_shapes(&av, 400.0);
    // The image branch ran when a texture mesh or the loader's ⚠ placeholder
    // is what was painted — either way it is the `image` prop being read.
    let image_path = shapes.iter().any(|s| match s {
        egui::Shape::Mesh(m) => m.texture_id != egui::TextureId::default(),
        egui::Shape::Text(t) => t.galley.text().contains('⚠'),
        _ => false,
    });
    assert!(
        image_path,
        "an `image` prop must reach the image loader: {shapes:?}"
    );
    assert!(
        !shapes
            .iter()
            .any(|s| matches!(s, egui::Shape::Text(t) if t.galley.text().contains("NL"))),
        "the picture covers the initials — none are drawn: {shapes:?}"
    );
}

/// A2 — with no image and no initials, `hash` draws the generated pattern
/// (jdenticon) — glyphs and `?`s never appear; with neither, the `icon`
/// prop (default `user`) paints the glyph.
#[test]
fn avatar_falls_back_to_hash_pattern_then_icon() {
    // hash only → pattern cells on the disc, zero text shapes.
    let av = node("we-avatar", "a", &[("hash", s("did:key:z6Mk"))]);
    let (_layout, shapes) = painted_shapes(&av, 400.0);
    assert!(
        !shapes.iter().any(|s| matches!(s, egui::Shape::Text(_))),
        "a hashed avatar draws a pattern, not letters or a glyph: {shapes:?}"
    );
    // icon → a single glyph galley; default is `user`.
    for props in [vec![("icon", s("camera"))], vec![]] {
        let av = node("we-avatar", "a", &props);
        let (_layout, galleys) = painted_galley_texts(&av, 400.0);
        let glyph = galleys
            .iter()
            .find(|(_, t)| t.trim().chars().count() == 1)
            .map(|(_, t)| t.trim().to_string());
        assert!(
            glyph.is_some() && glyph.as_deref() != Some("?"),
            "empty avatar falls back to the icon glyph: {galleys:?}"
        );
    }
}

/// A2 — `initialsFill` seeds the generated disc colour from `hash || initials`
/// (`seededFill`): two avatars with the same letters and different hashes
/// wear different fills.
#[test]
fn avatar_initials_fill_is_seeded_by_the_hash() {
    let mut col = node("Column", "c", &[]);
    child(
        &mut col,
        node(
            "we-avatar",
            "c/a",
            &[("initials", s("Nico Luck")), ("hash", s("did:key:a"))],
        ),
    );
    child(
        &mut col,
        node(
            "we-avatar",
            "c/b",
            &[("initials", s("Nico Luck")), ("hash", s("did:key:b"))],
        ),
    );
    let (layout, shapes) = painted_shapes(&col, 400.0);
    let fill_at = |id: &str| -> egui::Color32 {
        let r = layout.rects.get(&NodeId::from(id)).copied().unwrap();
        shapes
            .iter()
            .find_map(|s| match s {
                egui::Shape::Rect(fr) if fr.rect.contains(r.center()) => Some(fr.fill),
                _ => None,
            })
            .unwrap_or_default()
    };
    let (a, b) = (fill_at("c/a"), fill_at("c/b"));
    assert_ne!(
        a, b,
        "different hashes must seed different fills (seededFill): {a:?} {b:?}"
    );
    assert!(
        a.to_normalized_gamma_f32()[3] > 0.9,
        "the fill is opaque — the generated bg, not no fill at all"
    );
}

/// A2 — `avatarInnerRings`: `ringColor` resolves tones through the role
/// tokens (`avatarToneColor` → `--we-role-{tone}`), any other string is a
/// CSS colour; `ringWidth` is a CSS length inside the edge.
#[test]
fn avatar_ring_paints_the_resolved_role_color() {
    let av = node(
        "we-avatar",
        "a",
        &[
            ("ringColor", s("success")),
            ("ringWidth", s("3px")),
            ("initials", s("Nico Luck")),
        ],
    );
    let (_layout, shapes) = painted_shapes(&av, 400.0);
    let want = props_color32("oklch(0.75 0.229405 145)");
    assert!(
        shapes.iter().any(|s| match s {
            // `painter.rect_stroke` emits a stroked RectShape.
            egui::Shape::Rect(r) => r.stroke.width > 0.5 && stroke_is(r.stroke.color, want),
            _ => false,
        }),
        "ringColor: success must paint a --we-role-success stroke: {shapes:?}"
    );
}

fn props_color32(css: &str) -> egui::Color32 {
    let c = we_style::eval_color(css).expect("eval");
    let [r, g, b, a] = c.to_premultiplied();
    egui::Color32::from_rgba_premultiplied(
        (r * 255.0) as u8,
        (g * 255.0) as u8,
        (b * 255.0) as u8,
        (a * 255.0) as u8,
    )
}

fn stroke_is(got: egui::Color32, want: egui::Color32) -> bool {
    let d = |a: u8, b: u8| (a as i32 - b as i32).abs();
    d(got.r(), want.r()) <= 2 && d(got.g(), want.g()) <= 2 && d(got.b(), want.b()) <= 2
}

/// A2 — `clickable` renders a button (avatar.ts): it emits the node's
/// `onClick`; a plain avatar emits nothing.
#[test]
fn clickable_avatar_emits_onclick() {
    let mut col = node("Column", "c", &[]);
    let mut av = node(
        "we-avatar",
        "c/a",
        &[
            ("initials", s("Nico Luck")),
            ("clickable", Value::Bool(true)),
        ],
    );
    av.handlers = handlers_list(&["onClick"]);
    child(&mut col, av);
    let registry = Registry::with_builtins();
    let tokens = tokens();
    let events = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    let ev = events.clone();
    let mut harness = harness_ui(move |ui| {
        let cx = MeasureCx::new(ui.ctx());
        let scx = StyleCx {
            tokens: &tokens,
            ..StyleCx::empty()
        };
        let lay = layout(
            &cx,
            &scx,
            &registry,
            &col,
            egui::Rect::from_min_size(ui.cursor().min, egui::vec2(400.0, 800.0)),
        );
        let mut edit = EditState::default();
        paint(
            ui,
            &registry,
            &scx,
            &col,
            &lay,
            &mut ev.borrow_mut(),
            &mut edit,
            0.0,
        );
    });
    harness.run();
    harness.get_by_label("NL").click();
    harness.run();
    assert!(
        events
            .borrow()
            .iter()
            .any(|e| e.handler.as_ref() == "onClick"),
        "a clickable avatar emits onClick: {:?}",
        events.borrow()
    );
}

// ---------- A3: we-tooltip slotted content ------------------------------

/// A `we-tooltip`: `trigger` button child + a `slot="content"` we-text —
/// the bundle's reaction-tooltip shape (a rich Column, here one line).
fn tooltip_node(id: &str, extra: &[(&str, Value)]) -> ResolvedNode {
    let mut tip = node("we-tooltip", id, extra);
    child(
        &mut tip,
        node("we-button", &format!("{id}/b"), &[("text", s("hover me"))]),
    );
    let mut content = node("we-text", &format!("{id}/c"), &[("text", s("tip body"))]);
    content.slot = Some(Arc::from("content"));
    child(&mut tip, content);
    tip
}

/// A3 — `slot="content"` is the bubble, not page content (tooltip.ts:
/// `<slot name="content">` inside `part="tooltip"`). At rest the slotted
/// child has no layout rect and paints nowhere.
#[test]
fn tooltip_content_slot_never_enters_page_layout() {
    let tip = tooltip_node("t", &[("content", s("phrase"))]);
    let layout = lay_out(&tip, 400.0);
    assert!(
        layout.rects.get(&NodeId::from("t/c")).is_none(),
        "content-slot child must not enter page layout: {:?}",
        layout.rects.keys().collect::<Vec<_>>()
    );
    let (_l, galleys) = painted_galley_texts(&tip, 400.0);
    assert!(
        !galleys.iter().any(|(_, t)| t.contains("tip body")),
        "slotted content must not paint while closed: {galleys:?}"
    );
    // The trigger stays — its own galley.
    assert!(
        galleys.iter().any(|(_, t)| t.contains("hover me")),
        "the trigger child keeps painting: {galleys:?}"
    );
}

/// Galleys + `Layout` + `EditState` across ALL paint layers — the page
/// helpers only read the widget's own layer; overlays paint on their own.
struct PaintRig {
    layout: Layout,
    edit: EditState,
    texts: Vec<(egui::Pos2, String)>,
    events: Vec<WidgetEvent>,
}

/// Paint `root` inside the harness, then drain every layer's galley texts.
/// `interact` runs input steps between frames; it can run extra frames and
/// inspect the live `EditState` through the cell it is handed.
fn paint_rig(
    root: ResolvedNode,
    interact: impl FnOnce(
        &mut egui_kittest::Harness<'_>,
        &Layout,
        &std::cell::RefCell<Option<EditState>>,
    ),
) -> PaintRig {
    let registry = Registry::with_builtins();
    let tokens = tokens();
    let out = std::cell::RefCell::new(None);
    let texts = std::cell::RefCell::new(Vec::new());
    let events_cell = std::cell::RefCell::new(Vec::new());
    let lay_cell = std::cell::RefCell::new(None);
    let mut harness = harness_ui(|ui| {
        let ctx = ui.ctx().clone();
        let cx = MeasureCx::new(&ctx);
        let scx = StyleCx {
            tokens: &tokens,
            ..StyleCx::empty()
        };
        let lay = layout(
            &cx,
            &scx,
            &registry,
            &root,
            egui::Rect::from_min_size(ui.cursor().min, egui::vec2(400.0, 800.0)),
        );
        let mut events = events_cell.borrow().clone();
        let mut edit = out.borrow_mut().take().unwrap_or_default();
        paint(
            ui,
            &registry,
            &scx,
            &root,
            &lay,
            &mut events,
            &mut edit,
            0.0,
        );
        *out.borrow_mut() = Some(edit);
        *events_cell.borrow_mut() = events;
        *lay_cell.borrow_mut() = Some(lay);
        texts.borrow_mut().clear();
        ctx.graphics_mut(|g| {
            for cs in g.drain(&[], &Default::default()) {
                if let egui::Shape::Text(t) = cs.shape {
                    texts
                        .borrow_mut()
                        .push((t.pos, t.galley.text().to_string()));
                }
            }
        });
    });
    harness.run();
    // Move the snapshot out — `interact` may run frames that refill the cell.
    let snapshot = lay_cell.borrow_mut().take().expect("layout ran");
    interact(&mut harness, &snapshot, &out);
    if lay_cell.borrow().is_none() {
        *lay_cell.borrow_mut() = Some(snapshot);
    }
    harness.run();
    harness.run();
    let rig = PaintRig {
        layout: lay_cell.borrow_mut().take().unwrap(),
        edit: out.borrow_mut().take().unwrap_or_default(),
        texts: texts.borrow().clone(),
        events: events_cell.borrow().clone(),
    };
    rig
}

/// A3 — `open` is a real prop: with it set, the slotted child paints inside
/// the floating layer (the overlay pass), not the page.
#[test]
fn tooltip_open_prop_shows_the_slotted_content() {
    let rig = paint_rig(
        tooltip_node("t", &[("open", Value::Bool(true))]),
        |_, _, _| {},
    );
    assert!(
        rig.texts.iter().any(|(_, t)| t.contains("tip body")),
        "an open tooltip shows its slotted content: {:?}",
        rig.texts
    );
    // And it painted in the overlay — still no page rect for `t/c`.
    assert!(rig.layout.rects.get(&NodeId::from("t/c")).is_none());
}

/// A3 — hovering the trigger opens the tooltip (tooltip.ts `mouseenter →
/// show` — when there is something to say, which `content`/slotted
/// children provide).
#[test]
fn tooltip_hover_opens_the_bubble() {
    let rig = paint_rig(
        tooltip_node("t", &[("content", s("phrase"))]),
        |harness, lay, _| {
            let b = lay.rects.get(&NodeId::from("t/b")).copied().unwrap();
            harness.hover_at(b.center());
        },
    );
    assert!(
        rig.edit.is_open(&NodeId::from("t")),
        "hovering the trigger must open the tooltip"
    );
    assert!(
        rig.texts.iter().any(|(_, t)| t.contains("tip body")),
        "the open bubble shows the slotted content: {:?}",
        rig.texts
    );
}

/// A3 — `content` is the slot's *fallback* (tooltip.ts renders it inside
/// `<slot name="content">` when nothing is slotted): a prop-only tooltip
/// still shows its text on hover.
#[test]
fn tooltip_content_prop_is_the_slot_fallback() {
    let mut tip = node("we-tooltip", "t", &[("content", s("just text"))]);
    child(
        &mut tip,
        node("we-button", "t/b", &[("text", s("hover me"))]),
    );
    let rig = paint_rig(tip, |harness, lay, _| {
        let b = lay.rects.get(&NodeId::from("t/b")).copied().unwrap();
        harness.hover_at(b.center());
    });
    assert!(
        rig.texts.iter().any(|(_, t)| t.contains("just text")),
        "a prop-only tooltip shows its content text: {:?}",
        rig.texts
    );
}

// ---------- A4: custom scroll offsets -----------------------------------

/// The stored `_scroll` scratch y-offset for `id`.
fn scroll_y(edit: &EditState, id: &str) -> f64 {
    match edit.field(&NodeId::from(id), "_scroll") {
        Value::Obj(o) => match o.get("y") {
            Some(Value::Num(n)) => *n,
            _ => 0.0,
        },
        _ => 0.0,
    }
}

fn wheel_down(harness: &mut egui_kittest::Harness<'_>, px: f32) {
    harness.event(egui::Event::MouseWheel {
        unit: egui::MouseWheelUnit::Point,
        delta: egui::vec2(0.0, -px),
        phase: egui::TouchPhase::Move,
        source: egui::MouseWheelSource::Wheel,
        modifiers: egui::Modifiers::NONE,
    });
    harness.run();
}

/// A fixed-height scroll Column around a taller NON-SHRINKING inner
/// Column (flexShrink:0 — without it flexbox shrinks the child to fit,
/// and there is nothing to scroll).
fn scroll_col(id: &str, h: f64, inner_h: f64) -> ResolvedNode {
    let mut col = node(
        "Column",
        id,
        &[("height", Value::Num(h)), ("overflowY", s("auto"))],
    );
    child(
        &mut col,
        node(
            "Column",
            &format!("{id}/in"),
            &[
                ("height", Value::Num(inner_h)),
                ("flexShrink", Value::Num(0.0)),
            ],
        ),
    );
    col
}

/// A4 — egui's `smooth_scroll_delta` is content motion: scrolling down is
/// a negative y, so the stored offset must grow by `-delta`, not `+delta`.
#[test]
fn scroll_wheel_down_advances_the_offset() {
    let rig = paint_rig(scroll_col("c", 60.0, 300.0), |harness, lay, _| {
        let r = lay.rects.get(&NodeId::from("c")).copied().unwrap();
        harness.hover_at(r.center());
        wheel_down(harness, 40.0);
    });
    let y = scroll_y(&rig.edit, "c");
    assert!(
        y > 0.0,
        "wheel-down must advance the scroll offset, got {y}"
    );
}

/// A4 — the consumed delta dies in the inner container: a wheel over the
/// inner scroller moves it, not its scroll ancestor; once the inner hits
/// its max the same wheel chains outward.
#[test]
fn scroll_inner_consumes_then_chains_to_parent() {
    // outer 100px tall scrolling an inner scroller + tall pad; the inner
    // (40px viewport, 300px content → max 260) sits at the outer's top.
    let mut outer = node(
        "Column",
        "o",
        &[("height", Value::Num(100.0)), ("overflowY", s("auto"))],
    );
    let mut inner_scroller = scroll_col("o/i", 40.0, 300.0);
    inner_scroller
        .props
        .insert("flexShrink".into(), Value::Num(0.0));
    child(&mut outer, inner_scroller);
    child(
        &mut outer,
        node(
            "Column",
            "o/pad",
            &[
                ("height", Value::Num(400.0)),
                ("flexShrink", Value::Num(0.0)),
            ],
        ),
    );
    let rig = paint_rig(outer, |harness, lay, edit| {
        let r = lay.rects.get(&NodeId::from("o/i")).copied().unwrap();
        harness.hover_at(r.center());
        wheel_down(harness, 40.0);
        let (inner, outer) = {
            let e = edit.borrow();
            let e = e.as_ref().unwrap();
            (scroll_y(e, "o/i"), scroll_y(e, "o"))
        };
        assert!(inner > 0.0, "the inner scroller must scroll: {inner}");
        assert_eq!(outer, 0.0, "the inner must consume the wheel: {outer}");
        // Now run the inner to its max and past — the excess chains up.
        for _ in 0..10 {
            wheel_down(harness, 40.0);
        }
    });
    let inner = scroll_y(&rig.edit, "o/i");
    let outer = scroll_y(&rig.edit, "o");
    assert!(
        (inner - 260.0).abs() < 1.0,
        "the inner clamps at its content max: {inner}"
    );
    assert!(
        outer > 0.0,
        "wheel past the inner's max chains to the parent: {outer}"
    );
}

// ---------- A5: we-button child flow is an inline row -------------------

/// A5 — TS button.ts renders children inside `display:flex;
/// align-items:center; gap:…` — `we-button[we-icon, "label"]` puts icon
/// and text BESIDE each other, not stacked.
#[test]
fn button_child_flow_is_a_row() {
    let mut btn = node("we-button", "b", &[]);
    child(&mut btn, node("we-icon", "b/i", &[("name", s("check"))]));
    btn.children
        .push(we_template::ResolvedChild::Text(Arc::from("Save")));
    let layout = lay_out(&btn, 200.0);
    let icon = layout.rects.get(&NodeId::from("b/i")).copied().unwrap();
    let span = layout
        .texts
        .iter()
        .find(|t| t.text.as_ref() == "Save")
        .map(|t| t.rect)
        .expect("the label got a span");
    assert!(
        (icon.center().y - span.center().y).abs() < 4.0,
        "icon and label share the row's center line: icon {icon:?} label {span:?}"
    );
    assert!(
        span.min.x > icon.min.x,
        "the label sits right of the icon: icon {icon:?} label {span:?}"
    );
}

// ---------- A6: authored handlers on layout containers ------------------

fn click_at(harness: &mut egui_kittest::Harness<'_>, pos: egui::Pos2) {
    for pressed in [true, false] {
        harness.event(egui::Event::PointerButton {
            pos,
            button: egui::PointerButton::Primary,
            pressed,
            modifiers: egui::Modifiers::NONE,
        });
        harness.run();
    }
}

fn emitted(rig: &PaintRig, node: &str, handler: &str) -> bool {
    rig.events
        .iter()
        .any(|e| e.node == NodeId::from(node) && e.handler.as_ref() == handler)
}

/// A6 — createLayoutComponent forwards onClick/onMouseEnter/onMouseLeave
/// to the element: a Row with an authored handler must emit it.
#[test]
fn container_emits_authored_pointer_handlers() {
    let mut row = node(
        "Row",
        "r",
        &[("height", Value::Num(60.0)), ("width", Value::Num(200.0))],
    );
    row.handlers = handlers_list(&["onClick", "onMouseEnter", "onMouseLeave"]);
    child(
        &mut row,
        node("Column", "r/in", &[("height", Value::Num(20.0))]),
    );
    let rig = paint_rig(row, |harness, lay, _| {
        let r = lay.rects.get(&NodeId::from("r")).copied().unwrap();
        harness.hover_at(r.center());
        harness.run();
        click_at(harness, r.center());
        harness.hover_at(egui::pos2(r.min.x - 8.0, r.center().y));
        harness.run();
    });
    assert!(
        emitted(&rig, "r", "onClick"),
        "click on the row box emits onClick: {:?}",
        rig.events
    );
    assert!(
        emitted(&rig, "r", "onMouseEnter"),
        "entering the box emits onMouseEnter"
    );
    assert!(
        emitted(&rig, "r", "onMouseLeave"),
        "leaving the box emits onMouseLeave"
    );
}

/// A6 — DOM bubbling: a click landing on a child button still reaches the
/// container's onClick (the child fires too — that is propagation, not
/// double dispatch).
#[test]
fn container_onclick_bubbles_from_a_child() {
    let mut row = node(
        "Row",
        "r",
        &[("height", Value::Num(60.0)), ("width", Value::Num(200.0))],
    );
    row.handlers = handlers_list(&["onClick"]);
    let mut btn = node("we-button", "r/b", &[("text", s("inside"))]);
    btn.handlers = handlers_list(&["onClick"]);
    child(&mut row, btn);
    let rig = paint_rig(row, |harness, lay, _| {
        let b = lay.rects.get(&NodeId::from("r/b")).copied().unwrap();
        click_at(harness, b.center());
    });
    assert!(emitted(&rig, "r/b", "onClick"), "the button itself emits");
    assert!(
        emitted(&rig, "r", "onClick"),
        "the click bubbles to the row's onClick: {:?}",
        rig.events
    );
}

fn handlers_list(list: &[&str]) -> IndexMap<Arc<str>, we_template::HandlerRef> {
    list.iter()
        .map(|k| {
            (
                Arc::from(*k),
                we_template::HandlerRef {
                    tokens: vec![],
                    scope: Default::default(),
                },
            )
        })
        .collect()
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

// ---------- A7: resolved text style reaches the galley ----------

/// Position, text and the `TextFormat` baked into every painted galley —
/// the assertions A7 needs live on the format, not just the glyphs.
fn painted_galley_formats(
    root: &ResolvedNode,
    width: f32,
) -> (Layout, Vec<(egui::Pos2, String, egui::TextFormat)>) {
    let registry = Registry::with_builtins();
    let tokens = tokens();
    let scx = StyleCx {
        tokens: &tokens,
        ..StyleCx::empty()
    };
    let out = std::cell::RefCell::new(None);
    let mut harness = harness_ui(|ui| {
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
        let galleys: Vec<(egui::Pos2, String, egui::TextFormat)> = ctx.graphics(|g| {
            g.get(layer)
                .map(|list| {
                    list.all_entries()
                        .filter_map(|cs| match &cs.shape {
                            egui::Shape::Text(t) => Some((
                                t.pos,
                                t.galley.text().to_string(),
                                t.galley.job.sections[0].format.clone(),
                            )),
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

/// A7 — authored `fontWeight`/`italic`/`lineHeight`/`letterSpacing` must
/// reach the painted galley: TS emits `font-weight: 700`, `font-style:
/// italic`, `line-height: 2`, `letter-spacing: 2px` on the element.
/// With only static faces bundled, bold is approximated by a second
/// galley pass a fraction of a pixel right — the value still reaches the
/// job's `coords`.
#[test]
fn authored_font_style_and_metrics_reach_the_galley() {
    let mut col = node("Column", "c", &[]);
    child(
        &mut col,
        child_text_node(
            "c/t",
            "styled",
            &[
                ("italic", Value::Bool(true)),
                ("fontWeight", s("700")),
                ("lineHeight", s("2")),
                ("letterSpacing", s("2px")),
            ],
        ),
    );
    let (_lay, galleys) = painted_galley_formats(&col, 400.0);
    let hits: Vec<_> = galleys
        .iter()
        .filter(|(_, t, _)| t.contains("styled"))
        .collect();
    let f = &hits[0].2;
    assert!(f.italics, "italic must reach the galley format: {f:?}");
    assert_eq!(
        f.extra_letter_spacing, 2.0,
        "letterSpacing: 2px must reach the galley format: {f:?}"
    );
    assert_eq!(
        f.line_height,
        Some(f.font_id.size * 2.0),
        "lineHeight: 2 must reach the galley format: {f:?}"
    );
    assert!(
        f.coords
            .as_ref()
            .iter()
            .any(|(tag, v)| tag.to_string() == "wght" && *v == 700.0),
        "fontWeight: 700 must reach the galley as a wght coordinate: {f:?}"
    );
    assert!(
        hits.len() >= 2,
        "bold approximates as a second pass — one galley is a no-op: {galleys:?}"
    );
    let dx = (hits[1].0.x - hits[0].0.x).abs();
    assert!(
        dx > 0.0 && dx <= 1.5,
        "the bold pass sits a sub-pixel offset right: {hits:?}"
    );
}

/// A7 — CSS typography inherits: a `we-text` inside a styled Column gets
/// the column's color/fontSize/lineHeight/letterSpacing for both measure
/// and paint (the web resolves them in the cascade, not per element).
#[test]
fn parent_typography_inherits_into_child_text() {
    let mut col = node(
        "Column",
        "c",
        &[
            ("color", s("#3366cc")),
            ("fontSize", s("20px")),
            ("lineHeight", s("1.5")),
            ("letterSpacing", s("1px")),
        ],
    );
    child(&mut col, child_text_node("c/t", "inherits", &[]));
    // A bare text span two levels down — the row inherits the column's
    // typography and the span must measure/paint with it too.
    let mut row = node("Row", "c/r", &[]);
    row.children.push(ResolvedChild::Text(Arc::from("deep")));
    child(&mut col, row);
    let (lay, galleys) = painted_galley_formats(&col, 400.0);

    let t = lay.rects.get(&NodeId::from("c/t")).copied().unwrap();
    assert!(
        (t.height() - 30.0).abs() < 1.0,
        "the text box is 20px * 1.5 line-height = 30px, not the default: {t:?}"
    );
    let (_, _, f) = galleys
        .iter()
        .find(|(_, t, _)| t.contains("inherits"))
        .expect("the we-text galley painted");
    assert_eq!(
        f.font_id.size, 20.0,
        "fontSize inherits into the galley: {f:?}"
    );
    assert_eq!(
        f.color,
        egui::Color32::from_rgb(51, 102, 204),
        "color inherits into the galley: {f:?}"
    );
    assert_eq!(f.extra_letter_spacing, 1.0);
    assert_eq!(f.line_height, Some(30.0));

    let deep = galleys
        .iter()
        .find(|(_, t, _)| t.contains("deep"))
        .expect("the row's text span painted");
    assert_eq!(
        deep.2.font_id.size, 20.0,
        "two-level inheritance reaches the span: {:?}",
        deep.2
    );
    assert_eq!(deep.2.color, egui::Color32::from_rgb(51, 102, 204));
    let span = lay
        .texts
        .iter()
        .find(|s| s.node == NodeId::from("c/r"))
        .expect("the row owns a text span");
    assert!(
        (span.rect.height() - 30.0).abs() < 1.0,
        "the span measured at the inherited leading: {:?}",
        span.rect
    );
}

/// A7 — `opacity` composes down the tree (the web multiplies it into a
/// group): 0.5 × 0.5 fades descendant text to a quarter alpha.
#[test]
fn opacity_composes_into_descendant_text() {
    let mut col = node("Column", "c", &[("opacity", Value::Num(0.5))]);
    let mut inner = node("Column", "c/i", &[("opacity", Value::Num(0.5))]);
    child(&mut inner, child_text_node("c/i/t", "faded", &[]));
    child(&mut col, inner);
    let (_lay, galleys) = painted_galley_formats(&col, 400.0);
    let (_, _, f) = galleys
        .iter()
        .find(|(_, t, _)| t.contains("faded"))
        .expect("the faded text painted");
    assert!(
        (60.0..=68.0).contains(&(f.color.a() as f32)),
        "0.5×0.5 opacity fades the text alpha to ~64: {f:?}"
    );
}

/// A7 — the node's own typography beats the inherited parent's (the
/// cascade's normal rule — a guard so the merge doesn't clobber).
#[test]
fn own_text_style_beats_inherited() {
    let mut col = node(
        "Column",
        "c",
        &[("color", s("#3366cc")), ("fontSize", s("20px"))],
    );
    child(
        &mut col,
        child_text_node(
            "c/t",
            "mine",
            &[("color", s("#22cc88")), ("fontSize", s("10px"))],
        ),
    );
    let (_lay, galleys) = painted_galley_formats(&col, 400.0);
    let (_, _, f) = galleys
        .iter()
        .find(|(_, t, _)| t.contains("mine"))
        .expect("the own-styled text painted");
    assert_eq!(f.font_id.size, 10.0, "the authored size wins: {f:?}");
    assert_eq!(
        f.color,
        egui::Color32::from_rgb(34, 204, 136),
        "the authored color wins: {f:?}"
    );
}
