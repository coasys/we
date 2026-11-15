//! The About hero at glow: `we-typewriter`'s cycled phrase is painted, in
//! the accent, beside the fixed "We are building" (a role colour that
//! `eval_color` alone cannot read painted it white, and a phrase caught
//! mid-delete painted nothing).
use egui::Vec2;
use egui_kittest::Harness;
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

#[test]
fn the_typewriter_phrase_is_painted_in_the_accent() {
    let bundle = Bundle::parse(BUNDLE).unwrap();
    let (app, _) = we_app::coasys_app(&bundle, "about", "glow").unwrap();
    let mut h = Harness::builder()
        .with_size(Vec2::new(1280.0, 800.0))
        .with_pixels_per_point(1.0)
        .allow_missing_glyphs()
        .with_context_setup(|ctx| {
            we_egui::install_media(ctx);
            // Held still: the first phrase whole, as typewriter.ts draws it.
            we_egui::defaults::set_reduced_motion(ctx, true);
        })
        .with_accessibility_check(false)
        .build_ui_state(|ui, app: &mut RendererApp| app.frame_body(ui), app);
    h.run_steps(6);
    let img = h.render().expect("render");
    let app = h.state();
    let root = app.session.runtime.resolved().expect("resolved").clone();
    let tw = find(&root, &|n| n.ty.as_ref() == "we-typewriter").expect("typewriter");
    let lay = app.layout().expect("laid out");
    let r = lay.rects[&tw.id];
    // Accent-green pixels (g dominant) inside the right two thirds of the box.
    let mut green = 0;
    let x0 = (r.min.x + r.width() * 0.35) as u32;
    for y in r.min.y.max(0.0) as u32..(r.max.y as u32).min(img.height()) {
        for x in x0..(r.max.x as u32).min(img.width()) {
            let p = img.get_pixel(x, y);
            if p[1] > 150 && p[1] as i32 > p[0] as i32 + 40 && p[1] as i32 > p[2] as i32 + 10 {
                green += 1;
            }
        }
    }
    assert!(green > 200, "accent phrase pixels in the hero: {green}");
}
