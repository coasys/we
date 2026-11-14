//! The prop → declaration → field pipeline.
//!
//! `build_layout_decls` is the port of `buildLayoutStyles` — props in, the
//! emitted CSS declarations out, byte-for-byte what the conformance vectors
//! record as `style`. `eval_decls` then substitutes the theme's `var(--we-*)`
//! table and parses each declaration into the plain [`Style`] fields, and
//! `resolve` runs the whole thing for a resolved node: base props, the state
//! bags (`hoverProps` …) as patches, and the active viewport tier.
//!
//! The `--we-ds-*` variable indirection WE's stylesheet uses to carry states
//! is not needed here — the same PropSpec surface is applied as an overlay
//! directly. What is preserved exactly is the *emission*: the declarations a
//! bag would emit, filtered to the interactive surface, so the patch changes
//! exactly what the CSS mechanism would.

use std::sync::Arc;

use indexmap::IndexMap;
use we_expr::Value;

use crate::border::{border_parts, eval_border_side, parse_border, BorderText};
use crate::color::{eval_color, Color};
use crate::css_value::{eval_dimension, split_top_commas, top_level_parts};
use crate::scales::{
    bg_image_layer, compute_bg_image_composite, is_bg_image_faded, map_flex_axes,
    parse_transition_prop, resolve_font_family, resolve_font_weight, resolve_line_height,
    surface_image_decl, token_var, tone_variables, z_index_var, SemanticAxis,
};
use crate::shorthand::{state_bag_filled, tier_bag_of, Bag, Tier};
use crate::style::*;
use crate::tokens::TokenTable;
use crate::transition::parse_transitions;

/// One emitted declaration value — `opacity: 0.5` keeps its number, the rest
/// is text. `CSSStyleObject`'s `string | number`.
#[derive(Debug, Clone, PartialEq)]
pub enum DeclValue {
    Text(Arc<str>),
    Num(f64),
}

impl DeclValue {
    pub fn text(&self) -> String {
        match self {
            DeclValue::Text(t) => t.to_string(),
            DeclValue::Num(n) => Value::Num(*n).js_string(),
        }
    }

    /// The JSON form a vector records — numbers stay numbers, integral ones
    /// as integers (`flex-shrink: 0`, not `0.0`).
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            DeclValue::Text(t) => serde_json::Value::String(t.to_string()),
            DeclValue::Num(n) if n.fract() == 0.0 && n.abs() < 9.0e15 => {
                serde_json::json!(*n as i64)
            }
            DeclValue::Num(n) => serde_json::json!(n),
        }
    }
}

/// The emitted declaration map — `buildLayoutStyles`'s `CSSStyleObject`,
/// insertion-ordered as the TypeScript assigns it.
pub type Decls = IndexMap<Arc<str>, DeclValue>;

fn get<'a>(props: &'a Bag, key: &str) -> Option<&'a Value> {
    props.get(key)
}

fn truthy<'a>(props: &'a Bag, key: &str) -> Option<&'a Value> {
    props.get(key).filter(|v| v.truthy())
}

fn present<'a>(props: &'a Bag, key: &str) -> Option<&'a Value> {
    // `!== undefined` — `flexShrink: 0`, `zIndex: 0`, `opacity: 0` count.
    props.get(key).filter(|v| !matches!(v, Value::Undefined))
}

fn put(decls: &mut Decls, key: &str, value: impl Into<Arc<str>>) {
    decls.insert(Arc::from(key), DeclValue::Text(value.into()));
}

fn put_value(decls: &mut Decls, key: &str, value: &Value) {
    let v = match value {
        Value::Num(n) => DeclValue::Num(*n),
        other => DeclValue::Text(Arc::from(other.js_string().as_str())),
    };
    decls.insert(Arc::from(key), v);
}

/// `tokenVar` on the first truthy of several keys — the `a || b || c` chains.
fn token_chain<'a>(props: &'a Bag, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|k| truthy(props, k))
}

/// `getPaddingValues`/`getMarginValues` — four `tokenVar`s joined, `None` when
/// the join is `'0 0 0 0'`.
fn box_values(
    props: &Bag,
    prefix: &str,
    sides: [&str; 4],
    chains: [[&str; 3]; 4],
    axis: Option<SemanticAxis>,
) -> Option<Arc<str>> {
    let mut out = String::new();
    for (i, chain) in chains.iter().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        let token = token_chain(props, chain).map(|v| v.js_string());
        out.push_str(&token_var(prefix, token.as_deref(), "0", axis));
    }
    let _ = sides;
    if out == "0 0 0 0" {
        None
    } else {
        Some(Arc::from(out.as_str()))
    }
}

fn padding_values(props: &Bag) -> Option<Arc<str>> {
    box_values(
        props,
        "space",
        ["pt", "pr", "pb", "pl"],
        [
            ["pt", "py", "p"],
            ["pr", "px", "p"],
            ["pb", "py", "p"],
            ["pl", "px", "p"],
        ],
        Some(SemanticAxis::Padding),
    )
}

fn margin_values(props: &Bag) -> Option<Arc<str>> {
    box_values(
        props,
        "space",
        ["mt", "mr", "mb", "ml"],
        [
            ["mt", "my", "m"],
            ["mr", "mx", "m"],
            ["mb", "my", "m"],
            ["ml", "mx", "m"],
        ],
        None,
    )
}

fn radius_values(props: &Bag) -> Option<Arc<str>> {
    // Radius chains are four deep; handled directly rather than through
    // `box_values`' three-wide chains.
    const CHAINS: [[&str; 4]; 4] = [
        ["rtl", "rt", "rl", "r"],
        ["rtr", "rt", "rr", "r"],
        ["rbr", "rb", "rr", "r"],
        ["rbl", "rb", "rl", "r"],
    ];
    let mut out = String::new();
    for (i, chain) in CHAINS.iter().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        let token = chain
            .iter()
            .find_map(|k| truthy(props, k))
            .map(|v| v.js_string());
        out.push_str(&token_var("radius", token.as_deref(), "0", None));
    }
    if out == "0 0 0 0" {
        None
    } else {
        Some(Arc::from(out.as_str()))
    }
}

