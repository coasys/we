//! The token-name machinery — the port of `tokenVar` and friends from
//! `design-system/utils/src/index.ts`: which authored strings name a scale
//! step (`"300"`), which name a colour role (`"surface"`), which are raw CSS
//! (`"12px"`, `"var(--we-…)"`), and what CSS variable each emits.
//!
//! The unknown-token warning path (`warnUnknownToken`) is intentionally not
//! ported — this crate has no console; an undeclared `var(--we-*)` lands in
//! `Style::unsupported` instead, which is the same signal one level later.

use std::sync::Arc;

use we_expr::Value;

/// The spacing axis a `tokenVar('space', …)` is resolving for — families exist
/// only on `padding` and `gap` (`themeFamily.ts`), never on margin or offsets.
/// `Radius` is implied by `prefix == "radius"` rather than passed by callers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SemanticAxis {
    Radius,
    Padding,
    Gap,
}

/// Theme-family names → the `var(--we-theme-…, <fallback>)` chain they emit,
/// per axis. Port of `themeFamily` + `semanticValues`.
fn semantic_family(axis: SemanticAxis, token: &str) -> Option<&'static str> {
    match (axis, token) {
        (SemanticAxis::Radius, "control") => {
            Some("var(--we-theme-control-radius, var(--we-radius-400))")
        }
        (SemanticAxis::Radius, "surface") => {
            Some("var(--we-theme-surface-radius, var(--we-radius-400))")
        }
        (SemanticAxis::Radius, "input") => {
            Some("var(--we-theme-input-radius, var(--we-radius-300))")
        }
        (SemanticAxis::Radius, "avatar") => Some("var(--we-theme-avatar-radius, 50%)"),
        (SemanticAxis::Radius, "media") => Some("var(--we-theme-surface-radius, 0px)"),
        (SemanticAxis::Padding, "surface") => {
            Some("var(--we-theme-surface-padding, var(--we-space-500))")
        }
        (SemanticAxis::Gap, "control") => Some("var(--we-theme-control-gap, var(--we-space-300))"),
        (SemanticAxis::Gap, "surface") => Some("var(--we-theme-surface-gap, var(--we-space-400))"),
        _ => None,
    }
}

/// The glow shadow, written out so it resolves against the accent where it is
/// drawn — `GLOW_SHADOW` in `1-tokens/src/shadow.ts`.
pub const GLOW_SHADOW: &str = "0 0 0 1px color-mix(in srgb, var(--we-role-accent) calc(60% * var(--we-theme-glow-strength, 0.35) / 0.35), transparent), 0 0 var(--we-theme-glow-size, 16px) color-mix(in srgb, var(--we-role-accent) calc(var(--we-theme-glow-strength, 0.35) * 100%), transparent)";

/// Every semantic role name, kebab-case as a schema spells it —
/// `Object.keys(role)` kebab-cased: the base roles plus every family's
/// `{family, familySoft, familyText, familyBorder, familyHover, familyActive,
/// onFamily}` for the 14 chromatic families and `neutral`.
pub fn is_role_name(name: &str) -> bool {
    if BASE_ROLES.contains(&name) {
        return true;
    }
    // family, family-{soft,text,border,hover,active}, on-family
    for family in FAMILY_NAMES {
        if name == *family {
            return true;
        }
        for suffix in ["-soft", "-text", "-border", "-hover", "-active"] {
            let mut s = String::with_capacity(family.len() + suffix.len());
            s.push_str(family);
            s.push_str(suffix);
            if name == s {
                return true;
            }
        }
        let on = format!("on-{family}");
        if name == on {
            return true;
        }
    }
    false
}

const BASE_ROLES: &[&str] = &[
    "page",
    "chrome",
    "surface",
    "surface-raised",
    "surface-sunken",
    "text",
    "text-muted",
    "text-faint",
    "on-inverse",
    "surface-inverse",
    "border",
    "border-strong",
    "border-hover",
    "on-accent-muted",
    "surface-hover",
    "surface-active",
    "item-hover",
    "selected",
    "on-selected",
    "text-selection",
    "surface-sunken-hover",
    "field",
    "field-hover",
    "control-surface",
    "overlay",
    "shadow-color",
    "focus",
];

/// `CHROMATIC_FAMILIES` + `neutral` — the tone and family-role vocabulary.
const FAMILY_NAMES: &[&str] = &[
    "accent", "success", "warning", "danger", "red", "orange", "yellow", "lime", "green", "teal",
    "cyan", "blue", "purple", "pink", "neutral",
];

