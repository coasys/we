//! The WE webfonts, registered into egui's `FontDefinitions`.
//!
//! The families are the ones `font.ts` ships plus the faces themes carry
//! in their `fontFaces` — the same files the web side loads, pulled in
//! with `include_bytes!`/`include_str!` so nothing is duplicated:
//!
//! | family              | source file                                                      | weight  | licence     |
//! |---------------------|------------------------------------------------------------------|---------|-------------|
//! | DM Sans             | `1-tokens/src/fonts/dm-sans-latin*.woff2`                        | 400     | SIL OFL 1.1 |
//! | Mozilla Text        | `1-tokens/src/fonts/mozilla-text-latin*.woff2`                   | 200–700 | SIL OFL 1.1 |
//! | Boldonse            | `1-tokens/src/fonts/boldonse-latin*.woff2`                       | 400     | SIL OFL 1.1 |
//! | VT323               | `2-themes/src/retro/vt323.ts` (the theme's `fontFaces` data-URL) | 400     | SIL OFL 1.1 |
//! | Bricolage Grotesque | `cartridges/src/coasys/assets/BricolageGrotesque-latin.woff2`    | 300–800 | SIL OFL 1.1 |
//!
//! Each family's *latin* file precedes its *latin-ext* — egui falls back
//! down the list for missing glyphs, matching the CSS `unicode-range`
//! pairing.
//!
//! Every shipped face is WOFF2 (the browsers' container) and epaint's
//! `skrifa` reads raw sfnt, so each payload is decompressed to TTF once at
//! install via `wuff`.
//!
//! Weights: epaint shapes and rasterises at the `wght` (and `opsz`)
//! coordinates a `TextFormat` carries, so the two variable families reach
//! every weight they declare with no per-weight files. Two things keep that
//! honest, both here: a run that names no weight must land on CSS
//! `normal` (400) rather than the file's default instance — Mozilla Text's
//! is 200, Bricolage's 800 at opsz 96 — so each variable face carries a
//! `FontTweak` default of 400; and [`variation`] clamps a request to the
//! range the web's `@font-face` declares. A family with no face at the
//! asked-for weight is emboldened the way a browser synthesises it
//! ([`synthesises_bold`]); a variable one never is.
//!
//! VT323 is a pixel font, and its hints (ttfautohint's) fit only the y
//! axis — Chrome covers the x axis with LCD anti-aliasing, which a
//! grey-scale raster cannot. Its faces get x grid-fitting added to their
//! instructions ([`crate::pixel_grid`]), are hinted for monochrome
//! (`HintingTarget::Mono`, which executes x moves) and are placed without
//! sub-pixel bins, so every edge lands on a whole physical pixel.
use std::sync::Arc;

use base64::Engine as _;

/// The family names CSS stacks may quote — `family_named` answers for
/// exactly these.
const FAMILIES: &[&str] = &[
    "DM Sans",
    "Mozilla Text",
    "Boldonse",
    "VT323",
    "Bricolage Grotesque",
];

/// WOFF2 → TTF, once at install — epaint only reads raw sfnt.
fn ttf(woff2: &[u8]) -> egui::FontData {
    egui::FontData::from_owned(wuff::decompress_woff2(woff2).expect("vendored woff2 decodes"))
}

/// The retro theme's `fontFaces` entry, decoded out of `vt323.ts` — the
/// same base64 the web registers via the FontFace API, so the bytes can
/// never drift from it — with x grid-fitting added to its instructions
/// (see [`crate::pixel_grid`]).
fn vt323() -> egui::FontData {
    const VT323_TS: &str =
        include_str!("../../../../packages/design-system/2-themes/src/retro/vt323.ts");
    let woff2 = VT323_TS
        .split("base64,")
        .nth(1)
        .and_then(|rest| rest.split('\'').next())
        .and_then(|b64| base64::engine::general_purpose::STANDARD.decode(b64).ok())
        .expect("retro/vt323.ts keeps a data:font/woff2;base64 payload");
    let sfnt = wuff::decompress_woff2(&woff2).expect("vendored woff2 decodes");
    egui::FontData::from_owned(crate::pixel_grid::snap_x(&sfnt).unwrap_or(sfnt))
}

