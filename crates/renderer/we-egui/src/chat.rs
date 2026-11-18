//! The agent chat panel. A message list and an input over a [`we_data::chat::ChatPort`].
//!
//! The widget does not touch a store and does not call the executor. The
//! frame binds a [`we_data::chat::ChatModel`] for the paint
//! ([`bind_chat`]) and clears it after. No bind means the panel says the
//! Rust client has no AI session API. The connected window binds the live
//! port. An offline frame stays unbound. `AgentChatSheet` stays the closed
//! sheet. This widget replaces only the `AgentChat` placeholder.
use std::cell::RefCell;
use std::sync::{Arc, Mutex};

use we_data::chat::{
    ask_before, refusal_of, refusal_sentence, reply_running, unfinished_words, ChatModel,
    ReplyStatus, TurnRole,
};
use we_expr::Value;
use we_style::Style;
use we_template::{NodeId, ResolvedNode};

use crate::{MeasureCx, PaintCx, Rect, Size, Widget, WidgetKind};

thread_local! {
    static BOUND: RefCell<Option<Arc<Mutex<ChatModel>>>> = const { RefCell::new(None) };
}

/// Bind the chat model for the paints on this thread. `None` clears it.
/// A test clears it with a `Drop` guard so a panic cannot leave the model
/// on a thread the next test reuses.
pub fn bind_chat(model: Option<Arc<Mutex<ChatModel>>>) {
    BOUND.with(|slot| *slot.borrow_mut() = model);
}

fn bound_chat() -> Option<Arc<Mutex<ChatModel>>> {
    BOUND.with(|slot| slot.borrow().clone())
}

/// The message list and the input.
pub struct AgentChat;

impl Widget for AgentChat {
    fn type_name(&self) -> &'static str {
        "AgentChat"
    }

    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }

    fn measure(&self, _cx: &MeasureCx, _node: &ResolvedNode, _style: &Style, avail: Size) -> Size {
        let width = if avail.x.is_finite() {
            avail.x.max(0.0)
        } else {
            360.0
        };
        let height = if avail.y.is_finite() {
            avail.y.max(0.0)
        } else {
            480.0
        };
        Size::new(width, height)
    }

    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _style: &Style, rect: Rect) {
        cx.ui
            .painter()
            .rect_filled(rect, 0.0, cx.ui.visuals().extreme_bg_color);
        let Some(model) = bound_chat() else {
            stamp(
                cx,
                band(rect, rect.top() + 12.0, 22.0),
                "No AI sessions",
                false,
            );
            stamp(
                cx,
                band(rect, rect.top() + 36.0, 40.0),
                "The Rust client has no AI session API yet.",
                true,
            );
            return;
        };
        let (space_uuid, space_name, prefill) = inputs_of(node);
        let view = {
            let mut guard = model.lock().unwrap_or_else(|poison| poison.into_inner());
            guard.set_space(space_uuid, space_name);
            if let Some(text) = prefill {
                guard.prefill_once(text);
            }
            // Drain `ai-session-changed` before the frame reads the view.
            guard.follow();
            guard.view.clone()
        };
        // The next paint drains the next event. A delay, so a running reply
        // does not pin the headless harness to an immediate repaint.
        cx.ui
            .ctx()
            .request_repaint_after(std::time::Duration::from_millis(200));
        if view.unavailable.is_some() {
            paint_unavailable(cx, rect, view.unavailable.as_deref().unwrap_or(""));
            return;
        }
        let mut draft = view.draft.clone();
        let mut act = Act::None;
        paint_chrome(cx, node, rect, &view, &mut act);
        let input_top = rect.bottom() - 44.0;
        paint_body(cx, node, rect, input_top, &view, &mut act);
        let focus = matches!(act, Act::Focus);
        if focus {
            act = Act::None;
        }
        paint_field(
            cx, node, rect, input_top, &view, &mut draft, &mut act, focus,
        );
        let previous = view.draft.clone();
        let mut guard = model.lock().unwrap_or_else(|poison| poison.into_inner());
        if draft != previous {
            guard.set_draft(draft);
        }
        apply(&mut guard, act);
    }
}

fn paint_unavailable(cx: &mut PaintCx, rect: Rect, detail: &str) {
    stamp(
        cx,
        band(rect, rect.top() + 12.0, 22.0),
        "No AI sessions",
        false,
    );
    stamp(cx, band(rect, rect.top() + 36.0, 44.0), detail, true);
}

