//! CSS gradient backgrounds — `linear-gradient(…)` and `radial-gradient(…)`
//! layers, comma-separated, the first painted on top — rasterised here,
//! one colour per pixel as the browser does, into a texture the size of
//! the box in pixels and drawn 1:1 on the pixel-snapped box.
//!
//! It was a grid of vertex-coloured quads the GPU interpolated between
//! grid points. That looks the same, but it left each pixel's colour and
//! alpha to the rasteriser, so nothing could say what the blend of a
//! translucent wash over what is under it would be fed. Rasterised here,
//! every fragment is a texel read at its centre, the same on every machine
//! — which is what lets [`texel`] choose alphas that blend to the same byte
//! under every lavapipe (the About film's darkened foot was a dozen pixels
//! one level apart between mesa 25 and CI's mesa 26).
//!
//! Interpolation is premultiplied, as CSS specifies, so a stop fading into
//! `transparent` darkens nothing on its way out.
use egui::emath::GuiRounding as _;
use we_style::{Color, Dimension, Size};

/// One colour stop: premultiplied RGBA and its position along the ray
/// (`0..1`), filled in for stops that gave none.
#[derive(Debug, Clone, Copy)]
struct Stop {
    color: [f32; 4],
    at: f32,
}

#[derive(Debug, Clone)]
enum Shape {
    /// Unit direction (screen space, y down).
    Linear { dir: egui::Vec2 },
    /// Centre and the ending shape's two radii.
    Radial {
        center: egui::Pos2,
        rx: f32,
        ry: f32,
    },
}

#[derive(Debug, Clone)]
struct Layer {
    shape: Shape,
    stops: Vec<Stop>,
}

/// What lengths resolve against.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Metrics {
    pub units: we_metrics::UnitMetrics,
    pub viewport: Size,
}

/// Split at commas not inside parentheses.
fn split_top(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut start = 0;
    for (i, ch) in text.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => depth -= 1,
            ',' if depth == 0 => {
                out.push(text[start..i].trim());
                start = i + 1;
            }
            _ => {}
        }
    }
    out.push(text[start..].trim());
    out
}

/// Split at whitespace not inside parentheses.
fn words(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut start: Option<usize> = None;
    for (i, ch) in text.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => depth -= 1,
            c if c.is_whitespace() && depth == 0 => {
                if let Some(s) = start.take() {
                    out.push(&text[s..i]);
                }
                continue;
            }
            _ => {}
        }
        if start.is_none() {
            start = Some(i);
        }
    }
    if let Some(s) = start {
        out.push(&text[s..]);
    }
    out
}

/// A length against `base` (for percentages) — `None` when it is not one.
fn length(text: &str, base: f32, m: Metrics) -> Option<f32> {
    let d = we_style::eval_dimension(text)?;
    if matches!(d, Dimension::Auto) {
        return None;
    }
    d.resolve(Some(base), &m.units, m.viewport)
}

/// A colour stop `<color> [<pos> [<pos>]]`: one stop per position given.
fn stops_of(args: &[&str], ray: f32, m: Metrics) -> Option<Vec<Stop>> {
    let mut raw: Vec<(Color, Option<f32>)> = Vec::new();
    for arg in args {
        let w = words(arg);
        let (first, rest) = w.split_first()?;
        let color = we_style::eval_color(first)?;
        if rest.is_empty() {
            raw.push((color, None));
        }
        for pos in rest {
            let px = length(pos, ray, m)?;
            raw.push((color, Some(if ray > 0.0 { px / ray } else { 0.0 })));
        }
    }
    if raw.is_empty() {
        return None;
    }
    // Fill in: first 0, last 1, monotonic, the gaps spaced evenly.
    let n = raw.len();
    let mut at: Vec<Option<f32>> = raw.iter().map(|r| r.1).collect();
    if at[0].is_none() {
        at[0] = Some(0.0);
    }
    if at[n - 1].is_none() {
        at[n - 1] = Some(1.0);
    }
    let mut prev = at[0].unwrap_or(0.0);
    for v in at.iter_mut().flatten() {
        *v = v.max(prev);
        prev = *v;
    }
    let mut i = 0;
    while i < n {
        if at[i].is_some() {
            i += 1;
            continue;
        }
        let lo = i - 1;
        let mut hi = i;
        while at[hi].is_none() {
            hi += 1;
        }
        let (a, b) = (at[lo].unwrap_or(0.0), at[hi].unwrap_or(1.0));
        for (k, slot) in at.iter_mut().enumerate().take(hi).skip(i) {
            *slot = Some(a + (b - a) * (k - lo) as f32 / (hi - lo) as f32);
        }
        i = hi;
    }
    Some(
        raw.iter()
            .zip(at)
            .map(|((c, _), a)| Stop {
                color: c.to_premultiplied(),
                at: a.unwrap_or(0.0),
            })
            .collect(),
    )
}

