//! Text-ish widgets: `we-text`, `we-link`, `we-timestamp`, `we-typewriter`,
//! plus the tiny UTC date math `we-timestamp` needs.
use std::sync::Arc;

use we_expr::Value;
use we_style::Style;
use we_template::ResolvedNode;

use crate::defaults::{view_of, FONT_PX, ROOT_PX};
use crate::props;
use crate::{MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

// ── date math ────────────────────────────────────────────────────────────

/// Days since civil epoch → (year, month 1..12, day) — Hinnant's algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (y + if m <= 2 { 1 } else { 0 }, m, d)
}

fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let mp = if m > 2 { m - 3 } else { m + 9 } as u64;
    let doy = (153 * mp + 2) / 5 + d as u64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe as i64 - 719_468
}

/// `new Date(value)`'s inputs: epoch ms as a number, or ISO-8601
/// `YYYY-MM-DD[THH:MM[:SS[.fff]]][Z|±HH[:MM]]`. `None` = unparsable (the
/// caller renders the raw string).
pub fn parse_date(value: &Value) -> Option<f64> {
    match value {
        Value::Num(n) => Some(*n),
        Value::Str(s) => parse_iso(s.trim()),
        _ => None,
    }
}

fn parse_iso(s: &str) -> Option<f64> {
    let (date, rest) = match s.split_once(['T', ' ']) {
        Some((d, t)) => (d, t),
        None => (s, ""),
    };
    let mut it = date.split('-');
    let y: i64 = it.next()?.parse().ok()?;
    let m: u32 = it.next()?.parse().ok()?;
    let d: u32 = it.next()?.parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let days = days_from_civil(y, m, d) as f64;
    if rest.is_empty() {
        return Some(days * 86_400_000.0);
    }
    let (h, mi, sec, frac, off) = parse_time_rest(rest)?;
    Some((days * 86_400.0 + h * 3600.0 + mi * 60.0 + sec - off) * 1000.0 + frac)
}

/// `HH:MM[:SS[.fff]][Z|±HH[:MM]]` → (h, min, sec, frac_ms, offset_secs).
fn parse_time_rest(rest: &str) -> Option<(f64, f64, f64, f64, f64)> {
    let rest = rest.strip_suffix('Z').unwrap_or(rest);
    let (time, off) = match rest[1..].find(['+', '-']).map(|i| i + 1) {
        Some(i) => {
            let (pos, oh, om) = tz(&rest[i..])?;
            let s = oh * 3600.0 + om * 60.0;
            (&rest[..i], if pos { s } else { -s })
        }
        None => (rest, 0.0),
    };
    let mut it = time.split(':');
    let h: f64 = it.next()?.parse().ok()?;
    let mi: f64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let s: f64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    Some((h, mi, s.trunc(), s.fract() * 1000.0, off))
}

/// `±HH[:MM]` → (positive?, hours, minutes).
fn tz(s: &str) -> Option<(bool, f64, f64)> {
    let pos = s.starts_with('+');
    let t = s.strip_prefix(['+', '-'])?;
    let mut it = t.split(':');
    let h: f64 = it.next()?.parse().ok()?;
    let m: f64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    Some((pos, h, m))
}

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_LONG: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const DAYS_LONG: [&str; 7] = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
];

/// `Intl.DateTimeFormat` for `en` in UTC — `dateStyle` medium/short/long/
/// full plus an optional `timeStyle` short (`h:mm a`) or medium.
pub fn format_date(ms: f64, date_style: &str, time_style: Option<&str>) -> String {
    let secs = (ms / 1000.0).floor() as i64;
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    let wd_ix = ((days + 3).rem_euclid(7)) as usize; // epoch was a Thursday
    let date = match date_style {
        "short" => format!("{}/{}/{}", m, d, y % 100),
        "long" => format!("{} {}, {}", MONTHS_LONG[(m - 1) as usize], d, y),
        "full" => format!(
            "{}, {} {}, {}",
            DAYS_LONG[wd_ix],
            MONTHS_LONG[(m - 1) as usize],
            d,
            y
        ),
        _ => format!("{} {}, {}", MONTHS[(m - 1) as usize], d, y), // medium
    };
    let (h24, min, sec) = (sod / 3600, (sod % 3600) / 60, sod % 60);
    match time_style {
        Some("short") => {
            let (h, ap) = match h24 {
                0 => (12, "AM"),
                h if h < 12 => (h, "AM"),
                12 => (12, "PM"),
                h => (h - 12, "PM"),
            };
            format!("{}, {}:{:02} {}", date, h, min, ap)
        }
        Some(_) => format!("{}, {:02}:{:02}:{:02}", date, h24, min, sec),
        _ => date,
    }
}

