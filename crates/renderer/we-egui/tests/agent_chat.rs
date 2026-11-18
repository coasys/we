//! The agent chat panel: a list, a transcript, and an input.
//! No executor. A bound [`we_data::chat::MemoryChat`] stands in for the
//! session a web We client already started.
use std::sync::{Arc, Mutex};

use egui_kittest::kittest::Queryable;
use indexmap::IndexMap;

use we_data::chat::{ChatAccess, ChatAuthority, ChatModel, MemoryChat};
use we_egui::{bind_chat, layout, paint, MeasureCx, Registry, StyleCx};
use we_expr::Value;
use we_template::{AppSpec, LocalState, NodeId, ResolvedChild, ResolvedNode, Runtime, StoreBag};

const SPACE_A: &str = "a1a2a3a4-b1b2-c3c4-d5d6-e7e8e9f0a1b2";
const SPACE_B: &str = "b1b2b3b4-c1c2-d3d4-e5e6-f7f8f9a0b1c2";

struct ClearChat;
impl Drop for ClearChat {
    fn drop(&mut self) {
        bind_chat(None);
        we_template::bind_chat_mount(None);
        we_template::clear_chat_origins();
    }
}

/// The hand-built harness node is the app chrome. A test stamps it.
fn allow_host_chat(id: &str) {
    we_template::bind_chat_mount(Some(we_template::ChatMount::new("app", 1)));
    we_template::clear_chat_origins();
    we_template::stamp_chat_origin(
        NodeId::from(id),
        we_template::ChatOrigin {
            mount: we_template::MountId::from("app"),
            tier: we_template::Tier::App,
            generation: 1,
        },
    );
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
            allow_host_chat("chat");
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

fn panel_resolved(
    model: Arc<Mutex<ChatModel>>,
    node: ResolvedNode,
    origins: std::collections::HashMap<NodeId, we_template::ChatOrigin>,
    generation: Option<u64>,
) -> egui_kittest::Harness<'static> {
    let registry = Registry::with_builtins();
    egui_kittest::Harness::builder()
        .with_size(egui::vec2(420.0, 640.0))
        .allow_missing_glyphs()
        .build_ui(move |ui| {
            match generation {
                Some(generation) => we_template::bind_chat_mount(Some(
                    we_template::ChatMount::new("app", generation),
                )),
                None => we_template::bind_chat_mount(None),
            }
            we_template::publish_chat_origins(&origins);
            bind_chat(Some(model.clone()));
            let _clear = ClearChat;
            let ctx = ui.ctx().clone();
            we_egui::install_media(&ctx);
            let scx = StyleCx::empty();
            let lay = layout(
                &MeasureCx::new(&ctx),
                &scx,
                &registry,
                &node,
                egui::Rect::from_min_size(ui.cursor().min, egui::vec2(400.0, 600.0)),
            );
            let mut events = Vec::new();
            let mut edit = we_egui::EditState::default();
            paint(
                ui,
                &registry,
                &scx,
                &node,
                &lay,
                &mut events,
                &mut edit,
                1_000.0,
            );
        })
}

fn agent_nodes(node: &ResolvedNode, out: &mut Vec<ResolvedNode>) {
    if node.ty.as_ref() == "AgentChat" {
        out.push(node.clone());
    }
    for child in &node.children {
        if let ResolvedChild::Node(child) = child {
            agent_nodes(child, out);
        }
    }
}

/// Chrome and the space template each carry an AgentChat. The route is a space.
/// The live mount is `app` at generation 1, bound before the resolve so the
/// stamps carry that generation.
fn both_chats() -> (
    Vec<ResolvedNode>,
    std::collections::HashMap<NodeId, we_template::ChatOrigin>,
) {
    we_template::bind_chat_mount(Some(we_template::ChatMount::new("app", 1)));
    let app: we_template::BundleTemplate = serde_json::from_value(serde_json::json!({
        "id": "app",
        "meta": { "role": "app" },
        "type": "AgentChat"
    }))
    .expect("app template");
    let template: we_template::BundleTemplate = serde_json::from_value(serde_json::json!({
        "id": "space",
        "meta": {},
        "type": "AgentChat"
    }))
    .expect("space template");
    let spec = AppSpec {
        bundle: Arc::from("coasys"),
        app: Some(app),
        template: Some(template),
        pages: Vec::new(),
        boot: None,
    };
    let mut runtime = Runtime::app(spec, Arc::new(StoreBag::new()), LocalState::new());
    let tree = runtime.frame_at(&format!("/space/{SPACE_A}"));
    let origins = runtime.chat_origins().clone();
    let mut nodes = Vec::new();
    agent_nodes(&tree, &mut nodes);
    (nodes, origins)
}

