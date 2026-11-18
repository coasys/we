//! Select and open on the content graph, headless.
//!
//! The node is the coasys fixture's "Weekly sync" collection. The click
//! payload carries `recordId` and `recordType`, the same fields the
//! template panel reads. Open emits `onNodeDoubleClick`. Zoom in moves
//! the camera label from 100% to 125%.
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use egui_kittest::kittest::Queryable;
use indexmap::IndexMap;
use we_egui::{install_coasys_fixture, layout, paint, EditState, MeasureCx, Registry, StyleCx};
use we_expr::Value;
use we_template::{NodeId, ResolvedNode};

type Shared = Rc<RefCell<Vec<we_egui::WidgetEvent>>>;

fn s(v: &str) -> Value {
    Value::from(v)
}

fn n(v: f64) -> Value {
    Value::from(v)
}

fn obj(pairs: &[(&str, Value)]) -> Value {
    Value::from(
        pairs
            .iter()
            .map(|(k, v)| (Arc::<str>::from(*k), v.clone()))
            .collect::<IndexMap<Arc<str>, Value>>(),
    )
}

fn list(items: Vec<Value>) -> Value {
    Value::List(Arc::new(items))
}

fn content_node() -> ResolvedNode {
    // The content view from GraphView/index.ts. Layout is the view's
    // default force distance, not a layout invented for the test.
    let mut node = ResolvedNode {
        id: NodeId::from("graph"),
        ty: Arc::from("GraphView"),
        props: IndexMap::new(),
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        surfaces: Default::default(),
        transition: None,
    };
    let props = [
        (
            "seeds",
            obj(&[
                ("source", s("query")),
                (
                    "options",
                    obj(&[("entity", s("CollectionBlock")), ("limit", n(30.0))]),
                ),
            ]),
        ),
        (
            "expansion",
            obj(&[
                ("defaultDepth", n(1.0)),
                ("direction", s("out")),
                ("expanders", list(vec![s("collection")])),
                ("maxNodes", n(400.0)),
            ]),
        ),
        (
            "layout",
            obj(&[
                ("type", s("force")),
                ("options", obj(&[("distance", n(130.0))])),
            ]),
        ),
    ];
    for (k, v) in props {
        node.props.insert(Arc::from(k), v);
    }
    node
}

fn render(root: ResolvedNode) -> (egui_kittest::Harness<'static>, Shared) {
    let registry = Registry::with_builtins();
    let state: Shared = Rc::new(RefCell::new(Vec::new()));
    let state2 = state.clone();
    // The default harness is 800×600. A 900×700 graph sticks out of it,
    // and a click on a node centre outside the screen never lands.
    let harness = egui_kittest::Harness::builder()
        .with_size(egui::vec2(960.0, 720.0))
        .build_ui(move |ui| {
            let ctx = ui.ctx().clone();
            install_coasys_fixture(&ctx);
            we_egui::install_media(&ctx);
            let scx = StyleCx::empty();
            let lay = layout(&MeasureCx::new(&ctx), &scx, &registry, &root, ui.max_rect());
            let events = &mut *state2.borrow_mut();
            let mut edit = EditState::default();
            paint(ui, &registry, &scx, &root, &lay, events, &mut edit, 1_000.0);
        });
    (harness, state)
}

fn str_field(value: &Value, key: &str) -> String {
    match value {
        Value::Obj(map) => map.get(key).map(Value::js_string).unwrap_or_default(),
        _ => String::new(),
    }
}

#[test]
fn content_select_open_and_zoom() {
    let (mut h, state) = render(content_node());
    h.run();
    h.get_by_label("zoom 100%");
    h.get_by_label("Weekly sync").click();
    h.run();
    let click = state
        .borrow()
        .iter()
        .find(|e| e.handler.as_ref() == "onNodeClick")
        .cloned()
        .expect("onNodeClick");
    assert_eq!(click.node.as_str(), "graph");
    assert_eq!(
        str_field(&click.value, "recordId"),
        "coasys-call-weekly-sync"
    );
    assert_eq!(str_field(&click.value, "recordType"), "CollectionBlock");
    assert_eq!(str_field(&click.value, "type"), "CollectionBlock");
    assert_eq!(str_field(&click.value, "label"), "Weekly sync");

    h.get_by_label("Open").click();
    h.run();
    let open = state
        .borrow()
        .iter()
        .find(|e| e.handler.as_ref() == "onNodeDoubleClick")
        .cloned()
        .expect("onNodeDoubleClick");
    assert_eq!(
        str_field(&open.value, "recordId"),
        "coasys-call-weekly-sync"
    );
    assert_eq!(str_field(&open.value, "recordType"), "CollectionBlock");

    h.get_by_label("Zoom in").click();
    h.run();
    h.get_by_label("zoom 125%");
}
