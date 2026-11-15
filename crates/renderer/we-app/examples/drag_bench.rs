//! Drag the tree lane's splitter through the real frame loop and time it:
//! the Coasys app at the `people` route, 1280x800, a theme (default glow).
//!
//!     cargo run --release -p we-app --example drag_bench -- [theme] [moves] [ppp] [WxH]
//!
//! Each move is one frame with one `PointerMoved` of 3px, run through
//! `RendererApp::frame_body` inside `Context::run_ui` and tessellated, as
//! eframe does — no window and no GPU, so the numbers are CPU only. Prints
//! per-frame stage times and work counts, then median and p95.
use std::time::{Duration, Instant};

use egui::{pos2, vec2, Event, PointerButton, Pos2, RawInput, Rect};
use we_app::RendererApp;
use we_template::{Bundle, ResolvedChild, ResolvedNode};

const BUNDLE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../bundles/coasys.bundle.json"
));

fn find<'n>(n: &'n ResolvedNode, pred: &dyn Fn(&ResolvedNode) -> bool) -> Option<&'n ResolvedNode> {
    if pred(n) {
        return Some(n);
    }
    n.children.iter().find_map(|c| match c {
        ResolvedChild::Node(c) => find(c, pred),
        ResolvedChild::Text(_) => None,
    })
}

fn lane(app: &RendererApp, name: &str) -> Rect {
    let root = app.session.runtime.resolved().expect("resolved").clone();
    let n = find(&root, &|n| {
        n.ty.as_ref() == "$lane"
            && n.props.get("lane").map(|v| v.js_string()).as_deref() == Some(name)
    })
    .expect("the lane");
    app.layout().expect("laid out").rects[&n.id]
}

struct Frame {
    total: Duration,
    tess: Duration,
    stages: we_app::Stages,
    counters: we_egui::counters::Counters,
    repaint: bool,
    textures: usize,
    texture_bytes: usize,
    vertices: usize,
    galleys: usize,
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn main() {
    let mut args = std::env::args().skip(1);
    let theme = args.next().unwrap_or_else(|| "glow".into());
    let moves: usize = args.next().and_then(|s| s.parse().ok()).unwrap_or(60);
    let ppp: f32 = args.next().and_then(|s| s.parse().ok()).unwrap_or(1.0);
    let size: Vec<f32> = args
        .next()
        .unwrap_or_else(|| "1280x800".into())
        .split('x')
        .map(|n| n.parse().expect("WxH"))
        .collect();
    let bundle = Bundle::parse(BUNDLE).expect("bundle");
    let (mut app, _) = we_app::coasys_app(&bundle, "people", &theme).expect("app");
    let ctx = egui::Context::default();
    we_app::init_host(&ctx);
    let mut time = 0.0;
    let mut run = |app: &mut RendererApp, events: Vec<Event>| -> Frame {
        time += 1.0 / 60.0;
        let mut input = RawInput {
            screen_rect: Some(Rect::from_min_size(Pos2::ZERO, vec2(size[0], size[1]))),
            time: Some(time),
            events,
            ..Default::default()
        };
        input
            .viewports
            .entry(egui::ViewportId::ROOT)
            .or_default()
            .native_pixels_per_point = Some(ppp);
        we_egui::counters::take();
        let t = Instant::now();
        let mut out = ctx.run_ui(input, |ui| app.frame_body(ui));
        let total = t.elapsed();
        let counters = we_egui::counters::take();
        let textures = out.textures_delta.set.len();
        let texture_bytes: usize = out
            .textures_delta
            .set
            .values()
            .flatten()
            .map(|d| d.image.width() * d.image.height() * 4)
            .sum();
        out.textures_delta.clear();
        let t = Instant::now();
        let prims = ctx.tessellate(out.shapes, out.pixels_per_point);
        let tess = t.elapsed();
        let vertices: usize = prims
            .iter()
            .map(|p| match &p.primitive {
                egui::epaint::Primitive::Mesh(m) => m.vertices.len(),
                egui::epaint::Primitive::Callback(_) => 0,
            })
            .sum();
        Frame {
            total,
            tess,
            stages: app.stages,
            counters,
            repaint: out
                .viewport_output
                .values()
                .any(|v| v.repaint_delay == Duration::ZERO),
            textures,
            texture_bytes,
            vertices,
            galleys: ctx.fonts(|f| f.num_galleys_in_cache()),
        }
    };
    for _ in 0..20 {
        run(&mut app, vec![]);
    }
    let start = lane(&app, "tree");
    let from = pos2(start.max.x, start.center().y);
    run(&mut app, vec![Event::PointerMoved(from)]);
    let press = |pressed| Event::PointerButton {
        pos: from,
        button: PointerButton::Primary,
        pressed,
        modifiers: Default::default(),
    };
    run(&mut app, vec![Event::PointerMoved(from), press(true)]);
    let mut frames = Vec::new();
    let mut late = 0;
    for i in 1..=moves {
        let travel = 3.0 * i as f32;
        let f = run(
            &mut app,
            vec![Event::PointerMoved(from + vec2(travel, 0.0))],
        );
        let drawn = lane(&app, "tree").width();
        let want = start.width() + travel;
        if (drawn - want).abs() >= 0.5 {
            late += 1;
        }
        let s = f.stages;
        eprintln!(
            "move {i:3}: frame {:6.2} tess {:5.2} | resolve {:5.2} layout {:5.2}{} paint {:5.2} dispatch {:5.2} | styles {:4} passes {} galleys {:3} tex {} ({} B) verts {} repaint {:5} | drawn {drawn} want {want}",
            ms(f.total),
            ms(f.tess),
            ms(s.resolve),
            ms(s.layout),
            if s.laid_out { "*" } else { " " },
            ms(s.paint),
            ms(s.dispatch),
            f.counters.style_resolves,
            f.counters.layout_passes,
            f.galleys,
            f.textures,
            f.texture_bytes,
            f.vertices,
            f.repaint,
        );
        frames.push(f);
    }
    let release = from + vec2(3.0 * moves as f32, 0.0);
    run(
        &mut app,
        vec![Event::PointerButton {
            pos: release,
            button: PointerButton::Primary,
            pressed: false,
            modifiers: Default::default(),
        }],
    );
    let stat = |name: &str, get: &dyn Fn(&Frame) -> f64| {
        let mut v: Vec<f64> = frames.iter().map(get).collect();
        v.sort_by(|a, b| a.partial_cmp(b).expect("finite"));
        let p95 = v[(v.len() * 95).div_ceil(100) - 1];
        println!("{name:10} median {:8.2}  p95 {p95:8.2}", v[v.len() / 2]);
    };
    println!("{moves} moves, theme {theme}, ppp {ppp}, {}x{} points; frames where the width lagged the pointer: {late}", size[0], size[1]);
    stat("frame ms", &|f| ms(f.total));
    stat("tess ms", &|f| ms(f.tess));
    stat("resolve ms", &|f| ms(f.stages.resolve));
    stat("layout ms", &|f| ms(f.stages.layout));
    stat("paint ms", &|f| ms(f.stages.paint));
    stat("dispatch", &|f| ms(f.stages.dispatch));
    stat("styles", &|f| f.counters.style_resolves as f64);
    stat("passes", &|f| f.counters.layout_passes as f64);
    stat("tex bytes", &|f| f.texture_bytes as f64);
    stat("vertices", &|f| f.vertices as f64);
}