fn type_and_send(h: &mut egui_kittest::Harness<'static>, text: &str) {
    h.run();
    h.get_by_role(egui::accesskit::Role::TextInput).click();
    h.get_by_role(egui::accesskit::Role::TextInput)
        .type_text(text);
    settle(h);
    h.get_by_label("Send").click();
    settle(h);
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

/// A space template's AgentChat and the app chrome share one frame.
/// The space node's Send and Delete do not call the port. The app node's
/// do. A stale generation and an unbound mount do not. The model is writable.
#[test]
fn a_space_template_chat_intent_is_refused() {
    let _clear = ClearChat;
    let (nodes, origins) = both_chats();
    assert_eq!(
        nodes.len(),
        2,
        "{:?}",
        nodes
            .iter()
            .map(|node| node.id.as_str())
            .collect::<Vec<_>>()
    );
    let space = nodes
        .iter()
        .find(|node| node.id.as_str().starts_with("space"))
        .unwrap_or_else(|| {
            panic!(
                "space AgentChat missing: {:?}",
                nodes
                    .iter()
                    .map(|node| node.id.as_str())
                    .collect::<Vec<_>>()
            )
        })
        .clone();
    let app = nodes
        .iter()
        .find(|node| node.id.as_str().starts_with("app"))
        .unwrap_or_else(|| {
            panic!(
                "app AgentChat missing: {:?}",
                nodes
                    .iter()
                    .map(|node| node.id.as_str())
                    .collect::<Vec<_>>()
            )
        })
        .clone();
    let space_origin = origins.get(&space.id).expect("space origin");
    assert_eq!(space_origin.tier, we_template::Tier::Space);
    assert_eq!(space_origin.mount.as_str(), "space");
    let app_origin = origins.get(&app.id).expect("app origin");
    assert_eq!(app_origin.tier, we_template::Tier::App);
    assert_eq!(app_origin.mount.as_str(), "app");
    assert_eq!(app_origin.generation, 1);

    let mem = Arc::new(Mutex::new(MemoryChat::new()));
    mem.lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .seed("web-1", "From the web", 2, "hello from web", "kept");
    let model = Arc::new(Mutex::new(ChatModel::new(Box::new(mem.clone()))));
    let mut space_panel = panel_resolved(model, space.clone(), origins.clone(), Some(1));
    space_panel.run();
    space_panel.get_by_label("Delete From the web").click();
    settle(&mut space_panel);
    type_and_send(&mut space_panel, "from the space template");
    {
        let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
        assert_eq!(guard.creates, 0);
        assert!(guard.sends.is_empty(), "{:?}", guard.sends);
        assert_eq!(guard.cancels, 0);
        assert_eq!(guard.deletes, 0);
        assert_eq!(guard.session_count(), 1);
    }

    let mem = Arc::new(Mutex::new(MemoryChat::new()));
    let model = Arc::new(Mutex::new(ChatModel::new(Box::new(mem.clone()))));
    let mut app_panel = panel_resolved(model, app.clone(), origins.clone(), Some(1));
    type_and_send(&mut app_panel, "from the app");
    app_panel.get_by_label("Stop").click();
    settle(&mut app_panel);
    {
        let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
        assert_eq!(guard.creates, 1);
        assert_eq!(guard.sends.len(), 1);
        assert_eq!(guard.cancels, 1);
        assert_eq!(guard.deletes, 0);
    }

    let mem = Arc::new(Mutex::new(MemoryChat::new()));
    let model = Arc::new(Mutex::new(ChatModel::new(Box::new(mem.clone()))));
    let mut stale = panel_resolved(model, app.clone(), origins.clone(), Some(2));
    type_and_send(&mut stale, "stale generation");
    {
        let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
        assert_eq!(guard.creates, 0);
        assert!(guard.sends.is_empty(), "{:?}", guard.sends);
    }

    let mem = Arc::new(Mutex::new(MemoryChat::new()));
    let model = Arc::new(Mutex::new(ChatModel::new(Box::new(mem.clone()))));
    let mut unbound = panel_resolved(model, app, origins, None);
    type_and_send(&mut unbound, "no mount");
    let guard = mem.lock().unwrap_or_else(|poison| poison.into_inner());
    assert_eq!(guard.creates, 0);
    assert!(guard.sends.is_empty(), "{:?}", guard.sends);
    assert_eq!(guard.cancels, 0);
    assert_eq!(guard.deletes, 0);
}
