//! Pointer interaction with the whole Coasys app at the `people` route under
//! the glow theme — what `we-app --coasys people --theme glow` opens:
//!
//! - a home lane's resize handle sits on the edge the template names
//!   (`resize: "end"` → right, `"start"` → left), a drag writes the width to
//!   shell state, and the next frame's layout has it;
//! - the rail (`position: fixed`, `zIndex: "chrome"`) paints over the main
//!   view when hover expands it, and the pointer over the overlap stays the
//!   rail's.

#[path = "support/gpu.rs"]
mod gpu;

use egui::{Pos2, Rect, Vec2};
use egui_kittest::Harness;
use we_app::RendererApp;
use we_screen::ScreenOp;
use we_template::{Bundle, ResolvedChild, ResolvedNode};

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));

const W: f32 = 1280.0;
const H: f32 = 800.0;

fn harness(setup: impl FnOnce(&mut RendererApp)) -> Harness<'static, RendererApp> {
    let bundle = Bundle::parse(BUNDLE).unwrap();
    let (mut app, fell_back) = we_app::coasys_app(&bundle, "people", "glow").unwrap();
    assert!(!fell_back, "glow is a recorded theme");
    setup(&mut app);
    let mut harness = Harness::builder()
        .renderer(gpu::serial())
        .with_size(Vec2::new(W, H))
        .with_pixels_per_point(1.0)
        .allow_missing_glyphs()
        .with_context_setup(we_egui::install_media)
        .with_accessibility_check(false)
        .build_ui_state(|ui, app: &mut RendererApp| app.frame_body(ui), app);
    harness.run_steps(6);
    harness
}

fn find<'n>(n: &'n ResolvedNode, pred: &dyn Fn(&ResolvedNode) -> bool) -> Option<&'n ResolvedNode> {
    if pred(n) {
        return Some(n);
    }
    n.children.iter().find_map(|c| match c {
        ResolvedChild::Node(c) => find(c, pred),
        ResolvedChild::Text(_) => None,
    })
}

/// The laid-out rect of the `$lane` named `lane`.
fn lane_rect(harness: &Harness<'_, RendererApp>, lane: &str) -> Rect {
    let app = harness.state();
    let root = app.session.runtime.resolved().expect("resolved").clone();
    let node = find(&root, &|n| {
        n.ty.as_ref() == "$lane"
            && n.props.get("lane").map(|v| v.js_string()).as_deref() == Some(lane)
    })
    .unwrap_or_else(|| panic!("no $lane {lane}"));
    app.layout().expect("laid out").rects[&node.id]
}

fn pointer(harness: &mut Harness<'_, RendererApp>, pos: Pos2, pressed: Option<bool>) {
    harness.event(egui::Event::PointerMoved(pos));
    if let Some(pressed) = pressed {
        harness.event(egui::Event::PointerButton {
            pos,
            button: egui::PointerButton::Primary,
            pressed,
            modifiers: egui::Modifiers::NONE,
        });
    }
    harness.step();
}

/// Press at `from`, move by `dx` in steps, release; then let a frame settle.
fn drag(harness: &mut Harness<'_, RendererApp>, from: Pos2, dx: f32) {
    pointer(harness, from, None);
    pointer(harness, from, Some(true));
    for i in 1..=6 {
        let p = from + Vec2::new(dx * i as f32 / 6.0, 0.0);
        pointer(harness, p, None);
    }
    pointer(harness, from + Vec2::new(dx, 0.0), Some(false));
    harness.run_steps(3);
}

#[test]
fn the_tree_lane_resizes_from_its_end_edge_and_keeps_the_width() {
    let mut h = harness(|_| {});
    let before = lane_rect(&h, "tree");
    assert_eq!(before.width(), 280.0, "the template's width: {before:?}");
    drag(&mut h, Pos2::new(before.max.x, before.center().y), 60.0);
    let after = lane_rect(&h, "tree");
    assert_eq!(after.width(), 340.0, "dragged 60px right: {after:?}");
    assert_eq!(
        h.state().session.screen().shell.lanes["tree"].width,
        Some(340),
        "the dragged width is shell state"
    );
    // Clamped by the template's `minWidth`.
    drag(&mut h, Pos2::new(after.max.x, after.center().y), -400.0);
    assert_eq!(lane_rect(&h, "tree").width(), 220.0);
}

