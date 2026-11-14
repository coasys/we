//! A colour value, once `var()`s are substituted: hex, `rgb()`/`rgba()`,
//! `hsl()`/`hsla()`, `oklch()`, `oklab()`, `color(srgb …)`,
//! `color-mix(in srgb|oklab|oklch, …)`, `transparent` and the CSS named
//! colours. Channels may be `calc()`/`min()`/`max()`/`clamp()` expressions —
//! the recorded tables write `oklch(14.6% calc(16 / 100 * 0.2322) 288)` for
//! computed colours.
//!
//! The parser is deliberately a *mini* evaluator: it reads the shapes the
//! recorded token tables and the bundle actually contain, and returns `None`
//! for anything else — `oklch(from …)` relative syntax, `lab()`/`lch()`,
//! `hwb()`, non-srgb `color()`, `color-contrast()`, `light-dark()` — which the
//! caller records in `Style::unsupported` rather than guessing.
//!
//! Stored as straight (non-premultiplied) sRGB channels in `0..=1`. Mixing
//! happens premultiplied (per the CSS colour-mix spec) and the result is
//! un-premultiplied again; the egui boundary calls [`Color::to_premultiplied`].

use crate::css_value::{eval_math, split_slash, split_top_commas, top_level_parts, MathUnit};

/// One sRGB colour, straight alpha.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Color {
    pub const TRANSPARENT: Color = Color {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 0.0,
    };
    pub const WHITE: Color = Color {
        r: 1.0,
        g: 1.0,
        b: 1.0,
        a: 1.0,
    };
    pub const BLACK: Color = Color {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 1.0,
    };

    pub const fn new(r: f32, g: f32, b: f32, a: f32) -> Self {
        Self { r, g, b, a }
    }

    /// What egui's `Color32` wants: premultiplied channels in `0..=1`.
    pub fn to_premultiplied(self) -> [f32; 4] {
        [self.r * self.a, self.g * self.a, self.b * self.a, self.a]
    }

    /// Straight-alpha bytes — for tests comparing against recorded strings.
    pub fn to_srgb8(self) -> [u8; 4] {
        let c = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        [c(self.r), c(self.g), c(self.b), c(self.a)]
    }

    fn premultiplied(self) -> [f32; 4] {
        self.to_premultiplied()
    }

    fn from_premultiplied([r, g, b, a]: [f32; 4]) -> Color {
        if a <= 0.0 {
            return Color::TRANSPARENT;
        }
        Color {
            r: (r / a).clamp(0.0, 1.0),
            g: (g / a).clamp(0.0, 1.0),
            b: (b / a).clamp(0.0, 1.0),
            a: a.clamp(0.0, 1.0),
        }
    }

    /// Perceptual lightness `L` of the OKLab space this file converts through —
    /// the gallery sorts swatches by it.
    pub fn oklch_lightness(self) -> f32 {
        let (_, _, l) = srgb_to_oklab(self.r, self.g, self.b);
        l
    }
}

/// Parse a CSS colour after `var()` substitution. Returns `None` for anything
/// outside the supported grammar — the caller records it, nothing is guessed.
pub fn eval_color(text: &str) -> Option<Color> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    if t.starts_with('#') {
        return parse_hex(t);
    }
    let lower = t.to_ascii_lowercase();
    match lower.as_str() {
        "transparent" => return Some(Color::TRANSPARENT),
        "currentcolor" | "inherit" | "initial" | "unset" | "revert" | "auto" | "none" => {
            return None;
        }
        _ => {}
    }
    if let Some(c) = named_color(&lower) {
        return Some(c);
    }
    let (name, args) = fn_call(&lower, t)?;
    match name {
        "rgb" | "rgba" => parse_rgb(args),
        "hsl" | "hsla" => parse_hsl(args),
        "oklch" => parse_oklch(args),
        "oklab" => parse_oklab(args),
        "color" => parse_color_fn(args),
        "color-mix" => parse_color_mix(args),
        _ => None,
    }
}