/// `buildLayoutStyles(props, direction)` — the emitted declaration map. The
/// `direction` argument is the component's container axis; a `direction`
/// *prop* is a component input and is never read here.
pub fn build_layout_decls(props: &Bag, direction: Direction) -> Decls {
    let mut d = Decls::new();
    let base_dir = match direction {
        Direction::Row => "row",
        Direction::Column => "column",
    };
    let flex_dir = if truthy(props, "reverse").is_some() {
        format!("{base_dir}-reverse")
    } else {
        base_dir.to_string()
    };
    put(
        &mut d,
        "display",
        truthy(props, "display")
            .map(|v| v.js_string())
            .unwrap_or_else(|| "flex".to_string()),
    );
    put(&mut d, "flex-direction", flex_dir.clone());
    put(
        &mut d,
        "flex-wrap",
        if truthy(props, "wrap").is_some() {
            "wrap"
        } else {
            "nowrap"
        },
    );

    // tone first — it re-points the accent roles everything below may name.
    if let Some(tone) = truthy(props, "tone") {
        for (k, v) in tone_variables(&tone.js_string()) {
            d.insert(k, DeclValue::Text(v));
        }
    }

    if let Some(bg) = truthy(props, "bg") {
        let bg = bg.js_string();
        if let Some(gradient) = bg.strip_prefix("gradient-") {
            put(
                &mut d,
                "background-image",
                format!("var(--we-gradient-{gradient})"),
            );
        } else {
            put(
                &mut d,
                "background-color",
                token_var("color", Some(&bg), "0", None),
            );
            if truthy(props, "bgImage").is_none() {
                if let Some(img) = surface_image_decl(&bg) {
                    put(&mut d, "background-image", img);
                }
            }
        }
    }

    if let Some(bg_image) = truthy(props, "bgImage") {
        if is_bg_image_faded(get(props, "bgImage"), get(props, "bgImageOpacity")) {
            let composite = compute_bg_image_composite(
                bg_image,
                get(props, "bgImageOpacity"),
                get(props, "bgImageTint").or_else(|| get(props, "bg")),
            );
            if let Some(c) = composite {
                put(&mut d, "--we-bg-image-composite", c);
            }
            put(
                &mut d,
                "--we-bg-image-fit",
                get(props, "bgFit")
                    .map(|v| v.js_string())
                    .unwrap_or_else(|| "cover".to_string()),
            );
            put(
                &mut d,
                "--we-bg-image-position",
                get(props, "bgPosition")
                    .map(|v| v.js_string())
                    .unwrap_or_else(|| "center".to_string()),
            );
            if present(props, "position").is_none() {
                put(&mut d, "position", "relative");
            }
        } else {
            put(
                &mut d,
                "background-image",
                bg_image_layer(&bg_image.js_string()),
            );
            put(
                &mut d,
                "background-size",
                get(props, "bgFit")
                    .map(|v| v.js_string())
                    .unwrap_or_else(|| "cover".to_string()),
            );
            put(
                &mut d,
                "background-position",
                get(props, "bgPosition")
                    .map(|v| v.js_string())
                    .unwrap_or_else(|| "center".to_string()),
            );
            put(&mut d, "background-repeat", "no-repeat");
        }
    }

    if let Some(color) = truthy(props, "color") {
        put(
            &mut d,
            "color",
            token_var("color", Some(&color.js_string()), "0", None),
        );
    }

    if let Some(opacity) = present(props, "opacity") {
        put_value(&mut d, "opacity", opacity);
    }

    if let Some(border) = truthy(props, "border") {
        put(&mut d, "border", parse_border(&border.js_string()));
    }
    if let Some(bc) = truthy(props, "borderColor") {
        put(
            &mut d,
            "border-color",
            token_var("color", Some(&bc.js_string()), "0", None),
        );
    }
    if let Some(bt) = truthy(props, "borderTop") {
        put(&mut d, "border-top", parse_border(&bt.js_string()));
    }
    if let Some(br) = truthy(props, "borderRight") {
        put(&mut d, "border-right", parse_border(&br.js_string()));
    }
    if let Some(bb) = truthy(props, "borderBottom") {
        put(&mut d, "border-bottom", parse_border(&bb.js_string()));
    }
    if let Some(bl) = truthy(props, "borderLeft") {
        put(&mut d, "border-left", parse_border(&bl.js_string()));
    }
    if let Some(bw) = truthy(props, "borderWidth") {
        put_value(&mut d, "border-width", bw);
    }

    if truthy(props, "shadow").is_some() || truthy(props, "ring").is_some() {
        let mut parts: Vec<String> = Vec::new();
        if let Some(ring) = truthy(props, "ring") {
            parts.push(ring.js_string());
        }
        if let Some(shadow) = truthy(props, "shadow") {
            parts.push(token_var("shadow", Some(&shadow.js_string()), "0", None).to_string());
        }
        put(&mut d, "box-shadow", parts.join(", "));
    }

    if let Some(t) = crate::scales::compose_transform(
        get(props, "x"),
        get(props, "y"),
        get(props, "rotate"),
        get(props, "transform"),
    ) {
        put(&mut d, "transform", t);
    }
    if let Some(tr) = truthy(props, "transition") {
        if let Some(t) = parse_transition_prop(&tr.js_string()) {
            put(&mut d, "transition", t);
        }
    }

    if let Some(v) = truthy(props, "textAlign") {
        put(&mut d, "text-align", v.js_string());
    }
    if let Some(v) = truthy(props, "fontFamily") {
        if let Some(f) = resolve_font_family(&v.js_string()) {
            put(&mut d, "font-family", f);
        }
    }
    if let Some(v) = truthy(props, "fontWeight") {
        if let Some(f) = resolve_font_weight(&v.js_string()) {
            put(&mut d, "font-weight", f);
        }
    }
    if let Some(v) = truthy(props, "fontSize") {
        put(
            &mut d,
            "font-size",
            token_var("font-size", Some(&v.js_string()), "0", None),
        );
    }
    if let Some(v) = truthy(props, "lineHeight") {
        if let Some(f) = resolve_line_height(&v.js_string()) {
            put(&mut d, "line-height", f);
        }
    }
    if let Some(v) = truthy(props, "letterSpacing") {
        put(
            &mut d,
            "letter-spacing",
            token_var("letter-spacing", Some(&v.js_string()), "0", None),
        );
    }
    if let Some(v) = truthy(props, "textDecoration") {
        put(&mut d, "text-decoration", v.js_string());
    }
    if let Some(v) = truthy(props, "textTransform") {
        put(&mut d, "text-transform", v.js_string());
    }
    if let Some(v) = truthy(props, "whiteSpace") {
        put(&mut d, "white-space", v.js_string());
    }
    if let Some(v) = truthy(props, "overflowWrap") {
        put(&mut d, "overflow-wrap", v.js_string());
    }

    if let Some(v) = truthy(props, "cursor") {
        put(&mut d, "cursor", v.js_string());
    }
    if let Some(v) = truthy(props, "pointerEvents") {
        put(&mut d, "pointer-events", v.js_string());
    }
    if let Some(v) = truthy(props, "visibility") {
        put(&mut d, "visibility", v.js_string());
    }

    if let Some(v) = truthy(props, "flex") {
        put_value(&mut d, "flex", v);
    }
    if let Some(v) = present(props, "flexShrink") {
        put_value(&mut d, "flex-shrink", v);
    }
    if let Some(v) = truthy(props, "alignSelf") {
        put(&mut d, "align-self", v.js_string());
    }

    if let Some(v) = truthy(props, "width") {
        put_value(&mut d, "width", v);
    }
    if let Some(v) = truthy(props, "height") {
        put_value(&mut d, "height", v);
    }
    if let Some(v) = truthy(props, "minWidth") {
        put_value(&mut d, "min-width", v);
    }
    if let Some(v) = truthy(props, "minHeight") {
        put_value(&mut d, "min-height", v);
    }
    if let Some(v) = truthy(props, "maxWidth") {
        put_value(&mut d, "max-width", v);
    }
    if let Some(v) = truthy(props, "maxHeight") {
        put_value(&mut d, "max-height", v);
    }
    if let Some(v) = truthy(props, "aspectRatio") {
        put_value(&mut d, "aspect-ratio", v);
    }

    let (ax, ay) = (
        get(props, "ax")
            .filter(|v| v.truthy())
            .map(|v| v.js_string()),
        get(props, "ay")
            .filter(|v| v.truthy())
            .map(|v| v.js_string()),
    );
    let axes = map_flex_axes(ax.as_deref(), ay.as_deref(), &flex_dir);
    if let Some(main) = axes.main {
        put(&mut d, "justify-content", main);
    }
    if let Some(cross) = axes.cross {
        put(&mut d, "align-items", cross);
    }

    if let Some(v) = truthy(props, "gap") {
        put(
            &mut d,
            "gap",
            token_var("space", Some(&v.js_string()), "0", Some(SemanticAxis::Gap)),
        );
    }
    if let Some(v) = truthy(props, "overflow") {
        put(&mut d, "overflow", v.js_string());
    }
    if let Some(v) = truthy(props, "overflowX") {
        put(&mut d, "overflow-x", v.js_string());
    }
    if let Some(v) = truthy(props, "overflowY") {
        put(&mut d, "overflow-y", v.js_string());
    }
    if let Some(v) = truthy(props, "scrollbarWidth") {
        put(&mut d, "scrollbar-width", v.js_string());
    }
    if let Some(v) = truthy(props, "scrollbarGutter") {
        put(&mut d, "scrollbar-gutter", v.js_string());
    }
    if let Some(v) = present(props, "zIndex") {
        if let Some(z) = z_index_var(v) {
            put(&mut d, "z-index", z);
        }
    }
    if let Some(v) = truthy(props, "position") {
        put(&mut d, "position", v.js_string());
    }
    for (prop, css) in [
        ("top", "top"),
        ("right", "right"),
        ("bottom", "bottom"),
        ("left", "left"),
    ] {
        if let Some(v) = truthy(props, prop) {
            put(
                &mut d,
                css,
                token_var("space", Some(&v.js_string()), "0", None),
            );
        }
    }

    if let Some(m) = margin_values(props) {
        put(&mut d, "margin", m);
    }
    if let Some(p) = padding_values(props) {
        put(&mut d, "padding", p);
    }
    if let Some(r) = radius_values(props) {
        put(&mut d, "border-radius", r);
    }

    // `styles` last — it genuinely overrides.
    if let Some(Value::Obj(styles)) = props.get("styles") {
        for (k, v) in styles.iter() {
            put_value(&mut d, k, v);
        }
    }
    d
}

