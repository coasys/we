//! A theme's component *stylesheet* — the rules its `index.css` writes
//! against elements and parts (`[data-we-theme='retro']
//! we-button::part(base)`) that the recorded token table cannot carry: vars
//! alone never produced a bevel.
//!
//! The rules are not transcribed here. [`we_style::stylesheet`] parses the
//! theme's own CSS (the shipped `index.css`, or a sheet a user theme
//! installed with [`install`]), and this module asks it, per node, what
//! the host element and its `base` part match under the
//! `[data-we-theme='<id>']` root — then lands the evaluated declarations on
//! the resolved [`Style`] where the part's own declarations would sit.
//! Parts that are not nodes (the switch's `thumb`/`track`, the modal's
//! `close-button`) are asked through [`part_style`] by their painters, and
//! `::before`/`::after` boxes through [`pseudo_boxes`].
use std::sync::Arc;

use we_expr::Value;
use we_style::stylesheet::{
    self, cascade, has_state, take_animation, Cascaded, Element, Matched, PseudoElement, Query,
    State, Stylesheet,
};
use we_style::{EvalCx, EvalResult, StateKind, Style, StylePatch};
use we_template::ResolvedNode;

use crate::defaults::{font_px, root_px, StyleCx};

pub use we_style::stylesheet::{install, uninstall};

/// The stylesheet `theme` paints with — an installed one first, else the
/// built-in theme's `index.css`.
pub fn sheet(theme: &str) -> Option<Arc<Stylesheet>> {
    stylesheet::for_theme(theme)
}

/// A node's prop as the attribute the element reflects: a string as
/// itself, `true` as present-and-empty, a number in its JS spelling;
/// `false`/`null`/absent as no attribute. Lit reflects camelCase props as
/// lowercase attributes, so the lookup ignores case.
fn node_attr(node: &ResolvedNode, name: &str) -> Option<Arc<str>> {
    let v = node
        .props
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v)?;
    match v {
        Value::Str(s) => Some(s.clone()),
        Value::Bool(true) => Some(Arc::from("")),
        Value::Bool(false) | Value::Null => None,
        Value::Num(_) => Some(Arc::from(v.js_string().as_str())),
        _ => None,
    }
}

/// Every rule `node` matches under `theme` for `parts` (`None` is the host)
/// and `pseudo`.
fn matched<'s>(
    sheet: &'s Stylesheet,
    theme: &str,
    node: &ResolvedNode,
    parts: &[Option<&str>],
    pseudo: Option<PseudoElement>,
) -> Vec<Matched<'s>> {
    let attr = |n: &str| node_attr(node, n);
    let el = Element {
        ty: &node.ty,
        attr: &attr,
    };
    let root_attr = |n: &str| (n == "data-we-theme").then(|| Arc::from(theme));
    let root = Element {
        ty: "",
        attr: &root_attr,
    };
    let ancestors = [root];
    let mut out = Vec::new();
    for part in parts {
        out.extend(sheet.matching(&Query {
            element: &el,
            ancestors: &ancestors,
            part: *part,
            pseudo,
        }));
    }
    out
}

fn eval_cx<'a>(scx: &'a StyleCx) -> EvalCx<'a> {
    EvalCx {
        tokens: scx.tokens,
        viewport: scx.viewport,
        font_px: font_px(scx),
        root_px: root_px(scx),
    }
}

fn patch_of(ev: EvalResult) -> StylePatch {
    StylePatch {
        layout: ev.layout,
        text: ev.text,
        paint: ev.paint,
        unsupported: ev.unsupported,
        animation: None,
    }
}

/// One cascade evaluated: the normal declarations, then the important ones
/// over them.
fn evaluate(
    c: &Cascaded,
    scx: &StyleCx,
    scope: &indexmap::IndexMap<Arc<str>, Arc<str>>,
) -> (StylePatch, StylePatch) {
    let cx = eval_cx(scx);
    (
        patch_of(we_style::eval_decls_in(&c.normal, &cx, scope)),
        patch_of(we_style::eval_decls_in(&c.important, &cx, scope)),
    )
}

