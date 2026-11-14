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

/// One `options` entry: `{value, label?, icon?}` — `value` is what
/// `onChange` carries.
#[derive(Debug, Clone)]
struct Opt {
    value: Value,
    label: String,
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
                Some(Opt { value, label })
            }
            Value::Str(s) => Some(Opt {
                value: Value::Str(s.clone()),
                label: s.to_string(),
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
            .map(|o| o.label.clone())
            .or_else(|| props::prop_str(node, "placeholder"))
            .unwrap_or_default();
        let label = access_label(cx, node);

        let response = cx.interact_label(rect, &label, egui::Role::ComboBox, &node.id, "select");
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
        // `Popup::menu` anchors to the trigger rect, toggles on its click,
        // and closes on an outside click or Escape — egui's popup memory
        // carries the open flag.
        egui::Popup::menu(&response).width(rect.width()).show(|ui| {
            ui.set_min_width(rect.width());
            if opts.is_empty() {
                ui.weak("no options");
            }
            for opt in &opts {
                if ui
                    .selectable_label(opt.value.strict_eq(value), opt.label.clone())
                    .clicked()
                {
                    cx.emit(&node.id, "onChange", events::detail(opt.value.clone()));
                    ui.close();
                }
            }
        });
    }
}