/// `withRestingShadow` — a state bag with a `ring` and no `shadow` keeps the
/// element's resting shadow beneath the ring.
pub fn with_resting_shadow(bag: &Bag, resting: &Bag) -> Bag {
    let ring = truthy(bag, "ring").is_some();
    let shadow = truthy(bag, "shadow").is_some();
    if ring && !shadow {
        if let Some(resting_shadow) = truthy(resting, "shadow") {
            let mut out = bag.clone();
            out.insert(Arc::from("shadow"), resting_shadow.clone());
            return out;
        }
    }
    bag.clone()
}

/// `buildStateFragmentStyles` — `buildLayoutStyles` on a bag, with the
/// unconditional structural declarations removed (`flex-direction` always,
/// `display`/`flex-wrap` unless the bag names them).
pub fn build_state_fragment_decls(bag: &Bag, direction: Direction) -> Decls {
    let mut d = build_layout_decls(bag, direction);
    d.shift_remove("flex-direction");
    if !bag.contains_key("display") {
        d.shift_remove("display");
    }
    if !bag.contains_key("wrap") {
        d.shift_remove("flex-wrap");
    }
    d
}

/// `BORDER_SIDES` — the sides `withBorderSides` writes.
const BORDER_SIDE_KEYS: [&str; 4] = ["border-top", "border-right", "border-bottom", "border-left"];

/// `withBorderSides(style, beneath)` — expand the border shorthand into the
/// four side declarations a state or base var needs.
pub fn with_border_sides(style: &Decls, beneath: &Decls) -> Decls {
    let has_any = style.contains_key("border")
        || style.contains_key("border-color")
        || style.contains_key("border-width");
    if !has_any {
        return style.clone();
    }
    let border_text = style
        .get("border")
        .or_else(|| beneath.get("border"))
        .map(|v| v.text())
        .unwrap_or_default();
    let Some(parts): Option<BorderText> = border_parts(&border_text) else {
        return style.clone();
    };
    let width = style
        .get("border-width")
        .map(|v| v.text())
        .or_else(|| {
            if style.contains_key("border") {
                None
            } else {
                beneath.get("border-width").map(|v| v.text())
            }
        })
        .unwrap_or_else(|| parts.width.to_string());
    let color = style
        .get("border-color")
        .map(|v| v.text())
        .or_else(|| {
            if style.contains_key("border") {
                None
            } else {
                beneath.get("border-color").map(|v| v.text())
            }
        })
        .unwrap_or_else(|| parts.color.to_string());
    let mut out = style.clone();
    for side in BORDER_SIDE_KEYS {
        if !out.contains_key(side) && !beneath.contains_key(side) {
            out.insert(
                Arc::from(side),
                DeclValue::Text(Arc::from(
                    format!("{width} {} {color}", parts.style).as_str(),
                )),
            );
        }
    }
    out
}

/// The css props a state or tier var may carry — `INTERACTIVE_SPECS`' first
/// elements (host layout minus positioning, visual, layout, flex, typography).
pub fn is_interactive_prop(css_prop: &str) -> bool {
    matches!(
        css_prop,
        "width"
            | "height"
            | "min-width"
            | "min-height"
            | "max-width"
            | "max-height"
            | "aspect-ratio"
            | "z-index"
            | "margin"
            | "flex"
            | "flex-shrink"
            | "align-self"
            | "background-color"
            | "color"
            | "opacity"
            | "border"
            | "border-color"
            | "border-width"
            | "border-top"
            | "border-right"
            | "border-bottom"
            | "border-left"
            | "box-shadow"
            | "transform"
            | "cursor"
            | "pointer-events"
            | "visibility"
            | "border-radius"
            | "display"
            | "overflow"
            | "overflow-x"
            | "overflow-y"
            | "scrollbar-width"
            | "scrollbar-gutter"
            | "flex-direction"
            | "justify-content"
            | "align-items"
            | "flex-wrap"
            | "gap"
            | "padding"
            | "text-align"
            | "font-family"
            | "font-weight"
            | "font-size"
            | "font-style"
            | "line-height"
            | "letter-spacing"
            | "text-decoration"
            | "text-transform"
            | "white-space"
            | "overflow-wrap"
    )
}

