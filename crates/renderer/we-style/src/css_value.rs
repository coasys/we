//! The mini CSS evaluator: `calc()`/`max()`/`min()`/`clamp()` over lengths,
//! percentages and unitless values, with `+ - * /` and nesting. Everything the
//! vectors and the bundle's literal values need — nothing more. `var()` has
//! already been substituted when text arrives here; a `var(` that remains is a
//! variable nothing declared and the whole value fails to `None`.
//!
//! Rules, deliberately stricter than CSS:
//! - `+`/`-` combine only equal units (or unitless + unitless).
//! - `*` scales by a unitless factor; `/` divides by a unitless divisor.
//! - `max`/`min`/`clamp` compare only same-unit args.
//! - Bare unitless numbers are numbers, not lengths — `300` is a scale token,
//!   not a length, so it never reaches here as a dimension.

use crate::style::Dimension;

/// The unit a [`MathValue`] carries.
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

/// A number plus its unit, mid-evaluation.
#[derive(Debug, Clone, Copy)]
pub struct MathValue {
    pub value: f64,
    pub unit: MathUnit,
}

impl MathValue {
    fn same_unit(self, other: MathValue) -> bool {
        self.unit == other.unit
    }

    /// Into a [`Dimension`], when the unit is a length/percentage at all.
    fn to_dimension(self) -> Option<Dimension> {
        let v = self.value as f32;
        Some(match self.unit {
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
        })
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
        return eval_math(t).and_then(MathValue::to_dimension);
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
pub fn eval_math(text: &str) -> Option<MathValue> {
    eval_math_inner(text.trim()).ok()
}

fn eval_math_inner(t: &str) -> Result<MathValue, ()> {
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

    fn expr(&mut self) -> Result<MathValue, ()> {
        let mut lhs = self.term()?;
        loop {
            if self.eat(b'+') {
                let rhs = self.term()?;
                lhs = lhs.checked_add(rhs)?;
            } else if self.eat(b'-') {
                let rhs = self.term()?;
                lhs = lhs.checked_sub(rhs)?;
            } else {
                break;
            }
        }
        Ok(lhs)
    }

    fn term(&mut self) -> Result<MathValue, ()> {
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

    fn factor(&mut self) -> Result<MathValue, ()> {
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
                    v.value = -v.value;
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
                Ok(MathValue { value: num, unit })
            }
        }
    }

    fn fn_value(&mut self, name: &str, inner: &str) -> Result<MathValue, ()> {
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
                let mut best: Option<MathValue> = None;
                for a in args {
                    let v = eval_math_inner(a)?;
                    best = Some(match best {
                        None => v,
                        Some(b) if v.same_unit(b) => {
                            if (lower == "max") == (v.value > b.value) {
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
                if !(lo.same_unit(v) && v.same_unit(hi)) {
                    return Err(());
                }
                Ok(MathValue {
                    value: v.value.clamp(lo.value, hi.value),
                    unit: v.unit,
                })
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

impl MathValue {
    fn checked_add(self, rhs: MathValue) -> Result<MathValue, ()> {
        if self.same_unit(rhs) {
            Ok(MathValue {
                value: self.value + rhs.value,
                unit: self.unit,
            })
        } else {
            Err(())
        }
    }

    fn checked_sub(self, rhs: MathValue) -> Result<MathValue, ()> {
        if self.same_unit(rhs) {
            Ok(MathValue {
                value: self.value - rhs.value,
                unit: self.unit,
            })
        } else {
            Err(())
        }
    }

    fn checked_mul(self, rhs: MathValue) -> Result<MathValue, ()> {
        match (self.unit, rhs.unit) {
            (MathUnit::Unitless, u) | (u, MathUnit::Unitless) => Ok(MathValue {
                value: self.value * rhs.value,
                unit: u,
            }),
            _ => Err(()),
        }
    }

    fn checked_div(self, rhs: MathValue) -> Result<MathValue, ()> {
        if rhs.unit != MathUnit::Unitless || rhs.value == 0.0 {
            return Err(());
        }
        Ok(MathValue {
            value: self.value / rhs.value,
            unit: self.unit,
        })
    }
}
