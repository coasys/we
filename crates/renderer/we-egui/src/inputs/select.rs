//! `we-select` — a controlled dropdown. `options` is a list of
//! `{value, label, icon?}`; the `value` prop is what shows; picking an
//! option emits `onChange` `{detail: option.value}`.
use we_expr::Value;
use we_style::Style;
use we_template::ResolvedNode;

use crate::inputs::{access_label, disabled};
use crate::props;
use crate::{events, MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

pub struct Select;

/// One `options` entry: `{value, label?, icon?, disabled?, group?}` —
/// `value` is what `onChange` carries; `disabled` keeps the row in the
/// list but out of reach (select.ts:438); `group` names the heading that
/// precedes a run of entries sharing it.
#[derive(Debug, Clone)]
struct Opt {
    value: Value,
    label: String,
    icon: Option<String>,
    disabled: bool,
    group: Option<String>,
}

fn options(node: &ResolvedNode) -> Vec<Opt> {
    let Value::List(items) = props::prop(node, "options") else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| match item {
            Value::Obj(map) => {
                let value = map.get("value").cloned().unwrap_or(Value::Undefined);
                let label = map
                    .get("label")
                    .map(|l| l.js_string())
                    .unwrap_or_else(|| value.js_string());
                Some(Opt {
                    value,
                    label,
                    icon: map
                        .get("icon")
                        .and_then(|v| crate::media::phosphor(&v.js_string()))
                        .map(str::to_string),
                    disabled: map.get("disabled").is_some_and(|v| v.truthy()),
                    group: map
                        .get("group")
                        .map(|g| g.js_string())
                        .filter(|g| !g.is_empty()),
                })
            }
            Value::Str(s) => Some(Opt {
                value: Value::Str(s.clone()),
                label: s.to_string(),
                icon: None,
                disabled: false,
                group: None,
            }),
            _ => None,
        })
        .collect()
}

impl Widget for Select {
    fn type_name(&self) -> &'static str {
        "we-select"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }

    fn measure(&self, cx: &MeasureCx, node: &ResolvedNode, _style: &Style, avail: Size) -> Size {
        let w = options(node)
            .iter()
            .map(|o| {
                cx.ctx
                    .fonts_mut(|f| {
                        f.layout_no_wrap(
                            o.label.clone(),
                            egui::FontId::default(),
                            egui::Color32::WHITE,
                        )
                    })
                    .size()
                    .x
            })
            .fold(80.0_f32, f32::max)
            + 40.0;
        Size::new(avail.x.min(w), props::control_height(node))
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        let opts = options(node);
        let value = props::prop(node, "value");
        let current = opts.iter().find(|o| o.value.strict_eq(value));
        let is_placeholder = current.is_none();
        let shown = current
            .map(|o| match &o.icon {
                // select.ts:599 — the chosen row keeps its leading glyph.
                Some(glyph) => format!("{glyph} {}", o.label),
                None => o.label.clone(),
            })
            .or_else(|| props::prop_string(node, "placeholder"))
            .unwrap_or_default();
        let label = access_label(cx, node);

        let response = cx.interact_label(
            rect,
            &label,
            egui::Role::ComboBox,
            &node.id,
            "select",
            !disabled(node),
            None,
        );
        let visuals = cx.ui.visuals().clone();
        let fill = if response.hovered() {
            visuals.widgets.hovered.bg_fill
        } else {
            visuals.widgets.inactive.bg_fill
        };
        cx.ui.painter().rect_filled(rect, 4.0, fill);
        cx.ui.painter().text(
            egui::pos2(rect.min.x + 8.0, rect.center().y),
            egui::Align2::LEFT_CENTER,
            shown,
            egui::FontId::default(),
            if is_placeholder {
                visuals.weak_text_color()
            } else {
                visuals.text_color()
            },
        );
        cx.ui.painter().text(
            egui::pos2(rect.max.x - 8.0, rect.center().y),
            egui::Align2::RIGHT_CENTER,
            "v",
            egui::FontId::default(),
            visuals.weak_text_color(),
        );

        if disabled(node) {
            return;
        }
        // `Popup::menu` anchors to the trigger rect and toggles on its
        // click. `CloseOnClickOutside`, not the menu's usual
        // `CloseOnClick`: an inside click on a disabled option is the
        // DOM's no-op — the listbox stays open (select.ts:438) — and a
        // real pick closes it itself below.
        egui::Popup::menu(&response)
            .close_behavior(egui::PopupCloseBehavior::CloseOnClickOutside)
            .width(rect.width())
            .show(|ui| {
                ui.set_min_width(rect.width());
                if opts.is_empty() {
                    ui.weak("no options");
                }
                let mut last_group: Option<&str> = None;
                for opt in &opts {
                    // select.ts:641 — a heading when the group name changes
                    // from the previous rendered option's.
                    if opt.group.is_some() && opt.group.as_deref() != last_group {
                        ui.weak(opt.group.as_deref().unwrap_or_default());
                    }
                    last_group = opt.group.as_deref();
                    let text = match &opt.icon {
                        Some(glyph) => format!("{glyph} {}", opt.label),
                        None => opt.label.clone(),
                    };
                    let mut picked = false;
                    ui.add_enabled_ui(!opt.disabled, |ui| {
                        picked = ui
                            .selectable_label(opt.value.strict_eq(value), text)
                            .clicked();
                    });
                    if picked {
                        cx.emit(&node.id, "onChange", events::detail(opt.value.clone()));
                        ui.close();
                    }
                }
            });
    }
}
