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
//! Every shipped face is WOFF2 (the browsers' container) and egui's
//! `ab_glyph` reads raw sfnt, so each payload is decompressed to TTF
//! once at install via `wuff`.
//!
//! ab_glyph does not instance variable fonts, so a weight request can only
//! reach a *file that carries it*: `family_named` looks for a
//! `"Family Bold"` variant in the registered set before settling for the
//! base file. No per-weight files ship today — Mozilla Text's and
//! Bricolage's range rides the default instance, exactly like DM Sans's
//! browser-synthesised bolds land unstyled here.
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

/// WOFF2 → TTF, once at install — `ab_glyph` only reads raw sfnt.
fn ttf(woff2: &[u8]) -> egui::FontData {
    egui::FontData::from_owned(wuff::decompress_woff2(woff2).expect("vendored woff2 decodes"))
}

/// The retro theme's `fontFaces` entry, decoded out of `vt323.ts` — the
/// same base64 the web registers via the FontFace API, so the bytes can
/// never drift from it.
fn vt323() -> egui::FontData {
    const VT323_TS: &str =
        include_str!("../../../../packages/design-system/2-themes/src/retro/vt323.ts");
    let woff2 = VT323_TS
        .split("base64,")
        .nth(1)
        .and_then(|rest| rest.split('\'').next())
        .and_then(|b64| base64::engine::general_purpose::STANDARD.decode(b64).ok())
        .expect("retro/vt323.ts keeps a data:font/woff2;base64 payload");
    ttf(&woff2)
}

