//! A theme's component *stylesheet* — the rules a theme's `index.css`
//! writes against parts (`[data-we-theme='retro'] we-button::part(base)`)
//! that the recorded token table cannot carry: vars alone never produced
//! a bevel. Each rule lands on the resolved [`Style`] — bg, borders,
//! shadows — where the part's own declaration would sit, gated on the
//! theme id the way the `[data-we-theme='x']` selector gates it.
//!
//! Deliberately absent:
//!
//! - rules that address *parts* the element does not expose as nodes —
//!   the switch's `thumb`/`track` and the modal's `close-button`. Those
//!   ride `defaults::theme_of` in the widget's own painter, where the
//!   part rect exists (`inputs/switch.rs` is the first consumer).
//! - the `::after` dotted connectors (`we-menu-group`/`we-menu-item`) —
//!   there is no pseudo-element painter; the gap list carries it.
//! - `[disabled]`'s `text-shadow` — parsed but unpainted, same gap list.
use std::sync::LazyLock;

use we_style::{
    eval_box_shadow, eval_clip_path, eval_color, BorderKind, BorderSide, ClipPath, Color,
    Dimension, Edges, Shadow, Style,
};
use we_template::ResolvedNode;

use crate::defaults::StyleCx;

/// `retro/index.css`'s raised Win95 face — four inset layers every
/// bevelled part shares: white top/left over a lighter second edge,
/// black bottom/right over grey.
const RETRO_BEVEL_CSS: &str =
    "inset -1px -1px #0a0a0a, inset 1px 1px #fff, inset -2px -2px grey, inset 2px 2px #dfdfdf";

/// `we-button::part(base):active` — the same four layers with light and
/// dark swapped: the pressed-in look.
const RETRO_BEVEL_PRESSED_CSS: &str =
    "inset -1px -1px #fff, inset 1px 1px #0a0a0a, inset -2px -2px #dfdfdf, inset 2px 2px grey";

static RETRO_BEVEL: LazyLock<Vec<Shadow>> =
    LazyLock::new(|| eval_box_shadow(RETRO_BEVEL_CSS).expect("bevel CSS parses"));
static RETRO_BEVEL_PRESSED: LazyLock<Vec<Shadow>> =
    LazyLock::new(|| eval_box_shadow(RETRO_BEVEL_PRESSED_CSS).expect("bevel CSS parses"));

/// The raised-face layers — exported for the part-level painters
/// (the switch's track and thumb take the same four).
pub fn retro_bevel() -> &'static [Shadow] {
    &RETRO_BEVEL
}

/// The `:active` swap.
pub fn retro_bevel_pressed() -> &'static [Shadow] {
    &RETRO_BEVEL_PRESSED
}

fn color(text: &str) -> Color {
    eval_color(text).expect("theme_css colours are literal CSS")
}

/// `border: 0` — every side set to `none`.
fn clear_borders(style: &mut Style) {
    let none = we_style::BorderSide {
        width: None,
        kind: BorderKind::None,
        color: None,
    };
    style.paint.borders = we_style::Edges::new(
        Some(none.clone()),
        Some(none.clone()),
        Some(none.clone()),
        Some(none),
    );
}

/// `border-radius: 0`.
fn square(style: &mut Style) {
    let zero = Some(we_style::Dimension::Px(0.0));
    style.paint.radius = we_style::Edges::new(zero, zero, zero, zero);
}

/// `cyberpunk/index.css`'s `we-button::part(base)` slab — corners cut,
/// the whole face leaning right; `:hover` drops the clip (`clip-path:
/// none`) back to the plain box.
const CYBERPUNK_BUTTON_CLIP: &str = "polygon(-15px 0%, calc(100% + 15px) 0%, \
     calc(100% + 15px) 100%, 20px 100%, -15px calc(100% - 35px))";

/// `we-input::part(base)` — the notched field outline: the top dips at
/// 60%, the bottom at 80%, corner cuts everywhere else.
const CYBERPUNK_INPUT_CLIP: &str = "polygon(0 5px, 5px 0, calc(60% - 5px) 0, \
     60% 5px, 100% 5px, 100% calc(100% - 5px), \
     calc(100% - 5px) calc(100% - 3px), calc(80% - 3px) calc(100% - 3px), \
     calc(80% - 5px) calc(100% - 0px), 0 calc(100% - 0px), \
     0% calc(100% - 0px))";

static CYBERPUNK_BUTTON: LazyLock<ClipPath> =
    LazyLock::new(|| eval_clip_path(CYBERPUNK_BUTTON_CLIP).expect("clip CSS parses"));
static CYBERPUNK_INPUT: LazyLock<ClipPath> =
    LazyLock::new(|| eval_clip_path(CYBERPUNK_INPUT_CLIP).expect("clip CSS parses"));

/// The button slab — exported so the painter tests assert against the
/// theme's own declaration.
pub fn cyberpunk_button_clip() -> &'static ClipPath {
    &CYBERPUNK_BUTTON
}

/// The notched field outline.
pub fn cyberpunk_input_clip() -> &'static ClipPath {
    &CYBERPUNK_INPUT
}

/// A `var(--we-*)` colour — the recorded tables hold literals, so `get`
/// plus `eval_color` is the whole lookup.
fn var_color(scx: &StyleCx, name: &str) -> Option<Color> {
    scx.tokens.get(name).and_then(eval_color)
}