/// `bg` values that carry a themed surface image — `SURFACE_IMAGE_ROLES`
/// kebab-cased (`surfaceRaised` → `surface-raised`).
fn surface_image_var(bg: &str) -> Option<&'static str> {
    match bg {
        "chrome" => Some("--we-surface-image-chrome"),
        "page" => Some("--we-surface-image-page"),
        "surface" => Some("--we-surface-image-surface"),
        "surface-raised" => Some("--we-surface-image-surface-raised"),
        "surface-sunken" => Some("--we-surface-image-surface-sunken"),
        _ => None,
    }
}

/// `isRawCSSValue` — the authored value is already CSS, not a token: units,
/// `var()`, `#hex`, colour functions, math functions, the CSS-wide keywords,
/// and a number followed by whitespace (`"20px 30px"`, `"1 1 200px"`).
pub fn is_raw_css_value(value: &str) -> bool {
    let v = value;
    let lower = v.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "transparent"
            | "currentcolor"
            | "inherit"
            | "initial"
            | "unset"
            | "revert"
            | "auto"
            | "none"
    ) {
        return true;
    }
    for f in ["calc(", "min(", "max(", "clamp(", "env("] {
        if lower.starts_with(f) {
            return true;
        }
    }
    if lower.starts_with("color-mix(") {
        return true;
    }
    for f in [
        "oklch(",
        "oklab(",
        "lch(",
        "lab(",
        "hwb(",
        "color(",
        "color-contrast(",
        "light-dark(",
    ] {
        if lower.starts_with(f) {
            return true;
        }
    }
    let t = v.strip_prefix('-').unwrap_or(v);
    if t.starts_with("var(") || t.starts_with('#') {
        return true;
    }
    let tl = t.to_ascii_lowercase();
    if tl.starts_with("rgb(")
        || tl.starts_with("rgba(")
        || tl.starts_with("hsl(")
        || tl.starts_with("hsla(")
    {
        return true;
    }
    // `\d+(\.\d+)?(px|rem|em|%|vh|vw|vmin|vmax|ch|ex|\s)` — a number followed
    // immediately by a unit or whitespace.
    let bytes = t.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == 0 {
        return false;
    }
    if i < bytes.len() && bytes[i] == b'.' {
        // a dot must carry digits after it to extend the number
        let mut j = i + 1;
        while j < bytes.len() && bytes[j].is_ascii_digit() {
            j += 1;
        }
        if j > i + 1 {
            i = j;
        }
    }
    if i >= bytes.len() {
        return false; // a bare number is a token, not CSS
    }
    let rest = &t[i..];
    if rest.chars().next().is_some_and(|c| c.is_whitespace()) {
        return true;
    }
    for unit in [
        "px", "rem", "em", "%", "vh", "vw", "vmin", "vmax", "ch", "ex",
    ] {
        if rest.to_ascii_lowercase().starts_with(unit) {
            return true;
        }
    }
    false
}

/// `tokenVar` — what one authored value emits: the fallback when absent, the
/// raw value when it is already CSS, the role/family/scale `var(--we-*)` form
/// otherwise.
pub fn token_var(
    prefix: &str,
    token: Option<&str>,
    fallback: &str,
    axis: Option<SemanticAxis>,
) -> Arc<str> {
    let Some(token) = token else {
        return Arc::from(fallback);
    };
    if token.is_empty() {
        return Arc::from(fallback);
    }
    if token == "0" {
        return Arc::from("0");
    }
    if is_raw_css_value(token) {
        return Arc::from(token);
    }
    if prefix == "color" && is_role_name(token) {
        return Arc::from(format!("var(--we-role-{token})").as_str());
    }
    if prefix == "shadow" && token == "glow" {
        return Arc::from(GLOW_SHADOW);
    }
    if prefix == "color" && (token == "white" || token == "black") {
        return Arc::from(format!("var(--we-role-{token})").as_str());
    }
    let family_axis = if prefix == "radius" {
        Some(SemanticAxis::Radius)
    } else {
        axis
    };
    if let Some(ax) = family_axis {
        if let Some(family) = semantic_family(ax, token) {
            return Arc::from(family);
        }
    }
    Arc::from(format!("var(--we-{prefix}-{token})").as_str())
}

