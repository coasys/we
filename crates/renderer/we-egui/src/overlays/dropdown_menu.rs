//! `DropdownMenu` — a trigger plus a menu. `items` entries are
//! `{id, label, icon?, danger?, disabled?, type?}`; `type: "separator"`
//! divides groups. An item click emits `onSelect` `{id: item.id}` (the
//! payload the bundle's handlers read as `arg.id`) and the popup closes
//! itself — one item, one event.
use we_expr::Value;
use we_style::Style;
use we_template::{ResolvedChild, ResolvedNode};

use crate::props;
use crate::{
    events, Direction, MeasureCx, PaintCx, PartSpec, PartsSpec, Pick, Rect, Size, Widget,
    WidgetKind,
};

pub struct DropdownMenu;

impl Widget for DropdownMenu {
    fn type_name(&self) -> &'static str {
        "DropdownMenu"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Overlay
    }

    fn parts_spec(&self, _node: &ResolvedNode) -> Option<PartsSpec> {
        // The trigger child anchors; `items` float in the widget's popup.
        Some(PartsSpec {
            direction: Direction::Column,
            parts: vec![PartSpec::group("trigger", Pick::Default, Direction::Column)],
        })
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, _avail: Size) -> Size {
        Size::new(0.0, 0.0)
    }

    /// A childless menu generates its trigger — DropdownMenu.solid.tsx's
    /// `trigger()`: a `soft` we-button whose text is `triggerLabel`
    /// (`"Options"` without an icon; icon-only — `square`, named by
    /// `triggerTitle ?? "Options"` — when an icon stands alone), wrapped
    /// in a bottom `we-tooltip` when `triggerTitle` is set. An authored
    /// child is the trigger instead and nothing is generated.
    fn synthesized_children(&self, node: &ResolvedNode) -> Vec<ResolvedChild> {
        if !node.children.is_empty() {
            return Vec::new();
        }
        let icon = props::prop_text(node, "triggerIcon");
        // `label()`: an icon turns an absent label into icon-only rather
        // than "icon, followed by the word Options".
        let label = match icon {
            Some(_) => props::prop_str(node, "triggerLabel").unwrap_or_default(),
            None => props::prop_str(node, "triggerLabel").unwrap_or("Options"),
        };
        let icon_only = icon.is_some() && label.is_empty();
        let title = props::prop_text(node, "triggerTitle");
        let base = node.id.as_str();

        let mut bprops: indexmap::IndexMap<std::sync::Arc<str>, Value> = Default::default();
        let take = |k: &str| node.props.get(k).filter(|v| !v.is_undefined()).cloned();
        bprops.insert(
            "variant".into(),
            take("triggerVariant").unwrap_or_else(|| Value::Str("soft".into())),
        );
        if let Some(v) = take("size") {
            bprops.insert("size".into(), v.clone());
        }
        if let Some(v) = take("triggerTone") {
            bprops.insert("tone".into(), v.clone());
        }
        if icon_only {
            bprops.insert("square".into(), Value::Bool(true));
            // `label`, not `aria-label`, reaches the inner button — the
            // icon-only trigger's accessible name.
            bprops.insert(
                "label".into(),
                Value::Str(title.unwrap_or("Options").into()),
            );
        }
        let mut bchildren: Vec<ResolvedChild> = Vec::new();
        if let Some(name) = icon {
            let mut iprops: indexmap::IndexMap<std::sync::Arc<str>, Value> = Default::default();
            iprops.insert("name".into(), Value::Str(name.into()));
            bchildren.push(ResolvedChild::Node(Box::new(ResolvedNode {
                id: format!("{base}/~t/b/i").into(),
                ty: "we-icon".into(),
                props: iprops,
                handlers: Default::default(),
                slot: None,
                children: Vec::new(),
                surfaces: Default::default(),
                transition: None,
            })));
        }
        if !label.is_empty() {
            bchildren.push(ResolvedChild::Text(label.into()));
        }
        let button = ResolvedNode {
            id: format!("{base}/~t/b").into(),
            ty: "we-button".into(),
            props: bprops,
            handlers: Default::default(),
            slot: None,
            children: bchildren,
            surfaces: Default::default(),
            transition: None,
        };
        match title {
            // `we-tooltip` takes the trigger slot, the button sits inside.
            Some(content) => {
                let mut tprops: indexmap::IndexMap<std::sync::Arc<str>, Value> = Default::default();
                tprops.insert("content".into(), Value::Str(content.into()));
                tprops.insert("placement".into(), Value::Str("bottom".into()));
                vec![ResolvedChild::Node(Box::new(ResolvedNode {
                    id: format!("{base}/~t").into(),
                    ty: "we-tooltip".into(),
                    props: tprops,
                    handlers: Default::default(),
                    slot: None,
                    children: vec![ResolvedChild::Node(Box::new(button))],
                    surfaces: Default::default(),
                    transition: None,
                }))]
            }
            None => vec![ResolvedChild::Node(Box::new(button))],
        }
    }

    /// Activation in the `trigger` part toggles open — the walk applies it
    /// after the subtree paints (see `paint_node`): a click-sensing
    /// descendant's `clicked()` (pointer or keyboard fake-click) or a
    /// pointer hit on the anchor itself that no disabled control swallowed
    /// and no higher layer covered.
    fn trigger_toggles(&self) -> bool {
        true
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, _rect: Rect) {
        let overlay = props::part(cx, node, "overlay");
        if overlay.is_none() {
            return;
        }
        // Overlay pass: the search field, then the item rows.
        let Value::List(items) = node.props.get("items").cloned().unwrap_or(Value::Undefined)
        else {
            return;
        };
        let m = metrics(node);
        let searchable = props::prop_flag(node, "searchable").unwrap_or(false);
        let mut query = cx.edit.field(&node.id, "menu_query").to_text().to_string();
        if searchable {
            // DropdownMenu.solid.tsx: the field sits above the entries;
            // `searchPlaceholder` names it. Its text is a draft in
            // EditState — cleared only when an action closes the menu,
            // like the component's `setQuery('')`.
            let hint =
                props::prop_string(node, "searchPlaceholder").unwrap_or_else(|| "Search".into());
            let mut q = query.clone();
            let resp = cx.ui.add(
                egui::TextEdit::singleline(&mut q)
                    .hint_text(hint.as_str())
                    .desired_width(f32::INFINITY),
            );
            resp.widget_info(|| {
                egui::WidgetInfo::labeled(egui::Role::TextInput, true, hint.as_str())
            });
            if resp.changed() {
                query = q;
                cx.edit
                    .set_field(&node.id, "menu_query", Value::Str(query.clone().into()));
            }
        }
        let needle = query.trim().to_lowercase();
        for item in items.iter() {
            paint_entry(cx, node, item, &needle, m);
        }
    }
}