/// `toInteractiveVars` — the declarations a state or tier var actually
/// carries. `direction`/`top`/`right`/`bottom`/`left`/`position` are excluded
/// by the spec table; `transition`, `background-image` and the `--we-*` keys
/// never made the surface either.
pub fn interactive_decls(decls: &Decls) -> Decls {
    decls
        .iter()
        .filter(|(k, v)| is_interactive_prop(k) && !v.text().is_empty())
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

/// `emittedFor` — the declaration text a prop produced, for the conformance
/// harness's per-prop token classification. Shorthand sides re-derive their
/// own `tokenVar` output, exactly as `shorthandSide` does.
pub fn emitted_for(prop: &str, value: &Value, style: &Decls) -> Option<DeclValue> {
    let get = |key: &str| style.get(key).cloned();
    let out = match prop {
        "direction" | "reverse" => get("flex-direction"),
        "ax" => get("justify-content").or_else(|| get("align-items")),
        "ay" => get("align-items").or_else(|| get("justify-content")),
        "wrap" => get("flex-wrap"),
        "display" => get("display"),
        "bg" => get("background-color").or_else(|| get("background-image")),
        "bgImage" => get("background-image").or_else(|| get("--we-bg-image-composite")),
        "color" => get("color"),
        "opacity" => get("opacity"),
        "border" => get("border"),
        "borderTop" => get("border-top"),
        "borderRight" => get("border-right"),
        "borderBottom" => get("border-bottom"),
        "borderLeft" => get("border-left"),
        "borderColor" => get("border-color"),
        "shadow" | "ring" => get("box-shadow"),
        "transition" => get("transition"),
        "textAlign" => get("text-align"),
        "fontFamily" => get("font-family"),
        "fontWeight" => get("font-weight"),
        "fontSize" => get("font-size"),
        "lineHeight" => get("line-height"),
        "letterSpacing" => get("letter-spacing"),
        "textDecoration" => get("text-decoration"),
        "textTransform" => get("text-transform"),
        "whiteSpace" => get("white-space"),
        "overflowWrap" => get("overflow-wrap"),
        "cursor" => get("cursor"),
        "pointerEvents" => get("pointer-events"),
        "visibility" => get("visibility"),
        "flex" => get("flex"),
        "flexShrink" => get("flex-shrink"),
        "alignSelf" => get("align-self"),
        "width" => get("width"),
        "height" => get("height"),
        "minWidth" => get("min-width"),
        "minHeight" => get("min-height"),
        "maxWidth" => get("max-width"),
        "maxHeight" => get("max-height"),
        "aspectRatio" => get("aspect-ratio"),
        "gap" => get("gap"),
        "overflow" => get("overflow"),
        "overflowX" => get("overflow-x"),
        "overflowY" => get("overflow-y"),
        "scrollbarWidth" => get("scrollbar-width"),
        "scrollbarGutter" => get("scrollbar-gutter"),
        "zIndex" => get("z-index"),
        "position" => get("position"),
        "top" => get("top"),
        "right" => get("right"),
        "bottom" => get("bottom"),
        "left" => get("left"),
        "tone" => {
            let joined = style
                .iter()
                .filter(|(k, _)| k.starts_with("--we-"))
                .map(|(k, v)| format!("{k}:{}", v.text()))
                .collect::<Vec<_>>()
                .join(";");
            if joined.is_empty() {
                None
            } else {
                Some(DeclValue::Text(Arc::from(joined.as_str())))
            }
        }
        // `styles` spreads verbatim — nothing to classify.
        "styles" => None,
        _ => shorthand_side(prop, value),
    };
    out
}

/// `shorthandSide` — padding/margin/radius sides re-run `tokenVar` on the
/// authored value, since the joined shorthand cannot say which var was whose.
fn shorthand_side(prop: &str, value: &Value) -> Option<DeclValue> {
    let v = value.js_string();
    let b = prop.as_bytes();
    let is_padding = b == b"p" || (b.len() == 2 && b[0] == b'p' && b"xytblr".contains(&b[1]));
    let is_margin = b == b"m" || (b.len() == 2 && b[0] == b'm' && b"xytblr".contains(&b[1]));
    let is_radius =
        prop == "r" || ["rr", "rt", "rb", "rl", "rtl", "rtr", "rbr", "rbl"].contains(&prop);
    if is_padding {
        Some(DeclValue::Text(token_var(
            "space",
            Some(&v),
            "0",
            Some(SemanticAxis::Padding),
        )))
    } else if is_margin {
        Some(DeclValue::Text(token_var("space", Some(&v), "0", None)))
    } else if is_radius {
        Some(DeclValue::Text(token_var("radius", Some(&v), "0", None)))
    } else {
        None
    }
}

/// `mergeProps` — primary over secondary, with the generic-box-prop spreading
/// (`m` fills `mx`/`my`/`mt`… where primary does not name them).
pub fn merge_props(primary: &Bag, secondary: &Bag) -> Bag {
    let mut merged = secondary.clone();
    for (k, v) in primary {
        merged.insert(k.clone(), v.clone());
    }
    let fill = |merged: &mut Bag, generic: &str, keys: &[&str]| {
        if primary
            .get(generic)
            .is_some_and(|v| !matches!(v, Value::Undefined))
        {
            for key in keys {
                if primary
                    .get(*key)
                    .is_none_or(|v| matches!(v, Value::Undefined))
                {
                    if let Some(v) = primary.get(generic) {
                        merged.insert(Arc::from(*key), v.clone());
                    }
                }
            }
        }
    };
    fill(&mut merged, "m", &["mx", "my", "mt", "mr", "mb", "ml"]);
    fill(&mut merged, "p", &["px", "py", "pt", "pr", "pb", "pl"]);
    fill(
        &mut merged,
        "r",
        &["rtl", "rtr", "rbr", "rbl", "rt", "rb", "rl", "rr"],
    );
    merged
}

// ── evaluation: decls + theme → fields ─────────────────────────────────────

/// What the theme lookup needs at eval time. `var()`s resolve through
/// `tokens`; `viewport` is for `vw`/`vh`/`vmin`/`vmax` (and the tier pick,
/// done by the caller).
pub struct EvalCx<'a> {
    pub tokens: &'a TokenTable,
    pub viewport: Size,
    /// What `1em` means where this style lands — the element's own font size
    /// when known, else the theme's base (the caller decides; 14px is WE's).
    pub font_px: f32,
    /// What `1rem` means — the root font size the theme sets.
    pub root_px: f32,
}

impl<'a> EvalCx<'a> {
    pub fn new(tokens: &'a TokenTable) -> Self {
        Self {
            tokens,
            viewport: Size::new(0.0, 0.0),
            font_px: 14.0,
            root_px: 16.0,
        }
    }

    /// `var()`-substituted text for one emitted declaration — the
    /// browser-faithful resolution (`substitute_nested`), so a declared outer
    /// var of a nested fallback chain lands on its value, not the recorded
    /// simulation's stray-paren text.
    fn subst(&self, value: &DeclValue) -> String {
        self.tokens.substitute_nested(&value.text()).to_string()
    }
}

/// The result of evaluating a declaration map: a [`Style`]'s worth of fields
/// plus the raw strings nothing could turn into values.
#[derive(Debug, Default)]
pub struct EvalResult {
    pub layout: LayoutStyle,
    pub text: TextStyle,
    pub paint: PaintStyle,
    /// `--we-*` custom properties the decls set (a `tone` writes 13 of them).
    pub tone_vars: IndexMap<Arc<str>, Arc<str>>,
    pub transitions: Vec<crate::transition::Transition>,
    /// `cssprop=emitted-text` for everything that stayed unevaluated.
    pub unsupported: Vec<Arc<str>>,
}

impl EvalResult {
    fn bad(&mut self, css_prop: &str, value: &DeclValue) {
        self.unsupported
            .push(Arc::from(format!("{css_prop}={}", value.text()).as_str()));
    }
}

fn eval_dimension_decl(
    r: &mut EvalResult,
    cx: &EvalCx,
    css: &str,
    value: &DeclValue,
) -> Option<Dimension> {
    // A number on a length prop is px — the DOM's own rule for
    // `style.maxWidth = 300` (`eval_dimension` only takes unitless `0`).
    if let DeclValue::Num(n) = value {
        return Some(Dimension::Px(*n as f32));
    }
    let s = cx.subst(value);
    let d = eval_dimension(&s);
    if d.is_none() {
        r.bad(css, value);
    }
    d
}

fn eval_edges(
    r: &mut EvalResult,
    cx: &EvalCx,
    css: &str,
    value: &DeclValue,
) -> Edges<Option<Dimension>> {
    let s = cx.subst(value);
    let parts = top_level_parts(&s);
    if parts.len() != 4 {
        // A shorthand WE always emits as four slots; anything else is
        // authored text we could not read — one unsupported, no sides.
        r.bad(css, value);
        return Edges::default();
    }
    let mut out = Edges::default();
    for (i, slot) in [&mut out.top, &mut out.right, &mut out.bottom, &mut out.left]
        .iter_mut()
        .enumerate()
    {
        match eval_dimension(parts[i]) {
            Some(d) => **slot = Some(d),
            None => r.bad(css, value),
        }
    }
    out
}

fn eval_display(text: &str) -> Option<Display> {
    Some(match text.trim().to_ascii_lowercase().as_str() {
        "flex" => Display::Flex,
        "none" => Display::None,
        "contents" => Display::Contents,
        "block" => Display::Block,
        "inline" => Display::Inline,
        "inline-block" => Display::InlineBlock,
        "grid" => Display::Grid,
        other => Display::Other(Arc::from(other)),
    })
}

fn eval_flex_direction(text: &str) -> Option<FlexDirection> {
    Some(match text.trim() {
        "row" => FlexDirection::Row,
        "row-reverse" => FlexDirection::RowReverse,
        "column" => FlexDirection::Column,
        "column-reverse" => FlexDirection::ColumnReverse,
        _ => return None,
    })
}

fn eval_wrap(text: &str) -> Option<Wrap> {
    Some(match text.trim() {
        "wrap" => Wrap::Wrap,
        "nowrap" => Wrap::NoWrap,
        "wrap-reverse" => Wrap::WrapReverse,
        _ => return None,
    })
}

fn eval_align(text: &str) -> Option<ItemAlign> {
    Some(match text.trim().to_ascii_lowercase().as_str() {
        "auto" => ItemAlign::Auto,
        "start" | "flex-start" => ItemAlign::Start,
        "center" => ItemAlign::Center,
        "end" | "flex-end" => ItemAlign::End,
        "stretch" => ItemAlign::Stretch,
        "space-between" => ItemAlign::SpaceBetween,
        "space-around" => ItemAlign::SpaceAround,
        "space-evenly" => ItemAlign::SpaceEvenly,
        "baseline" => ItemAlign::Baseline,
        other => ItemAlign::Other(Arc::from(other)),
    })
}