/// `formatRelativeTime` ported: under a minute reads "now"; `numeric: auto`
/// gives yesterday/tomorrow; otherwise `"N units ago"`/`"in N units"`.
/// `style` is `long`/`short`/`narrow`.
pub fn format_relative(target_ms: f64, now_ms: f64, style: &str) -> String {
    const MIN: f64 = 60_000.0;
    const HOUR: f64 = 3_600_000.0;
    const DAY: f64 = 86_400_000.0;
    const MONTH: f64 = DAY * 365.0 / 12.0;
    const YEAR: f64 = DAY * 365.0;
    let elapsed = target_ms - now_ms;
    let abs = elapsed.abs();
    let (unit, n) = if abs >= YEAR {
        ("year", elapsed / YEAR)
    } else if abs >= MONTH {
        ("month", elapsed / MONTH)
    } else if abs >= DAY {
        ("day", elapsed / DAY)
    } else if abs >= HOUR {
        ("hour", elapsed / HOUR)
    } else if abs >= MIN {
        ("minute", elapsed / MIN)
    } else {
        return "now".to_string();
    };
    let n = n.round() as i64;
    // `numeric: auto` — the named single-unit forms apply in every style.
    match (unit, n) {
        ("day", -1) => return "yesterday".to_string(),
        ("day", 1) => return "tomorrow".to_string(),
        ("year", -1) => return "last year".to_string(),
        ("year", 1) => return "next year".to_string(),
        ("month", -1) => return "last month".to_string(),
        ("month", 1) => return "next month".to_string(),
        _ => {}
    }
    let (sing, short, narrow) = match unit {
        "year" => ("year", "yr", "yr"),
        "month" => ("month", "mo", "mo"),
        "day" => ("day", "day", "day"),
        "hour" => ("hour", "hr", "hr"),
        _ => ("minute", "min", "min"),
    };
    if n < 0 {
        match style {
            "narrow" => format!("{}{} ago", -n, narrow),
            "short" => format!("{} {}. ago", -n, short),
            _ => format!("{} {}{} ago", -n, sing, if n == -1 { "" } else { "s" }),
        }
    } else {
        match style {
            "narrow" => format!("in {}{}", n, narrow),
            "short" => format!("in {} {}.", n, short),
            _ => format!("in {} {}{}", n, sing, if n == 1 { "" } else { "s" }),
        }
    }
}

// ── galley helpers ───────────────────────────────────────────────────────

/// The `LayoutJob` a we-text-family widget paints: transform, wrap,
/// `lines`/`truncate` clamps with an ellipsis, align, break-anywhere.
pub fn text_job(
    text: &str,
    style: &Style,
    ctx: &egui::Context,
    avail_w: f32,
    truncate: bool,
    lines: Option<usize>,
) -> std::sync::Arc<egui::Galley> {
    let view = view_of(ctx);
    let font = props::font_id(style, FONT_PX, ROOT_PX, view.viewport);
    let color = props::text_color(style, ctx);
    let nowrap = matches!(style.text.white_space, Some(we_style::WhiteSpace::Nowrap)) || truncate;
    let break_anywhere = matches!(
        style.text.overflow_wrap,
        Some(we_style::OverflowWrap::Anywhere) | Some(we_style::OverflowWrap::BreakWord)
    );
    let mut job = egui::text::LayoutJob::simple(
        text.to_string(),
        font,
        color,
        if nowrap {
            f32::INFINITY
        } else {
            avail_w.max(0.0)
        },
    );
    job.wrap.break_anywhere = break_anywhere;
    if truncate {
        job.wrap.max_rows = 1;
        job.wrap.overflow_character = Some('…');
    } else if let Some(n) = lines {
        job.wrap.max_rows = n.max(1);
        job.wrap.overflow_character = Some('…');
    }
    job.halign = match style.text.align {
        Some(we_style::TextAlign::Center) => egui::Align::Center,
        Some(we_style::TextAlign::Right) | Some(we_style::TextAlign::End) => egui::Align::Max,
        _ => egui::Align::Min,
    };
    ctx.fonts_mut(|f| f.layout_job(job))
}

