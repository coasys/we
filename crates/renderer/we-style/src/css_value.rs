//! The mini CSS evaluator: `calc()`/`max()`/`min()`/`clamp()` over lengths,
//! percentages and unitless values, with `+ - * /` and nesting. Everything the
//! vectors and the bundle's literal values need — nothing more. `var()` has
//! already been substituted when text arrives here; a `var(` that remains is a
//! variable nothing declared and the whole value fails to `None`.
//!
//! Rules, deliberately stricter than CSS:
//! - `+`/`-` combine any units — the result is a linear combination that
//!   keeps every term symbolic (`calc(72px - 2rem)` is `{px:72, rem:-2}`);
//!   `Dimension::to_px` folds the terms against the metrics it is given.
//! - `*` scales by a unitless factor; `/` divides by a unitless divisor.
//! - `max`/`min`/`clamp` compare only single-term same-unit args — ordering
//!   mixed units needs metrics eval does not carry.
//! - Bare unitless numbers are numbers, not lengths — `300` is a scale token,
//!   not a length, so it never reaches here as a dimension. A number added
//!   to a length stays invalid (as in CSS).

use crate::style::{Calc, Dimension};

/// The unit a single term carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathUnit {
    Unitless,
    Px,
    Percent,
    Rem,
    Em,
    Vw,
    Vh,
    Vmin,
    Vmax,
    Ch,
    Ex,
    Lh,
    /// An absolute unit already normalised into px (`in`, `cm`, `mm`, `pt`, `pc`, `q`).
    AbsolutePx,
}

/// A value mid-evaluation: a linear combination of units — `calc(100% - 24px)`
/// is `{percent:100, px:-24}`. `+`/`-` accumulate per unit; a single surviving
/// term collapses back to the scalar it always was. `units` is a bitmask of
/// which units contributed a term — `calc(72px - 72px)` keeps its `px` unit
/// even though the coefficient cancelled to zero.
#[derive(Debug, Clone, Copy, Default)]
pub struct MathSum {
    pub unitless: f64,
    pub px: f64,
    pub percent: f64,
    pub rem: f64,
    pub em: f64,
    pub vw: f64,
    pub vh: f64,
    pub vmin: f64,
    pub vmax: f64,
    pub ch: f64,
    pub ex: f64,
    pub lh: f64,
    units: u16,
}

const fn unit_bit(u: MathUnit) -> u16 {
    match u {
        MathUnit::Unitless => 1,
        MathUnit::Px | MathUnit::AbsolutePx => 2,
        MathUnit::Percent => 4,
        MathUnit::Rem => 8,
        MathUnit::Em => 16,
        MathUnit::Vw => 32,
        MathUnit::Vh => 64,
        MathUnit::Vmin => 128,
        MathUnit::Vmax => 256,
        MathUnit::Ch => 512,
        MathUnit::Ex => 1024,
        MathUnit::Lh => 2048,
    }
}

const ALL_UNITS: [MathUnit; 12] = [
    MathUnit::Unitless,
    MathUnit::Px,
    MathUnit::Percent,
    MathUnit::Rem,
    MathUnit::Em,
    MathUnit::Vw,
    MathUnit::Vh,
    MathUnit::Vmin,
    MathUnit::Vmax,
    MathUnit::Ch,
    MathUnit::Ex,
    MathUnit::Lh,
];

impl MathSum {
    /// One term's coefficient.
    fn term(&self, unit: MathUnit) -> f64 {
        match unit {
            MathUnit::Unitless => self.unitless,
            MathUnit::Px | MathUnit::AbsolutePx => self.px,
            MathUnit::Percent => self.percent,
            MathUnit::Rem => self.rem,
            MathUnit::Em => self.em,
            MathUnit::Vw => self.vw,
            MathUnit::Vh => self.vh,
            MathUnit::Vmin => self.vmin,
            MathUnit::Vmax => self.vmax,
            MathUnit::Ch => self.ch,
            MathUnit::Ex => self.ex,
            MathUnit::Lh => self.lh,
        }
    }