/// `name(args)` — the function call split, or `None`.
fn fn_call<'a>(lower: &'a str, text: &'a str) -> Option<(&'a str, &'a str)> {
    let open = lower.find('(')?;
    let name = lower[..open].trim();
    if !text.ends_with(')')
        || name.is_empty()
        || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return None;
    }
    Some((name, text[open + 1..text.len() - 1].trim()))
}

fn parse_hex(t: &str) -> Option<Color> {
    let h = t.strip_prefix('#')?;
    let d = |i: usize| u8::from_str_radix(&h[i..i + 1], 16).ok();
    let d2 = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
    let (r, g, b, a) = match h.len() {
        3 => (d(0)? * 17, d(1)? * 17, d(2)? * 17, 255),
        4 => (d(0)? * 17, d(1)? * 17, d(2)? * 17, d(3)? * 17),
        6 => (d2(0)?, d2(2)?, d2(4)?, 255),
        8 => (d2(0)?, d2(2)?, d2(4)?, d2(6)?),
        _ => return None,
    };
    Some(Color::new(
        r as f32 / 255.0,
        g as f32 / 255.0,
        b as f32 / 255.0,
        a as f32 / 255.0,
    ))
}

/// A channel that may be a literal, a `…%`, or a math expression —
/// `calc(16 / 100 * 0.2322)` appears inside the recorded shadows' `oklch()`.
/// `pct_scale` is what `100%` means on this channel (1.0 for alpha, 2.55 for
/// `rgb()`, 0.01 for lightness, 0.004 for chroma/oklab axes). `none` is 0.
fn math_channel(s: &str, pct_scale: f32) -> Option<f32> {
    let s = s.trim();
    if s.eq_ignore_ascii_case("none") {
        return Some(0.0);
    }
    if let Some(p) = s.strip_suffix('%') {
        return p.trim().parse::<f32>().ok().map(|v| v * pct_scale);
    }
    let v = eval_math(s)?;
    Some(match v.unit {
        MathUnit::Unitless => v.value as f32,
        MathUnit::Percent => (v.value as f32) * pct_scale,
        _ => return None,
    })
}

/// A channel of `rgb()`: `0..255` number or `0..100%`, `none` treated as 0.
fn rgb_channel(s: &str) -> Option<f32> {
    math_channel(s, 2.55)
}

fn alpha_channel(s: &str) -> Option<f32> {
    math_channel(s, 0.01)
}

/// `rgb(199, 201, 220)`, `rgba(199,201,220,.08)` and `rgb(199 201 220 / .08)`.
fn parse_rgb(args: &str) -> Option<Color> {
    let parts: Vec<f32> = if args.contains(',') {
        split_top_commas(args)
            .iter()
            .map(|p| rgb_channel(p))
            .collect::<Option<_>>()?
    } else {
        let slash = split_slash(args);
        let head: Vec<f32> = top_level_parts(slash[0])
            .iter()
            .map(|p| rgb_channel(p))
            .collect::<Option<_>>()?;
        if slash.len() == 2 {
            let mut v = head;
            v.push(alpha_channel(slash[1])?);
            v
        } else {
            head
        }
    };
    match parts.len() {
        3 | 4 => Some(Color::new(
            (parts[0] / 255.0).clamp(0.0, 1.0),
            (parts[1] / 255.0).clamp(0.0, 1.0),
            (parts[2] / 255.0).clamp(0.0, 1.0),
            parts.get(3).copied().unwrap_or(1.0).clamp(0.0, 1.0),
        )),
        _ => None,
    }
}

fn hue_degrees(s: &str) -> Option<f32> {
    let s = s.trim();
    if s.eq_ignore_ascii_case("none") {
        return Some(0.0);
    }
    for (suffix, mul) in [
        ("turn", 360.0f32),
        ("rad", 180.0 / std::f32::consts::PI),
        ("grad", 0.9),
        ("deg", 1.0),
    ] {
        if let Some(n) = s.strip_suffix(suffix) {
            return n.trim().parse::<f32>().ok().map(|v| v * mul);
        }
    }
    // `calc(288 - 30)` — a hue may arrive as unitless math.
    match eval_math(s)? {
        v if v.unit == MathUnit::Unitless => Some(v.value as f32),
        _ => None,
    }
}