fn eval_position(text: &str) -> Option<Position> {
    Some(match text.trim() {
        "static" => Position::Static,
        "relative" => Position::Relative,
        "absolute" => Position::Absolute,
        "fixed" => Position::Fixed,
        "sticky" => Position::Sticky,
        other => Position::Other(Arc::from(other)),
    })
}

fn eval_overflow(text: &str) -> Option<Overflow> {
    Some(match text.trim() {
        "visible" => Overflow::Visible,
        "hidden" => Overflow::Hidden,
        "auto" => Overflow::Auto,
        "scroll" => Overflow::Scroll,
        "clip" => Overflow::Clip,
        other => Overflow::Other(Arc::from(other)),
    })
}

fn eval_scrollbar_width(text: &str) -> Option<ScrollbarWidth> {
    Some(match text.trim() {
        "auto" => ScrollbarWidth::Auto,
        "thin" => ScrollbarWidth::Thin,
        "none" => ScrollbarWidth::None,
        t => ScrollbarWidth::Length(eval_dimension(t)?),
    })
}

fn eval_scrollbar_gutter(text: &str) -> Option<ScrollbarGutter> {
    Some(match text.trim() {
        "auto" => ScrollbarGutter::Auto,
        "stable" => ScrollbarGutter::Stable,
        "stable both-edges" => ScrollbarGutter::StableBothEdges,
        other => ScrollbarGutter::Other(Arc::from(other)),
    })
}

fn eval_text_align(text: &str) -> Option<TextAlign> {
    Some(match text.trim() {
        "left" => TextAlign::Left,
        "right" => TextAlign::Right,
        "center" => TextAlign::Center,
        "justify" => TextAlign::Justify,
        "start" => TextAlign::Start,
        "end" => TextAlign::End,
        other => TextAlign::Other(Arc::from(other)),
    })
}

fn eval_text_transform(text: &str) -> Option<TextTransform> {
    Some(match text.trim() {
        "none" => TextTransform::None,
        "uppercase" => TextTransform::Uppercase,
        "lowercase" => TextTransform::Lowercase,
        "capitalize" => TextTransform::Capitalize,
        other => TextTransform::Other(Arc::from(other)),
    })
}

fn eval_text_decoration(text: &str) -> Option<TextDecoration> {
    Some(match text.trim() {
        "none" => TextDecoration::None,
        "underline" => TextDecoration::Underline,
        "line-through" => TextDecoration::LineThrough,
        "overline" => TextDecoration::Overline,
        other => TextDecoration::Other(Arc::from(other)),
    })
}

fn eval_white_space(text: &str) -> Option<WhiteSpace> {
    Some(match text.trim() {
        "normal" => WhiteSpace::Normal,
        "nowrap" => WhiteSpace::Nowrap,
        "pre" => WhiteSpace::Pre,
        "pre-wrap" => WhiteSpace::PreWrap,
        "pre-line" => WhiteSpace::PreLine,
        other => WhiteSpace::Other(Arc::from(other)),
    })
}

fn eval_overflow_wrap(text: &str) -> Option<OverflowWrap> {
    Some(match text.trim() {
        "normal" => OverflowWrap::Normal,
        "anywhere" => OverflowWrap::Anywhere,
        "break-word" => OverflowWrap::BreakWord,
        other => OverflowWrap::Other(Arc::from(other)),
    })
}

fn eval_line_height(text: &str) -> Option<LineHeight> {
    let t = text.trim();
    if t == "normal" {
        return Some(LineHeight::Normal);
    }
    if let Some(d) = eval_dimension(t) {
        return Some(LineHeight::Length(d));
    }
    t.parse::<f32>().ok().map(LineHeight::Ratio)
}

fn eval_cursor(text: &str) -> Option<Cursor> {
    Some(match text.trim() {
        "auto" => Cursor::Auto,
        "default" => Cursor::Default,
        "pointer" => Cursor::Pointer,
        "text" => Cursor::Text,
        "move" => Cursor::Move,
        "grab" => Cursor::Grab,
        "grabbing" => Cursor::Grabbing,
        "zoom-in" => Cursor::ZoomIn,
        "zoom-out" => Cursor::ZoomOut,
        "not-allowed" => Cursor::NotAllowed,
        "crosshair" => Cursor::Crosshair,
        "wait" => Cursor::Wait,
        "help" => Cursor::Help,
        "none" => Cursor::None,
        other => Cursor::Other(Arc::from(other)),
    })
}

fn eval_pointer_events(text: &str) -> Option<PointerEvents> {
    Some(match text.trim() {
        "auto" => PointerEvents::Auto,
        "none" => PointerEvents::None,
        _ => return None,
    })
}

fn eval_visibility(text: &str) -> Option<Visibility> {
    Some(match text.trim() {
        "visible" => Visibility::Visible,
        "hidden" => Visibility::Hidden,
        "collapse" => Visibility::Collapse,
        other => Visibility::Other(Arc::from(other)),
    })
}

fn eval_bg_fit(text: &str) -> Option<BgFit> {
    Some(match text.trim() {
        "cover" => BgFit::Cover,
        "contain" => BgFit::Contain,
        "fill" => BgFit::Fill,
        "none" => BgFit::None,
        "scale-down" => BgFit::ScaleDown,
        other => BgFit::Other(Arc::from(other)),
    })
}

fn eval_z_index(text: &str) -> Option<ZIndex> {
    match text.trim() {
        "auto" => Some(ZIndex::Auto),
        t => t.parse::<i32>().ok().map(ZIndex::Value),
    }
}

fn eval_flex(text: &str) -> Option<Flex> {
    let t = text.trim();
    match t {
        "auto" => {
            return Some(Flex {
                grow: 1.0,
                shrink: 1.0,
                basis: Dimension::Auto,
            })
        }
        "none" => {
            return Some(Flex {
                grow: 0.0,
                shrink: 0.0,
                basis: Dimension::Auto,
            })
        }
        "initial" => {
            return Some(Flex {
                grow: 0.0,
                shrink: 1.0,
                basis: Dimension::Auto,
            })
        }
        _ => {}
    }
    let parts = top_level_parts(t);
    if parts.is_empty() || parts.len() > 3 {
        return None;
    }
    let mut grow: Option<f32> = None;
    let mut shrink: Option<f32> = None;
    let mut basis: Option<Dimension> = None;
    for (i, part) in parts.iter().enumerate() {
        if let Ok(n) = part.parse::<f32>() {
            if grow.is_none() {
                grow = Some(n);
            } else if shrink.is_none() {
                shrink = Some(n);
            } else {
                return None;
            }
        } else if i == parts.len() - 1 {
            basis = Some(eval_dimension(part)?);
        } else {
            return None;
        }
    }
    Some(Flex {
        grow: grow.unwrap_or(1.0),
        shrink: shrink.unwrap_or(1.0),
        basis: basis.unwrap_or(Dimension::Px(0.0)),
    })
}

fn eval_aspect_ratio(text: &str) -> Option<f32> {
    let t = text.trim();
    if let Ok(n) = t.parse::<f32>() {
        return Some(n);
    }
    let (w, h) = t.split_once('/')?;
    let (w, h) = (w.trim().parse::<f32>().ok()?, h.trim().parse::<f32>().ok()?);
    if h == 0.0 {
        return None;
    }
    Some(w / h)
}

/// `translate(x, y) rotate(θ)` and whatever trails them.
fn eval_transform(text: &str) -> Option<Transform> {
    let t = text.trim();
    if t.eq_ignore_ascii_case("none") {
        return Some(Transform::default());
    }
    let mut out = Transform::default();
    let mut rest: Vec<&str> = Vec::new();
    for part in top_level_parts(t) {
        let lower = part.to_ascii_lowercase();
        if let Some(inner) = lower
            .strip_prefix("translate(")
            .and_then(|s| s.strip_suffix(')'))
        {
            let args: Vec<&str> = inner.split(',').map(|a| a.trim()).collect();
            if args.len() == 2 {
                if let (Some(x), Some(y)) = (eval_dimension(args[0]), eval_dimension(args[1])) {
                    out.translate = Some([x, y]);
                    continue;
                }
            }
            rest.push(part);
        } else if let Some(inner) = lower
            .strip_prefix("rotate(")
            .and_then(|s| s.strip_suffix(')'))
        {
            let inner = inner.trim().trim_end_matches("deg");
            if let Ok(deg) = inner.parse::<f32>() {
                out.rotate_deg = Some(deg);
                continue;
            }
            rest.push(part);
        } else {
            rest.push(part);
        }
    }
    if !rest.is_empty() {
        out.rest = Some(Arc::from(rest.join(" ").as_str()));
    }
    if out.translate.is_none() && out.rotate_deg.is_none() && out.rest.is_none() {
        return None;
    }
    Some(out)
}

