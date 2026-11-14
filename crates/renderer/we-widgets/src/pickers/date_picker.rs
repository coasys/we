//! `we-date-picker` — a text field plus a month-grid popup. `value` is an
//! ISO `YYYY-MM-DD` (with an optional `time` prop `HH:MM`); picking a day
//! emits `onChange` `{detail: iso}` and closes the popup. A bespoke
//! implementation — no `egui_extras` needed for a month grid.
use we_expr::Value;
use we_style::Style;
use we_template::ResolvedNode;

use crate::inputs::{access_label, disabled};
use crate::props;
use crate::{events, MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

pub struct DatePicker;

/// `YYYY-MM-DD`, no chrono — the arithmetic a month grid needs.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Ymd(i32, u32, u32);

impl Ymd {
    fn parse(s: &str) -> Option<Self> {
        let (y, rest) = s.split_once('-')?;
        let (m, d) = rest.split_once('-')?;
        Some(Self(y.parse().ok()?, m.parse().ok()?, d.parse().ok()?))
    }

    fn iso(self) -> String {
        format!("{:04}-{:02}-{:02}", self.0, self.1, self.2)
    }

    /// Days in `self`'s month.
    fn days(self) -> u32 {
        match self.1 {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 => {
                if self.0 % 4 == 0 && (self.0 % 100 != 0 || self.0 % 400 == 0) {
                    29
                } else {
                    28
                }
            }
            _ => 30,
        }
    }

    /// Day of week for the 1st of the month (0 = Monday), via Zeller.
    fn first_weekday(self) -> u32 {
        let (mut y, mut m) = (self.0, self.1 as i32);
        if m < 3 {
            m += 12;
            y -= 1;
        }
        let k = y % 100;
        let j = y / 100;
        let h = (1 + (13 * (m + 1)) / 5 + k + k / 4 + j / 4 + 5 * j) % 7;
        ((h + 5) % 7) as u32 // h: 0=Saturday
    }

    fn shift_month(self, delta: i32) -> Self {
        let m0 = self.0 * 12 + self.1 as i32 - 1 + delta;
        Self(m0.div_euclid(12), (m0.rem_euclid(12) + 1) as u32, 1)
    }
}

/// `today` from seconds since epoch — civil-from-days, no chrono.
fn today(now_secs: f64) -> Ymd {
    let days = (now_secs / 86400.0).floor() as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    Ymd((if m <= 2 { y + 1 } else { y }) as i32, m, d)
}

fn show_time(node: &ResolvedNode) -> bool {
    props::prop_bool(node, "showTime").unwrap_or(false)
        || props::prop_str(node, "mode").as_deref() == Some("datetime")
}

impl Widget for DatePicker {
    fn type_name(&self) -> &'static str {
        "we-date-picker"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }

    fn measure(&self, _cx: &MeasureCx, node: &ResolvedNode, _style: &Style, avail: Size) -> Size {
        Size::new(avail.x.min(160.0), props::control_height(node))
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        let value = props::prop_str(node, "value").unwrap_or_default();
        let label = access_label(cx, node);
        let visuals = cx.ui.visuals().clone();

        let response = cx.interact_label(rect, &label, egui::Role::ComboBox, &node.id, "date");
        cx.ui
            .painter()
            .rect_filled(rect, 4.0, visuals.widgets.inactive.bg_fill);
        cx.ui.painter().text(
            egui::pos2(rect.min.x + 8.0, rect.center().y),
            egui::Align2::LEFT_CENTER,
            if value.is_empty() {
                props::prop_str(node, "placeholder").unwrap_or_else(|| "Pick a date".into())
            } else {
                value.clone()
            },
            egui::FontId::default(),
            if value.is_empty() {
                visuals.weak_text_color()
            } else {
                visuals.text_color()
            },
        );
        if disabled(node) {
            return;
        }

        // The visible month survives across frames in EditState.
        let selected = Ymd::parse(&value);
        if cx.edit.field(&node.id, "month").is_undefined() {
            let m = selected.unwrap_or_else(|| today(cx.now));
            cx.edit.set_field(
                &node.id,
                "month",
                Value::Str(format!("{:04}-{:02}", m.0, m.1).into()),
            );
        }
        let month_s = cx.edit.field(&node.id, "month").js_string();
        let month = Ymd::parse(&(month_s + "-01")).unwrap_or_else(|| today(cx.now));

        egui::Popup::menu(&response).show(|ui| {
            ui.set_min_width(210.0);
            // Month header: ‹ YYYY-MM ›
            ui.horizontal(|ui| {
                if ui.small_button("‹").clicked() {
                    let m = month.shift_month(-1);
                    cx.edit.set_field(
                        &node.id,
                        "month",
                        Value::Str(format!("{:04}-{:02}", m.0, m.1).into()),
                    );
                }
                ui.strong(format!("{:04}-{:02}", month.0, month.1));
                if ui.small_button("›").clicked() {
                    let m = month.shift_month(1);
                    cx.edit.set_field(
                        &node.id,
                        "month",
                        Value::Str(format!("{:04}-{:02}", m.0, m.1).into()),
                    );
                }
            });
            // Day grid, Monday first.
            let cell = egui::vec2(28.0, 24.0);
            ui.horizontal(|ui| {
                for w in ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] {
                    let (r, _) = ui.allocate_exact_size(cell, egui::Sense::hover());
                    ui.painter().text(
                        r.center(),
                        egui::Align2::CENTER_CENTER,
                        w,
                        egui::FontId::proportional(10.0),
                        visuals.weak_text_color(),
                    );
                }
            });
            let first = month.first_weekday();
            let days = month.days();
            let mut col = first;
            ui.horizontal_wrapped(|ui| {
                for _ in 0..first {
                    ui.allocate_exact_size(cell, egui::Sense::hover());
                }
                for d in 1..=days {
                    if col == 7 {
                        col = 0;
                    }
                    let day = Ymd(month.0, month.1, d);
                    let is_sel = selected == Some(day);
                    let (r, resp) = ui.allocate_exact_size(cell, egui::Sense::click());
                    if is_sel {
                        ui.painter()
                            .rect_filled(r, 4.0, visuals.widgets.active.bg_fill);
                    } else if resp.hovered() {
                        ui.painter()
                            .rect_filled(r, 4.0, visuals.widgets.hovered.bg_fill);
                    }
                    ui.painter().text(
                        r.center(),
                        egui::Align2::CENTER_CENTER,
                        d.to_string(),
                        egui::FontId::default(),
                        visuals.text_color(),
                    );
                    if resp.clicked() {
                        let mut detail = day.iso();
                        if show_time(node) {
                            detail = format!(
                                "{detail}T{}",
                                props::prop_str(node, "time").unwrap_or_else(|| "00:00".into())
                            );
                        }
                        cx.emit(&node.id, "onChange", events::detail_str(&detail));
                        ui.close();
                    }
                    col += 1;
                }
            });
            if show_time(node) {
                let mut t = props::prop_str(node, "time").unwrap_or_else(|| "00:00".into());
                ui.horizontal(|ui| {
                    ui.label("Time");
                    if ui.text_edit_singleline(&mut t).lost_focus() {
                        let d = selected.unwrap_or_else(|| today(cx.now)).iso();
                        cx.emit(
                            &node.id,
                            "onChange",
                            events::detail_str(&format!("{d}T{t}")),
                        );
                    }
                });
            }
        });
    }
}