/// Every shipped face file, by family — the latin file before the
/// latin-ext one, the order egui falls back in. A family's *own* faces are
/// exactly these, which is what a chain copies before its generics.
const FACE_FILES: &[(&str, &str)] = &[
    ("DM Sans", "dm-sans-latin"),
    ("DM Sans", "dm-sans-latin-ext"),
    ("Mozilla Text", "mozilla-text-latin"),
    ("Mozilla Text", "mozilla-text-latin-ext"),
    ("Boldonse", "boldonse-latin"),
    ("Boldonse", "boldonse-latin-ext"),
    ("VT323", "vt323-latin"),
    ("Bricolage Grotesque", "bricolage-grotesque-latin"),
];

/// The `font-weight` range each family's faces answer for — the web's
/// `@font-face` declaration, which is what CSS matches a request against
/// (Bricolage's file reaches 200; its theme declares 300–800).
fn weight_range(family: &str) -> (f32, f32) {
    match family {
        "Mozilla Text" => (200.0, 700.0),
        "Bricolage Grotesque" => (300.0, 800.0),
        _ => (400.0, 400.0),
    }
}

/// Bricolage's optical-size axis — the browser sets it to the font size
/// in CSS px (`font-optical-sizing: auto`).
const OPSZ: (f32, f32) = (12.0, 96.0);

/// How a family's faces are rasterised. The variable faces default to
/// `wght` 400 (and Bricolage to a body-text `opsz`), so text laid out
/// without coordinates — egui's own widgets, the inputs — is CSS `normal`,
/// not the file's default instance. VT323 is grid-fitted for monochrome
/// and placed on whole pixels.
fn tweak(family: &str) -> egui::FontTweak {
    let mut t = egui::FontTweak::default();
    match family {
        "Mozilla Text" => {
            t.coords = egui::epaint::text::VariationCoords::new([(b"wght", 400.0)]);
        }
        "Bricolage Grotesque" => {
            t.coords =
                egui::epaint::text::VariationCoords::new([(b"wght", 400.0), (b"opsz", 16.0)]);
        }
        "VT323" => {
            t.hinting = Some(true);
            t.hinting_target = egui::epaint::text::HintingTarget::Mono;
            t.subpixel_binning = Some(false);
        }
        _ => {}
    }
    t
}

/// The WE family a resolved egui family is set in first — the leading
/// entry of its chain key — or `None` when it leads with a generic.
fn primary(family: &egui::FontFamily) -> Option<&'static str> {
    let egui::FontFamily::Name(key) = family else {
        return None;
    };
    let head = key.split(", ").next().unwrap_or_default();
    FAMILIES.iter().copied().find(|f| *f == head)
}

/// The variation coordinates a run in `family` at `weight` and `size_px`
/// (CSS px) is set at: for a variable family `wght` clamped to its
/// declared range (400 when no weight is asked for) and Bricolage's `opsz`
/// at the size. A static face has no axes and ignores a coordinate, so it
/// carries the authored `wght` as it was asked for — the record of the
/// resolved weight a galley keeps — and the look comes from
/// [`synthesises_bold`].
pub(crate) fn variation(
    family: &egui::FontFamily,
    weight: Option<f32>,
    size_px: f32,
) -> egui::epaint::text::VariationCoords {
    let mut coords = egui::epaint::text::VariationCoords::default();
    let (lo, hi) = primary(family).map_or((400.0, 400.0), weight_range);
    if lo == hi {
        if let Some(w) = weight {
            coords.push(b"wght", w);
        }
        return coords;
    }
    coords.push(b"wght", weight.unwrap_or(400.0).clamp(lo, hi));
    if primary(family) == Some("Bricolage Grotesque") {
        coords.push(b"opsz", size_px.clamp(OPSZ.0, OPSZ.1));
    }
    coords
}