/// Register every WE family into `fonts`, after egui's defaults — a stack
/// that names none of them still lands on `Proportional`/`Monospace`.
/// `font_data` names stay file-unique so the latin and latin-ext faces of
/// one family coexist in the fallback list.
pub(crate) fn install(fonts: &mut egui::FontDefinitions) {
    macro_rules! tok {
        ($f:literal) => {
            include_bytes!(concat!(
                "../../../../packages/design-system/1-tokens/src/fonts/",
                $f
            ))
        };
    }
    let faces: [(&str, &str, egui::FontData); 8] = [
        ("DM Sans", "dm-sans-latin", ttf(tok!("dm-sans-latin.woff2"))),
        (
            "DM Sans",
            "dm-sans-latin-ext",
            ttf(tok!("dm-sans-latin-ext.woff2")),
        ),
        (
            "Mozilla Text",
            "mozilla-text-latin",
            ttf(tok!("mozilla-text-latin.woff2")),
        ),
        (
            "Mozilla Text",
            "mozilla-text-latin-ext",
            ttf(tok!("mozilla-text-latin-ext.woff2")),
        ),
        (
            "Boldonse",
            "boldonse-latin",
            ttf(tok!("boldonse-latin.woff2")),
        ),
        (
            "Boldonse",
            "boldonse-latin-ext",
            ttf(tok!("boldonse-latin-ext.woff2")),
        ),
        ("VT323", "vt323-latin", vt323()),
        (
            "Bricolage Grotesque",
            "bricolage-grotesque-latin",
            ttf(include_bytes!(concat!(
                "../../../../packages/templates/cartridges/src/coasys/assets/",
                "BricolageGrotesque-latin.woff2"
            ))),
        ),
    ];
    for (family, file, data) in faces {
        fonts.font_data.insert(file.to_string(), data.into());
        fonts
            .families
            .entry(egui::FontFamily::Name(Arc::from(family)))
            .or_default()
            .push(file.to_string());
    }
    // Every CSS stack ends in a generic, and a glyph the named face lacks
    // falls through to it (VT323 has no U+2192). Each family's chain is its
    // own faces then the generic's: `X` for a stack ending in a sans/serif/
    // system generic (`Proportional`), `X, monospace` for one naming a mono
    // entry. The primary face still sets the metrics — epaint reads them
    // off the chain's first face — so only previously missing glyphs move.
    let tail = |g: egui::FontFamily| fonts.families.get(&g).cloned().unwrap_or_default();
    let (prop, mono) = (
        tail(egui::FontFamily::Proportional),
        tail(egui::FontFamily::Monospace),
    );
    for family in FAMILIES {
        let own = fonts
            .families
            .get(&egui::FontFamily::Name(Arc::from(*family)))
            .cloned()
            .unwrap_or_default();
        fonts.families.insert(
            egui::FontFamily::Name(Arc::from(Chain::key_of(&[family], true).as_str())),
            chained(&own, &mono),
        );
        fonts.families.insert(
            egui::FontFamily::Name(Arc::from(*family)),
            chained(&own, &prop),
        );
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

/// What a CSS `font-family` stack resolves to: the WE families it names
/// *with faces installed* (`has_face`), in stack order, and whether its
/// generic is mono. Skipping uninstalled names is the CSS behaviour — a
/// face that didn't load falls through to the next stack entry — and no
/// later entry is dropped: each one is a further link of the chain.
struct Chain {
    names: Vec<String>,
    mono: bool,
}

impl Chain {
    fn of(stack: &str, weight: Option<f32>, has_face: impl Fn(&str) -> bool) -> Self {
        let mut names: Vec<String> = Vec::new();
        let mut mono = false;
        for entry in stack.split(',') {
            let name = unquote(entry);
            if let Some(base) = FAMILIES.iter().find(|f| f.eq_ignore_ascii_case(name)) {
                if !has_face(base) {
                    continue;
                }
                // A weight-specific face would register as `"<base> Bold"`
                // (none ship — variable files can't instance under ab_glyph).
                let bold = format!("{base} Bold");
                let pick = if weight.is_some_and(|w| w >= 600.0) && has_face(&bold) {
                    bold
                } else {
                    base.to_string()
                };
                if !names.contains(&pick) {
                    names.push(pick);
                }
            } else if is_mono(name) {
                mono = true;
            }
        }
        Self { names, mono }
    }

    /// The registered family name of a chain: the lone family itself for a
    /// sans/system stack, `"X, monospace"` for a mono one, the names joined
    /// for several. A `", "` never occurs in a face's own name.
    fn key_of(names: &[&str], mono: bool) -> String {
        let mut k = names.join(", ");
        if mono {
            k.push_str(", monospace");
        }
        k
    }

    fn key(&self) -> Option<String> {
        if self.names.is_empty() {
            return None;
        }
        let names: Vec<&str> = self.names.iter().map(String::as_str).collect();
        Some(Self::key_of(&names, self.mono))
    }

    /// The generic the stack ends in.
    fn generic(&self) -> egui::FontFamily {
        if self.mono {
            egui::FontFamily::Monospace
        } else {
            egui::FontFamily::Proportional
        }
    }

    /// The single-name chain `install` registers for the first family —
    /// right until a several-name chain is registered.
    fn first(&self) -> egui::FontFamily {
        match self.names.first() {
            Some(n) => egui::FontFamily::Name(Arc::from(Self::key_of(&[n], self.mono).as_str())),
            None => self.generic(),
        }
    }
}

/// The egui family a CSS `font-family` stack resolves to — the chain of
/// its installed WE families then its generic (see [`Chain`]); egui's
/// generic alone when it names none.
pub(crate) fn family_named(
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

/// `family_named` against the context's installed families — an `install`
/// that never ran (headless tests) makes every WE name fall through to
/// egui's generics instead of resolving to an empty family.
///
/// A stack naming several WE families needs a chain `install` could not
/// foresee: it is added to the font definitions the first time it is seen
/// (each named family's own faces in stack order, then the generic's) and
/// this pass uses the first family's chain; egui swaps the definitions in
/// before the next pass, or at once if no text was laid out yet.
pub(crate) fn resolve(ctx: &egui::Context, stack: &str, weight: Option<f32>) -> egui::FontFamily {
    const PENDING: &str = "we-egui::font-chains-pending";
    let (family, register) = ctx.fonts(|f| {
        let installed: std::collections::BTreeSet<Arc<str>> = f
            .families()
            .into_iter()
            .filter_map(|fam| match fam {
                egui::FontFamily::Name(n) => Some(n),
                _ => None,
            })
            .collect();
        let chain = Chain::of(stack, weight, |name| installed.contains(name));
        let Some(key) = chain.key() else {
            return (chain.generic(), None);
        };
        if installed.contains(key.as_str()) {
            return (egui::FontFamily::Name(Arc::from(key.as_str())), None);
        }
        let defs = f.definitions();
        let generic = defs
            .families
            .get(&chain.generic())
            .cloned()
            .unwrap_or_default();
        let mut list: Vec<String> = Vec::new();
        for name in &chain.names {
            // A family's own faces: its registered chain less the
            // proportional tail `install` appended.
            let own = defs
                .families
                .get(&egui::FontFamily::Name(Arc::from(name.as_str())))
                .map(|l| {
                    let prop = defs.families.get(&egui::FontFamily::Proportional);
                    l.iter()
                        .filter(|face| !prop.is_some_and(|p| p.contains(face)))
                        .cloned()
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            list = chained(&list, &own);
        }
        let mut next = defs.clone();
        next.families.insert(
            egui::FontFamily::Name(Arc::from(key.as_str())),
            chained(&list, &generic),
        );
        (chain.first(), Some((key, next)))
    });
    if let Some((key, defs)) = register {
        let id = egui::Id::new((PENDING, key.as_str()));
        if ctx.data_mut(|d| d.get_temp::<bool>(id)).is_none() {
            ctx.data_mut(|d| d.insert_temp(id, true));
            ctx.set_fonts(defs);
            ctx.request_repaint();
        }
    }
    family
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
                // what ab_glyph will parse on paint.
                let magic = &defs.font_data[face].font.as_ref().as_ref()[..4];
                assert!(
                    matches!(magic, b"\x00\x01\x00\x00" | b"true" | b"OTTO"),
                    "{face} decoded to sfnt ({magic:?})"
                );
            }
        }
    }
}