    fn term_mut(&mut self, unit: MathUnit) -> &mut f64 {
        match unit {
            MathUnit::Unitless => &mut self.unitless,
            MathUnit::Px | MathUnit::AbsolutePx => &mut self.px,
            MathUnit::Percent => &mut self.percent,
            MathUnit::Rem => &mut self.rem,
            MathUnit::Em => &mut self.em,
            MathUnit::Vw => &mut self.vw,
            MathUnit::Vh => &mut self.vh,
            MathUnit::Vmin => &mut self.vmin,
            MathUnit::Vmax => &mut self.vmax,
            MathUnit::Ch => &mut self.ch,
            MathUnit::Ex => &mut self.ex,
            MathUnit::Lh => &mut self.lh,
        }
    }

    /// `value` in `unit` — a one-term sum.
    fn one(value: f64, unit: MathUnit) -> Self {
        let mut s = Self::default();
        *s.term_mut(unit) = value;
        s.units = unit_bit(unit);
        s
    }

    /// `(value, unit)` when a single unit contributed terms — the term may
    /// be zero (`calc(72px - 72px)` is `(0, px)`); `None` for a multi-unit
    /// sum (or a sum no term ever reached).
    pub fn single(&self) -> Option<(f64, MathUnit)> {
        if self.units.count_ones() != 1 {
            return None;
        }
        ALL_UNITS
            .iter()
            .find(|u| self.units & unit_bit(**u) != 0)
            .map(|u| (self.term(*u), *u))
    }

    /// Whether both sums are a single term in the same unit — what
    /// `min`/`max`/`clamp` can order without metrics.
    fn comparable(&self, other: &MathSum) -> bool {
        match (self.single(), other.single()) {
            (Some((_, a)), Some((_, b))) => a == b,
            _ => false,
        }
    }

    /// Into a [`Dimension`]: a single-unit sum collapses to its scalar
    /// variant; several units become [`Dimension::Calc`]. A `unitless` term
    /// beside a length is invalid (`calc(2 + 3px)`), as is a bare unitless
    /// sum.
    fn to_dimension(self) -> Option<Dimension> {
        if let Some((v, u)) = self.single() {
            let v = v as f32;
            return Some(match u {
                MathUnit::Px | MathUnit::AbsolutePx => Dimension::Px(v),
                MathUnit::Percent => Dimension::Percent(v / 100.0),
                MathUnit::Rem => Dimension::Rem(v),
                MathUnit::Em => Dimension::Em(v),
                MathUnit::Vw => Dimension::Vw(v),
                MathUnit::Vh => Dimension::Vh(v),
                MathUnit::Vmin => Dimension::Vmin(v),
                MathUnit::Vmax => Dimension::Vmax(v),
                MathUnit::Ch => Dimension::Ch(v),
                MathUnit::Ex => Dimension::Ex(v),
                MathUnit::Lh => Dimension::Lh(v),
                MathUnit::Unitless => return None,
            });
        }
        if self.units & unit_bit(MathUnit::Unitless) != 0 {
            return None;
        }
        let c = Calc {
            px: self.px as f32,
            percent: (self.percent / 100.0) as f32,
            rem: self.rem as f32,
            em: self.em as f32,
            vw: self.vw as f32,
            vh: self.vh as f32,
            vmin: self.vmin as f32,
            vmax: self.vmax as f32,
            ch: self.ch as f32,
            ex: self.ex as f32,
            lh: self.lh as f32,
        };
        Some(Dimension::Calc(c))
    }

    /// Scale every term — `*` needs one unitless side (the caller checks).
    /// The unit mask is kept: `calc(0 * 5px)` is still a `px` zero.
    fn scaled(self, k: f64) -> Self {
        Self {
            units: self.units,
            unitless: self.unitless * k,
            px: self.px * k,
            percent: self.percent * k,
            rem: self.rem * k,
            em: self.em * k,
            vw: self.vw * k,
            vh: self.vh * k,
            vmin: self.vmin * k,
            vmax: self.vmax * k,
            ch: self.ch * k,
            ex: self.ex * k,
            lh: self.lh * k,
        }
    }
}

