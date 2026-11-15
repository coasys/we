//! The frame's theme context is the frame's own: a view without a theme
//! font or a theme id must not inherit the previous frame's on the same
//! egui `Context`.
use std::cell::RefCell;
use std::sync::Arc;

use indexmap::IndexMap;
use we_egui::{layout, paint, EditState, MeasureCx, Registry, StyleCx};
use we_template::{NodeId, ResolvedChild, ResolvedNode};

fn node(ty: &str, id: &str, props: &[(&str, we_expr::Value)]) -> ResolvedNode {
    ResolvedNode {
        id: NodeId::from(id),
        ty: Arc::from(ty),
        props: props
            .iter()
            .map(|(k, v)| (Arc::from(*k), v.clone()))
            .collect::<IndexMap<Arc<str>, we_expr::Value>>(),
        handlers: IndexMap::new(),
        slot: None,
        children: vec![],
        surfaces: Default::default(),
        transition: None,
    }
}

/// What one frame painted: the text runs' families and whether the switch
/// thumb was the round (non-retro) knob.
#[derive(Clone, Default, Debug)]
struct Seen {
    families: Vec<egui::FontFamily>,
    round_thumb: bool,
}

#[test]
fn a_themeless_view_after_retro_keeps_nothing_of_retro() {
    let mut root = node("Column", "c", &[]);
    root.children = vec![
        ResolvedChild::Node(Box::new(node(
            "we-text",
            "c/t",
            &[("text", we_expr::Value::from("HELLO"))],
        ))),
        ResolvedChild::Node(Box::new(node(
            "we-switch",
            "c/s",
            &[("checked", we_expr::Value::Bool(true))],
        ))),
    ];
    let registry = Registry::with_builtins();
    let retro = we_style::TokenTable::new(
        [(
            Arc::<str>::from("--we-font-family"),
            Arc::<str>::from("'VT323', monospace"),
        )]
        .into_iter()
        .collect(),
    );
    let frames = RefCell::new(Vec::<Seen>::new());
    let mut harness = egui_kittest::Harness::new_ui(|ui| {
        let ctx = ui.ctx().clone();
        we_egui::install_media(&ctx);
        // Two retro frames, then the plain view on the same Context.
        let n = frames.borrow().len();
        let mut scx = StyleCx::empty();
        if n < 2 {
            scx.tokens = &retro;
            scx.theme = "retro";
        }
        let lay = layout(
            &MeasureCx::new(&ctx),
            &scx,
            &registry,
            &root,
            egui::Rect::from_min_size(ui.cursor().min, egui::vec2(400.0, 600.0)),
        );
        let mut events = Vec::new();
        let mut edit = EditState::default();
        paint(
            ui,
            &registry,
            &scx,
            &root,
            &lay,
            &mut events,
            &mut edit,
            0.0,
        );
        let layer = ui.layer_id();
        let seen = ctx.graphics(|g| {
            let mut seen = Seen::default();
            if let Some(list) = g.get(layer) {
                for cs in list.all_entries() {
                    match &cs.shape {
                        egui::Shape::Text(t) => seen.families.extend(
                            t.galley
                                .job
                                .sections
                                .iter()
                                .map(|s| s.format.font_id.family.clone()),
                        ),
                        egui::Shape::Circle(_) => seen.round_thumb = true,
                        _ => {}
                    }
                }
            }
            seen
        });
        frames.borrow_mut().push(seen);
    });
    harness.run_steps(4);
    drop(harness);
    let frames = frames.into_inner();
    let vt = |s: &Seen| {
        s.families
            .iter()
            .any(|f| matches!(f, egui::FontFamily::Name(n) if n.starts_with("VT323")))
    };
    assert!(vt(&frames[1]), "retro frame is in VT323: {:?}", frames[1]);
    assert!(
        !frames[1].round_thumb,
        "retro frame has the square bevelled thumb"
    );
    let last = frames.last().expect("frames ran");
    assert!(!vt(last), "the plain view has no VT323: {last:?}");
    assert!(
        last.round_thumb,
        "the plain view's switch has no retro bevel"
    );
}