/// The width shell state holds for the lane named `lane`.
fn stored(h: &Harness<'_, RendererApp>, lane: &str) -> Option<u32> {
    h.state()
        .session
        .screen()
        .shell
        .lanes
        .get(lane)
        .and_then(|l| l.width)
}

/// The laid-out rect of the row the lanes sit in.
fn lane_row(harness: &Harness<'_, RendererApp>) -> Rect {
    let app = harness.state();
    let root = app.session.runtime.resolved().expect("resolved").clone();
    let row = find(&root, &|n| {
        n.children
            .iter()
            .any(|c| matches!(c, ResolvedChild::Node(c) if c.ty.as_ref() == "$lane"))
    })
    .expect("the lanes' row");
    app.layout().expect("laid out").rects[&row.id]
}

/// A drag to either extreme stores the clamped width, not the pointer's:
/// no narrower than `minWidth`, no wider than the row less the other lanes
/// and what the main view keeps (`PanelLane.tsx` `measureRoom`/`clamp`).
#[test]
fn a_drag_to_either_extreme_stores_the_clamped_width() {
    let mut h = harness(|_| {});
    let lane = lane_rect(&h, "tree");
    drag(&mut h, Pos2::new(lane.max.x, lane.center().y), -400.0);
    assert_eq!(stored(&h, "tree"), Some(220), "held to minWidth");
    assert_eq!(lane_rect(&h, "tree").width(), 220.0);
    let lane = lane_rect(&h, "tree");
    let room = lane_row(&h).width() - we_egui::LANE_LEAVES_PX;
    drag(&mut h, Pos2::new(lane.max.x, lane.center().y), 2000.0);
    assert_eq!(stored(&h, "tree"), Some(room as u32), "held to the room");
    assert_eq!(lane_rect(&h, "tree").width(), room);
}

/// The inspector opening beside a wide tree takes its width out of the
/// tree's room: the kept width is drawn clamped (and kept, so closing it
/// gives the width back), and a drag with it open stores no more than fits.
#[test]
fn an_open_inspector_narrows_the_room_a_kept_width_is_drawn_in() {
    let mut h = harness(|_| {});
    let lane = lane_rect(&h, "tree");
    drag(&mut h, Pos2::new(lane.max.x, lane.center().y), 500.0);
    assert_eq!(stored(&h, "tree"), Some(780));
    assert_eq!(lane_rect(&h, "tree").width(), 780.0);
    h.state_mut()
        .session
        .apply_screen(ScreenOp::OpenTemplatePanel {
            id: "inspector".into(),
        });
    h.run_steps(4);
    let inspector = lane_rect(&h, "inspector");
    assert_eq!(inspector.width(), 340.0, "{inspector:?}");
    let room = lane_row(&h).width() - inspector.width() - we_egui::LANE_LEAVES_PX;
    let tree = lane_rect(&h, "tree");
    assert_eq!(tree.width(), room, "drawn clamped: {tree:?}");
    assert_eq!(stored(&h, "tree"), Some(780), "the kept width stays");
    assert!(tree.max.x <= inspector.min.x, "{tree:?} {inspector:?}");
    drag(&mut h, Pos2::new(tree.max.x, tree.center().y), 300.0);
    assert_eq!(stored(&h, "tree"), Some(room as u32), "held to the room");
}

/// A window made narrower clamps a kept width as it is laid out.
#[test]
fn a_narrower_window_clamps_a_kept_width() {
    let mut h = harness(|_| {});
    let lane = lane_rect(&h, "tree");
    drag(&mut h, Pos2::new(lane.max.x, lane.center().y), 320.0);
    assert_eq!(stored(&h, "tree"), Some(600));
    h.set_size(Vec2::new(900.0, H));
    h.run_steps(4);
    let room = lane_row(&h).width() - we_egui::LANE_LEAVES_PX;
    assert!(room < 600.0, "the narrow row has less room: {room}");
    assert_eq!(lane_rect(&h, "tree").width(), room);
    assert_eq!(stored(&h, "tree"), Some(600), "the kept width stays");
}