/// Split on depth-0 whitespace, keeping `…()` groups whole —
/// `var(--a) solid color-mix(in srgb, red, blue)` is three parts.
/// Port of `topLevelParts` in `design-system/utils/src/index.ts`.
pub fn top_level_parts(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut depth = 0i32;
    let mut start: Option<usize> = None;
    for (i, ch) in text.trim().char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => depth -= 1,
            c if c.is_whitespace() && depth == 0 => {
                if let Some(s) = start.take() {
                    parts.push(&text.trim()[s..i]);
                }
            }
            _ => {
                if start.is_none() {
                    start = Some(i);
                }
            }
        }
    }
    if let Some(s) = start {
        parts.push(&text.trim()[s..]);
    }
    parts
}

/// Split on depth-0 commas — the arguments of a CSS function or a
/// comma-separated list like `box-shadow`.
pub fn split_top_commas(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut depth = 0i32;
    let mut start = 0usize;
    for (i, ch) in text.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => depth -= 1,
            ',' if depth == 0 => {
                parts.push(text[start..i].trim());
                start = i + 1;
            }
            _ => {}
        }
    }
    parts.push(text[start..].trim());
    parts
}

/// Split on a depth-0 `/` — the `head / alpha` separator of the modern colour
/// syntaxes. A `/` inside `calc(16 / 100 * x)` is inside parens and does not
/// count.
pub fn split_slash(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut depth = 0i32;
    let mut start = 0usize;
    for (i, ch) in text.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => depth -= 1,
            '/' if depth == 0 => {
                parts.push(text[start..i].trim());
                start = i + 1;
            }
            _ => {}
        }
    }
    parts.push(text[start..].trim());
    parts
}

/// A CSS dimension: `12px`, `0.75rem`, `55%`, `1lh`, `auto`, or a math
/// function that reduces to a length/percent. `None` for everything else —
/// an unset var, a bare number, a keyword that is not a length.
pub fn eval_dimension(text: &str) -> Option<Dimension> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    if t.eq_ignore_ascii_case("auto") {
        return Some(Dimension::Auto);
    }
    // Math functions.
    let lower = t.to_ascii_lowercase();
    if lower.starts_with("calc(")
        || lower.starts_with("min(")
        || lower.starts_with("max(")
        || lower.starts_with("clamp(")
    {
        return eval_math(t).and_then(MathSum::to_dimension);
    }
    // <number><unit> — the unit decides.
    let (num, unit) = split_number_unit(t)?;
    match unit {
        "" => {
            // A bare number is only a length when it is exactly 0.
            if num == 0.0 {
                Some(Dimension::Px(0.0))
            } else {
                None
            }
        }
        "px" => Some(Dimension::Px(num as f32)),
        "%" => Some(Dimension::Percent((num / 100.0) as f32)),
        "rem" => Some(Dimension::Rem(num as f32)),
        "em" => Some(Dimension::Em(num as f32)),
        // The viewport units — `d`/`s`/`l` qualify small/large/dynamic
        // browser chrome, which egui does not have: they are the viewport.
        "vw" | "dvw" | "svw" | "lvw" => Some(Dimension::Vw(num as f32)),
        "vh" | "dvh" | "svh" | "lvh" => Some(Dimension::Vh(num as f32)),
        "vmin" | "dvmin" | "svmin" | "lvmin" => Some(Dimension::Vmin(num as f32)),
        "vmax" | "dvmax" | "svmax" | "lvmax" => Some(Dimension::Vmax(num as f32)),
        "ch" => Some(Dimension::Ch(num as f32)),
        "ex" => Some(Dimension::Ex(num as f32)),
        "lh" => Some(Dimension::Lh(num as f32)),
        "in" => Some(Dimension::Px((num * 96.0) as f32)),
        "cm" => Some(Dimension::Px((num * 96.0 / 2.54) as f32)),
        "mm" => Some(Dimension::Px((num * 96.0 / 25.4) as f32)),
        "q" => Some(Dimension::Px((num * 96.0 / 101.6) as f32)),
        "pt" => Some(Dimension::Px((num * 96.0 / 72.0) as f32)),
        "pc" => Some(Dimension::Px((num * 16.0) as f32)),
        _ => None,
    }
}