fn paint_chrome(
    cx: &mut PaintCx,
    node: &ResolvedNode,
    rect: Rect,
    view: &we_data::chat::ChatView,
    act: &mut Act,
) {
    let top = rect.top() + 8.0;
    let row = band(rect, top, 24.0);
    if view.active.is_some() {
        let back = egui::Rect::from_min_max(row.min, egui::pos2(row.left() + 88.0, row.bottom()));
        if button(cx, &node.id, "back", back, "All chats", true) {
            set(act, Act::Back);
        }
        let title = view
            .active
            .as_ref()
            .map(|active| active.title.as_str())
            .unwrap_or("Chats");
        let title_rect = egui::Rect::from_min_max(
            egui::pos2(row.left() + 92.0, row.top()),
            egui::pos2(row.right() - 96.0, row.bottom()),
        );
        stamp(
            cx,
            title_rect,
            if title.is_empty() { "Chats" } else { title },
            false,
        );
    } else {
        let title_rect =
            egui::Rect::from_min_max(row.min, egui::pos2(row.right() - 96.0, row.bottom()));
        stamp(cx, title_rect, "Chats", false);
    }
    let new_chat = egui::Rect::from_min_max(egui::pos2(row.right() - 88.0, row.top()), row.max);
    if button(cx, &node.id, "new", new_chat, "New chat", true) {
        if view.active.is_some() {
            set(act, Act::Back);
        } else {
            set(act, Act::Focus);
        }
    }
    stamp(cx, band(rect, top + 24.0, 20.0), &badge_text(view), true);
}

fn paint_body(
    cx: &mut PaintCx,
    node: &ResolvedNode,
    rect: Rect,
    input_top: f32,
    view: &we_data::chat::ChatView,
    act: &mut Act,
) {
    let mut y = rect.top() + 56.0;
    if let Some(text) = view.error.as_deref() {
        y = line(cx, rect, y, input_top, text, true);
    }
    if let Some(text) = view.send_failed.as_deref() {
        y = line(cx, rect, y, input_top, text, true);
    }
    if view.active.is_none() {
        if view.summaries.is_empty() {
            line(cx, rect, y, input_top, &empty_title(view), false);
            line(cx, rect, y + 22.0, input_top, empty_body(view), true);
            return;
        }
        for summary in &view.summaries {
            if y + 40.0 > input_top {
                break;
            }
            let row = band(rect, y, 22.0);
            let open =
                egui::Rect::from_min_max(row.min, egui::pos2(row.right() - 120.0, row.bottom()));
            let delete =
                egui::Rect::from_min_max(egui::pos2(row.right() - 112.0, row.top()), row.max);
            let title = if summary.title.is_empty() {
                "Chat"
            } else {
                summary.title.as_str()
            };
            if button(
                cx,
                &node.id,
                &format!("open-{}", summary.id),
                open,
                title,
                true,
            ) {
                set(act, Act::Open(summary.id.clone()));
            }
            let delete_label = format!("Delete {}", summary.title);
            if button(
                cx,
                &node.id,
                &format!("del-{}", summary.id),
                delete,
                &delete_label,
                true,
            ) {
                set(act, Act::Delete(summary.id.clone()));
            }
            y += 22.0;
            let where_text = match summary.scope.as_deref() {
                Some(uuid) => name_for(view, uuid).unwrap_or("A space").to_string(),
                None => "Global".to_string(),
            };
            y = line(cx, rect, y, input_top, &where_text, true);
        }
        return;
    }
    let running = reply_running(&view.messages);
    for message in &view.messages {
        if !message.text.is_empty() {
            y = line(
                cx,
                rect,
                y,
                input_top,
                &message.text,
                message.role == TurnRole::Assistant,
            );
        }
        for step in &message.steps {
            let label = if step.wrote {
                format!("{} wrote", step.name)
            } else {
                step.name.clone()
            };
            y = line(cx, rect, y, input_top, &label, true);
        }
        if let Some(words) = unfinished_line(message) {
            y = line(cx, rect, y, input_top, &words, true);
            let question = ask_before(&view.messages, &message.id);
            if !question.is_empty() && y + 22.0 <= input_top {
                let again = band(rect, y, 22.0);
                if button(
                    cx,
                    &node.id,
                    &format!("again-{}", message.id),
                    again,
                    "Send again",
                    !running,
                ) {
                    set(act, Act::Resend(question));
                }
                y += 22.0;
            }
        }
    }
    if running {
        line(cx, rect, y, input_top, "Working…", true);
    }
    let scope = view
        .active
        .as_ref()
        .and_then(|active| active.scope.as_deref());
    if let Some(_raw) = refusal_of(&view.messages, scope) {
        let sentence =
            refusal_sentence(scope.and_then(|uuid| name_for(view, uuid)), scope.is_some());
        line(cx, rect, y + 22.0, input_top, &sentence, false);
    }
}