/// `<x> <y>` / keywords → a point in `rect`.
fn position(text: &[&str], rect: egui::Rect, m: Metrics) -> egui::Pos2 {
    let kw = |w: &str, horiz: bool| -> Option<f32> {
        Some(match w {
            "left" if horiz => 0.0,
            "right" if horiz => 1.0,
            "top" if !horiz => 0.0,
            "bottom" if !horiz => 1.0,
            "center" => 0.5,
            _ => return None,
        })
    };
    let (mut x, mut y) = (rect.width() * 0.5, rect.height() * 0.5);
    match text {
        [one] => {
            if let Some(f) = kw(one, false) {
                if *one != "center" {
                    y = f * rect.height();
                }
            } else if let Some(f) = kw(one, true) {
                x = f * rect.width();
            } else if let Some(v) = length(one, rect.width(), m) {
                x = v;
            }
        }
        [a, b, ..] => {
            // A vertical keyword first (`top left`) swaps the pair.
            let (h, v) = if matches!(*a, "top" | "bottom") || matches!(*b, "left" | "right") {
                (*b, *a)
            } else {
                (*a, *b)
            };
            x = kw(h, true)
                .map(|f| f * rect.width())
                .or_else(|| length(h, rect.width(), m))
                .unwrap_or(x);
            y = kw(v, false)
                .map(|f| f * rect.height())
                .or_else(|| length(v, rect.height(), m))
                .unwrap_or(y);
        }
        [] => {}
    }
    rect.min + egui::vec2(x, y)
}

fn parse_radial(args: &[&str], rect: egui::Rect, m: Metrics) -> Option<Layer> {
    // The first argument is the shape/size/position when it is not a colour.
    let (head, stop_args) = match args.first() {
        Some(a) if we_style::eval_color(words(a).first()?).is_none() => (Some(*a), &args[1..]),
        _ => (None, args),
    };
    let mut center = rect.center();
    let mut size: Vec<&str> = Vec::new();
    let mut circle = false;
    if let Some(h) = head {
        let w = words(h);
        let at = w.iter().position(|x| *x == "at");
        let (sz, pos) = match at {
            Some(i) => (&w[..i], &w[i + 1..]),
            None => (&w[..], &w[w.len()..]),
        };
        if !pos.is_empty() {
            center = position(pos, rect, m);
        }
        for s in sz {
            match *s {
                "circle" => circle = true,
                "ellipse" => {}
                other => size.push(other),
            }
        }
    }
    // Distances from the centre to the box's sides and corners.
    let dx = [(center.x - rect.min.x).abs(), (rect.max.x - center.x).abs()];
    let dy = [(center.y - rect.min.y).abs(), (rect.max.y - center.y).abs()];
    let (cx, fx) = (dx[0].min(dx[1]), dx[0].max(dx[1]));
    let (cy, fy) = (dy[0].min(dy[1]), dy[0].max(dy[1]));
    let (rx, ry) = match size.as_slice() {
        [a, b] => (length(a, rect.width(), m)?, length(b, rect.height(), m)?),
        [a] if !a.contains('-') => {
            let r = length(a, rect.width(), m)?;
            (r, r)
        }
        [kw] => keyword_size(kw, circle, (cx, cy), (fx, fy)),
        _ => keyword_size("farthest-corner", circle, (cx, cy), (fx, fy)),
    };
    let ray = rx.max(1e-3);
    Some(Layer {
        shape: Shape::Radial {
            center,
            rx: rx.max(1e-3),
            ry: ry.max(1e-3),
        },
        stops: stops_of(stop_args, ray, m)?,
    })
}