fn merge(patch: &StylePatch, into: &mut StylePatch) {
    patch.layout.merge_into(&mut into.layout);
    patch.text.merge_into(&mut into.text);
    patch.paint.merge_into(&mut into.paint);
    into.unsupported.extend(patch.unsupported.iter().cloned());
}

/// An important `border*` beats a state's `border-color`/`border-width`
/// too — those would recolour or resize the sides the rule cleared.
fn important_over(important: &StylePatch, patch: &mut StylePatch) {
    merge(important, patch);
    if !important.paint.borders.all_unset() {
        patch.paint.border_color = None;
        patch.paint.border_width = None;
    }
}

const STATES: [(State, StateKind); 4] = [
    (State::Hover, StateKind::Hover),
    (State::Active, StateKind::Active),
    (State::Focus, StateKind::Focus),
    (State::Disabled, StateKind::Disabled),
];

fn slot(style: &mut Style, kind: StateKind) -> &mut Option<Box<StylePatch>> {
    match kind {
        StateKind::Hover => &mut style.hover,
        StateKind::Active => &mut style.active,
        StateKind::Focus => &mut style.focus,
        StateKind::Disabled => &mut style.disabled,
    }
}

/// `style_of`'s last pass: the rules the theme's stylesheet declares for
/// the node's host element and its `base` part, over whatever the bags
/// resolved.
///
/// - Resting rules land on the style and on `pretier` (state patches
///   rebuild from it) — over the authored props, since an outer `::part`
///   rule beats the part's own var-reading declaration.
/// - A rule written for a state (`::part(base):active`) becomes that
///   state's patch: the whole cascade in that state, with an authored
///   state bag still winning the slots it sets.
/// - `!important` declarations beat everything authored, state bags
///   included.
/// - `animation-*` resolves against the sheet's `@keyframes` onto
///   [`Style::animation`] (or a state patch's).
pub(crate) fn apply(scx: &StyleCx, node: &ResolvedNode, style: &mut Style) {
    if scx.theme.is_empty() {
        return;
    }
    let Some(sheet) = sheet(scx.theme) else {
        return;
    };
    let m = matched(&sheet, scx.theme, node, &[None, Some("base")], None);
    if m.is_empty() {
        return;
    }
    let scope = style.scope.clone();
    let mut rest = cascade(&m, None);
    let anim = take_animation(&mut rest, &sheet).map(Arc::new);
    let (normal, important) = evaluate(&rest, scx, &scope);
    let mut resting = normal;
    merge(&important, &mut resting);
    let land = |s: &mut Style| {
        resting.layout.merge_into(&mut s.layout);
        resting.text.merge_into(&mut s.text);
        resting.paint.merge_into(&mut s.paint);
        if anim.is_some() {
            s.animation = anim.clone();
        }
    };
    land(style);
    if let Some(pretier) = style.pretier.as_deref_mut() {
        land(pretier);
    }
    style
        .unsupported
        .extend(resting.unsupported.iter().cloned());

    for (state, kind) in STATES {
        let slot = slot(style, kind);
        if has_state(&m, state) {
            let mut c = cascade(&m, Some(state));
            let anim = take_animation(&mut c, &sheet).map(Arc::new);
            let (mut patch, imp) = evaluate(&c, scx, &scope);
            if let Some(authored) = slot.as_deref() {
                merge(authored, &mut patch);
            }
            important_over(&imp, &mut patch);
            patch.animation = anim;
            *slot = Some(Box::new(patch));
        } else if let Some(authored) = slot.as_deref_mut() {
            important_over(&important, authored);
        }
    }
}

/// What the theme's rules say about a part `node` does not expose as a
/// node — the switch's `thumb`/`track`, the modal's `close-button` — in
/// `state` (`None` at rest). `None` when no rule matches.
pub fn part_style(
    scx: &StyleCx,
    node: &ResolvedNode,
    part: &str,
    state: Option<StateKind>,
) -> Option<StylePatch> {
    if scx.theme.is_empty() {
        return None;
    }
    let sheet = sheet(scx.theme)?;
    let m = matched(&sheet, scx.theme, node, &[Some(part)], None);
    if m.is_empty() {
        return None;
    }
    let state = state.and_then(|k| STATES.iter().find(|(_, s)| *s == k).map(|(st, _)| *st));
    let mut c = cascade(&m, state);
    let anim = take_animation(&mut c, &sheet).map(Arc::new);
    let (mut patch, imp) = evaluate(&c, scx, scx.scope);
    merge(&imp, &mut patch);
    patch.animation = anim;
    Some(patch)
}