#[allow(clippy::too_many_arguments)]
fn paint_field(
    cx: &mut PaintCx,
    node: &ResolvedNode,
    rect: Rect,
    input_top: f32,
    view: &we_data::chat::ChatView,
    draft: &mut String,
    act: &mut Act,
    focus: bool,
) {
    let running = reply_running(&view.messages);
    let input_rect = egui::Rect::from_min_max(
        egui::pos2(rect.left() + 8.0, input_top),
        egui::pos2(rect.right() - 80.0, input_top + 32.0),
    );
    let action_rect = egui::Rect::from_min_max(
        egui::pos2(rect.right() - 72.0, input_top),
        egui::pos2(rect.right() - 8.0, input_top + 32.0),
    );
    let mut child = cx.ui.new_child(egui::UiBuilder::new().max_rect(input_rect));
    let hint = placeholder(view);
    let output = egui::TextEdit::singleline(draft)
        .id_salt(("agent-chat-draft", node.id.as_str()))
        .desired_width(input_rect.width().max(1.0))
        .show(&mut child);
    // `hint_text` wants a `'static` atom. The placeholder names the space,
    // so it is painted below and reported here for the accessibility check.
    output.response.widget_info(|| {
        let mut info =
            egui::WidgetInfo::text_edit(true, draft.as_str(), draft.as_str(), hint.as_str());
        // The field has no neighbour label. The placeholder is its name.
        info.label = Some(hint.clone());
        info
    });
    if focus {
        output.response.request_focus();
    }
    // A single-line field surrenders focus on Enter, so `has_focus` is
    // already false. `lost_focus` is how that press still sends.
    let enter = enter_sends(cx);
    let focused = output.response.has_focus();
    let submitted = output.response.lost_focus() && enter;
    drop(output);
    drop(child);
    if draft.is_empty() {
        let placeholder = placeholder(view);
        cx.ui.painter().text(
            input_rect.left_top() + egui::vec2(4.0, 8.0),
            egui::Align2::LEFT_TOP,
            placeholder,
            egui::FontId::proportional(13.0),
            cx.ui.visuals().weak_text_color(),
        );
    }
    // Send and Stop never share the row. Stop wins while a reply runs.
    if running {
        if button(cx, &node.id, "stop", action_rect, "Stop", true) {
            set(act, Act::Cancel);
        }
    } else if button(
        cx,
        &node.id,
        "send",
        action_rect,
        "Send",
        !draft.trim().is_empty(),
    ) && matches!(act, Act::None)
    {
        *act = Act::Send;
    }
    if matches!(act, Act::None) && !running && (submitted || (focused && enter)) {
        *act = Act::Send;
    }
}

fn enter_sends(cx: &PaintCx) -> bool {
    cx.ui.input(|input| {
        let composing = input.events.iter().any(|event| {
            matches!(
                event,
                egui::Event::Ime(egui::ImeEvent::Preedit { text, .. }) if !text.is_empty()
            )
        });
        input.key_pressed(egui::Key::Enter) && !input.modifiers.shift && !composing
    })
}

enum Act {
    None,
    Send,
    Cancel,
    Open(String),
    Back,
    Delete(String),
    Resend(String),
    Focus,
}

fn set(act: &mut Act, next: Act) {
    if matches!(act, Act::None) {
        *act = next;
    }
}

fn apply(model: &mut ChatModel, act: Act) {
    match act {
        Act::None | Act::Focus => {}
        Act::Send => model.send(),
        Act::Cancel => model.cancel(),
        Act::Open(id) => model.open(&id),
        Act::Back => model.back(),
        Act::Delete(id) => model.delete(&id),
        Act::Resend(text) => model.resend(&text),
    }
}

