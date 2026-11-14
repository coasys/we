//! Side-by-side PNG dump for `scripts/theme-compare.sh`: every gallery
//! schema under every recorded theme, rendered through `RendererApp` at
//! the width the web capture uses, written to `$WE_COMPARE_OUT` as
//! `<gallery>-<theme>.png`. Without `WE_COMPARE_OUT` the test is a no-op,
//! so `cargo test` stays green and writes nothing.
//!
//! Heights come from the resolved layout, not a fixed viewport — the web
//! side screenshots full-page, so a full-content Rust frame is the same
//! subject.
use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;

use egui::{Rect, Vec2};
use egui_kittest::Harness;
use we_app::gallery::load_theme_set;
use we_egui::{layout, MeasureCx, Registry, StyleCx};

const GALLERIES: &[(&str, &str, f32)] = &[
    ("widgets", include_str!("../gallery/widgets.json"), 820.0),
    ("inputs", include_str!("../gallery/inputs.json"), 460.0),
    ("style", include_str!("../gallery/style.json"), 760.0),
];

fn app_for(schema: &we_template::SchemaNode, theme: &we_style::Theme) -> we_app::RendererApp {
    let mut app = we_app::RendererApp::new(
        schema.clone(),
        "theme-compare",
        Arc::new(we_template::StoreBag::new()),
        we_screen::ScreenState::desktop(we_screen::ScreenSchema::default(), "/gallery"),
        Registry::with_builtins(),
    );
    app.theme = theme.clone();
    app
}

/// Content height at `width`: the same `layout` call `frame_body` runs, so
/// the capture matches what a real viewport of that size shows.
fn content_height(ctx: &egui::Context, app: &mut we_app::RendererApp, width: f32) -> f32 {
    let resolved = app.session.resolve();
    let mcx = MeasureCx::new(ctx);
    let scx = StyleCx {
        tokens: &app.theme.tokens,
        viewport: we_style::Size::new(width, 1.0),
        container_width: width,
        ..StyleCx::empty()
    };
    let l = layout(
        &mcx,
        &scx,
        &app.registry,
        &resolved,
        Rect::from_min_size(egui::Pos2::ZERO, Vec2::new(width, 1.0)),
    );
    l.size.y.max(120.0).ceil()
}

#[test]
fn theme_compare_dump() {
    let Some(out) = std::env::var_os("WE_COMPARE_OUT").map(PathBuf::from) else {
        return;
    };
    std::fs::create_dir_all(&out).expect("create WE_COMPARE_OUT");
    let set = load_theme_set();
    assert!(!set.is_empty(), "no token tables found");
    for (gallery, schema_src, width) in GALLERIES {
        let schema: we_template::SchemaNode =
            serde_json::from_str(schema_src).expect("gallery schema parses");
        for theme in set.iter() {
            // Pass 1: a tall harness only to get fonts + the content height
            // (a fresh Context has none until the first run).
            let measured = Rc::new(RefCell::new(0.0f32));
            {
                let m = measured.clone();
                let app = app_for(&schema, theme);
                let mut probe = Harness::builder()
                    .with_size(Vec2::new(*width, 4000.0))
                    // Same pinned raster inputs as `gallery.rs`: the
                    // WE-installed fonts (the theme's face shapes the
                    // measure) and 1px-per-point.
                    .with_pixels_per_point(1.0)
                    .with_context_setup(we_egui::install_media)
                    .build_ui_state(
                        move |ui, app: &mut we_app::RendererApp| {
                            app.frame_body(ui);
                            *m.borrow_mut() = content_height(ui.ctx(), app, *width);
                        },
                        app,
                    );
                probe.run_steps(4);
            }
            let height = measured.borrow().max(120.0).ceil();
            // Pass 2: the real capture at content height.
            let app = app_for(&schema, theme);
            let mut harness = Harness::builder()
                .with_size(Vec2::new(*width, height))
                .with_pixels_per_point(1.0)
                .with_context_setup(we_egui::install_media)
                .build_ui_state(|ui, app: &mut we_app::RendererApp| app.frame_body(ui), app);
            // Same settle loop as the widgets snapshots: animated widgets
            // request repaints, images decode on a loader thread.
            harness.run_steps(4);
            for _ in 0..100 {
                if !harness.ctx.has_pending_images() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
                harness.step();
            }
            let image = harness.render().expect("render");
            image
                .save(out.join(format!("{gallery}-{}.png", theme.id)))
                .expect("write png");
        }
    }
}