/// The extent keywords (`closest-side` … `farthest-corner`); an ellipse
/// sized to a corner keeps the side ratio and is scaled by √2, as CSS does.
fn keyword_size(kw: &str, circle: bool, closest: (f32, f32), farthest: (f32, f32)) -> (f32, f32) {
    let corner = |(x, y): (f32, f32)| {
        if circle {
            let r = x.hypot(y);
            (r, r)
        } else {
            (x * std::f32::consts::SQRT_2, y * std::f32::consts::SQRT_2)
        }
    };
    let side = |(x, y): (f32, f32), far: bool| {
        if circle {
            let r = if far { x.max(y) } else { x.min(y) };
            (r, r)
        } else {
            (x, y)
        }
    };
    match kw {
        "closest-side" => side(closest, false),
        "farthest-side" => side(farthest, true),
        "closest-corner" => corner(closest),
        _ => corner(farthest),
    }
}

fn parse_linear(args: &[&str], rect: egui::Rect, m: Metrics) -> Option<Layer> {
    let mut angle = std::f32::consts::PI; // `to bottom`
    let mut stop_args = args;
    if let Some(first) = args.first() {
        let w = words(first);
        if w.first() == Some(&"to") {
            let (mut x, mut y) = (0.0f32, 0.0f32);
            for k in &w[1..] {
                match *k {
                    "left" => x = -1.0,
                    "right" => x = 1.0,
                    "top" => y = -1.0,
                    "bottom" => y = 1.0,
                    _ => {}
                }
            }
            // A corner: the line runs perpendicular to the diagonal through
            // the other two corners of THIS box, so it points at the corner.
            angle = if x != 0.0 && y != 0.0 {
                (x * rect.height()).atan2(-(y * rect.width()))
            } else {
                x.atan2(-y)
            };
            stop_args = &args[1..];
        } else if let Some(a) = angle_of(first) {
            angle = a;
            stop_args = &args[1..];
        }
    }
    let dir = egui::vec2(angle.sin(), -angle.cos());
    let len = (rect.width() * dir.x).abs() + (rect.height() * dir.y).abs();
    Some(Layer {
        shape: Shape::Linear { dir },
        stops: stops_of(stop_args, len.max(1e-3), m)?,
    })
}

fn angle_of(text: &str) -> Option<f32> {
    let t = text.trim();
    let num = |s: &str| s.trim().parse::<f32>().ok();
    if let Some(v) = t.strip_suffix("deg") {
        return num(v).map(f32::to_radians);
    }
    if let Some(v) = t.strip_suffix("grad") {
        return num(v).map(|g| g * std::f32::consts::PI / 200.0);
    }
    if let Some(v) = t.strip_suffix("rad") {
        return num(v);
    }
    if let Some(v) = t.strip_suffix("turn") {
        return num(v).map(|g| g * std::f32::consts::TAU);
    }
    None
}

fn parse(text: &str, rect: egui::Rect, m: Metrics) -> Vec<Layer> {
    let mut out = Vec::new();
    for layer in split_top(text) {
        let Some(open) = layer.find('(') else {
            continue;
        };
        let (name, body) = (layer[..open].trim(), &layer[open + 1..]);
        let Some(body) = body.strip_suffix(')') else {
            continue;
        };
        let args = split_top(body);
        let parsed = match name {
            "linear-gradient" => parse_linear(&args, rect, m),
            "radial-gradient" => parse_radial(&args, rect, m),
            _ => None,
        };
        out.extend(parsed);
    }
    out
}

impl Layer {
    fn t_at(&self, rect: egui::Rect, p: egui::Pos2) -> f32 {
        match &self.shape {
            Shape::Linear { dir } => {
                let len = (rect.width() * dir.x).abs() + (rect.height() * dir.y).abs();
                if len <= 0.0 {
                    return 0.0;
                }
                (p - rect.center()).dot(*dir) / len + 0.5
            }
            Shape::Radial { center, rx, ry } => {
                let d = p - *center;
                (d.x / rx).hypot(d.y / ry)
            }
        }
    }