fn ui_cursor(ui: &egui::Ui) -> egui::Pos2 {
    ui.cursor().min
}

/// `ITEM_SIZES` from DropdownMenu.solid.tsx — `itemSize ?? size` picks a
/// tier; the row height, item font and leading-glyph box all move
/// together.
#[derive(Clone, Copy)]
struct Metrics {
    h: f32,
    font: f32,
    icon: f32,
}

fn metrics(node: &ResolvedNode) -> Metrics {
    let tier = props::prop_text(node, "itemSize")
        .or_else(|| props::prop_text(node, "size"))
        .unwrap_or("md");
    match tier {
        "xs" => Metrics {
            h: 18.0,
            font: 10.5,
            icon: 12.0,
        },
        "sm" => Metrics {
            h: 22.0,
            font: 12.0,
            icon: 14.0,
        },
        "lg" => Metrics {
            h: 30.0,
            font: 15.0,
            icon: 16.0,
        },
        "xl" => Metrics {
            h: 34.0,
            font: 16.0,
            icon: 18.0,
        },
        _ => Metrics {
            h: 26.0,
            font: 13.0,
            icon: 16.0,
        },
    }
}

/// The `matches` of DropdownMenu.solid.tsx: an empty needle keeps
/// everything; a group survives while any descendant does; dividers
/// always stand down under a needle.
fn matches(entry: &Value, needle: &str) -> bool {
    if needle.is_empty() {
        return true;
    }
    let Value::Obj(map) = entry else {
        // A `$if` hole — rendered as nothing regardless.
        return true;
    };
    match map.get("type").map(|v| v.js_string()).as_deref() {
        Some("divider" | "separator") => false,
        Some("group") => map.get("items").is_some_and(
            |items| matches!(items, Value::List(l) if l.iter().any(|e| matches(e, needle))),
        ),
        _ => map
            .get("label")
            .map(|v| v.js_string().to_lowercase().contains(needle))
            .unwrap_or(false),
    }
}