/// `style_of`'s last pass: the component rules `theme`'s stylesheet
/// declares, over whatever the bags resolved. The stylesheet's
/// `!important` decls are unconditional (authored props lose there too);
/// its plain decls sit where the part's own would — also unconditional,
/// since the rule replaces the part's var-read entirely. The rules land
/// on `pretier` too — state patches rebuild from it, and the stylesheet
/// holds under states the same way the CSS does.
pub(crate) fn apply(scx: &StyleCx, node: &ResolvedNode, style: &mut Style) {
    let themed = |style: &mut Style| match scx.theme {
        "retro" => retro(node, style),
        "cyberpunk" => cyberpunk(scx, node, style),
        _ => {}
    };
    themed(style);
    // `pretier` carries the same rules — state patches rebuild from it.
    if let Some(pretier) = style.pretier.as_deref_mut() {
        themed(pretier);
    }
}

fn retro(node: &ResolvedNode, style: &mut Style) {
    match node.ty.as_ref() {
        // we-button::part(base): `background: silver !important;
        // color: #222 !important; border: 0 !important` + the bevel.
        "we-button" => {
            style.paint.bg = Some(color("silver"));
            style.text.color = Some(color("#222"));
            clear_borders(style);
            style.paint.shadows = Some(retro_bevel().to_vec());
            // `:active` swaps the bevel — an authored `activeProps` shadow
            // still wins its slot (the rule is not !important); the rest
            // of an authored patch is kept.
            let patch = style.active.get_or_insert_with(Box::default);
            if patch.paint.shadows.is_none() {
                patch.paint.shadows = Some(retro_bevel_pressed().to_vec());
            }
        }
        // we-input::part(base): `background: white; border: 0` + the
        // bevel (`:focus-within` repeats the same value — no swap).
        "we-input" => {
            style.paint.bg = Some(color("white"));
            clear_borders(style);
            style.paint.shadows = Some(retro_bevel().to_vec());
        }
        // we-avatar::part(base): `border-radius: 0; border: 0` + bevel.
        "we-avatar" => {
            square(style);
            clear_borders(style);
            style.paint.shadows = Some(retro_bevel().to_vec());
        }
        // we-modal::part(base): `background: silver` + bevel — the
        // overlay chrome reads the style when its port lands (gap list
        // #8); recording the rule now is what makes that land.
        "we-modal" => {
            style.paint.bg = Some(color("silver"));
            style.paint.shadows = Some(retro_bevel().to_vec());
        }
        _ => {}
    }
}

fn cyberpunk(scx: &StyleCx, node: &ResolvedNode, style: &mut Style) {
    match node.ty.as_ref() {
        // we-button::part(base): the clip-path slab; `:hover` swaps it
        // for `clip-path: none` — an authored hover patch still wins its
        // slot (the rule is not `!important`).
        "we-button" => {
            style.paint.clip = Some(CYBERPUNK_BUTTON.clone());
            let patch = style.hover.get_or_insert_with(Box::default);
            if patch.paint.clip.is_none() {
                patch.paint.clip = Some(ClipPath::None);
            }
        }
        // we-input::part(base): `height: 60px; font-size: 16px` — then
        // the layered borders collapse to solid accent-200 at 10/2/10/2
        // (`border: 10px solid` then left/right 2px and the
        // `border-color` line wins them all), the notched clip, and
        // `:focus-within` recolouring every side accent-500.
        "we-input" => {
            style.layout.height = Some(Dimension::Px(60.0));
            style.text.font_size = Some(Dimension::Px(16.0));
            let c200 = var_color(scx, "--we-color-accent-200");
            let side = |width: f32| {
                Some(BorderSide {
                    width: Some(Dimension::Px(width)),
                    kind: BorderKind::Solid,
                    color: c200,
                })
            };
            style.paint.borders = Edges::new(side(10.0), side(2.0), side(10.0), side(2.0));
            style.paint.clip = Some(CYBERPUNK_INPUT.clone());
            if let Some(c500) = var_color(scx, "--we-color-accent-500") {
                let patch = style.focus.get_or_insert_with(Box::default);
                patch.paint.borders = style.paint.borders.map(|s| {
                    s.as_ref().map(|b| BorderSide {
                        color: Some(c500),
                        ..b.clone()
                    })
                });
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bevel_parses_to_the_css_layers() {
        let layers = retro_bevel();
        assert_eq!(layers.len(), 4);
        assert!(layers.iter().all(|s| s.inset));
        assert!(layers
            .iter()
            .all(|s| s.blur.is_none() && s.spread.is_none()));
        // Light edges come from the +1/+1 and +2/+2 layers, dark from the
        // negative ones — the pairing the test in props.rs asserts on
        // geometry terms.
        assert_eq!(layers[0].dx, we_style::Dimension::Px(-1.0));
        assert_eq!(layers[1].dx, we_style::Dimension::Px(1.0));
        assert_eq!(layers[2].dx, we_style::Dimension::Px(-2.0));
        assert_eq!(layers[3].dx, we_style::Dimension::Px(2.0));
    }

    #[test]
    fn pressed_swaps_light_and_dark() {
        let pressed = retro_bevel_pressed();
        // The raised face's light edge (#fff at +1,+1) moves to the
        // dark position (-1,-1) and vice versa.
        assert_eq!(pressed[0].dx, we_style::Dimension::Px(-1.0));
        assert_eq!(pressed[0].color, Some(eval_color("#fff").unwrap()));
        assert_eq!(pressed[1].color, Some(eval_color("#0a0a0a").unwrap()));
        assert_eq!(pressed[2].color, Some(eval_color("#dfdfdf").unwrap()));
        assert_eq!(pressed[3].color, Some(eval_color("grey").unwrap()));
    }
}