/// A generated `::before`/`::after` box: its key (`"::before"`), the part
/// of the element it hangs off (`None` is the host), and its evaluated
/// style.
#[derive(Debug, Clone)]
pub struct PseudoBox {
    pub key: &'static str,
    pub part: Option<&'static str>,
    pub style: Style,
}

/// The `::before`/`::after` boxes the theme generates on `node` (its host
/// and its `base` part). A box exists only where `content` is set and is
/// not `none` — CSS's rule; `content: none` is how a theme removes the
/// part's own pseudo-element, which [`suppressed_pseudos`] reports.
pub fn pseudo_boxes(scx: &StyleCx, node: &ResolvedNode) -> Vec<PseudoBox> {
    let mut out = Vec::new();
    if scx.theme.is_empty() {
        return out;
    }
    let Some(sheet) = sheet(scx.theme) else {
        return out;
    };
    for pseudo in [PseudoElement::Before, PseudoElement::After] {
        for part in [None, Some("base")] {
            let m = matched(&sheet, scx.theme, node, &[part], Some(pseudo));
            if m.is_empty() {
                continue;
            }
            let mut c = cascade(&m, None);
            let content = c.take("content");
            if content.as_deref().is_none_or(|v| v.trim() == "none") {
                continue;
            }
            let anim = take_animation(&mut c, &sheet).map(Arc::new);
            let (normal, imp) = evaluate(&c, scx, scx.scope);
            let mut p = normal;
            merge(&imp, &mut p);
            let style = Style {
                layout: p.layout,
                text: p.text,
                paint: p.paint,
                unsupported: p.unsupported,
                animation: anim,
                ..Style::default()
            };
            out.push(PseudoBox {
                key: pseudo.key(),
                part,
                style,
            });
        }
    }
    out
}