/// `-?123.45<unit>` — the numeric part and the lowercase unit.
fn split_number_unit(t: &str) -> Option<(f64, &str)> {
    let bytes = t.as_bytes();
    let mut i = 0usize;
    if i < bytes.len() && (bytes[i] == b'-' || bytes[i] == b'+') {
        i += 1;
    }
    let mut saw_digit = false;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
        saw_digit = true;
    }
    if i < bytes.len() && bytes[i] == b'.' {
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
            saw_digit = true;
        }
    }
    // exponent: 1e3
    if i < bytes.len() && (bytes[i] == b'e' || bytes[i] == b'E') {
        let mut j = i + 1;
        if j < bytes.len() && (bytes[j] == b'-' || bytes[j] == b'+') {
            j += 1;
        }
        if j < bytes.len() && bytes[j].is_ascii_digit() {
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                j += 1;
            }
            i = j;
        }
    }
    if !saw_digit {
        return None;
    }
    let num: f64 = t[..i].parse().ok()?;
    Some((num, &t[i..]))
}

/// Evaluate a `calc()`/`max()`/`min()`/`clamp()` expression — the text must be
/// one whole function call or a plain `<number><unit>`.
pub fn eval_math(text: &str) -> Option<MathSum> {
    eval_math_inner(text.trim()).ok()
}

fn eval_math_inner(t: &str) -> Result<MathSum, ()> {
    let mut p = Parser { text: t, pos: 0 };
    let v = p.expr()?;
    p.skip_ws();
    if p.pos != t.len() {
        return Err(());
    }
    Ok(v)
}

struct Parser<'a> {
    text: &'a str,
    pos: usize,
}

impl<'a> Parser<'a> {
    fn skip_ws(&mut self) {
        while self.pos < self.text.len() && self.text.as_bytes()[self.pos].is_ascii_whitespace() {
            self.pos += 1;
        }
    }

    fn skip_ws_peek(&self) -> Option<(u8, usize)> {
        let mut i = self.pos;
        while i < self.text.len() && self.text.as_bytes()[i].is_ascii_whitespace() {
            i += 1;
        }
        self.text.as_bytes().get(i).copied().map(|b| (b, i))
    }

    fn eat(&mut self, b: u8) -> bool {
        match self.skip_ws_peek() {
            Some((c, i)) if c == b => {
                self.pos = i + 1;
                true
            }
            _ => false,
        }
    }

    fn expr(&mut self) -> Result<MathSum, ()> {
        let mut lhs = self.term()?;
        loop {
            if self.eat(b'+') {
                let rhs = self.term()?;
                lhs = lhs.checked_add(rhs);
            } else if self.eat(b'-') {
                let rhs = self.term()?;
                lhs = lhs.checked_sub(rhs);
            } else {
                break;
            }
        }
        Ok(lhs)
    }

    fn term(&mut self) -> Result<MathSum, ()> {
        let mut lhs = self.factor()?;
        loop {
            if self.eat(b'*') {
                let rhs = self.factor()?;
                lhs = lhs.checked_mul(rhs)?;
            } else if self.eat(b'/') {
                let rhs = self.factor()?;
                lhs = lhs.checked_div(rhs)?;
            } else {
                break;
            }
        }
        Ok(lhs)
    }