    fn color_at(&self, t: f32) -> [f32; 4] {
        let s = &self.stops;
        if t <= s[0].at {
            return s[0].color;
        }
        for w in s.windows(2) {
            let (a, b) = (w[0], w[1]);
            if t <= b.at {
                let f = if b.at > a.at {
                    (t - a.at) / (b.at - a.at)
                } else {
                    1.0
                };
                return std::array::from_fn(|i| a.color[i] + (b.color[i] - a.color[i]) * f);
            }
        }
        s[s.len() - 1].color
    }
}

/// Every layer composited at `p`, premultiplied, first layer on top.
fn composite(layers: &[Layer], rect: egui::Rect, p: egui::Pos2) -> [f32; 4] {
    let mut acc = [0.0f32; 4];
    for layer in layers.iter().rev() {
        let src = layer.color_at(layer.t_at(rect, p));
        acc = std::array::from_fn(|i| src[i] + acc[i] * (1.0 - src[3]));
    }
    acc
}

/// How much of the rounded `rect` covers `p` (`0` or `1`, with a one-pixel
/// feather at the corner arcs).
fn coverage(rect: egui::Rect, radius: f32, p: egui::Pos2) -> f32 {
    if radius <= 0.0 {
        return 1.0;
    }
    let r = radius.min(rect.width() * 0.5).min(rect.height() * 0.5);
    let cx = p.x.clamp(rect.min.x + r, rect.max.x - r);
    let cy = p.y.clamp(rect.min.y + r, rect.max.y - r);
    let d = (p.x - cx).hypot(p.y - cy);
    (r - d + 0.5).clamp(0.0, 1.0)
}

/// A rasterised box, and the pass it was last drawn in.
#[derive(Clone)]
struct Entry {
    texture: egui::TextureHandle,
    last_used: u64,
}

/// Rasterised boxes, keyed by [`key`]: the page box's gradient is a
/// million pixels, each compositing every layer, and the same texture
/// every frame while the gradient, the box's pixel size and the metrics
/// hold.
#[derive(Clone, Default)]
struct Cache(std::collections::HashMap<u64, Entry>);

/// More distinct gradient boxes than this and the ones not drawn in the
/// last two passes go — a resize drag walks through sizes nothing will ask
/// for again, each a texture the size of its box.
const CACHE_CAP: usize = 32;

/// What a texture depends on: the value, the box's size in pixels (a
/// texture is drawn wherever the box is), its corner radius, the fade, the
/// pixel density and the metrics that resolve its lengths.
fn key(text: &str, size: [usize; 2], radius: f32, opacity: f32, ppp: f32, m: Metrics) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut h);
    size.hash(&mut h);
    for f in [radius, opacity, ppp, m.viewport.width, m.viewport.height] {
        f.to_bits().hash(&mut h);
    }
    format!("{:?}", m.units).hash(&mut h);
    h.finish()
}

/// Paint `text`'s gradient layers over `rect`, faded by `opacity`. Nothing
/// is painted for a value with no layer this module understands.
pub(crate) fn paint(
    painter: &egui::Painter,
    rect: egui::Rect,
    radius: f32,
    text: &str,
    opacity: f32,
    m: Metrics,
) {
    let ctx = painter.ctx();
    let ppp = ctx.pixels_per_point();
    let rect = rect.round_to_pixels(ppp);
    let px = (rect.size() * ppp).round();
    if px.x < 1.0 || px.y < 1.0 {
        return;
    }
    let size = [px.x as usize, px.y as usize];
    let id = egui::Id::unique("we-egui::gradient-cache");
    let k = key(text, size, radius, opacity, ppp, m);
    let pass = ctx.cumulative_pass_nr();
    let cached = ctx.data_mut(|d| {
        let entry = d.get_temp_mut_or_default::<Cache>(id).0.get_mut(&k)?;
        entry.last_used = pass;
        Some(entry.texture.id())
    });
    let texture = match cached {
        Some(texture) => texture,
        None => {
            let Some(image) = build(size, ppp, radius, text, opacity, m) else {
                return;
            };
            let handle =
                ctx.load_texture("we-egui::gradient", image, egui::TextureOptions::NEAREST);
            let texture = handle.id();
            ctx.data_mut(|d| {
                let cache = d.get_temp_mut_or_default::<Cache>(id);
                if cache.0.len() >= CACHE_CAP {
                    cache.0.retain(|_, e| pass <= e.last_used + 2);
                    if cache.0.len() >= CACHE_CAP {
                        cache.0.clear();
                    }
                }
                cache.0.insert(
                    k,
                    Entry {
                        texture: handle,
                        last_used: pass,
                    },
                );
            });
            texture
        }
    };
    painter.image(
        texture,
        rect,
        egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)),
        egui::Color32::WHITE,
    );
}