/// One `box-shadow` layer: `[inset] <dx> <dy> [blur] [spread] [color]` — the
/// colour may sit at the front (`red 0 0 4px`) or the back.
fn eval_shadow_layer(text: &str) -> Option<Shadow> {
    let mut inset = false;
    let mut lens: Vec<Dimension> = Vec::new();
    let mut color: Option<Color> = None;
    for part in top_level_parts(text) {
        if part.eq_ignore_ascii_case("inset") {
            inset = true;
            continue;
        }
        if let Some(d) = eval_dimension(part) {
            if lens.len() < 4 {
                lens.push(d);
                continue;
            }
            return None;
        }
        if color.is_none() {
            if let Some(c) = eval_color(part) {
                color = Some(c);
                continue;
            }
        }
        return None;
    }
    if lens.len() < 2 {
        return None;
    }
    Some(Shadow {
        inset,
        dx: lens[0],
        dy: lens[1],
        blur: lens.get(2).copied(),
        spread: lens.get(3).copied(),
        color,
    })
}

fn eval_box_shadow(text: &str) -> Option<Vec<Shadow>> {
    let t = text.trim();
    if t.eq_ignore_ascii_case("none") {
        return Some(Vec::new());
    }
    split_top_commas(t)
        .iter()
        .map(|layer| eval_shadow_layer(layer.trim()))
        .collect()
}

/// The `background-image` decl — `url()`, a gradient, or the faded
/// `linear-gradient(wash, wash), image` composite the `--we-bg-image-composite`
/// var carries.
fn eval_bg_image(text: &str) -> Option<BgImage> {
    let t = text.trim();
    if t.is_empty() || t == "none" {
        return None;
    }
    let parts = split_top_commas(t);
    if parts.len() >= 2 {
        let first = parts[0].trim();
        if first.to_ascii_lowercase().starts_with("linear-gradient(") && first.ends_with(')') {
            // faded composite — the wash is the gradient's first colour-mix
            let inner = &first["linear-gradient(".len()..first.len() - 1];
            let stops = split_top_commas(inner);
            let wash = stops
                .first()
                .map(|s| Arc::from(s.trim()))
                .unwrap_or_else(|| Arc::from(""));
            let image = parts[1..].join(", ").trim().to_string();
            return Some(BgImage::Faded {
                image: Arc::from(image.as_str()),
                wash,
            });
        }
    }
    let lower = t.to_ascii_lowercase();
    if lower.starts_with("url(") {
        let inner = &t[4..t.len() - 1];
        let inner = inner.trim().trim_matches('"').trim_matches('\'');
        return Some(BgImage::Url(Arc::from(inner)));
    }
    if lower.contains("gradient(") {
        return Some(BgImage::Gradient(Arc::from(t)));
    }
    None
}

/// Evaluate one declaration map against the theme's token table.
pub fn eval_decls(decls: &Decls, cx: &EvalCx) -> EvalResult {
    eval_decls_scoped(decls, cx, &IndexMap::new())
}