/// A toggle's `checked`, resolved: a plain bool or an accessor callable —
/// the payload reports it *as it was before the press* (the schema's
/// handler flips `!arg.checked`).
fn is_checked(map: &indexmap::IndexMap<std::sync::Arc<str>, Value>) -> bool {
    match map.get("checked") {
        Some(Value::Callable(c)) => c.call(&[]).truthy(),
        Some(v) => v.truthy(),
        None => false,
    }
}

/// `item.onAction?.()` / `item.onToggle?.()` — per-entry callbacks arrive
/// as callables when the resolver lifts them.
fn invoke(map: &indexmap::IndexMap<std::sync::Arc<str>, Value>, key: &str) {
    if let Some(Value::Callable(c)) = map.get(key) {
        c.call(&[]);
    }
}

/// One `items` entry — DividerMenuEntry's four kinds: `divider`, `group`
/// (a heading that collapses rather than selects), `toggle` (selects but
/// stays open) and the default `action`. Anything `hidden` or filtered
/// out renders nothing.
fn paint_entry(cx: &mut PaintCx, node: &ResolvedNode, entry: &Value, needle: &str, m: Metrics) {
    let Value::Obj(map) = entry else {
        return;
    };
    if map.get("hidden").is_some_and(|v| v.truthy()) || !matches(entry, needle) {
        return;
    }
    let ty = map.get("type").map(|v| v.js_string()).unwrap_or_default();
    match ty.as_str() {
        "divider" | "separator" => {
            let visuals = cx.ui.visuals().clone();
            let r = Rect::from_min_size(ui_cursor(cx.ui), egui::vec2(cx.ui.available_width(), 1.0));
            cx.ui
                .painter()
                .rect_filled(r, 0.0, visuals.window_stroke().color);
            cx.ui.advance_cursor_after_rect(r);
        }
        "group" => {
            paint_group(cx, node, map, needle, m);
        }
        _ => {
            paint_item(cx, node, map, &ty, m);
        }
    }
}