/// `hsl(240, 50%, 50%)` / `hsl(240 50% 50% / .5)`.
fn parse_hsl(args: &str) -> Option<Color> {
    let (h, s, l, a) = if args.contains(',') {
        let p = split_top_commas(args);
        if p.len() < 3 || p.len() > 4 {
            return None;
        }
        (
            hue_degrees(p[0])?,
            pct(p[1])?,
            pct(p[2])?,
            match p.get(3) {
                Some(x) => alpha_channel(x)?,
                None => 1.0,
            },
        )
    } else {
        let slash = split_slash(args);
        let head = top_level_parts(slash[0]);
        if head.len() != 3 {
            return None;
        }
        (
            hue_degrees(head[0])?,
            pct(head[1])?,
            pct(head[2])?,
            if slash.len() == 2 {
                alpha_channel(slash[1])?
            } else {
                1.0
            },
        )
    };
    let (r, g, b) = hsl_to_srgb(h, s.clamp(0.0, 1.0), l.clamp(0.0, 1.0));
    Some(Color::new(r, g, b, a.clamp(0.0, 1.0)))
}

fn pct(s: &str) -> Option<f32> {
    let s = s.trim();
    if s.eq_ignore_ascii_case("none") {
        return Some(0.0);
    }
    if let Some(p) = s.strip_suffix('%') {
        return p.trim().parse::<f32>().ok().map(|v| v / 100.0);
    }
    // `calc(50%)` and friends — s/l channels are percentages only.
    match eval_math(s)? {
        v if v.unit == MathUnit::Percent => Some((v.value / 100.0) as f32),
        _ => None,
    }
}

/// `oklch(0.55 0.27 288)` / `oklch(55% 0.27 288deg / 0.8)` — and the
/// recorder's computed forms `oklch(14.6% calc(16 / 100 * 0.2322) 288)`.
fn parse_oklch(args: &str) -> Option<Color> {
    let slash = split_slash(args);
    let head = top_level_parts(slash[0]);
    if head.len() != 3 {
        return None;
    }
    let l = lightness(head[0])?;
    let c = math_channel(head[1], 0.004)?; // % is of 0.4 chroma
    let h = hue_degrees(head[2])?;
    let a = if slash.len() == 2 {
        alpha_channel(slash[1])?
    } else {
        1.0
    };
    let rad = h.to_radians();
    let (r, g, b) = oklab_to_srgb(l, c * rad.cos(), c * rad.sin());
    Some(Color::new(r, g, b, a.clamp(0.0, 1.0)))
}

/// `oklab(0.55 0.1 -0.05 / 0.8)` — `a`/`b` as numbers or `%` (of ±0.4).
fn parse_oklab(args: &str) -> Option<Color> {
    let slash = split_slash(args);
    let head = top_level_parts(slash[0]);
    if head.len() != 3 {
        return None;
    }
    let l = lightness(head[0])?;
    let axis = |s: &str| math_channel(s, 0.004);
    let a = if slash.len() == 2 {
        alpha_channel(slash[1])?
    } else {
        1.0
    };
    let (r, g, b) = oklab_to_srgb(l, axis(head[1])?, axis(head[2])?);
    Some(Color::new(r, g, b, a.clamp(0.0, 1.0)))
}

fn lightness(s: &str) -> Option<f32> {
    math_channel(s, 0.01)
}

/// `color(srgb r g b / a)` — what Chrome serialises an srgb colour outside
/// the `rgb()` gamut of notations to (`--we-role-text-selection` records
/// `color(srgb 0.457459 0.240274 0.984199 / 0.3)`). Other `color()` spaces
/// stay `None` — nothing in the tables or bundles uses them.
fn parse_color_fn(args: &str) -> Option<Color> {
    let (space, rest) = args.split_once(char::is_whitespace)?;
    if !space.trim().eq_ignore_ascii_case("srgb") {
        return None;
    }
    let slash = split_slash(rest);
    if slash.len() > 2 {
        return None;
    }
    let head = top_level_parts(slash[0]);
    if head.len() != 3 {
        return None;
    }
    let channel = |s: &str| -> Option<f32> { math_channel(s, 0.01).map(|v| v.clamp(0.0, 1.0)) };
    let a = if slash.len() == 2 {
        alpha_channel(slash[1])?
    } else {
        1.0
    };
    Some(Color::new(
        channel(head[0])?,
        channel(head[1])?,
        channel(head[2])?,
        a.clamp(0.0, 1.0),
    ))
}

