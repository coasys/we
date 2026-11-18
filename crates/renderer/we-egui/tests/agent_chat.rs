//! The agent chat panel: a list, a transcript, and an input.
//! No executor. A bound [`we_data::chat::MemoryChat`] stands in for the
//! session a web We client already started.
use std::sync::{Arc, Mutex};

use egui_kittest::kittest::Queryable;
use indexmap::IndexMap;
use we_data::chat::{ChatModel, MemoryChat};
use we_egui::{bind_chat, layout, paint, MeasureCx, Registry, StyleCx};
use we_template::{NodeId, ResolvedNode};

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

fn panel(model: Option<Arc<Mutex<ChatModel>>>) -> egui_kittest::Harness<'static> {
    let registry = Registry::with_builtins();
    let root = node("AgentChat", "chat");
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