/// `renderGroup`: an overline caption — caret + click-to-collapse when
/// `collapsible !== false` (the default), a static overline otherwise.
/// `disabled` groups keep their items but can't be toggled. Searching
/// opens every surviving group (`collapsed() && !query` gates children).
fn paint_group(
    cx: &mut PaintCx,
    node: &ResolvedNode,
    map: &indexmap::IndexMap<std::sync::Arc<str>, Value>,
    needle: &str,
    m: Metrics,
) {
    let label = map.get("label").map(|v| v.js_string()).unwrap_or_default();
    let id = map
        .get("id")
        .map(|v| v.js_string())
        .unwrap_or_else(|| label.clone());
    let disabled = map.get("disabled").is_some_and(|v| v.truthy());
    // `collapsible !== false` — only a literal `false` makes it static.
    let collapsible = !matches!(map.get("collapsible"), Some(Value::Bool(false)));
    let gkey = format!("gcol:{id}");
    let collapsed = match cx.edit.field(&node.id, &gkey) {
        Value::Undefined => map.get("collapsed").is_some_and(|v| v.truthy()),
        v => v.truthy(),
    };

    let visuals = cx.ui.visuals().clone();
    let h = 22.0;
    let r = Rect::from_min_size(ui_cursor(cx.ui), egui::vec2(cx.ui.available_width(), h));
    let sense = if collapsible && !disabled {
        egui::Sense::click()
    } else {
        egui::Sense::hover()
    };
    let resp = cx.ui.interact(
        r,
        cx.ui.scope_id().with((node.id.as_str(), "g", id.as_str())),
        sense,
    );
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, collapsible, label.as_str()));
    if resp.hovered() && collapsible && !disabled {
        cx.ui
            .painter()
            .rect_filled(r, 4.0, visuals.widgets.hovered.bg_fill);
    }
    let faint = if disabled {
        visuals.weak_text_color()
    } else {
        visuals.text_color()
    };
    let mut x = r.min.x + 8.0;
    if collapsible {
        // The caret says what a click does — `caret-down` open,
        // `caret-right` shut, like the solid group's icon swap.
        let caret = crate::media::phosphor(if collapsed {
            "caret-right"
        } else {
            "caret-down"
        })
        .unwrap_or("?");
        cx.ui.painter().text(
            egui::pos2(x, r.center().y),
            egui::Align2::LEFT_CENTER,
            caret,
            egui::FontId::new(m.icon * 0.8, egui::FontFamily::Proportional),
            faint,
        );
        x += m.icon + 4.0;
    }
    // `variant="overline"`: capitals, small, faint — a heading, not a row.
    cx.ui.painter().text(
        egui::pos2(x, r.center().y),
        egui::Align2::LEFT_CENTER,
        label.to_uppercase(),
        egui::FontId::new(m.font - 2.0, egui::FontFamily::Proportional),
        faint,
    );
    cx.ui.advance_cursor_after_rect(r);
    if resp.clicked() && collapsible && !disabled {
        cx.edit.set_field(&node.id, &gkey, Value::Bool(!collapsed));
    }
    if !collapsed || !needle.is_empty() {
        if let Some(Value::List(kids)) = map.get("items") {
            for kid in kids.iter() {
                paint_entry(cx, node, kid, needle, m);
            }
        }
    }
}