/// [`eval_decls`] inside the element's var scope: `--we-*` custom properties
/// the decls set (a `tone` writes 13) overlay `inherited` and the theme for
/// every `var()` substitution — an element's own custom properties win for
/// the declarations on it, the same way CSS scopes them. `bg: accent-soft`
/// under `tone: danger` answers `danger-soft`, not `accent-soft`.
fn eval_decls_scoped(
    decls: &Decls,
    cx: &EvalCx,
    inherited: &IndexMap<Arc<str>, Arc<str>>,
) -> EvalResult {
    let has_own = decls.keys().any(|k| k.starts_with("--we-"));
    let merged;
    let scoped;
    let cx = if !has_own && inherited.is_empty() {
        cx
    } else {
        let mut vars: IndexMap<Arc<str>, Arc<str>> = cx
            .tokens
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        vars.extend(inherited.iter().map(|(k, v)| (k.clone(), v.clone())));
        for (k, v) in decls.iter().filter(|(k, _)| k.starts_with("--we-")) {
            vars.insert(k.clone(), Arc::from(v.text().as_str()));
        }
        merged = TokenTable::new(vars);
        scoped = EvalCx {
            tokens: &merged,
            viewport: cx.viewport,
            font_px: cx.font_px,
            root_px: cx.root_px,
        };
        &scoped
    };
    let mut r = EvalResult::default();
    for (css, value) in decls {
        let css = css.as_ref();
        if css.starts_with("--we-") {
            // Custom properties: the bg-image composite vars become paint
            // fields; the tone re-pointings collect for the widget.
            match css {
                "--we-bg-image-composite" => {
                    let s = cx.subst(value);
                    match eval_bg_image(&s) {
                        Some(img) => r.paint.bg_image = Some(img),
                        None => r.bad(css, value),
                    }
                }
                "--we-bg-image-fit" => match eval_bg_fit(&cx.subst(value)) {
                    Some(f) => r.paint.bg_image_style.fit = Some(f),
                    None => r.bad(css, value),
                },
                "--we-bg-image-position" => {
                    r.paint.bg_image_style.position = Some(Arc::from(cx.subst(value).as_str()));
                }
                _ => {
                    r.tone_vars
                        .insert(Arc::from(css), Arc::from(cx.subst(value).as_str()));
                }
            }
            continue;
        }
        macro_rules! dim {
            ($field:expr) => {
                if let Some(d) = eval_dimension_decl(&mut r, cx, css, value) {
                    $field = Some(d);
                }
            };
        }
        macro_rules! color {
            ($field:expr) => {{
                let s = cx.subst(value);
                match eval_color(&s) {
                    Some(c) => $field = Some(c),
                    None => r.bad(css, value),
                }
            }};
        }
        macro_rules! simple {
            ($field:expr, $eval:ident) => {{
                let s = cx.subst(value);
                match $eval(&s) {
                    Some(v) => $field = Some(v),
                    None => r.bad(css, value),
                }
            }};
        }
        match css {
            "display" => simple!(r.layout.display, eval_display),
            "flex-direction" => simple!(r.layout.direction, eval_flex_direction),
            "flex-wrap" => simple!(r.layout.wrap, eval_wrap),
            "justify-content" => simple!(r.layout.justify, eval_align),
            "align-items" => simple!(r.layout.align, eval_align),
            "align-self" => simple!(r.layout.align_self, eval_align),
            "gap" => {
                let s = cx.subst(value);
                let parts = top_level_parts(&s);
                match parts.len() {
                    1 => match eval_dimension(parts[0]) {
                        Some(d) => r.layout.gap = Some((d, d)),
                        None => r.bad(css, value),
                    },
                    2 => match (eval_dimension(parts[0]), eval_dimension(parts[1])) {
                        (Some(row), Some(col)) => r.layout.gap = Some((row, col)),
                        _ => r.bad(css, value),
                    },
                    _ => r.bad(css, value),
                }
            }
            "padding" => {
                let edges = eval_edges(&mut r, cx, css, value);
                if !edges.all_unset() {
                    r.layout.padding = edges;
                }
            }
            "margin" => {
                let edges = eval_edges(&mut r, cx, css, value);
                if !edges.all_unset() {
                    r.layout.margin = edges;
                }
            }
            "width" => dim!(r.layout.width),
            "height" => dim!(r.layout.height),
            "min-width" => dim!(r.layout.min_width),
            "min-height" => dim!(r.layout.min_height),
            "max-width" => dim!(r.layout.max_width),
            "max-height" => dim!(r.layout.max_height),
            "aspect-ratio" => {
                let s = cx.subst(value);
                match eval_aspect_ratio(&s) {
                    Some(v) => r.layout.aspect_ratio = Some(v),
                    None => r.bad(css, value),
                }
            }
            "flex" => {
                let s = cx.subst(value);
                match eval_flex(&s) {
                    Some(v) => r.layout.flex = Some(v),
                    None => r.bad(css, value),
                }
            }
            "flex-shrink" => {
                let s = cx.subst(value);
                match s.trim().parse::<f32>() {
                    Ok(v) => r.layout.flex_shrink = Some(v),
                    Err(_) => r.bad(css, value),
                }
            }
            "position" => simple!(r.layout.position, eval_position),
            "top" => dim!(r.layout.inset.top),
            "right" => dim!(r.layout.inset.right),
            "bottom" => dim!(r.layout.inset.bottom),
            "left" => dim!(r.layout.inset.left),
            "overflow" => {
                let s = cx.subst(value);
                match eval_overflow(&s) {
                    Some(v) => {
                        r.layout.overflow = Some(v.clone());
                        // The shorthand sets both axes wherever the axis decl
                        // has not already overridden it.
                        if r.layout.overflow_x.is_none() {
                            r.layout.overflow_x = Some(v.clone());
                        }
                        if r.layout.overflow_y.is_none() {
                            r.layout.overflow_y = Some(v);
                        }
                    }
                    None => r.bad(css, value),
                }
            }
            "overflow-x" => simple!(r.layout.overflow_x, eval_overflow),
            "overflow-y" => simple!(r.layout.overflow_y, eval_overflow),
            "scrollbar-width" => simple!(r.layout.scrollbar_width, eval_scrollbar_width),
            "scrollbar-gutter" => simple!(r.layout.scrollbar_gutter, eval_scrollbar_gutter),
            "color" => color!(r.text.color),
            "background-color" => color!(r.paint.bg),
            "background-image" => {
                let s = cx.subst(value);
                match eval_bg_image(&s) {
                    Some(img) => r.paint.bg_image = Some(img),
                    None => {
                        // `none` is a valid image-less value; a parse failure
                        // is what reaches unsupported.
                        if s.trim() == "none" {
                            r.paint.bg_image = None;
                        } else {
                            r.bad(css, value);
                        }
                    }
                }
            }
            "background-size" => match eval_bg_fit(&cx.subst(value)) {
                Some(f) => r.paint.bg_image_style.fit = Some(f),
                None => r.bad(css, value),
            },
            "background-position" => {
                r.paint.bg_image_style.position = Some(Arc::from(cx.subst(value).as_str()));
            }
            "background-repeat" => {}
            "opacity" => {
                let s = cx.subst(value);
                match s.trim().parse::<f32>() {
                    Ok(v) => r.paint.opacity = Some(v.clamp(0.0, 1.0)),
                    Err(_) => r.bad(css, value),
                }
            }
            "border" => {
                let s = cx.subst(value);
                match eval_border_side(&s) {
                    Some(side) => {
                        let side = side.unwrap_or(BorderSide {
                            width: None,
                            kind: BorderKind::None,
                            color: None,
                        });
                        for slot in [
                            &mut r.paint.borders.top,
                            &mut r.paint.borders.right,
                            &mut r.paint.borders.bottom,
                            &mut r.paint.borders.left,
                        ] {
                            *slot = Some(side.clone());
                        }
                    }
                    None => r.bad(css, value),
                }
            }
            "border-top" | "border-right" | "border-bottom" | "border-left" => {
                let s = cx.subst(value);
                let slot = match css {
                    "border-top" => &mut r.paint.borders.top,
                    "border-right" => &mut r.paint.borders.right,
                    "border-bottom" => &mut r.paint.borders.bottom,
                    _ => &mut r.paint.borders.left,
                };
                match eval_border_side(&s) {
                    Some(side) => {
                        *slot = Some(side.unwrap_or(BorderSide {
                            width: None,
                            kind: BorderKind::None,
                            color: None,
                        }))
                    }
                    None => r.bad(css, value),
                }
            }
            "border-color" => {
                let s = cx.subst(value);
                match eval_color(&s) {
                    Some(c) => {
                        r.paint.border_color = Some(c);
                        // Emitted before the side declarations, so it colours
                        // every side written so far; a later `border-top`
                        // overwrites the whole triple on its side.
                        for slot in [
                            &mut r.paint.borders.top,
                            &mut r.paint.borders.right,
                            &mut r.paint.borders.bottom,
                            &mut r.paint.borders.left,
                        ] {
                            if let Some(side) = slot.as_mut() {
                                side.color = Some(c);
                            }
                        }
                    }
                    None => r.bad(css, value),
                }
            }
            "border-width" => {
                let s = cx.subst(value);
                match eval_dimension(&s) {
                    Some(d) => {
                        r.paint.border_width = Some(d);
                        for slot in [
                            &mut r.paint.borders.top,
                            &mut r.paint.borders.right,
                            &mut r.paint.borders.bottom,
                            &mut r.paint.borders.left,
                        ] {
                            if let Some(side) = slot.as_mut() {
                                side.width = Some(d);
                            }
                        }
                    }
                    None => r.bad(css, value),
                }
            }
            "border-radius" => {
                let edges = eval_edges(&mut r, cx, css, value);
                if !edges.all_unset() {
                    r.paint.radius = edges;
                }
            }
            "box-shadow" => {
                let s = cx.subst(value);
                match eval_box_shadow(&s) {
                    Some(shadows) => r.paint.shadows = Some(shadows),
                    None => r.bad(css, value),
                }
            }
            "transform" => {
                let s = cx.subst(value);
                match eval_transform(&s) {
                    Some(t) => r.paint.transform = Some(t),
                    None => r.bad(css, value),
                }
            }
            "transition" => {
                let s = cx.subst(value);
                r.transitions = parse_transitions(&s);
                if r.transitions.is_empty() {
                    r.bad(css, value);
                }
            }
            "cursor" => simple!(r.paint.cursor, eval_cursor),
            "pointer-events" => simple!(r.paint.pointer_events, eval_pointer_events),
            "visibility" => simple!(r.paint.visibility, eval_visibility),
            "z-index" => simple!(r.paint.z_index, eval_z_index),
            "font-family" => {
                r.text.font_family = Some(Arc::from(cx.subst(value).as_str()));
            }
            "font-weight" => {
                let s = cx.subst(value);
                match s.trim().parse::<f32>() {
                    Ok(v) => r.text.font_weight = Some(v),
                    Err(_) => r.bad(css, value),
                }
            }
            "font-size" => dim!(r.text.font_size),
            "line-height" => simple!(r.text.line_height, eval_line_height),
            "letter-spacing" => dim!(r.text.letter_spacing),
            "text-align" => simple!(r.text.align, eval_text_align),
            "text-transform" => simple!(r.text.transform, eval_text_transform),
            "text-decoration" => simple!(r.text.decoration, eval_text_decoration),
            "white-space" => simple!(r.text.white_space, eval_white_space),
            "overflow-wrap" => simple!(r.text.overflow_wrap, eval_overflow_wrap),
            _ => r.bad(css, value),
        }
    }
    r
}

// ── resolve: props + theme + viewport → Style ──────────────────────────────

/// Everything resolution needs: the theme's table, the component's container
/// direction, the viewport the tier and `vw`/`vh` resolve against, and the
/// font metrics `em`/`rem`/`lh` mean.
pub struct StyleInput<'a> {
    pub tokens: &'a TokenTable,
    pub direction: Direction,
    /// Container width in px — decides which `*UpProps` tier applies.
    /// `Tier::for_width` maps it; `Tier::Base` behaviour comes free by
    /// passing `0`.
    pub container_width: f32,
    pub viewport: Size,
    pub font_px: f32,
    pub root_px: f32,
}

