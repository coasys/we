//! `parseBorder`/`borderParts` — the string-level port from
//! `design-system/utils/src/index.ts` — and the field-level read of the result:
//! `"1px solid border"` → `var(--we-border-width, 1px) solid var(--we-role-border)`
//! → `BorderSide { width, kind, color }`.

use std::sync::Arc;

use crate::color::{eval_color, Color};
use crate::css_value::{eval_dimension, top_level_parts};
use crate::scales::token_var;
use crate::style::{BorderKind, BorderSide, Dimension};

/// `borderParts(value)` — the three parts of a `width style colour` border,
/// resolved as `parseBorder` resolves them, or `None` for anything shorter
/// (`'none'`, `'0'`).
pub fn border_parts(value: &str) -> Option<BorderText> {
    let parts = top_level_parts(value);
    if parts.len() < 3 {
        return None;
    }
    let width = parts[0];
    let style = parts[1];
    let color = parts[2..].join(" ");
    Some(BorderText {
        width: if width == "1px" {
            Arc::from("var(--we-border-width, 1px)")
        } else {
            Arc::from(width)
        },
        style: Arc::from(style),
        color: if color.contains('(') || color.contains('#') {
            Arc::from(color.as_str())
        } else {
            token_var("color", Some(color.as_str()), "", None)
        },
    })
}

/// The string parts `parseBorder` emits — width/style/color, already resolved
/// at the token level (`var(--we-border-width, 1px)` etc.).
#[derive(Debug, Clone)]
pub struct BorderText {
    pub width: Arc<str>,
    pub style: Arc<str>,
    pub color: Arc<str>,
}

/// `parseBorder(value)` — the emitted CSS declaration.
pub fn parse_border(value: &str) -> Arc<str> {
    if value.is_empty() {
        return Arc::from("");
    }
    match border_parts(value) {
        Some(p) => Arc::from(format!("{} {} {}", p.width, p.style, p.color).as_str()),
        None => Arc::from(value),
    }
}

/// `width` keywords CSS allows beside lengths.
fn border_width(text: &str) -> Option<Option<Dimension>> {
    match text.to_ascii_lowercase().as_str() {
        "thin" => Some(Some(Dimension::Px(1.0))),
        "medium" => Some(Some(Dimension::Px(3.0))),
        "thick" => Some(Some(Dimension::Px(5.0))),
        _ => eval_dimension(text).map(Some),
    }
}

fn border_kind(text: &str) -> Option<BorderKind> {
    Some(match text.to_ascii_lowercase().as_str() {
        "none" => BorderKind::None,
        "hidden" => BorderKind::Hidden,
        "solid" => BorderKind::Solid,
        "dashed" => BorderKind::Dashed,
        "dotted" => BorderKind::Dotted,
        "double" => BorderKind::Double,
        "groove" => BorderKind::Groove,
        "ridge" => BorderKind::Ridge,
        "inset" => BorderKind::Inset,
        "outset" => BorderKind::Outset,
        _ => return None,
    })
}

/// Read a `border`/`border-{side}` declaration — already `var()`-substituted —
/// into a [`BorderSide`]. Lenient the way CSS is: any of width/style/color may
/// be absent (`border: solid` is `medium solid currentColor`). `none`/`0` are
/// `None` — no side at all.
pub fn eval_border_side(text: &str) -> Option<Option<BorderSide>> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    if t.eq_ignore_ascii_case("none") || t == "0" {
        return Some(None);
    }
    let mut width: Option<Dimension> = None;
    let mut kind: Option<BorderKind> = None;
    let mut color_parts: Vec<&str> = Vec::new();
    let mut bad = false;
    for part in top_level_parts(t) {
        if width.is_none() {
            if let Some(w) = border_width(part) {
                width = w;
                continue;
            }
        }
        if kind.is_none() {
            if let Some(k) = border_kind(part) {
                kind = Some(k);
                continue;
            }
        }
        color_parts.push(part);
    }
    let color: Option<Color> = if color_parts.is_empty() {
        None
    } else {
        match eval_color(&color_parts.join(" ")) {
            Some(c) => Some(c),
            None => {
                bad = true;
                None
            }
        }
    };
    if bad || (width.is_none() && kind.is_none() && color.is_none()) {
        return None;
    }
    Some(Some(BorderSide {
        width,
        kind: kind.unwrap_or(BorderKind::None),
        color,
    }))
}