/// Whether a run in `family` at `weight` is emboldened synthetically — as
/// the browser does when the matched face is lighter than bold: a request
/// of 600 or more whose clamped weight is still below 600. DM Sans, VT323,
/// Boldonse and the generics are, a variable face never is.
pub(crate) fn synthesises_bold(family: &egui::FontFamily, weight: Option<f32>) -> bool {
    let w = weight.unwrap_or(400.0);
    let (lo, hi) = primary(family).map_or((400.0, 400.0), weight_range);
    w >= 600.0 && w.clamp(lo, hi) < 600.0
}

/// The decoded face for one of [`FACE_FILES`].
fn face_data(file: &str) -> egui::FontData {
    macro_rules! tok {
        ($f:literal) => {
            include_bytes!(concat!(
                "../../../../packages/design-system/1-tokens/src/fonts/",
                $f
            ))
        };
    }
    match file {
        "dm-sans-latin" => ttf(tok!("dm-sans-latin.woff2")),
        "dm-sans-latin-ext" => ttf(tok!("dm-sans-latin-ext.woff2")),
        "mozilla-text-latin" => ttf(tok!("mozilla-text-latin.woff2")),
        "mozilla-text-latin-ext" => ttf(tok!("mozilla-text-latin-ext.woff2")),
        "boldonse-latin" => ttf(tok!("boldonse-latin.woff2")),
        "boldonse-latin-ext" => ttf(tok!("boldonse-latin-ext.woff2")),
        "vt323-latin" => vt323(),
        "bricolage-grotesque-latin" => ttf(include_bytes!(concat!(
            "../../../../packages/templates/cartridges/src/coasys/assets/",
            "BricolageGrotesque-latin.woff2"
        ))),
        other => unreachable!("no vendored face {other}"),
    }
}

/// Register every WE family into `fonts`, after egui's defaults — a stack
/// that names none of them still lands on `Proportional`/`Monospace`.
/// `font_data` names stay file-unique so the latin and latin-ext faces of
/// one family coexist in the fallback list.
///
/// Every CSS stack ends in a generic, and a glyph the named face lacks
/// falls through to it (VT323 has no U+2192). So each family is registered
/// as two chains up front — `X` (own faces, then `Proportional`'s list) and
/// `X, monospace` (own faces, then `Monospace`'s) — which covers every
/// one-family theme stack from the first frame. The generic lists must be
/// complete before this runs (media.rs appends the Noto symbol subsets
/// first): the chains copy them. The primary face still sets the metrics —
/// epaint reads them off the chain's first face — so only previously
/// missing glyphs move.
pub(crate) fn install(fonts: &mut egui::FontDefinitions) {
    for (family, file) in FACE_FILES {
        let mut data = face_data(file);
        data.tweak = tweak(family);
        fonts.font_data.insert(file.to_string(), data.into());
        fonts
            .families
            .entry(egui::FontFamily::Name(Arc::from(*family)))
            .or_default()
            .push(file.to_string());
    }
    for family in FAMILIES {
        for links in [
            vec![Link::Named(family.to_string())],
            vec![
                Link::Named(family.to_string()),
                Link::Generic(egui::FontFamily::Monospace),
            ],
        ] {
            let chain = Chain { links };
            let key = chain.key().expect("a named chain has a key");
            let faces = chain.faces(fonts);
            fonts
                .families
                .insert(egui::FontFamily::Name(Arc::from(key.as_str())), faces);
        }
    }
}

/// `head` then every face of `tail` not already in it.
fn chained(head: &[String], tail: &[String]) -> Vec<String> {
    let mut out = head.to_vec();
    for f in tail {
        if !out.contains(f) {
            out.push(f.clone());
        }
    }
    out
}