/// A premultiplied colour, faded by `k`, as an 8-bit texel whose alpha is
/// a multiple of 3 — the colour scaled with it, so it keeps its hue.
///
/// A translucent texel is blended over what is under it as
/// `src + dst·(255−α)/255`, and lavapipe before mesa 26 divides by 255 as
/// `(x + (x>>8) + 0x80) >> 8`, a level low for every product
/// `x ≡ 128 (mod 255)` from 129·255 up; mesa 26 rounds exactly. Those
/// products need `dst·α ≡ 127 (mod 255)`, which no `α` sharing a factor
/// with 255 = 3·5·17 can give — so with `α` in steps of 3 (86 levels,
/// opaque included) a gradient blends to the same byte on either, over a
/// photograph as over a flat fill. It was a dozen pixels of the About
/// film's darkened foot, one level apart between this machine's mesa and
/// CI's.
fn texel(c: [f32; 4], k: f32) -> egui::Color32 {
    let alpha = (c[3] * k * 255.0).clamp(0.0, 255.0);
    let stepped = (alpha / 3.0).round() * 3.0;
    let scale = if alpha > 0.0 {
        k * stepped / alpha
    } else {
        0.0
    };
    let a = stepped as u8;
    let byte = |v: f32| ((v * scale * 255.0).round().clamp(0.0, 255.0) as u8).min(a);
    egui::Color32::from_rgba_premultiplied(byte(c[0]), byte(c[1]), byte(c[2]), a)
}

