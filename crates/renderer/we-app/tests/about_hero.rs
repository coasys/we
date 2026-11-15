//! The About hero at glow: `we-typewriter`'s cycled phrase is painted, in
//! the accent, beside the fixed "We are building" (a role colour that
//! `eval_color` alone cannot read painted it white, and a phrase caught
//! mid-delete painted nothing).

#[path = "support/gpu.rs"]
mod gpu;

use egui::Vec2;
use egui_kittest::kittest::Queryable;
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
        .renderer(gpu::serial())
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
    let root = app.session.runtime().resolved().expect("resolved").clone();
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

fn about(reduced: bool) -> Harness<'static, RendererApp> {
    let bundle = Bundle::parse(BUNDLE).unwrap();
    let (app, _) = we_app::coasys_app(&bundle, "about", "glow").unwrap();
    let mut h = Harness::builder()
        .renderer(gpu::serial())
        .with_size(Vec2::new(1280.0, 800.0))
        .with_pixels_per_point(1.0)
        .allow_missing_glyphs()
        .with_context_setup(move |ctx| {
            we_egui::install_media(ctx);
            we_egui::defaults::set_reduced_motion(ctx, reduced);
        })
        .with_accessibility_check(false)
        .build_ui_state(|ui, app: &mut RendererApp| app.frame_body(ui), app);
    h.run_steps(6);
    h
}

fn link<'n>(root: &'n ResolvedNode, href: &str) -> &'n ResolvedNode {
    find(root, &|n| {
        n.ty.as_ref() == "we-link"
            && n.props.get("href").map(|v| v.js_string()).as_deref() == Some(href)
    })
    .unwrap_or_else(|| panic!("no link to {href}"))
}

fn kids(n: &ResolvedNode) -> Vec<&ResolvedNode> {
    n.children
        .iter()
        .filter_map(|c| match c {
            ResolvedChild::Node(c) => Some(&**c),
            ResolvedChild::Text(_) => None,
        })
        .collect()
}

/// The header row (V2): `display: flex` on a `we-link` is a CSS row, so the
/// wordmark sits beside the logo; an icon link's `label` is its name, not
/// words drawn beside the icon; the GitHub pill's halves sit side by side.
#[test]
fn the_about_header_lays_out_as_one_row() {
    let h = about(true);
    let app = h.state();
    let root = app.session.runtime().resolved().expect("resolved").clone();
    let lay = app.layout().expect("laid out");

    let brand = link(&root, "https://coasys.org");
    let logo = kids(brand)[0];
    let b = lay.rects[&brand.id];
    let l = lay.rects[&logo.id];
    assert!(
        b.width() > l.width() + 60.0 && b.height() < l.height() + 4.0,
        "the wordmark sits beside the logo: link {b:?}, logo {l:?}"
    );

    let discord = link(&root, "https://discord.gg/fYGVM66jEz");
    let d = lay.rects[&discord.id];
    assert!(
        d.width() <= 30.0 && d.height() <= 30.0,
        "Discord is its mark alone: {d:?}"
    );
    assert!(
        h.query_all_by_label_contains("Discord").next().is_some(),
        "the label still names it"
    );

    let gh = link(&root, "https://github.com/coasys/ad4m");
    let halves = kids(gh);
    let (a, z) = (lay.rects[&halves[0].id], lay.rects[&halves[1].id]);
    assert!(
        a.max.x <= z.min.x + 0.5,
        "the pill's halves do not overlap: {a:?} {z:?}"
    );
    assert!(
        lay.rects[&gh.id].height() <= 37.0,
        "the pill is one 36px row"
    );
}