/// Strip one CSS stack entry: `'DM Sans'` → `DM Sans`; `system-ui` stays.
fn unquote(entry: &str) -> &str {
    let e = entry.trim();
    e.strip_prefix('\'')
        .and_then(|s| s.strip_suffix('\''))
        .or_else(|| e.strip_prefix('"').and_then(|s| s.strip_suffix('"')))
        .unwrap_or(e)
}

/// Generic + platform mono names — entries that mean "the system mono",
/// resolved to egui's bundled `Monospace`.
fn is_mono(entry: &str) -> bool {
    let e = entry.to_ascii_lowercase();
    e.contains("mono") || e == "consolas" || e == "menlo" || e == "courier" || e == "courier new"
}

/// CSS generic families that are not mono — egui's `Proportional` stands in
/// for all of them. Platform names (`-apple-system`, `Segoe UI`, `Roboto`)
/// are not generics: they are faces we do not have, skipped like any other.
fn is_sans_generic(entry: &str) -> bool {
    matches!(
        entry.to_ascii_lowercase().as_str(),
        "sans-serif"
            | "serif"
            | "system-ui"
            | "ui-sans-serif"
            | "ui-serif"
            | "ui-rounded"
            | "cursive"
            | "fantasy"
            | "emoji"
            | "math"
    )
}

/// One entry of a resolved stack: a WE family with faces installed, or a
/// generic (egui's `Proportional` or `Monospace`).
#[derive(Clone, PartialEq)]
enum Link {
    Named(String),
    Generic(egui::FontFamily),
}

/// What a CSS `font-family` stack resolves to: its usable entries IN STACK
/// ORDER — installed WE families and generics alike, each once. Skipping
/// uninstalled names is the CSS behaviour (a face that didn't load falls
/// through to the next entry), and a generic keeps its place:
/// `monospace, 'VT323'` tries the mono faces first, and
/// `'VT323', sans-serif, monospace` the sans ones before the mono ones. A
/// final sans generic after a named face is dropped — it is the implicit
/// tail every chain without a generic gets anyway — so `'DM Sans',
/// sans-serif` and `'DM Sans'` are the same chain, `DM Sans`.
struct Chain {
    links: Vec<Link>,
}

impl Chain {
    fn of(stack: &str, weight: Option<f32>, has_face: impl Fn(&str) -> bool) -> Self {
        let mut links: Vec<Link> = Vec::new();
        for entry in stack.split(',') {
            let name = unquote(entry);
            let link = if let Some(base) = FAMILIES.iter().find(|f| f.eq_ignore_ascii_case(name)) {
                if !has_face(base) {
                    continue;
                }
                // A weight-specific face would register as `"<base> Bold"`
                // (none ship — the variable faces take `wght` instead).
                let bold = format!("{base} Bold");
                Link::Named(if weight.is_some_and(|w| w >= 600.0) && has_face(&bold) {
                    bold
                } else {
                    base.to_string()
                })
            } else if is_mono(name) {
                Link::Generic(egui::FontFamily::Monospace)
            } else if is_sans_generic(name) {
                Link::Generic(egui::FontFamily::Proportional)
            } else {
                continue;
            };
            if !links.contains(&link) {
                links.push(link);
            }
        }
        let named = links.iter().any(|l| matches!(l, Link::Named(_)));
        if named && links.last() == Some(&Link::Generic(egui::FontFamily::Proportional)) {
            links.pop();
        }
        Self { links }
    }