/// `color-mix(in <space>, c1 [p%], c2 [p%])` — the one blend the token tables
/// and themes use. Spaces honoured: `srgb`, `oklab`, `oklch` (hue-interpolating).
fn parse_color_mix(args: &str) -> Option<Color> {
    let parts = split_top_commas(args);
    if parts.len() != 3 {
        return None;
    }
    let space = parts[0]
        .trim()
        .strip_prefix("in ")?
        .trim()
        .to_ascii_lowercase();
    let (c1, p1) = mix_stop(parts[1])?;
    let (c2, p2) = mix_stop(parts[2])?;
    let (mut w1, mut w2) = (p1.unwrap_or(0.5), p2.unwrap_or(0.5));
    if p1.is_some() && p2.is_none() {
        w2 = 1.0 - w1;
    } else if p1.is_none() && p2.is_some() {
        w1 = 1.0 - w2;
    }
    let mut alpha_mul = 1.0f32;
    let sum = w1 + w2;
    if sum <= 0.0 {
        return Some(Color::TRANSPARENT);
    }
    if sum < 1.0 {
        alpha_mul = sum;
    } else {
        w1 /= sum;
        w2 /= sum;
    }
    let mixed = match space.as_str() {
        "srgb" | "srgb-linear" => {
            let [r1, g1, b1, a1] = c1.premultiplied();
            let [r2, g2, b2, a2] = c2.premultiplied();
            Color::from_premultiplied([
                r1 * w1 + r2 * w2,
                g1 * w1 + g2 * w2,
                b1 * w1 + b2 * w2,
                a1 * w1 + a2 * w2,
            ])
        }
        "oklab" | "oklch" => {
            let polar = space == "oklch";
            let (a1, b1, c1l) = oklab_axes(c1, polar);
            let (a2, b2, c2l) = oklab_axes(c2, polar);
            let (ar, br, lr) = (a1 * w1 + a2 * w2, b1 * w1 + b2 * w2, c1l * w1 + c2l * w2);
            let (la, aa, ba) = if polar {
                // back from polar: a = C cos h, b = C sin h
                (lr, ar * br.cos(), ar * br.sin())
            } else {
                (lr, ar, br)
            };
            let (r, g, b) = oklab_to_srgb(la, aa, ba);
            Color::new(r, g, b, c1.a * w1 + c2.a * w2)
        }
        _ => return None,
    };
    Some(Color {
        a: mixed.a * alpha_mul,
        ..mixed
    })
}

/// `(a, b, L)` or `(C, h°, L)` of a colour, for oklab/oklch mixing.
fn oklab_axes(c: Color, polar: bool) -> (f32, f32, f32) {
    let (a, b, l) = srgb_to_oklab(c.r, c.g, c.b);
    if polar {
        ((a * a + b * b).sqrt(), b.atan2(a).to_degrees(), l)
    } else {
        (a, b, l)
    }
}

/// `c [p%]` — a colour plus an optional percentage; the percentage itself may
/// be a `calc()` (the glow shadow writes `calc(60% * var(…) / 0.35)`).
fn mix_stop(text: &str) -> Option<(Color, Option<f32>)> {
    let t = text.trim();
    // The colour runs to the first top-level whitespace; the rest is the weight.
    let mut depth = 0i32;
    let mut split_at = t.len();
    for (i, ch) in t.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => depth -= 1,
            c if c.is_whitespace() && depth == 0 => {
                split_at = i;
                break;
            }
            _ => {}
        }
    }
    let (colour, rest) = t.split_at(split_at);
    let c = eval_color(colour)?;
    let rest = rest.trim();
    if rest.is_empty() {
        return Some((c, None));
    }
    let p = if let Some(p) = rest.strip_suffix('%') {
        p.trim().parse::<f32>().ok()? / 100.0
    } else {
        match eval_math(rest)? {
            v if v.unit == MathUnit::Percent => (v.value / 100.0) as f32,
            v if v.unit == MathUnit::Unitless => v.value as f32,
            _ => return None,
        }
    };
    Some((c, Some(p)))
}