fn measure_text(
    cx: &MeasureCx,
    _node: &ResolvedNode,
    style: &Style,
    avail: Size,
    text: &str,
    truncate: bool,
    lines: Option<usize>,
) -> Size {
    let g = text_job(
        &props::transform_text(style, text, false),
        style,
        cx.ctx,
        avail.x.max(1.0),
        truncate,
        lines,
    );
    g.size()
}

/// Underline for `text-decoration: underline`.
fn underline(cx: &mut PaintCx, style: &Style, rect: Rect) {
    if matches!(
        style.text.decoration,
        Some(we_style::TextDecoration::Underline)
    ) {
        let view = view_of(cx.ui.ctx());
        let font = props::font_id(style, FONT_PX, ROOT_PX, view.viewport);
        let h = props::line_height_px(style, &font, cx.ui.ctx(), FONT_PX, ROOT_PX, view.viewport);
        cx.ui.painter().hline(
            rect.min.x..=rect.min.x + rect.width(),
            rect.min.y + h - 1.5,
            egui::Stroke::new(1.0, props::text_color(style, cx.ui.ctx())),
        );
    }
}

// ── we-text ──────────────────────────────────────────────────────────────

/// `we-text` — styled, wrapping text. `truncate` → one line + `…`; `lines: n`
/// → clamp to n rows. `variant`/`tag` come through `Style`; `italic` and
/// `uppercase` are widget props.
#[derive(Debug, Default)]
pub struct Text;

impl Text {
    fn content(node: &ResolvedNode, style: &Style) -> String {
        props::transform_text(
            style,
            &props::text_of(node),
            props::prop_bool(node, "uppercase"),
        )
    }
}

impl Widget for Text {
    fn type_name(&self) -> &'static str {
        "we-text"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, avail: Size) -> Size {
        measure_text(
            cx,
            node,
            style,
            avail,
            &Self::content(node, style),
            props::prop_bool(node, "truncate"),
            props::prop_num(node, "lines").map(|n| n.max(1.0) as usize),
        )
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        let content = Self::content(node, style);
        let g = text_job(
            &content,
            style,
            cx.ui.ctx(),
            rect.width(),
            props::prop_bool(node, "truncate"),
            props::prop_num(node, "lines").map(|n| n.max(1.0) as usize),
        );
        cx.ui
            .painter()
            .add(egui::Shape::galley(rect.min, g, egui::Color32::PLACEHOLDER));
        underline(cx, style, rect);
        cx.label(rect, &content);
    }
}

// ── we-link ──────────────────────────────────────────────────────────────

/// `we-link` — inline-styled text or a card anchor. Internal `to` (and any
/// `href` the template handles) emits `onClick` with `{detail:{href}}`;
/// an external `http(s)` href with no handler fires `ctx.open_url`.
#[derive(Debug, Default)]
pub struct Link;