/// `text` rasterised over a box of `size` pixels, each pixel the layers
/// composited at its centre — `None` for a value with no layer this module
/// understands. Geometry is in points, so lengths resolve as they do for
/// the box.
fn build(
    size: [usize; 2],
    ppp: f32,
    radius: f32,
    text: &str,
    opacity: f32,
    m: Metrics,
) -> Option<egui::ColorImage> {
    let [w, h] = size;
    let rect =
        egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(w as f32 / ppp, h as f32 / ppp));
    let layers = parse(text, rect, m);
    if layers.is_empty() {
        return None;
    }
    let mut pixels = Vec::with_capacity(w * h);
    for j in 0..h {
        for i in 0..w {
            let p = egui::pos2((i as f32 + 0.5) / ppp, (j as f32 + 0.5) / ppp);
            let c = composite(&layers, rect, p);
            pixels.push(texel(c, opacity * coverage(rect, radius, p)));
        }
    }
    Some(egui::ColorImage {
        size,
        pixels,
        source_size: egui::vec2(w as f32, h as f32),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m() -> Metrics {
        Metrics {
            units: we_metrics::UnitMetrics::default(),
            viewport: Size {
                width: 1440.0,
                height: 900.0,
            },
        }
    }

    #[test]
    fn glows_page_parses_into_three_radial_layers() {
        let text = "radial-gradient(45vmax 40vmax at 32% -12%, rgba(117, 255, 190, 0.15), transparent 70%), radial-gradient(50vmax 45vmax at 104% 112%, rgba(109, 38, 183, 0.24), transparent 70%), radial-gradient(40vmax 36vmax at -8% 110%, rgba(37, 40, 125, 0.3), transparent 70%)";
        let rect = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(1000.0, 800.0));
        let layers = parse(text, rect, m());
        assert_eq!(layers.len(), 3);
        let Shape::Radial { center, rx, ry } = layers[0].shape else {
            panic!("radial");
        };
        assert!(
            (center.x - 320.0).abs() < 0.5 && (center.y + 96.0).abs() < 0.5,
            "{center:?}"
        );
        assert!(
            (rx - 648.0).abs() < 0.5 && (ry - 576.0).abs() < 0.5,
            "{rx} {ry}"
        );
        assert_eq!(layers[0].stops.len(), 2);
        assert!((layers[0].stops[1].at - 0.7).abs() < 1e-4);
    }

    /// The same gradient over a box of the same size is rasterised once
    /// and drawn wherever the box is.
    #[test]
    fn a_repeated_box_reuses_its_texture() {
        let ctx = egui::Context::default();
        let text = "radial-gradient(45vmax 40vmax at 32% -12%, rgba(117, 255, 190, 0.15), transparent 70%)";
        let size = egui::vec2(300.0, 200.0);
        let mut uploads = 0;
        let mut drawn = Vec::new();
        for at in [egui::pos2(0.0, 0.0), egui::pos2(40.0, 10.0)] {
            let mut out = ctx.run_ui(egui::RawInput::default(), |ui| {
                paint(
                    ui.painter(),
                    egui::Rect::from_min_size(at, size),
                    0.0,
                    text,
                    1.0,
                    m(),
                );
            });
            uploads += out
                .textures_delta
                .set
                .values()
                .flatten()
                .filter(|d| d.image.size() == [300, 200])
                .count();
            let ids: Vec<_> = out
                .shapes
                .iter()
                .filter_map(|s| match &s.shape {
                    egui::Shape::Mesh(mesh) => Some((mesh.texture_id, mesh.calc_bounds())),
                    _ => None,
                })
                .collect();
            drawn.push(ids);
            out.textures_delta.clear();
        }
        assert_eq!(uploads, 1, "one upload: the moved box hits the cache");
        assert_eq!(drawn[0].len(), 1);
        assert_eq!(drawn[0][0].0, drawn[1][0].0, "the same texture");
        assert_eq!(drawn[1][0].1.min, egui::pos2(40.0, 10.0));
    }

    /// A pixel is the layers at its centre, so a horizontal ramp over 4px
    /// reads 1/8, 3/8, 5/8, 7/8 of the way.
    #[test]
    fn a_pixel_is_the_gradient_at_its_centre() {
        let img = build(
            [4, 1],
            1.0,
            0.0,
            "linear-gradient(to right, black, white)",
            1.0,
            m(),
        )
        .expect("parses");
        let reds: Vec<u8> = img.pixels.iter().map(|p| p.r()).collect();
        assert_eq!(reds, vec![32, 96, 159, 223]);
    }

    /// The property `texel` buys: every blend of a gradient texel over any
    /// byte divides the same way under lavapipe's old `x/255` as exactly.
    #[test]
    fn a_texel_blends_the_same_under_either_division() {
        let old = |x: u32| (x + (x >> 8) + 0x80) >> 8;
        let exact = |x: u32| (x + 0x80 + ((x + 0x80) >> 8)) >> 8;
        assert!((0..=65025).all(|x| exact(x) == (x as f32 / 255.0).round() as u32));
        assert!(
            (0..=255u32).any(|a| (0..=255u32).any(|d| old(d * (255 - a)) != exact(d * (255 - a))))
        );
        for step in 0..=1000 {
            let t = step as f32 / 1000.0;
            let c = [0.05 * t, 0.06 * t, 0.15 * t, 0.75 * t];
            let px = texel(c, 1.0);
            let a = u32::from(px.a());
            assert_eq!(a % 3, 0, "{px:?}");
            assert!(px.r() <= px.a() && px.g() <= px.a() && px.b() <= px.a());
            for d in 0..=255u32 {
                assert_eq!(old(d * (255 - a)), exact(d * (255 - a)), "d {d} a {a}");
            }
        }
    }

    #[test]
    fn unpositioned_stops_spread_evenly() {
        let rect = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(100.0, 100.0));
        let l = parse("linear-gradient(red, lime, blue)", rect, m());
        let at: Vec<f32> = l[0].stops.iter().map(|s| s.at).collect();
        assert_eq!(at, vec![0.0, 0.5, 1.0]);
    }
}