    /// The registered family name of the chain — its entries joined in
    /// order, generics spelled `sans-serif`/`monospace` (`"VT323"`,
    /// `"VT323, monospace"`, `"monospace, VT323"`). `None` when it names no
    /// installed WE family: the generic alone answers. A `", "` never
    /// occurs in a face's own name.
    fn key(&self) -> Option<String> {
        if !self.links.iter().any(|l| matches!(l, Link::Named(_))) {
            return None;
        }
        let parts: Vec<&str> = self
            .links
            .iter()
            .map(|l| match l {
                Link::Named(n) => n.as_str(),
                Link::Generic(egui::FontFamily::Monospace) => "monospace",
                Link::Generic(_) => "sans-serif",
            })
            .collect();
        Some(parts.join(", "))
    }

    /// The stack's first generic — what it resolves to with no WE family.
    fn generic(&self) -> egui::FontFamily {
        self.links
            .iter()
            .find_map(|l| match l {
                Link::Generic(g) => Some(g.clone()),
                Link::Named(_) => None,
            })
            .unwrap_or(egui::FontFamily::Proportional)
    }

    /// The faces of the chain against `defs`: each entry in order — a
    /// family's own files, a generic's whole list — then `Proportional`'s
    /// when no generic was written (the browser default), each face once.
    fn faces(&self, defs: &egui::FontDefinitions) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for link in &self.links {
            let part: Vec<String> = match link {
                Link::Named(n) => {
                    let own: Vec<String> = FACE_FILES
                        .iter()
                        .filter(|(f, file)| f == n && defs.font_data.contains_key(*file))
                        .map(|(_, file)| file.to_string())
                        .collect();
                    if own.is_empty() {
                        defs.families
                            .get(&egui::FontFamily::Name(Arc::from(n.as_str())))
                            .cloned()
                            .unwrap_or_default()
                    } else {
                        own
                    }
                }
                Link::Generic(g) => defs.families.get(g).cloned().unwrap_or_default(),
            };
            out = chained(&out, &part);
        }
        if !self.links.iter().any(|l| matches!(l, Link::Generic(_))) {
            let prop = defs
                .families
                .get(&egui::FontFamily::Proportional)
                .cloned()
                .unwrap_or_default();
            out = chained(&out, &prop);
        }
        out
    }

    /// A family `install` always registers that comes closest, for the
    /// rare pass that must lay text out before the chain's own
    /// registration lands: the first entry's one-family chain (with its
    /// first generic), or the leading generic.
    fn fallback(&self) -> egui::FontFamily {
        match self.links.first() {
            Some(Link::Named(n)) => {
                let mono = self.generic() == egui::FontFamily::Monospace;
                let key = if mono {
                    format!("{n}, monospace")
                } else {
                    n.clone()
                };
                egui::FontFamily::Name(Arc::from(key.as_str()))
            }
            Some(Link::Generic(g)) => g.clone(),
            None => egui::FontFamily::Proportional,
        }
    }
}

/// The egui family a CSS `font-family` stack resolves to — the chain of
/// its entries (see [`Chain`]); egui's generic alone when it names no WE
/// family.
#[cfg(test)]
fn family_named(
    stack: &str,
    weight: Option<f32>,
    has_face: impl Fn(&str) -> bool,
) -> egui::FontFamily {
    let chain = Chain::of(stack, weight, has_face);
    match chain.key() {
        Some(k) => egui::FontFamily::Name(Arc::from(k.as_str())),
        None => chain.generic(),
    }
}

/// The installed WE family names on the context's fonts.
fn installed(f: &egui::epaint::text::FontsView<'_>) -> std::collections::BTreeSet<Arc<str>> {
    f.families()
        .into_iter()
        .filter_map(|fam| match fam {
            egui::FontFamily::Name(n) => Some(n),
            _ => None,
        })
        .collect()
}