impl Widget for Link {
    fn type_name(&self) -> &'static str {
        "we-link"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Container
    }
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, avail: Size) -> Size {
        measure_text(cx, node, style, avail, &props::text_of(node), false, None)
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        crate::containers::paint_container(cx, node, style, rect);
        let label = props::text_of(node);
        let href = props::prop_text(node, "href")
            .or_else(|| props::prop_text(node, "to"))
            .unwrap_or("")
            .to_string();
        let disabled = props::prop_bool(node, "disabled");
        let response = cx.interact_label(rect, &label, egui::Role::Link, &node.id, "link");
        let eff = props::state_style(style, &response, disabled);
        if !disabled && response.clicked() {
            cx.emit(
                &node.id,
                "onClick",
                props::detail([("href", Value::Str(Arc::from(href.as_str())))]),
            );
            // safeHref: only http(s) opens a real browser tab, and only when
            // the template left `onClick` unhandled.
            let external = href.starts_with("http://") || href.starts_with("https://");
            if external && !node.handlers.contains_key("onClick") {
                cx.ui.ctx().open_url(egui::OpenUrl::new_tab(href));
            }
        }
        if !label.is_empty() {
            let g = text_job(&label, &eff, cx.ui.ctx(), rect.width(), false, None);
            cx.ui
                .painter()
                .add(egui::Shape::galley(rect.min, g, egui::Color32::PLACEHOLDER));
            underline(cx, &eff, rect);
        }
        if response.hovered() && !disabled {
            cx.ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
    }
}

// ── we-timestamp ─────────────────────────────────────────────────────────

/// `we-timestamp` — `value` + `relative`/`relativeStyle`/`locale`/`dateStyle`.
/// "Now" comes from `PaintCx::now` (epoch seconds), never the system clock.
#[derive(Debug, Default)]
pub struct Timestamp;

impl Timestamp {
    fn text(node: &ResolvedNode, now_secs: f64) -> String {
        let Some(v) = node.props.get("value") else {
            return String::new();
        };
        match parse_date(v) {
            Some(ms) if props::prop_bool(node, "relative") => {
                let style = props::prop_str(node, "relativeStyle").unwrap_or("long");
                format_relative(ms, now_secs * 1000.0, style)
            }
            Some(ms) => {
                let date_style = props::prop_str(node, "dateStyle").unwrap_or("medium");
                format_date(ms, date_style, props::prop_str(node, "timeStyle"))
            }
            None => v.to_text().to_string(),
        }
    }
}

impl Widget for Timestamp {
    fn type_name(&self) -> &'static str {
        "we-timestamp"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, avail: Size) -> Size {
        // `MeasureCx` has no clock — measure a representative long string so
        // the relative form doesn't wrap ("now" under-measures "5 months ago").
        let sample = if props::prop_bool(node, "relative") {
            "00 months ago".to_string()
        } else {
            Self::text(node, 0.0)
        };
        measure_text(cx, node, style, avail, &sample, false, None)
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        // `cx.now` is the frame clock (seconds since start), not epoch —
        // `relative` needs wall time.
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        let text = Self::text(node, now_secs);
        let g = text_job(&text, style, cx.ui.ctx(), rect.width(), false, None);
        cx.ui.painter().add(egui::Shape::galley(
            rect.min,
            g,
            props::text_color(style, cx.ui.ctx()),
        ));
        cx.label(rect, &text);
    }
}

// ── we-typewriter ────────────────────────────────────────────────────────

/// `we-typewriter` — fixed `text` plus a `phrases`[] it types and deletes on
/// the `PaintCx` frame clock. `phraseColor` colors the cycled part; `cursor`
/// shows a block cursor.
#[derive(Debug, Default)]
pub struct Typewriter;