impl<'a> StyleInput<'a> {
    pub fn new(tokens: &'a TokenTable, direction: Direction) -> Self {
        Self {
            tokens,
            direction,
            container_width: 0.0,
            viewport: Size::new(0.0, 0.0),
            font_px: 14.0,
            root_px: 16.0,
        }
    }

    fn cx(&self) -> EvalCx<'_> {
        EvalCx {
            tokens: self.tokens,
            viewport: self.viewport,
            font_px: self.font_px,
            root_px: self.root_px,
        }
    }
}

/// The prop names `buildLayoutStyles` reads — every key it turns into a
/// declaration, the signature-adjacent `reverse`, and the state/tier bags.
/// A prop outside this set is a widget prop (or a typo) and counts as
/// ignored.
pub fn is_design_prop(key: &str) -> bool {
    matches!(
        key,
        // flex layer
        "ax" | "ay" | "wrap" | "gap"
        | "p" | "px" | "py" | "pt" | "pr" | "pb" | "pl"
        // layout layer
        | "flex" | "flexShrink" | "alignSelf"
        | "width" | "height" | "minWidth" | "minHeight" | "maxWidth" | "maxHeight"
        | "aspectRatio" | "position" | "top" | "right" | "bottom" | "left"
        | "zIndex" | "display" | "overflow" | "overflowX" | "overflowY"
        | "scrollbarWidth" | "scrollbarGutter"
        | "m" | "mx" | "my" | "mt" | "mr" | "mb" | "ml"
        // visual layer
        | "tone" | "bg" | "bgImage" | "bgFit" | "bgPosition" | "bgImageOpacity"
        | "bgImageTint" | "color" | "opacity" | "shadow" | "ring" | "cursor"
        | "pointerEvents" | "visibility" | "transform" | "x" | "y" | "rotate"
        | "transition"
        | "border" | "borderColor" | "borderTop" | "borderRight" | "borderBottom"
        | "borderLeft" | "borderWidth"
        | "r" | "rr" | "rt" | "rb" | "rl" | "rtl" | "rtr" | "rbr" | "rbl"
        // typography layer
        | "textAlign" | "fontFamily" | "fontWeight" | "fontSize" | "lineHeight"
        | "letterSpacing" | "textDecoration" | "textTransform" | "whiteSpace"
        | "overflowWrap"
        // signature-adjacent, bags, escape hatch
        | "reverse" | "styles"
        | "hoverProps" | "activeProps" | "focusProps" | "disabledProps"
        | "smUpProps" | "mdUpProps" | "lgUpProps"
        // component inputs the builder never reads but that are still DS keys
        | "direction"
    )
}

/// `stateProps` bag → its [`StylePatch`], exactly the steps `useStateProps`
/// runs: box sides filled from the element's props, resting shadow, fragment
/// decls, border sides expanded against the base decls, the interactive
/// surface.
fn state_patch(
    bag: &Bag,
    props: &Bag,
    base_decls: &Decls,
    direction: Direction,
    cx: &EvalCx,
    tone_vars: &IndexMap<Arc<str>, Arc<str>>,
) -> StylePatch {
    let filled = state_bag_filled(bag, props);
    let filled = with_resting_shadow(&filled, props);
    let mut fragment = build_state_fragment_decls(&filled, direction);
    fragment = with_border_sides(&fragment, base_decls);
    fragment = interactive_decls(&fragment);
    // The element's `tone` vars scope every decl on it — a state's
    // `bg: accent-soft` re-points the same way the base decls did.
    let ev = eval_decls_scoped(&fragment, cx, tone_vars);
    StylePatch {
        layout: ev.layout,
        text: ev.text,
        paint: ev.paint,
        unsupported: ev.unsupported,
    }
}

/// Resolve a node's design-system props into a [`Style`]: the base
/// declarations evaluated, the state bags as patches, and the active tier's
/// bag folded over the base (cascading through the tiers beneath it, as the
/// `var(--we-ds-{tier}-*, var(--we-ds-lower, …))` chains do).
pub fn resolve(props: &Bag, input: &StyleInput) -> Style {
    let cx = input.cx();
    let base_decls = with_border_sides(&build_layout_decls(props, input.direction), &Decls::new());
    let base = eval_decls(&base_decls, &cx);

    let mut style = Style {
        layout: base.layout.clone(),
        text: base.text.clone(),
        paint: base.paint.clone(),
        transitions: base.transitions.clone(),
        unsupported: base.unsupported.clone(),
        ..Style::default()
    };

    if let Some(tone) = truthy(props, "tone") {
        style.tone = Some(Tone {
            name: Arc::from(tone.js_string().as_str()),
            vars: Arc::new(base.tone_vars.clone()),
        });
    }
    // `styles` was merged into the decls; its unmodelled keys are already in
    // unsupported as `css-prop=value`. Mark the hatch itself once, as the
    // brief asks.
    if props.contains_key("styles") {
        style.unsupported.push(Arc::from("styles=?"));
    }

    // State bags — patches over the pre-tier style.
    let has_states = ["hoverProps", "activeProps", "focusProps", "disabledProps"]
        .iter()
        .any(|k| {
            props
                .get(*k)
                .and_then(|v| match v {
                    Value::Obj(o) if !o.is_empty() => Some(()),
                    _ => None,
                })
                .is_some()
        });
    if has_states {
        if let Some(bag) = props.get("focusProps").and_then(|v| match v {
            Value::Obj(o) if !o.is_empty() => Some(o.as_ref()),
            _ => None,
        }) {
            style.focus = Some(Box::new(state_patch(
                bag,
                props,
                &base_decls,
                input.direction,
                &cx,
                &base.tone_vars,
            )));
        }
        if let Some(bag) = props.get("hoverProps").and_then(|v| match v {
            Value::Obj(o) if !o.is_empty() => Some(o.as_ref()),
            _ => None,
        }) {
            style.hover = Some(Box::new(state_patch(
                bag,
                props,
                &base_decls,
                input.direction,
                &cx,
                &base.tone_vars,
            )));
        }
        if let Some(bag) = props.get("activeProps").and_then(|v| match v {
            Value::Obj(o) if !o.is_empty() => Some(o.as_ref()),
            _ => None,
        }) {
            style.active = Some(Box::new(state_patch(
                bag,
                props,
                &base_decls,
                input.direction,
                &cx,
                &base.tone_vars,
            )));
        }
        if let Some(bag) = props.get("disabledProps").and_then(|v| match v {
            Value::Obj(o) if !o.is_empty() => Some(o.as_ref()),
            _ => None,
        }) {
            style.disabled = Some(Box::new(state_patch(
                bag,
                props,
                &base_decls,
                input.direction,
                &cx,
                &base.tone_vars,
            )));
        }
    }

    // The active tier and the ones beneath it, ascending — `md` falls back
    // through `sm` to base, exactly as its var chain does.
    let active = Tier::for_width(input.container_width);
    if active != Tier::Base {
        let mut applied = false;
        let mut pretier: Option<Box<Style>> = None;
        for tier in [Tier::Sm, Tier::Md, Tier::Lg]
            .iter()
            .copied()
            .take_while(|t| *t <= active)
        {
            let Some(bag) = tier_bag_of(props, tier) else {
                continue;
            };
            if !applied {
                pretier = Some(Box::new(style.clone()));
                applied = true;
            }
            let mut fragment = build_state_fragment_decls(&bag, input.direction);
            fragment = with_border_sides(&fragment, &base_decls);
            fragment = interactive_decls(&fragment);
            let ev = eval_decls_scoped(&fragment, &cx, &base.tone_vars);
            ev.layout.merge_into(&mut style.layout);
            ev.text.merge_into(&mut style.text);
            ev.paint.merge_into(&mut style.paint);
            style.unsupported.extend(ev.unsupported);
        }
        if applied {
            style.pretier = pretier;
        }
    }

    // Everything left is not ours — widget props and anything unknown.
    style.ignored_props = props.keys().filter(|k| !is_design_prop(k)).count();

    style
}