/// `renderActionItem`/`renderToggleItem` — one row: leading avatar or
/// glyph, the label, a trailing `check` when `selected` (action) or
/// `checked` (toggle). A click on an action closes the menu and clears
/// the search; a toggle only reports.
fn paint_item(
    cx: &mut PaintCx,
    node: &ResolvedNode,
    map: &indexmap::IndexMap<std::sync::Arc<str>, Value>,
    ty: &str,
    m: Metrics,
) {
    let label = map.get("label").map(|v| v.js_string()).unwrap_or_default();
    let id = map
        .get("id")
        .cloned()
        .unwrap_or_else(|| Value::Str(label.clone().into()));
    let disabled = map.get("disabled").is_some_and(|v| v.truthy());
    let toggle = ty == "toggle";
    let marked = if toggle {
        is_checked(map)
    } else {
        map.get("selected").is_some_and(|v| v.truthy())
    };
    let danger = map.get("danger").is_some_and(|v| v.truthy())
        || matches!(map.get("tone"), Some(v) if v.js_string() == "danger");

    let visuals = cx.ui.visuals().clone();
    let r = Rect::from_min_size(ui_cursor(cx.ui), egui::vec2(cx.ui.available_width(), m.h));
    let resp = cx.ui.interact(
        r,
        cx.ui
            .scope_id()
            .with((node.id.as_str(), "mi", id.js_string().as_str())),
        if disabled {
            egui::Sense::hover()
        } else {
            egui::Sense::click()
        },
    );
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, !disabled, label.as_str()));
    if resp.hovered() {
        cx.ui
            .painter()
            .rect_filled(r, 4.0, visuals.widgets.hovered.bg_fill);
    }
    let mut x = r.min.x + 8.0;
    let text_color = if danger {
        visuals.error_fg_color
    } else if disabled {
        visuals.weak_text_color()
    } else {
        visuals.text_color()
    };
    // `leading`: the face if the entry is a person, else its glyph —
    // avatar wins over icon where both are given.
    if let Some(Value::Obj(avatar)) = map.get("avatar") {
        let tone = avatar.get("tone").map(|v| v.js_string());
        let rings = crate::media::menu_rings(cx.ui.ctx(), tone.as_deref());
        let image = avatar
            .get("image")
            .map(|v| v.js_string())
            .filter(|u| !u.is_empty());
        let hash = avatar
            .get("hash")
            .map(|v| v.js_string())
            .filter(|h| !h.is_empty());
        let face = match (&image, &hash) {
            (Some(u), _) => crate::media::Face::Image(u),
            (None, Some(h)) => crate::media::Face::Hash(h),
            (None, None) => crate::media::Face::Icon("user"),
        };
        let fr = Rect::from_center_size(egui::pos2(x + 8.0, r.center().y), egui::vec2(16.0, 16.0));
        crate::media::Avatar::paint_face(cx.ui, &we_style::Style::default(), fr, &face, &rings);
        x += 20.0;
    } else if let Some(icon) = map
        .get("icon")
        .and_then(|v| crate::media::phosphor(&v.js_string()))
    {
        cx.ui.painter().text(
            egui::pos2(x, r.center().y),
            egui::Align2::LEFT_CENTER,
            icon,
            egui::FontId::new(m.icon, egui::FontFamily::Proportional),
            text_color,
        );
        x += m.icon + 4.0;
    }
    cx.ui.painter().text(
        egui::pos2(x, r.center().y),
        egui::Align2::LEFT_CENTER,
        &label,
        egui::FontId::new(m.font, egui::FontFamily::Proportional),
        text_color,
    );
    if marked {
        // `check`, right-aligned — `selected` on an action, `checked` on
        // a toggle (DropdownMenu.solid.tsx:264,287).
        if let Some(glyph) = crate::media::phosphor("check") {
            cx.ui.painter().text(
                egui::pos2(r.max.x - 8.0, r.center().y),
                egui::Align2::RIGHT_CENTER,
                glyph,
                egui::FontId::new(m.icon * 0.8, egui::FontFamily::Proportional),
                visuals.widgets.hovered.fg_stroke.color,
            );
        }
    }
    cx.ui.advance_cursor_after_rect(r);
    if !resp.clicked() {
        return;
    }
    let mut payload = map.clone();
    payload.insert("id".into(), id);
    if toggle {
        // onToggle, then onSelect — `checked` as it was *before* the
        // press — and the menu stays open.
        invoke(map, "onToggle");
        payload.insert("checked".into(), Value::Bool(marked));
        cx.emit(
            &node.id,
            "onSelect",
            events::item(Value::Obj(std::sync::Arc::new(payload))),
        );
    } else {
        // onAction, then onSelect, then `closeMenu` — and the search
        // starts over next time (`setQuery('')` on the way out). The
        // close is the shared popup transition: the flag drops and focus
        // returns to the invoker, like the DOM popover hiding does.
        invoke(map, "onAction");
        cx.emit(
            &node.id,
            "onSelect",
            events::item(Value::Obj(std::sync::Arc::new(payload))),
        );
        cx.edit
            .set_field(&node.id, "menu_query", Value::Str("".into()));
        cx.edit.close_popup(cx.ui.ctx(), &node.id);
    }
}