/// Queue chains `install` could not foresee. Every queued chain of one
/// pass accumulates into ONE pending definition set — egui keeps only the
/// last `set_fonts` of a pass, so separate copies of the active
/// definitions would each drop the others' additions. egui applies the set
/// at once if no text was laid out yet this pass, else before the next.
fn register(ctx: &egui::Context, chains: Vec<(String, Vec<String>)>) {
    #[derive(Clone)]
    struct Pending {
        pass: u64,
        defs: Arc<egui::FontDefinitions>,
    }
    if chains.is_empty() {
        return;
    }
    let id = egui::Id::unique("we-egui::font-chains-pending");
    let pass = ctx.cumulative_pass_nr();
    let mut defs = ctx
        .data_mut(|d| d.get_temp::<Pending>(id))
        .filter(|p| p.pass == pass)
        .map(|p| (*p.defs).clone())
        .unwrap_or_else(|| ctx.fonts(|f| f.definitions().clone()));
    let mut changed = false;
    for (key, faces) in chains {
        let fam = egui::FontFamily::Name(Arc::from(key.as_str()));
        if let std::collections::btree_map::Entry::Vacant(e) = defs.families.entry(fam) {
            e.insert(faces);
            changed = true;
        }
    }
    if !changed {
        return;
    }
    ctx.data_mut(|d| {
        d.insert_temp(
            id,
            Pending {
                pass,
                defs: Arc::new(defs.clone()),
            },
        )
    });
    ctx.set_fonts(defs);
    ctx.request_repaint();
}

/// Register, before anything is measured, the chain of every stack the
/// coming layout will use — so a several-name stack (`'VT323', 'DM Sans',
/// sans-serif`) is laid out in its own chain on the first frame it
/// appears rather than in a provisional one. `layout` calls this with
/// every node's resolved stack; egui swaps the definitions in at once
/// while no text has been laid out this pass.
pub(crate) fn prepare<'s>(
    ctx: &egui::Context,
    stacks: impl IntoIterator<Item = (&'s str, Option<f32>)>,
) {
    let wanted = ctx.fonts(|f| {
        let have = installed(f);
        let mut out: Vec<(String, Vec<String>)> = Vec::new();
        for (stack, weight) in stacks {
            let chain = Chain::of(stack, weight, |n| have.contains(n));
            let Some(key) = chain.key() else { continue };
            if have.contains(key.as_str()) || out.iter().any(|(k, _)| *k == key) {
                continue;
            }
            let faces = chain.faces(f.definitions());
            out.push((key, faces));
        }
        out
    });
    register(ctx, wanted);
}

