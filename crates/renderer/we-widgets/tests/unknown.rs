//! The unknown-widget fallback: a type the registry does not know paints a
//! red box labelled with the type name — and its children still paint.
use std::sync::Arc;

use indexmap::IndexMap;
use we_template::{NodeId, ResolvedChild, ResolvedNode};
use we_widgets::{MeasureCx, PaintCx, Registry, Size, Widget, WidgetEvent, WidgetKind};

struct Stub;

impl Widget for Stub {
    fn type_name(&self) -> &'static str {
        "Stub"
    }
    fn kind(&self) -> WidgetKind {
        WidgetKind::Leaf
    }
    fn measure(
        &self,
        _cx: &MeasureCx,
        _node: &ResolvedNode,
        _s: &we_style::Style,
        a: Size,
    ) -> Size {
        Size::new(a.x.min(40.0), 10.0)
    }
    fn paint(&self, cx: &mut PaintCx, node: &ResolvedNode, _s: &we_style::Style, rect: egui::Rect) {
        cx.emit(&node.id, "onClick", we_expr::Value::Null);
        cx.label(rect, "stub");
    }
}

fn node(ty: &str) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from("n"),
        ty: Arc::from(ty),
        props: IndexMap::new(),
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        transition: None,
    }
}

#[test]
fn registry_returns_fallback_for_unknown_types() {
    let reg = Registry::empty().with(Stub);
    assert_eq!(reg.widget_for("Stub").type_name(), "Stub");
    assert_eq!(
        reg.widget_for("we-does-not-exist").type_name(),
        "__unknown__"
    );
    assert_eq!(
        reg.widget_for("we-does-not-exist").kind(),
        WidgetKind::Container
    );
}

#[test]
fn events_flow_through_paint_cx() {
    // PaintCx is what carries widget-reported input back to the frame; emit
    // must reach the drained event list.
    let mut harness = egui_kittest::Harness::new_ui(move |ui| {
        let mut events: Vec<WidgetEvent> = Vec::new();
        {
            let parts = we_widgets::Parts::new();
            let mut edit = we_widgets::EditState::default();
            let mut cx = PaintCx::new(ui, &mut events, &parts, &mut edit, 0.0, &[]);
            let stub = Stub;
            stub.paint(
                &mut cx,
                &node("Stub"),
                &we_style::Style::empty(),
                egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(40.0, 10.0)),
            );
        }
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].handler.as_ref(), "onClick");
    });
    harness.run();
}

#[test]
fn unknown_node_children_are_present() {
    // The box is a container: a child's ResolvedChild survives in the tree.
    let mut child = node("we-icon");
    child.id = NodeId::from("n/0");
    let mut n = node("we-does-not-exist");
    n.children = vec![ResolvedChild::Node(Box::new(child))];
    let reg = Registry::empty();
    let w = reg.widget_for(&n.ty);
    assert_eq!(w.type_name(), "__unknown__");
    assert!(matches!(&n.children[0], ResolvedChild::Node(c) if c.ty.as_ref() == "we-icon"));
}