/// The pseudo-elements a theme removes with `content: none` — the
/// primitive's own decoration a painter should then leave out (retro's
/// `we-tabs::part(base)::before`).
pub fn suppressed_pseudos(
    scx: &StyleCx,
    node: &ResolvedNode,
    part: Option<&str>,
) -> Vec<PseudoElement> {
    let mut out = Vec::new();
    let Some(sheet) = (!scx.theme.is_empty()).then(|| sheet(scx.theme)).flatten() else {
        return out;
    };
    for pseudo in [PseudoElement::Before, PseudoElement::After] {
        let m = matched(&sheet, scx.theme, node, &[part], Some(pseudo));
        if cascade(&m, None).get("content").as_deref().map(str::trim) == Some("none") {
            out.push(pseudo);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use we_style::{eval_box_shadow, eval_clip_path, eval_color, BorderKind, Color};

    fn color(text: &str) -> Color {
        eval_color(text).unwrap()
    }

    const RETRO_BEVEL: &str =
        "inset -1px -1px #0a0a0a, inset 1px 1px #fff, inset -2px -2px grey, inset 2px 2px #dfdfdf";
    const RETRO_PRESSED: &str =
        "inset -1px -1px #fff, inset 1px 1px #0a0a0a, inset -2px -2px #dfdfdf, inset 2px 2px grey";

    fn node(ty: &str, props: &[(&str, Value)]) -> ResolvedNode {
        ResolvedNode {
            id: we_template::NodeId::from("n"),
            ty: Arc::from(ty),
            props: props
                .iter()
                .map(|(k, v)| (Arc::<str>::from(*k), v.clone()))
                .collect(),
            handlers: indexmap::IndexMap::new(),
            slot: None,
            children: vec![],
            transition: None,
        }
    }

    fn themed(theme: &'static str) -> StyleCx<'static> {
        let mut scx = StyleCx::empty();
        scx.theme = theme;
        scx
    }

    fn bag(pairs: &[(&str, &str)]) -> Value {
        Value::from(
            pairs
                .iter()
                .map(|(k, v)| (Arc::<str>::from(*k), Value::from(*v)))
                .collect::<indexmap::IndexMap<Arc<str>, Value>>(),
        )
    }

    /// A retro button node with authored state bags that try to recolour
    /// what the theme declares `!important`.
    fn retro_button_with_states() -> ResolvedNode {
        let paint = [
            ("bg", "#ff0000"),
            ("color", "#0000ff"),
            ("border", "3px solid #00ff00"),
        ];
        node(
            "we-button",
            &[
                ("label", Value::from("OK")),
                ("hoverProps", bag(&paint)),
                ("activeProps", bag(&paint)),
                ("focusProps", bag(&paint)),
                ("disabledProps", bag(&paint)),
            ],
        )
    }

    /// `background: silver !important; color: #222 !important; border: 0
    /// !important` — an !important declaration beats every non-important
    /// one, `:hover`/`:active`/`:focus`/`:disabled` bags included.
    #[test]
    fn important_retro_button_decls_survive_every_state() {
        let style = crate::defaults::style_of(&retro_button_with_states(), &themed("retro"));
        for kind in [
            StateKind::Hover,
            StateKind::Active,
            StateKind::Focus,
            StateKind::Disabled,
        ] {
            assert!(style.state(kind).is_some(), "{kind:?} bag resolved");
            let s = style.with_state(kind);
            assert_eq!(s.paint.bg, Some(color("silver")), "{kind:?} bg");
            assert_eq!(s.text.color, Some(color("#222")), "{kind:?} color");
            for side in s.paint.borders.as_slice() {
                assert!(
                    side.as_ref().is_some_and(|b| b.kind == BorderKind::None),
                    "{kind:?} border stays 0: {side:?}"
                );
            }
        }
    }

    /// `we-button::part(base):active` swaps the bevel; an authored
    /// `activeProps` shadow still wins its slot (the rule is not
    /// important).
    #[test]
    fn retro_pressed_bevel_on_active() {
        let style = crate::defaults::style_of(&node("we-button", &[]), &themed("retro"));
        assert_eq!(style.paint.shadows, eval_box_shadow(RETRO_BEVEL));
        let active = style.with_state(StateKind::Active);
        assert_eq!(active.paint.shadows, eval_box_shadow(RETRO_PRESSED));
        assert_eq!(active.paint.bg, Some(color("silver")));
        let authored = node("we-button", &[("activeProps", bag(&[("shadow", "none")]))]);
        let style = crate::defaults::style_of(&authored, &themed("retro"));
        let active = style.with_state(StateKind::Active);
        assert_ne!(active.paint.shadows, eval_box_shadow(RETRO_PRESSED));
    }

    #[test]
    fn retro_disabled_button_carries_text_shadow() {
        let scx = themed("retro");
        let plain = crate::defaults::style_of(&node("we-button", &[]), &scx);
        assert_eq!(plain.paint.text_shadows, None);
        let off =
            crate::defaults::style_of(&node("we-button", &[("disabled", Value::Bool(true))]), &scx);
        assert_eq!(off.paint.text_shadows, eval_box_shadow("1px 1px 0 #fff"));
    }

    #[test]
    fn cyberpunk_rules_land_on_their_elements() {
        let scx = themed("cyberpunk");
        let button = crate::defaults::style_of(&node("we-button", &[]), &scx);
        assert!(matches!(
            button.paint.clip,
            Some(we_style::ClipPath::Polygon(_))
        ));
        let hover = button.with_state(StateKind::Hover);
        assert_eq!(hover.paint.clip, Some(we_style::ClipPath::None));
        assert_eq!(hover.animation.as_ref().unwrap().duration_ms, 2000.0);
        assert!(button.animation.is_none());
        // The menu-item and tab clips the hand table never carried.
        let tab = crate::defaults::style_of(&node("we-tab", &[]), &scx);
        assert_eq!(
            tab.paint.clip,
            eval_clip_path("polygon(87% 0, 0 0, 0 50%, 13% 100%, 88% 100%, 100% 100%, 99% 16%)")
        );
        let item = crate::defaults::style_of(&node("we-menu-item", &[]), &scx);
        assert!(item.paint.clip.is_some());
        assert_eq!(item.layout.margin.right, Some(we_style::Dimension::Px(0.0)));
        // Headings take the glitch, body text does not.
        let h = crate::defaults::style_of(
            &node("we-text", &[("variant", Value::from("heading-md"))]),
            &scx,
        );
        assert_eq!(h.animation.as_ref().unwrap().name.as_ref(), "glitched");
        assert_eq!(h.layout.display, Some(we_style::Display::Block));
        let body =
            crate::defaults::style_of(&node("we-text", &[("variant", Value::from("body"))]), &scx);
        assert!(body.animation.is_none());
    }

    #[test]
    fn cyberpunk_input_borders_collapse_and_recolour_on_focus() {
        let mut vars = indexmap::IndexMap::new();
        vars.insert(Arc::from("--we-color-accent-200"), Arc::from("#112233"));
        vars.insert(Arc::from("--we-color-accent-500"), Arc::from("#445566"));
        let tokens = we_style::TokenTable::new(vars);
        let mut scx = themed("cyberpunk");
        scx.tokens = Box::leak(Box::new(tokens));
        let style = crate::defaults::style_of(&node("we-input", &[]), &scx);
        let w = |s: &Option<we_style::BorderSide>| s.as_ref().unwrap().width;
        let b = &style.paint.borders;
        assert_eq!(w(&b.top), Some(we_style::Dimension::Px(10.0)));
        assert_eq!(w(&b.left), Some(we_style::Dimension::Px(2.0)));
        assert!(b
            .as_slice()
            .iter()
            .all(|s| s.as_ref().unwrap().color == Some(color("#112233"))));
        assert_eq!(style.layout.height, Some(we_style::Dimension::Px(60.0)));
        let focus = style.with_state(StateKind::Focus);
        assert!(focus
            .paint
            .borders
            .as_slice()
            .iter()
            .all(|s| s.as_ref().unwrap().color == Some(color("#445566"))));
    }

    #[test]
    fn parts_without_nodes_answer_through_part_style() {
        let scx = themed("retro");
        let switch = node("we-switch", &[]);
        let thumb = part_style(&scx, &switch, "thumb", None).unwrap();
        assert_eq!(thumb.paint.shadows, eval_box_shadow(RETRO_BEVEL));
        assert!(part_style(&scx, &switch, "nope", None).is_none());
        let modal = node("we-modal", &[]);
        let close = part_style(&scx, &modal, "close-button", None).unwrap();
        assert_eq!(close.paint.bg, Some(color("silver")));
        assert!(part_style(&themed("dark"), &switch, "thumb", None).is_none());
    }

    #[test]
    fn pseudo_boxes_need_content() {
        let scx = themed("cyberpunk");
        let h = node("we-text", &[("variant", Value::from("heading-lg"))]);
        let boxes = pseudo_boxes(&scx, &h);
        assert_eq!(boxes.len(), 1);
        assert_eq!(boxes[0].key, "::after");
        assert_eq!(
            boxes[0].style.layout.height,
            Some(we_style::Dimension::Px(10.0))
        );
        assert!(boxes[0].style.paint.clip.is_some());
        assert!(pseudo_boxes(&scx, &node("we-text", &[])).is_empty());
        let retro = themed("retro");
        let item = pseudo_boxes(&retro, &node("we-menu-item", &[]));
        assert_eq!(item.len(), 1);
        assert_eq!(item[0].part, Some("base"));
        assert_eq!(
            item[0].style.layout.position,
            Some(we_style::Position::Absolute)
        );
        // `content: none` generates nothing and is reported as a removal.
        let tabs = node("we-tabs", &[]);
        assert!(pseudo_boxes(&retro, &tabs).is_empty());
        assert_eq!(
            suppressed_pseudos(&retro, &tabs, Some("base")),
            vec![PseudoElement::Before]
        );
    }

    #[test]
    fn installed_sheet_replaces_nothing_else() {
        install(
            "test-user-theme",
            "[data-we-theme='test-user-theme'] we-badge::part(base) { background: #123456 }",
        );
        let style = crate::defaults::style_of(&node("we-badge", &[]), &themed("test-user-theme"));
        assert_eq!(style.paint.bg, Some(color("#123456")));
        uninstall("test-user-theme");
        let style = crate::defaults::style_of(&node("we-badge", &[]), &themed("test-user-theme"));
        assert_eq!(style.paint.bg, None);
    }
}