fn inputs_of(node: &ResolvedNode) -> (Option<String>, Option<String>, Option<&str>) {
    let Value::Obj(obj) = crate::props::prop(node, "inputs") else {
        return (None, None, None);
    };
    let string = |key: &str| match obj.get(key) {
        Some(Value::Str(text)) if !text.is_empty() => Some(text.to_string()),
        _ => None,
    };
    let prefill = match obj.get("prefill") {
        Some(Value::Str(text)) if !text.is_empty() => Some(text.as_ref()),
        _ => None,
    };
    (string("perspectiveUuid"), string("spaceName"), prefill)
}

fn badge_text(view: &we_data::chat::ChatView) -> String {
    let scope = match &view.active {
        Some(active) => active.scope.as_deref(),
        None => view.space_uuid.as_deref(),
    };
    match scope {
        Some(uuid) => match name_for(view, uuid) {
            Some(name) => format!("this space only · {name}"),
            None => "this space only".to_string(),
        },
        None => "All your spaces".to_string(),
    }
}

fn name_for<'a>(view: &'a we_data::chat::ChatView, uuid: &str) -> Option<&'a str> {
    if view.space_uuid.as_deref() == Some(uuid) {
        view.space_name.as_deref()
    } else {
        None
    }
}

fn placeholder(view: &we_data::chat::ChatView) -> String {
    if view.space_uuid.is_none() {
        return "Ask about any space…".to_string();
    }
    let name = view
        .space_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("this space");
    format!("Ask {name}…")
}

fn empty_title(view: &we_data::chat::ChatView) -> String {
    if view.space_uuid.is_none() {
        return "Ask about any of your spaces".to_string();
    }
    match view
        .space_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        Some(name) => format!("Ask about the {name} space"),
        None => "Ask about this space".to_string(),
    }
}

fn empty_body(view: &we_data::chat::ChatView) -> &'static str {
    if view.space_uuid.is_some() {
        "It acts as you in this space only. You see each step and can stop it."
    } else {
        "It acts as you, in all your spaces. You see each step and can stop it."
    }
}

fn unfinished_line(message: &we_data::chat::ChatTurn) -> Option<String> {
    let status = message.status?;
    if matches!(status, ReplyStatus::Done | ReplyStatus::Running) {
        return None;
    }
    let words = unfinished_words(status)?;
    if message.refused {
        return Some(words.to_string());
    }
    match &message.error {
        Some(error) => Some(format!("{words}: {error}")),
        None => Some(words.to_string()),
    }
}

fn band(rect: Rect, y: f32, height: f32) -> Rect {
    egui::Rect::from_min_max(
        egui::pos2(rect.left() + 8.0, y),
        egui::pos2(rect.right() - 8.0, y + height),
    )
}

fn line(cx: &mut PaintCx, rect: Rect, y: f32, limit: f32, text: &str, weak: bool) -> f32 {
    if y + 22.0 > limit {
        return y;
    }
    stamp(cx, band(rect, y, 22.0), text, weak);
    y + 22.0
}

fn stamp(cx: &mut PaintCx, rect: Rect, text: &str, weak: bool) {
    if text.is_empty() || rect.height() <= 0.0 {
        return;
    }
    let color = if weak {
        cx.ui.visuals().weak_text_color()
    } else {
        cx.ui.visuals().text_color()
    };
    cx.ui.painter().text(
        rect.left_top() + egui::vec2(4.0, 3.0),
        egui::Align2::LEFT_TOP,
        text,
        egui::FontId::proportional(13.0),
        color,
    );
    cx.label(rect, text);
}

fn button(
    cx: &mut PaintCx,
    node: &NodeId,
    part: &str,
    rect: Rect,
    text: &str,
    enabled: bool,
) -> bool {
    let response = cx.interact_label(rect, text, egui::Role::Button, node, part, enabled, None);
    let color = if enabled {
        cx.ui.visuals().text_color()
    } else {
        cx.ui.visuals().weak_text_color()
    };
    cx.ui.painter().text(
        rect.left_top() + egui::vec2(4.0, 3.0),
        egui::Align2::LEFT_TOP,
        text,
        egui::FontId::proportional(13.0),
        color,
    );
    enabled && response.clicked()
}