    fn factor(&mut self) -> Result<MathSum, ()> {
        let (b, i) = self.skip_ws_peek().ok_or(())?;
        match b {
            b'(' => {
                self.pos = i + 1;
                let v = self.expr()?;
                if !self.eat(b')') {
                    return Err(());
                }
                Ok(v)
            }
            b'-' | b'+' => {
                self.pos = i + 1;
                let mut v = self.factor()?;
                if b == b'-' {
                    v = v.scaled(-1.0);
                }
                Ok(v)
            }
            _ => {
                let rest = &self.text[i..];
                // `ident(` — a function: calc, min, max, clamp or give up.
                if let Some(open) = rest.find('(') {
                    let name = rest[..open].trim_end();
                    if !name.is_empty()
                        && name
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
                    {
                        let inner_start = i + open + 1;
                        let close = matching_paren(self.text, inner_start - 1)?;
                        let inner = &self.text[inner_start..close];
                        self.pos = close + 1;
                        return self.fn_value(name, inner);
                    }
                }
                // A plain number with optional unit.
                let (num, unit, len) = number_unit_len(rest).ok_or(())?;
                self.pos = i + len;
                Ok(MathSum::one(num, unit))
            }
        }
    }

    fn fn_value(&mut self, name: &str, inner: &str) -> Result<MathSum, ()> {
        let lower = name.to_ascii_lowercase();
        match lower.as_str() {
            "calc" => {
                let mut p = Parser {
                    text: inner,
                    pos: 0,
                };
                let v = p.expr()?;
                p.skip_ws();
                if p.pos != inner.len() {
                    return Err(());
                }
                Ok(v)
            }
            "max" | "min" => {
                let args = split_top_commas(inner);
                if args.is_empty() {
                    return Err(());
                }
                let mut best: Option<MathSum> = None;
                for a in args {
                    let v = eval_math_inner(a)?;
                    best = Some(match best {
                        None => v,
                        Some(b) if v.comparable(&b) => {
                            // `comparable` means a single same-unit term —
                            // the comparison happens on the term itself.
                            let (v_n, _) = v.single().unwrap();
                            let (b_n, _) = b.single().unwrap();
                            if (lower == "max") == (v_n > b_n) {
                                v
                            } else {
                                b
                            }
                        }
                        Some(_) => return Err(()),
                    });
                }
                best.ok_or(())
            }
            "clamp" => {
                let args = split_top_commas(inner);
                if args.len() != 3 {
                    return Err(());
                }
                let lo = eval_math_inner(args[0])?;
                let v = eval_math_inner(args[1])?;
                let hi = eval_math_inner(args[2])?;
                if !(lo.comparable(&v) && v.comparable(&hi)) {
                    return Err(());
                }
                // CSS ordering: max(min, min(preferred, max)) — the minimum
                // wins over a smaller maximum (`clamp(100px, 50px, 0px)` is
                // 100px). f64::clamp would panic on that valid CSS.
                let (lo_n, _) = lo.single().unwrap();
                let (v_n, _) = v.single().unwrap();
                let (hi_n, _) = hi.single().unwrap();
                Ok(MathSum::one(lo_n.max(v_n.min(hi_n)), v.single().unwrap().1))
            }
            _ => Err(()),
        }
    }
}

/// The index of the `)` matching the `(` at `open`. `Err` when unbalanced.
fn matching_paren(text: &str, open: usize) -> Result<usize, ()> {
    debug_assert_eq!(text.as_bytes()[open], b'(');
    let mut depth = 0i32;
    for (i, b) in text.as_bytes().iter().enumerate().skip(open) {
        match b {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Ok(i);
                }
            }
            _ => {}
        }
    }
    Err(())
}

