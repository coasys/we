//! The agent chat panel: a list, a transcript, and an input.
//! No executor. A bound [`we_data::chat::MemoryChat`] stands in for the
//! session a web We client already started.
use std::sync::{Arc, Mutex};

use egui_kittest::kittest::Queryable;
use indexmap::IndexMap;
use we_data::chat::{ChatAccess, ChatAuthority, ChatModel, MemoryChat};
use we_egui::{bind_chat, layout, paint, MeasureCx, Registry, StyleCx};
use we_expr::Value;
use we_template::{NodeId, ResolvedNode};

const SPACE_A: &str = "a1a2a3a4-b1b2-c3c4-d5d6-e7e8e9f0a1b2";
const SPACE_B: &str = "b1b2b3b4-c1c2-d3d4-e5e6-f7f8f9a0b1c2";

struct ClearChat;
impl Drop for ClearChat {
    fn drop(&mut self) {
        bind_chat(None);
    }
}

fn node(ty: &str, id: &str) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from(id),
        ty: Arc::from(ty),
        props: IndexMap::new(),
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        surfaces: Default::default(),
        transition: None,
    }
}

fn inputs(pairs: &[(&str, &str)]) -> Value {
    let mut map = IndexMap::new();
    for (key, value) in pairs {
        map.insert(Arc::from(*key), Value::Str(Arc::from(*value)));
    }
    Value::Obj(Arc::new(map))
}

fn panel(model: Option<Arc<Mutex<ChatModel>>>) -> egui_kittest::Harness<'static> {
    panel_with(model, None)
}

fn panel_with(
    model: Option<Arc<Mutex<ChatModel>>>,
    fields: Option<Value>,
) -> egui_kittest::Harness<'static> {
    let registry = Registry::with_builtins();
    let mut root = node("AgentChat", "chat");
    if let Some(fields) = fields {
        root.props.insert(Arc::from("inputs"), fields);
    }
    egui_kittest::Harness::builder()
        .with_size(egui::vec2(420.0, 640.0))
        .allow_missing_glyphs()
        .build_ui(move |ui| {
            bind_chat(model.clone());
            let _clear = ClearChat;
            let ctx = ui.ctx().clone();
            we_egui::install_media(&ctx);
            let scx = StyleCx::empty();
            let lay = layout(
                &MeasureCx::new(&ctx),
                &scx,
                &registry,
                &root,
                egui::Rect::from_min_size(ui.cursor().min, egui::vec2(400.0, 600.0)),
            );
            let mut events = Vec::new();
            let mut edit = we_egui::EditState::default();
            paint(
                ui,
                &registry,
                &scx,
                &root,
                &lay,
                &mut events,
                &mut edit,
                1_000.0,
            );
        })
}

fn settle(h: &mut egui_kittest::Harness<'static>) {
    h.step();
    h.run();
}

#[test]
fn agent_chat_panel_continues_and_sends() {
    let _clear = ClearChat;
    let mem = Arc::new(Mutex::new(MemoryChat::new()));
    mem.lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .seed(
            "web-1",
            "From the web",
            2,
            "hello from web",
            "hello from the web app",
        );
    let model = Arc::new(Mutex::new(ChatModel::new(Box::new(mem.clone()))));
    let mut h = panel(Some(model));
    h.run();
    h.get_by_label("From the web").click();
    settle(&mut h);
    h.get_by_label("hello from web");
    h.get_by_label("hello from the web app");
    h.get_by_role(egui::accesskit::Role::TextInput).click();
    h.get_by_role(egui::accesskit::Role::TextInput)
        .type_text("and from rust");
    settle(&mut h);
    h.get_by_label("Send").click();
    settle(&mut h);
    h.get_by_label("Stop");
    h.get_by_label("Working…");
    assert!(h.query_by_label("Send").is_none());
    {
        let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
        assert_eq!(
            guard.sends,
            vec![("web-1".to_string(), "and from rust".to_string())]
        );
        assert_eq!(guard.session_count(), 1);
        assert_eq!(guard.creates, 0);
    }
    h.get_by_label("Stop").click();
    settle(&mut h);
    assert!(h.query_by_label("Stop").is_none());
    h.get_by_role(egui::accesskit::Role::TextInput).click();
    h.get_by_role(egui::accesskit::Role::TextInput)
        .type_text("second line");
    settle(&mut h);
    h.key_press(egui::Key::Enter);
    settle(&mut h);
    let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
    assert_eq!(
        guard.sends,
        vec![
            ("web-1".to_string(), "and from rust".to_string()),
            ("web-1".to_string(), "second line".to_string()),
        ]
    );
}

#[test]
fn agent_chat_panel_unwired() {
    let _clear = ClearChat;
    let mut h = panel(None);
    h.run();
    h.get_by_label("No AI sessions");
    h.get_by_label("The Rust client has no AI session API yet.");
    assert!(h.query_by_label("Send").is_none());
}

#[test]
fn a_template_perspective_does_not_change_the_scope() {
    let _clear = ClearChat;
    let mem = Arc::new(Mutex::new(MemoryChat::new()));
    let model = Arc::new(Mutex::new(ChatModel::bound(
        Box::new(mem.clone()),
        ChatAuthority::space(SPACE_A, Some("Garden".to_string()), ChatAccess::Write),
    )));
    let mut h = panel_with(
        Some(model.clone()),
        Some(inputs(&[
            ("perspectiveUuid", SPACE_B),
            ("prefill", "from the template"),
        ])),
    );
    h.run();
    h.get_by_label("Send").click();
    settle(&mut h);
    {
        let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
        assert_eq!(guard.created, vec![Some(SPACE_A.to_string())]);
        assert_eq!(
            guard.sends,
            vec![("sess-1".to_string(), "from the template".to_string())]
        );
    }

    let mem = Arc::new(Mutex::new(MemoryChat::new()));
    let model = Arc::new(Mutex::new(ChatModel::bound(
        Box::new(mem.clone()),
        ChatAuthority::space(SPACE_A, Some("Garden".to_string()), ChatAccess::Write),
    )));
    let mut omitted = panel_with(Some(model.clone()), None);
    omitted.run();
    omitted
        .get_by_role(egui::accesskit::Role::TextInput)
        .click();
    omitted
        .get_by_role(egui::accesskit::Role::TextInput)
        .type_text("omitted scope");
    settle(&mut omitted);
    omitted.get_by_label("Send").click();
    settle(&mut omitted);
    omitted.get_by_label("Stop").click();
    settle(&mut omitted);
    let mut forged = panel_with(Some(model), Some(inputs(&[("perspectiveUuid", SPACE_B)])));
    forged.run();
    forged.get_by_role(egui::accesskit::Role::TextInput).click();
    forged
        .get_by_role(egui::accesskit::Role::TextInput)
        .type_text("still garden");
    settle(&mut forged);
    forged.get_by_label("Send").click();
    settle(&mut forged);
    let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
    assert_eq!(guard.creates, 1);
    assert_eq!(guard.created, vec![Some(SPACE_A.to_string())]);
    assert_eq!(
        guard.sends,
        vec![
            ("sess-1".to_string(), "omitted scope".to_string()),
            ("sess-1".to_string(), "still garden".to_string()),
        ]
    );
}