/// `zIndexVar` — a number passes through, a layer name emits `var(--we-z-*)`.
pub fn z_index_var(value: &Value) -> Option<Arc<str>> {
    if matches!(value, Value::Undefined | Value::Null) {
        return None;
    }
    let s = value.js_string();
    if let Value::Num(_) = value {
        return Some(Arc::from(s.as_str()));
    }
    // /^-?\d+$/ — an integer literal, not any string containing a digit.
    let body = s.strip_prefix('-').unwrap_or(&s);
    if !body.is_empty() && body.bytes().all(|b| b.is_ascii_digit()) {
        return Some(Arc::from(s.as_str()));
    }
    Some(Arc::from(format!("var(--we-z-{s})").as_str()))
}

/// `parseTransition` — each whitespace-separated segment that names a duration
/// token becomes `var(--we-transition-*)`.
pub fn parse_transition_prop(value: &str) -> Option<Arc<str>> {
    if value.is_empty() {
        return None;
    }
    const DURATIONS: [&str; 6] = ["0", "100", "200", "300", "400", "500"];
    let out = value
        .split(',')
        .map(|part| {
            part.trim()
                .split_whitespace()
                .map(|seg| {
                    if DURATIONS.contains(&seg) {
                        format!("var(--we-transition-{seg})")
                    } else {
                        seg.to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>()
        .join(", ");
    Some(Arc::from(out.as_str()))
}

/// `Number(value)` when finite, else `None` — what `cssLength`'s
/// `Number.isFinite(numeric)` actually tests. `Value::to_number` squashes NaN
/// to 0, which would read `'abc'` as `0px`.
fn js_num(value: &Value) -> Option<f64> {
    match value {
        Value::Undefined => None,
        Value::Null => Some(0.0),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        Value::Num(n) => n.is_finite().then_some(*n),
        Value::Str(s) => s.trim().parse::<f64>().ok().filter(|n| n.is_finite()),
        Value::List(l) => match l.len() {
            0 => Some(0.0),
            1 => js_num(&l[0]),
            _ => None,
        },
        _ => None,
    }
}

/// `cssLength` — a number means px, a numeric string is px too, anything else
/// keeps its text.
pub fn css_length(value: &Value) -> Option<Arc<str>> {
    match value {
        Value::Undefined | Value::Null => None,
        Value::Str(s) if s.is_empty() => None,
        _ => {
            let s = value.js_string();
            match js_num(value) {
                Some(n) if !s.trim().is_empty() => Some(Arc::from(format!("{n}px").as_str())),
                _ => Some(Arc::from(s.as_str())),
            }
        }
    }
}

/// `cssAngle` — the same, in degrees.
pub fn css_angle(value: &Value) -> Option<Arc<str>> {
    match value {
        Value::Undefined | Value::Null => None,
        Value::Str(s) if s.is_empty() => None,
        _ => {
            let s = value.js_string();
            match js_num(value) {
                Some(n) if !s.trim().is_empty() => Some(Arc::from(format!("{n}deg").as_str())),
                _ => Some(Arc::from(s.as_str())),
            }
        }
    }
}

/// `composeTransform` — `x`/`y`/`rotate` in front of an explicit `transform`.
pub fn compose_transform(
    x: Option<&Value>,
    y: Option<&Value>,
    rotate: Option<&Value>,
    transform: Option<&Value>,
) -> Option<Arc<str>> {
    let x = x.and_then(css_length);
    let y = y.and_then(css_length);
    let rotate = rotate.and_then(css_angle);
    if x.is_none() && y.is_none() && rotate.is_none() {
        return match transform {
            Some(v) if v.truthy() => Some(v.js_string().into()),
            _ => None,
        };
    }
    let mut parts: Vec<String> = Vec::new();
    if x.is_some() || y.is_some() {
        parts.push(format!(
            "translate({}, {})",
            x.as_deref().unwrap_or("0"),
            y.as_deref().unwrap_or("0")
        ));
    }
    if let Some(r) = rotate {
        parts.push(format!("rotate({r})"));
    }
    if let Some(v) = transform {
        if v.truthy() {
            parts.push(v.js_string());
        }
    }
    Some(Arc::from(parts.join(" ").as_str()))
}

/// `isBgImageFaded` — a `bgImage` whose `bgImageOpacity` is set below 1.
pub fn is_bg_image_faded(bg_image: Option<&Value>, opacity: Option<&Value>) -> bool {
    match (bg_image, opacity) {
        (Some(img), Some(op)) if img.truthy() => {
            !matches!(op, Value::Undefined) && op.to_number() < 1.0
        }
        _ => false,
    }
}

/// `resolveBgImageUrl` — whitespace stripped; `data:` URIs pass through
/// verbatim (this renderer decodes them itself — the browser's blob-URL hop
/// exists for CSS string-size limits that do not apply here).
pub fn resolve_bg_image_url(raw: &str) -> String {
    raw.chars().filter(|c| !c.is_whitespace()).collect()
}

/// `isGradientValue` — a `*-gradient(` opening.
pub fn is_gradient_value(raw: &str) -> bool {
    let t = raw.trim_start().to_ascii_lowercase();
    for prefix in ["linear-gradient(", "radial-gradient(", "conic-gradient("] {
        if t.starts_with(prefix) {
            return true;
        }
    }
    for prefix in [
        "repeating-linear-gradient(",
        "repeating-radial-gradient(",
        "repeating-conic-gradient(",
    ] {
        if t.starts_with(prefix) {
            return true;
        }
    }
    false
}

/// `bgImageLayer` — `none`, a gradient verbatim, or `url("…")`.
pub fn bg_image_layer(raw: &str) -> Arc<str> {
    if raw.trim() == "none" {
        return Arc::from("none");
    }
    if is_gradient_value(raw) {
        return Arc::from(
            raw.trim()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .as_str(),
        );
    }
    Arc::from(format!("url(\"{}\")", resolve_bg_image_url(raw)).as_str())
}

/// `computeBgImageComposite` — `linear-gradient(wash, wash), image` when the
/// image is faded, else the plain layer.
pub fn compute_bg_image_composite(
    bg_image: &Value,
    opacity: Option<&Value>,
    tint_src: Option<&Value>,
) -> Option<Arc<str>> {
    if !bg_image.truthy() {
        return None;
    }
    let image = bg_image_layer(&bg_image.js_string());
    let op = opacity.map(|v| v.to_number());
    if op.is_none() || op.is_some_and(|o| o >= 1.0) {
        return Some(image);
    }
    let tint_text = tint_src
        .map(|v| v.js_string())
        .unwrap_or_else(|| "neutral-0".to_string());
    let tint = token_var("color", Some(tint_text.as_str()), tint_text.as_str(), None);
    let pct = ((1.0 - op.unwrap_or(1.0)) * 100.0).round() as i32;
    let wash = format!("color-mix(in srgb, {tint} {pct}%, transparent)");
    Some(Arc::from(
        format!("linear-gradient({wash}, {wash}), {image}").as_str(),
    ))
}

/// `mapFlexAxes` — which of `ax`/`ay` is the main axis under `direction`,
/// mapped to the CSS word.
pub struct FlexAxes {
    pub main: Option<&'static str>,
    pub cross: Option<&'static str>,
}

pub fn map_flex_axes(ax: Option<&str>, ay: Option<&str>, direction: &str) -> FlexAxes {
    let is_row = direction.contains("row");
    let (main_key, cross_key) = if is_row { (ax, ay) } else { (ay, ax) };
    FlexAxes {
        main: main_key.and_then(|k| match k {
            "start" => Some("flex-start"),
            "center" => Some("center"),
            "end" => Some("flex-end"),
            "between" => Some("space-between"),
            "around" => Some("space-around"),
            "even" => Some("space-evenly"),
            _ => None,
        }),
        cross: cross_key.and_then(|k| match k {
            "start" => Some("flex-start"),
            "center" => Some("center"),
            "end" => Some("flex-end"),
            "stretch" => Some("stretch"),
            _ => None,
        }),
    }
}

/// `toneVariables` — the `--we-*` re-pointings a `tone` writes on its element.
/// Returns them in WE's emission order.
pub fn tone_variables(tone: &str) -> Vec<(Arc<str>, Arc<str>)> {
    let mut out: Vec<(Arc<str>, Arc<str>)> = Vec::with_capacity(13);
    let held = |name: &str| -> String {
        format!(
            "var(--we-held-{}, {})",
            kebab(name),
            accent_family_role(name)
        )
    };
    for suffix in ["", "-soft", "-text", "-border", "-hover", "-active"] {
        let accent_role = format!("accent{suffix}");
        let value = if tone == "accent" {
            held(&camel(&accent_role))
        } else {
            format!("var(--we-role-{tone}{suffix})")
        };
        out.push((
            Arc::from(format!("--we-role-{accent_role}").as_str()),
            Arc::from(value.as_str()),
        ));
    }
    let on_accent = if tone == "accent" {
        held("onAccent")
    } else {
        let t = camel(tone);
        format!("var(--we-role-on-{t})")
    };
    out.push((
        Arc::from("--we-role-on-accent"),
        Arc::from(on_accent.as_str()),
    ));
    out.push((
        Arc::from("--we-role-on-accent-muted"),
        Arc::from("oklch(from var(--we-role-on-accent) l c h / 0.8)"),
    ));
    out.push((
        Arc::from("--we-role-focus"),
        Arc::from("var(--we-role-accent)"),
    ));
    out.push((
        Arc::from("--we-color-focus"),
        Arc::from("var(--we-role-focus)"),
    ));
    out.push((
        Arc::from("--we-ring-color"),
        Arc::from("var(--we-role-focus)"),
    ));
    out.push((
        Arc::from("--we-focus-outline"),
        Arc::from("0 0 0 var(--we-focus-ring-width) var(--we-color-focus)"),
    ));
    out.push((
        Arc::from("--we-gradient-accent"),
        Arc::from(
            "linear-gradient(135deg, oklch(from var(--we-role-accent) l c calc(h - 25)) 0%, oklch(from var(--we-role-accent) l c calc(h + 25)) 100%)",
        ),
    ));
    out
}

/// `FAMILY_ROLES[accent<suffix>]` — the held-var fallback for `tone: 'accent'`
/// only (the accent family's own values, per `chromaticRoles('accent')`).
fn accent_family_role(name: &str) -> &'static str {
    match name {
        "accent" => "oklch(calc(var(--we-accent-lightness, 55) * 1%) calc(var(--we-color-accent-saturation) / 100 * var(--we-color-accent-fill-chroma-max, 0.2663)) var(--we-color-accent-hue))",
        "accentSoft" => "var(--we-color-accent-100)",
        "accentText" => "var(--we-color-accent-700)",
        "accentBorder" => "var(--we-color-accent-300)",
        "accentHover" => {
            "oklch(from var(--we-role-accent) calc(l + var(--we-state-hover-accent, var(--we-state-hover))) c h)"
        }
        "accentActive" => {
            "oklch(from var(--we-role-accent) calc(l + var(--we-state-active-accent, var(--we-state-active))) c h)"
        }
        "onAccent" => "oklch(100% 0 var(--we-color-neutral-hue))",
        _ => "var(--we-role-accent)",
    }
}

fn kebab(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        if c.is_ascii_uppercase() {
            out.push('-');
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

fn camel(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut up = false;
    for c in name.chars() {
        if c == '-' {
            up = true;
        } else if up {
            out.extend(c.to_uppercase());
            up = false;
        } else {
            out.push(c);
        }
    }
    out
}

/// The `surfaceImageVar` emission for a `bg` role, if it is one.
pub fn surface_image_decl(bg: &str) -> Option<Arc<str>> {
    surface_image_var(bg).map(|v| Arc::from(format!("var({v}, none)").as_str()))
}

/// `font.family` token names — `resolveFontFamily`'s set.
const FONT_FAMILY_TOKENS: &[&str] = &["base", "mozilla", "boldonse", "mono"];
/// `font.weight` token names — `resolveFontWeight`'s set.
const FONT_WEIGHT_TOKENS: &[&str] = &[
    "100", "200", "300", "400", "500", "600", "700", "800", "900", "regular", "medium", "semibold",
    "bold",
];
/// `font.lineHeight` token names — `resolveLineHeight`'s set.
const LINE_HEIGHT_TOKENS: &[&str] = &["none", "tight", "snug", "normal", "relaxed", "loose"];

/// `makeTokenResolver` for the three font props: a token name emits
/// `var(--we-<cssVarPrefix>-<name>)`, anything else passes through.
fn set_resolver<'a>(tokens: &[&str], prefix: &str, value: &str) -> Arc<str> {
    if tokens.contains(&value) {
        Arc::from(format!("var(--we-{prefix}-{value})").as_str())
    } else {
        Arc::from(value)
    }
}

pub fn resolve_font_family(value: &str) -> Option<Arc<str>> {
    if value.is_empty() {
        return None;
    }
    Some(set_resolver(FONT_FAMILY_TOKENS, "font-family", value))
}

pub fn resolve_font_weight(value: &str) -> Option<Arc<str>> {
    if value.is_empty() {
        return None;
    }
    Some(set_resolver(FONT_WEIGHT_TOKENS, "font-weight", value))
}

pub fn resolve_line_height(value: &str) -> Option<Arc<str>> {
    if value.is_empty() {
        return None;
    }
    Some(set_resolver(LINE_HEIGHT_TOKENS, "line-height", value))
}