/// `(value, unit, byte_len)` of the leading `<number><unit>` in `rest`.
fn number_unit_len(rest: &str) -> Option<(f64, MathUnit, usize)> {
    let bytes = rest.as_bytes();
    let mut i = 0usize;
    if i < bytes.len() && (bytes[i] == b'-' || bytes[i] == b'+') {
        i += 1;
    }
    let mut saw = false;
    while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
        i += 1;
        saw = true;
    }
    if i < bytes.len() && (bytes[i] == b'e' || bytes[i] == b'E') {
        let mut j = i + 1;
        if j < bytes.len() && (bytes[j] == b'-' || bytes[j] == b'+') {
            j += 1;
        }
        if j < bytes.len() && bytes[j].is_ascii_digit() {
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                j += 1;
            }
            i = j;
        }
    }
    if !saw {
        return None;
    }
    let num: f64 = rest[..i].parse().ok()?;
    let unit_start = i;
    while i < bytes.len() && (bytes[i].is_ascii_alphabetic() || bytes[i] == b'%') {
        i += 1;
    }
    let unit = match &rest[unit_start..i] {
        "" => MathUnit::Unitless,
        "%" => MathUnit::Percent,
        u if u.eq_ignore_ascii_case("px") => MathUnit::Px,
        u if u.eq_ignore_ascii_case("rem") => MathUnit::Rem,
        u if u.eq_ignore_ascii_case("em") => MathUnit::Em,
        u if u.eq_ignore_ascii_case("vw") => MathUnit::Vw,
        u if u.eq_ignore_ascii_case("vh") => MathUnit::Vh,
        u if u.eq_ignore_ascii_case("vmin") => MathUnit::Vmin,
        u if u.eq_ignore_ascii_case("vmax") => MathUnit::Vmax,
        u if u.eq_ignore_ascii_case("ch") => MathUnit::Ch,
        u if u.eq_ignore_ascii_case("ex") => MathUnit::Ex,
        u if u.eq_ignore_ascii_case("lh") => MathUnit::Lh,
        u if u.eq_ignore_ascii_case("in")
            || u.eq_ignore_ascii_case("cm")
            || u.eq_ignore_ascii_case("mm")
            || u.eq_ignore_ascii_case("q")
            || u.eq_ignore_ascii_case("pt")
            || u.eq_ignore_ascii_case("pc") =>
        {
            MathUnit::AbsolutePx
        }
        _ => return Some((num, MathUnit::Unitless, unit_start)),
    };
    let value = if unit == MathUnit::AbsolutePx {
        let mul = match &rest[unit_start..i] {
            u if u.eq_ignore_ascii_case("in") => 96.0,
            u if u.eq_ignore_ascii_case("cm") => 96.0 / 2.54,
            u if u.eq_ignore_ascii_case("mm") => 96.0 / 25.4,
            u if u.eq_ignore_ascii_case("q") => 96.0 / 101.6,
            u if u.eq_ignore_ascii_case("pt") => 96.0 / 72.0,
            _ => 16.0,
        };
        num * mul
    } else {
        num
    };
    Some((value, unit, i))
}

impl MathSum {
    /// `+` — every unit's terms accumulate independently; any pair of units
    /// combines (the sum keeps them symbolic).
    fn checked_add(self, rhs: MathSum) -> MathSum {
        let mut s = self;
        for u in ALL_UNITS {
            *s.term_mut(u) += rhs.term(u);
        }
        s.units |= rhs.units;
        s
    }

    fn checked_sub(self, rhs: MathSum) -> MathSum {
        self.checked_add(rhs.scaled(-1.0))
    }

    /// `*` — one side must be a bare unitless factor (`calc(2 * 3px)`).
    fn checked_mul(self, rhs: MathSum) -> Result<MathSum, ()> {
        match (self.single(), rhs.single()) {
            (Some((k, MathUnit::Unitless)), _) => Ok(rhs.scaled(k)),
            (_, Some((k, MathUnit::Unitless))) => Ok(self.scaled(k)),
            _ => Err(()),
        }
    }

    /// `/` — the divisor must be a nonzero unitless number.
    fn checked_div(self, rhs: MathSum) -> Result<MathSum, ()> {
        match rhs.single() {
            Some((d, MathUnit::Unitless)) if d != 0.0 => Ok(self.scaled(1.0 / d)),
            _ => Err(()),
        }
    }
}