impl Typewriter {
    /// (phrase index, shown chars) at `now`, from the mount time `t0` —
    /// typewriter.ts's schedule: full → delete → pause → type → next.
    fn shown(node: &ResolvedNode, t0: f64, now: f64) -> (usize, usize) {
        let phrases = props::prop_list(node, "phrases")
            .cloned()
            .unwrap_or_default();
        let type_ms = props::prop_num(node, "typeMs").unwrap_or(65.0) / 1000.0;
        let del_ms = props::prop_num(node, "deleteMs").unwrap_or(32.0) / 1000.0;
        let hold_ms = props::prop_num(node, "holdMs").unwrap_or(2600.0) / 1000.0;
        if phrases.is_empty() {
            return (0, 0);
        }
        // The cycle wraps — compare `now` folded into [t0, t0+cycle).
        let mut cycle = 0.0;
        for p in &phrases {
            let len = p.js_string().chars().count() as f64;
            cycle += hold_ms + len * del_ms + type_ms * 4.0 + len * type_ms;
        }
        let now = t0 + (now - t0).rem_euclid(cycle);
        let mut t = t0;
        for (i, p) in phrases.iter().enumerate() {
            let len = p.js_string().chars().count();
            let del = len as f64 * del_ms;
            let pause = type_ms * 4.0;
            let typ = len as f64 * type_ms;
            if now < t + hold_ms {
                return (i, len);
            }
            t += hold_ms;
            if now < t + del {
                return (i, len.saturating_sub(((now - t) / del_ms).floor() as usize));
            }
            t += del;
            if now < t + pause {
                return (i, 0);
            }
            t += pause;
            if now < t + typ {
                return (i, (((now - t) / type_ms).floor() as usize).min(len));
            }
            t += typ;
        }
        (0, 0)
    }
}

impl Widget for Typewriter {
    fn type_name(&self) -> &'static str {
        "we-typewriter"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }
    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, style: &Style, avail: Size) -> Size {
        // The longest phrase, so cycling never reflows the line below —
        // typewriter.ts's grid-cell trick.
        let fixed = props::prop_str(node, "text").unwrap_or("");
        let longest = props::prop_list(node, "phrases")
            .map(|l| {
                l.iter().map(|v| v.js_string()).fold(String::new(), |a, b| {
                    if b.len() > a.len() {
                        b
                    } else {
                        a
                    }
                })
            })
            .unwrap_or_default();
        measure_text(
            cx,
            node,
            style,
            avail,
            &format!("{fixed}{longest}"),
            false,
            None,
        )
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, style: &Style, rect: Rect) {
        // First paint stores the mount time — the schedule anchors there.
        if props::scratch(&cx.edit.data, &node.id, "_typewriter").is_none() {
            props::scratch_set(
                &mut cx.edit.data,
                &node.id,
                "_typewriter",
                Value::Num(cx.now),
            );
        }
        let t0 = match props::scratch(&cx.edit.data, &node.id, "_typewriter") {
            Some(Value::Num(n)) => *n,
            _ => cx.now,
        };
        let fixed = props::prop_str(node, "text").unwrap_or("").to_string();
        let (ix, n) = Self::shown(node, t0, cx.now);
        let phrase = props::prop_list(node, "phrases")
            .and_then(|l| l.get(ix).map(|v| v.js_string()))
            .unwrap_or_default();
        let cycled: String = phrase.chars().take(n).collect();

        let g_fixed = text_job(&fixed, style, cx.ui.ctx(), rect.width(), false, None);
        let x_after = g_fixed.size().x;
        cx.ui.painter().add(egui::Shape::galley(
            rect.min,
            g_fixed,
            egui::Color32::PLACEHOLDER,
        ));
        let mut phrase_style = style.clone();
        if let Some(t) = props::prop_str(node, "phraseColor") {
            if let Some(c) = we_style::eval_color(t) {
                phrase_style.text.color = Some(c);
            }
        }
        let g_rest = text_job(
            &cycled,
            &phrase_style,
            cx.ui.ctx(),
            rect.width() - x_after,
            false,
            None,
        );
        let w_rest = g_rest.size().x;
        cx.ui.painter().add(egui::Shape::galley(
            rect.min + egui::vec2(x_after, 0.0),
            g_rest,
            egui::Color32::PLACEHOLDER,
        ));
        if props::prop_bool(node, "cursor") || !cycled.is_empty() {
            let p = rect.min + egui::vec2(x_after + w_rest + 1.0, 0.0);
            cx.ui.painter().rect_filled(
                egui::Rect::from_min_size(p, egui::vec2(6.0, 12.0)),
                1.0,
                props::text_color(&phrase_style, cx.ui.ctx()),
            );
        }
        cx.ui.ctx().request_repaint();
        cx.label(rect, &format!("{fixed}{cycled}"));
    }
}