// ── colour-space math (CSS Color 4, OKLab) ──────────────────────────────────

fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb(c: f32) -> f32 {
    if c <= 0.0031308 {
        12.92 * c
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

/// `(a, b, L)` — the OKLab axes and lightness.
/// The matrices are Ottosson's published constants, kept at spec precision.
#[allow(clippy::excessive_precision)]
fn srgb_to_oklab(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let (r, g, b) = (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b));
    let l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    let m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    let s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    let (l, m, s) = (l.cbrt(), m.cbrt(), s.cbrt());
    (
        // (a, b, L) — the green–red axis, blue–yellow axis, then lightness.
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    )
}

/// Ottosson's published constants, kept at spec precision.
#[allow(clippy::excessive_precision)]
fn oklab_to_srgb(l: f32, a: f32, b: f32) -> (f32, f32, f32) {
    let l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    let m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    let s_ = l - 0.0894841775 * a - 1.2914855480 * b;
    let (l, m, s) = (l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_);
    let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    let b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    (
        linear_to_srgb(r).clamp(0.0, 1.0),
        linear_to_srgb(g).clamp(0.0, 1.0),
        linear_to_srgb(b).clamp(0.0, 1.0),
    )
}

fn hsl_to_srgb(h: f32, s: f32, l: f32) -> (f32, f32, f32) {
    let h = ((h % 360.0) + 360.0) % 360.0;
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = l - c / 2.0;
    let (r, g, b) = match (h / 60.0) as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    (r + m, g + m, b + m)
}

fn named_color(name: &str) -> Option<Color> {
    let (r, g, b) = match name {
        "white" => (255, 255, 255),
        "black" => (0, 0, 0),
        "red" => (255, 0, 0),
        "green" => (0, 128, 0),
        "lime" => (0, 255, 0),
        "blue" => (0, 0, 255),
        "yellow" => (255, 255, 0),
        "cyan" | "aqua" => (0, 255, 255),
        "magenta" | "fuchsia" => (255, 0, 255),
        "orange" => (255, 165, 0),
        "purple" => (128, 0, 128),
        "pink" => (255, 192, 203),
        "brown" => (165, 42, 42),
        "gray" | "grey" => (128, 128, 128),
        "silver" => (192, 192, 192),
        "maroon" => (128, 0, 0),
        "olive" => (128, 128, 0),
        "navy" => (0, 0, 128),
        "teal" => (0, 128, 128),
        "gold" => (255, 215, 0),
        "coral" => (255, 127, 80),
        "salmon" => (250, 128, 114),
        "khaki" => (240, 230, 140),
        "indigo" => (75, 0, 130),
        "violet" => (238, 130, 238),
        "turquoise" => (64, 224, 208),
        "tomato" => (255, 99, 71),
        "skyblue" => (135, 206, 235),
        "seagreen" => (46, 139, 87),
        "slategray" | "slategrey" => (112, 128, 144),
        "slateblue" => (106, 90, 205),
        "royalblue" => (65, 105, 225),
        "rebeccapurple" => (102, 51, 153),
        "plum" => (221, 160, 221),
        "orchid" => (218, 112, 214),
        "crimson" => (220, 20, 60),
        "darkgray" | "darkgrey" => (169, 169, 169),
        "dimgray" | "dimgrey" => (105, 105, 105),
        "lightgray" | "lightgrey" => (211, 211, 211),
        "gainsboro" => (220, 220, 220),
        "whitesmoke" => (245, 245, 245),
        "snow" => (255, 250, 250),
        "beige" => (245, 245, 220),
        "ivory" => (255, 255, 240),
        "linen" => (250, 240, 230),
        "tan" => (210, 180, 140),
        "wheat" => (245, 222, 179),
        "peachpuff" => (255, 218, 185),
        "lavender" => (230, 230, 250),
        "mintcream" => (245, 255, 250),
        "azure" => (240, 255, 255),
        "aliceblue" => (240, 248, 255),
        "ghostwhite" => (248, 248, 255),
        "honeydew" => (240, 255, 240),
        "darkslategray" | "darkslategrey" => (47, 79, 79),
        "forestgreen" => (34, 139, 34),
        "darkgreen" => (0, 100, 0),
        "darkred" => (139, 0, 0),
        "darkblue" => (0, 0, 139),
        "lightblue" => (173, 216, 230),
        "lightgreen" => (144, 238, 144),
        "lightpink" => (255, 182, 193),
        "lightyellow" => (255, 255, 224),
        "dodgerblue" => (30, 144, 255),
        "cornflowerblue" => (100, 149, 237),
        "steelblue" => (70, 130, 180),
        "midnightblue" => (25, 25, 112),
        "mediumblue" => (0, 0, 205),
        "deepskyblue" => (0, 191, 255),
        "orangered" => (255, 69, 0),
        "darkorange" => (255, 140, 0),
        "goldenrod" => (218, 165, 32),
        "darkgoldenrod" => (184, 134, 11),
        "chocolate" => (210, 105, 30),
        "sienna" => (160, 82, 45),
        "saddlebrown" => (139, 69, 19),
        "peru" => (205, 133, 63),
        "rosybrown" => (188, 143, 143),
        "sandybrown" => (244, 164, 96),
        "burlywood" => (222, 184, 135),
        "darkkhaki" => (189, 183, 107),
        "olivedrab" => (107, 142, 35),
        "yellowgreen" => (154, 205, 50),
        "lawngreen" => (124, 252, 0),
        "chartreuse" => (127, 255, 0),
        "greenyellow" => (173, 255, 47),
        "springgreen" => (0, 255, 127),
        "mediumspringgreen" => (0, 250, 154),
        "aquamarine" => (127, 255, 212),
        "mediumaquamarine" => (102, 205, 170),
        "mediumseagreen" => (60, 179, 113),
        "darkseagreen" => (143, 188, 143),
        "lightseagreen" => (32, 178, 170),
        "darkcyan" => (0, 139, 139),
        "darkturquoise" => (0, 206, 209),
        "mediumturquoise" => (72, 209, 204),
        "paleturquoise" => (175, 238, 238),
        "lightcyan" => (224, 255, 255),
        "powderblue" => (176, 224, 230),
        "cadetblue" => (95, 158, 160),
        "palegreen" => (152, 251, 152),
        "mediumpurple" => (147, 112, 219),
        "mediumorchid" => (186, 85, 211),
        "darkorchid" => (153, 50, 204),
        "blueviolet" => (138, 43, 226),
        "darkviolet" => (148, 0, 211),
        "darkmagenta" => (139, 0, 139),
        "mediumvioletred" => (199, 21, 133),
        "deeppink" => (255, 20, 147),
        "hotpink" => (255, 105, 180),
        "palevioletred" => (219, 112, 147),
        "lightcoral" => (240, 128, 128),
        "indianred" => (205, 92, 92),
        "firebrick" => (178, 34, 34),
        "moccasin" => (255, 228, 181),
        "navajowhite" => (255, 222, 173),
        "bisque" => (255, 228, 196),
        "blanchedalmond" => (255, 235, 205),
        "papayawhip" => (255, 239, 213),
        "cornsilk" => (255, 248, 220),
        "lemonchiffon" => (255, 250, 205),
        "lightgoldenrodyellow" => (250, 250, 210),
        "oldlace" => (253, 245, 230),
        "floralwhite" => (255, 250, 240),
        "seashell" => (255, 245, 238),
        "antiquewhite" => (250, 235, 215),
        "mistyrose" => (255, 228, 225),
        "lavenderblush" => (255, 240, 245),
        "thistle" => (216, 191, 216),
        _ => return None,
    };
    Some(Color::new(
        r as f32 / 255.0,
        g as f32 / 255.0,
        b as f32 / 255.0,
        1.0,
    ))
}