/// The egui family for a CSS `font-family` stack against the context's
/// installed families — an `install` that never ran (headless tests) makes
/// every WE name fall through to egui's generics.
///
/// A chain nobody registered yet ([`prepare`] normally has) is queued here
/// and used at once if egui could apply it; otherwise this pass uses
/// [`Chain::fallback`] and the next pass the chain itself.
pub(crate) fn resolve(ctx: &egui::Context, stack: &str, weight: Option<f32>) -> egui::FontFamily {
    let (family, register_it) = ctx.fonts(|f| {
        let have = installed(f);
        let chain = Chain::of(stack, weight, |name| have.contains(name));
        let Some(key) = chain.key() else {
            return (chain.generic(), None);
        };
        if have.contains(key.as_str()) {
            return (egui::FontFamily::Name(Arc::from(key.as_str())), None);
        }
        let faces = chain.faces(f.definitions());
        (chain.fallback(), Some((key, faces)))
    });
    let Some((key, faces)) = register_it else {
        return family;
    };
    register(ctx, vec![(key.clone(), faces)]);
    let now = egui::FontFamily::Name(Arc::from(key.as_str()));
    if ctx.fonts(|f| f.families().contains(&now)) {
        now
    } else {
        family
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stacks_resolve() {
        assert_eq!(
            family_named("'DM Sans', sans-serif", None, |_| true),
            egui::FontFamily::Name(Arc::from("DM Sans"))
        );
        assert_eq!(
            family_named("'VT323', monospace", None, |_| true),
            egui::FontFamily::Name(Arc::from("VT323, monospace"))
        );
        assert_eq!(
            family_named("'VT323', 'DM Sans', sans-serif", None, |_| true),
            egui::FontFamily::Name(Arc::from("VT323, DM Sans"))
        );
        assert_eq!(
            family_named(
                "'Bricolage Grotesque', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
                Some(300.0),
                |_| true
            ),
            egui::FontFamily::Name(Arc::from("Bricolage Grotesque"))
        );
        assert_eq!(
            family_named("monospace", None, |_| true),
            egui::FontFamily::Monospace
        );
        assert_eq!(
            family_named(
                "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
                None,
                |_| true
            ),
            egui::FontFamily::Monospace
        );
        assert_eq!(
            family_named("system-ui, -apple-system, sans-serif", None, |_| true),
            egui::FontFamily::Proportional
        );
        // Generic entries keep their place in the stack.
        assert_eq!(
            family_named("monospace, 'VT323'", None, |_| true),
            egui::FontFamily::Name(Arc::from("monospace, VT323"))
        );
        assert_eq!(
            family_named("'VT323', sans-serif, monospace", None, |_| true),
            egui::FontFamily::Name(Arc::from("VT323, sans-serif, monospace"))
        );
    }

    /// A request is clamped to the range the web's `@font-face` declares,
    /// and only a face lighter than bold after that is synthesised.
    #[test]
    fn weights_clamp_to_the_declared_range() {
        let fam = |n: &str| egui::FontFamily::Name(Arc::from(n));
        let wght = |f: &egui::FontFamily, w: Option<f32>| {
            variation(f, w, 16.0)
                .as_ref()
                .iter()
                .find(|(t, _)| t.to_be_bytes() == *b"wght")
                .map(|(_, v)| *v)
        };
        assert_eq!(wght(&fam("Mozilla Text"), None), Some(400.0));
        assert_eq!(wght(&fam("Mozilla Text"), Some(900.0)), Some(700.0));
        assert_eq!(wght(&fam("Bricolage Grotesque"), Some(200.0)), Some(300.0));
        assert_eq!(wght(&fam("DM Sans"), Some(700.0)), Some(700.0));
        assert_eq!(wght(&fam("DM Sans"), None), None);
        assert!(!synthesises_bold(&fam("Mozilla Text"), Some(900.0)));
        assert!(!synthesises_bold(
            &fam("Bricolage Grotesque, monospace"),
            Some(700.0)
        ));
        assert!(synthesises_bold(&fam("DM Sans"), Some(600.0)));
        assert!(synthesises_bold(&fam("VT323, monospace"), Some(700.0)));
        assert!(synthesises_bold(
            &egui::FontFamily::Proportional,
            Some(700.0)
        ));
        assert!(!synthesises_bold(&fam("DM Sans"), Some(500.0)));
    }

    #[test]
    fn uninstalled_names_fall_through_the_stack() {
        // CSS skips a font-family whose faces never loaded; ours does too.
        assert_eq!(
            family_named("'VT323', monospace", None, |n| n != "VT323"),
            egui::FontFamily::Monospace
        );
        assert_eq!(
            family_named("'DM Sans', sans-serif", None, |_| false),
            egui::FontFamily::Proportional
        );
    }

    #[test]
    fn families_decode_and_parse() {
        let mut defs = egui::FontDefinitions::default();
        install(&mut defs);
        for name in FAMILIES {
            let list = defs
                .families
                .get(&egui::FontFamily::Name(Arc::from(*name)))
                .unwrap_or_else(|| panic!("{name} registered"));
            assert!(!list.is_empty(), "{name} has faces");
            for face in list {
                // wuff → raw sfnt: first four bytes are the sfnt tag,
                // what skrifa will parse on paint.
                let magic = &defs.font_data[face].font.as_ref().as_ref()[..4];
                assert!(
                    matches!(magic, b"\x00\x01\x00\x00" | b"true" | b"OTTO"),
                    "{face} decoded to sfnt ({magic:?})"
                );
            }
        }
    }
}