/// A slow frame: the release and a move well past it arrive in one frame.
/// The width is where the button went up, not where the pointer went next.
#[test]
fn a_release_in_a_slow_frame_keeps_the_width_it_was_let_go_at() {
    let mut h = harness(|_| {});
    let lane = lane_rect(&h, "tree");
    let from = Pos2::new(lane.max.x, lane.center().y);
    pointer(&mut h, from, None);
    pointer(&mut h, from, Some(true));
    pointer(&mut h, from + Vec2::new(20.0, 0.0), None);
    let at = from + Vec2::new(40.0, 0.0);
    h.event(egui::Event::PointerMoved(at));
    h.event(egui::Event::PointerButton {
        pos: at,
        button: egui::PointerButton::Primary,
        pressed: false,
        modifiers: egui::Modifiers::NONE,
    });
    h.event(egui::Event::PointerMoved(at + Vec2::new(400.0, 100.0)));
    h.step();
    h.run_steps(3);
    assert_eq!(lane_rect(&h, "tree").width(), lane.width() + 40.0);
}

#[test]
fn the_inspector_lane_resizes_from_its_start_edge() {
    let mut h = harness(|app| {
        app.session.apply_screen(ScreenOp::OpenTemplatePanel {
            id: "inspector".into(),
        });
    });
    let before = lane_rect(&h, "inspector");
    assert_eq!(
        before.width(),
        340.0,
        "open, the template's width: {before:?}"
    );
    let right = before.max.x;
    assert!(
        right > W - 20.0,
        "the inspector is the right-hand lane: {before:?}"
    );
    // Dragging its LEFT edge leftwards widens it.
    drag(&mut h, Pos2::new(before.min.x, before.center().y), -60.0);
    let after = lane_rect(&h, "inspector");
    assert_eq!(after.width(), 400.0, "dragged 60px left: {after:?}");
    assert_eq!(after.max.x, right, "it grows leftwards");
    // Its right edge is not a handle.
    drag(
        &mut h,
        Pos2::new(after.max.x - 2.0, after.center().y),
        -60.0,
    );
    assert_eq!(lane_rect(&h, "inspector").width(), 400.0);
}

/// The rail: the fixed `zIndex: "chrome"` column that widens on hover.
fn rail_rect(harness: &Harness<'_, RendererApp>) -> Rect {
    let app = harness.state();
    let root = app.session.runtime.resolved().expect("resolved").clone();
    let node = find(&root, &|n| {
        n.handlers.contains_key("onMouseEnter")
            && n.props.get("zIndex").map(|v| v.js_string()).as_deref() == Some("chrome")
    })
    .expect("the rail");
    app.layout().expect("laid out").rects[&node.id]
}

fn hover(harness: &mut Harness<'_, RendererApp>, pos: Pos2, frames: usize) {
    for _ in 0..frames {
        harness.event(egui::Event::PointerMoved(pos));
        harness.step();
    }
}

fn close(a: image::Rgba<u8>, b: image::Rgba<u8>) -> bool {
    a.0.iter().zip(b.0.iter()).all(|(x, y)| x.abs_diff(*y) <= 6)
}

#[test]
fn the_expanded_rail_paints_over_the_main_view_and_keeps_the_pointer() {
    let mut h = harness(|_| {});
    let collapsed = rail_rect(&h);
    assert_eq!(collapsed.width(), 72.0, "{collapsed:?}");
    let tree = lane_rect(&h, "tree");
    assert!(
        tree.min.x >= collapsed.max.x,
        "the tree lane starts beside the rail"
    );
    let img = h.render().expect("render");
    // The rail's right border, beside the tree lane.
    let border_x = (collapsed.max.x - 0.5) as u32;
    let mid_y = collapsed.center().y as u32;
    let border = *img.get_pixel(border_x, mid_y);

    hover(
        &mut h,
        Pos2::new(collapsed.center().x, collapsed.center().y),
        60,
    );
    let expanded = rail_rect(&h);
    assert_eq!(expanded.width(), 256.0, "hover expands it: {expanded:?}");
    assert!(
        expanded.max.x > tree.min.x + 100.0,
        "it now overlaps the tree lane"
    );

    // Its border is drawn over the tree lane along the rail's whole height:
    // the rail paints after the main view, not under it.
    let img = h.render().expect("render");
    let x = (expanded.max.x - 0.5) as u32;
    let rows: Vec<u32> = (expanded.min.y as u32 + 20..expanded.max.y as u32 - 20).collect();
    let on = rows
        .iter()
        .filter(|y| close(*img.get_pixel(x, **y), border))
        .count();
    assert!(
        on * 10 >= rows.len() * 9,
        "the rail's edge shows on {on} of {} rows at x={x}",
        rows.len()
    );
    let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/interaction");
    std::fs::create_dir_all(&dir).unwrap();
    img.save(dir.join("rail-expanded.png")).unwrap();

    // The pointer over the overlap — above the tree lane — is the rail's:
    // it stays open.
    hover(
        &mut h,
        Pos2::new(tree.min.x + 80.0, expanded.center().y),
        60,
    );
    assert_eq!(
        rail_rect(&h).width(),
        256.0,
        "hover in the overlap keeps it open"
    );
    // And leaving it closes it again.
    hover(
        &mut h,
        Pos2::new(expanded.max.x + 300.0, expanded.center().y),
        60,
    );
    assert_eq!(rail_rect(&h).width(), 72.0, "leaving collapses it");
}

/// The `we-tree-item` whose value is `value`.
fn tree_item<'n>(root: &'n ResolvedNode, value: &str) -> &'n ResolvedNode {
    find(root, &|n| {
        n.ty.as_ref() == "we-tree-item"
            && n.props.get("value").map(|v| v.js_string()).as_deref() == Some(value)
    })
    .unwrap_or_else(|| panic!("no tree item {value}"))
}

/// Whether the tree lane's `group|people` row is open — what a click on
/// its row toggles.
fn people_open(h: &Harness<'_, RendererApp>) -> bool {
    let root = h
        .state()
        .session
        .runtime
        .resolved()
        .expect("resolved")
        .clone();
    tree_item(&root, "group|people")
        .props
        .get("open")
        .is_some_and(|v| v.truthy())
}

fn click(h: &mut Harness<'_, RendererApp>, at: Pos2) {
    hover(h, at, 3);
    pointer(h, at, Some(true));
    pointer(h, at, Some(false));
    h.run_steps(3);
}

/// Under the expanded rail a click is the rail's: the tree row beneath it
/// — `group|people`, a row with nothing of the rail's on that line — does
/// not toggle. Beside the rail the same row does.
#[test]
fn a_click_on_the_expanded_rail_does_not_reach_the_tree_row_under_it() {
    let mut h = harness(|_| {});
    let rail = rail_rect(&h);
    let row = {
        let app = h.state();
        let root = app.session.runtime.resolved().expect("resolved").clone();
        app.layout().expect("laid out").rects[&tree_item(&root, "group|people").id]
    };
    let was = people_open(&h);
    hover(&mut h, rail.center(), 60);
    let expanded = rail_rect(&h);
    assert_eq!(expanded.width(), 256.0, "hover expands it");
    let under = Pos2::new(row.min.x + 60.0, row.center().y);
    assert!(expanded.contains(under), "{under:?} is under the rail");
    click(&mut h, under);
    assert_eq!(rail_rect(&h).width(), 256.0, "still the rail's");
    assert_eq!(people_open(&h), was, "the row under the rail toggled");
    // The control: beside the rail, the same row takes the click.
    let beside = Pos2::new(expanded.max.x + 40.0, row.center().y);
    assert!(row.contains(beside));
    click(&mut h, beside);
    assert_ne!(people_open(&h), was, "a click beside the rail toggles it");
}
