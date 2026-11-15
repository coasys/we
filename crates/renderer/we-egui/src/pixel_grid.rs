//! Horizontal grid-fitting for a pixel font, added to its TrueType
//! instructions once at install.
//!
//! VT323 carries ttfautohint's hints, which fit the *y* axis only: its rows
//! land on whole pixels, its columns wherever the scale puts them — at 16px
//! a design dot is 1.28px wide and every stem has a half-covered column on
//! each side. Chrome hides that behind LCD sub-pixel anti-aliasing, which
//! epaint does not do; on a grey-scale raster it reads as smear.
//!
//! So each simple glyph's program gets a tail that rounds every point's x
//! to the pixel grid (`SVTCA[x]`, `RTG`, then `MDAP[rnd]` per point, with
//! a dot's rounded corners aligned onto their edge — [`CORNER`]), and
//! every composite component rounds its offset (`ROUND_XY_TO_GRID`). Under
//! `HintingTarget::Mono` skrifa executes x moves, so a stem is a whole
//! number of pixels wide and starts on a pixel edge — with glyph origins
//! on whole pixels (no sub-pixel bins), every edge is. Advances are not
//! touched: epaint positions glyphs from the shaper's unhinted advances.
//!
//! The rewrite works on the decoded sfnt bytes — the same bytes the web
//! loads — so the outlines can never drift from `vt323.ts`.

/// Big-endian reads that fail softly: a font this cannot parse is
/// returned unchanged.
fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn put_u16(b: &mut [u8], at: usize, v: u16) {
    b[at..at + 2].copy_from_slice(&v.to_be_bytes());
}

/// The sfnt table checksum: the sum of the table's big-endian u32 words,
/// zero-padded to a whole word.
fn checksum(table: &[u8]) -> u32 {
    table.chunks(4).fold(0u32, |sum, w| {
        let mut word = [0u8; 4];
        word[..w.len()].copy_from_slice(w);
        sum.wrapping_add(u32::from_be_bytes(word))
    })
}

/// How far VT323 draws a dot's rounded corner outside its edge, in font
/// units, and the grid its edges sit on. A corner point is aligned to its
/// edge rather than rounded on its own, or at a scale where the edge
/// rounds down and the corner up (18px: 6.48 and 6.55 px) the corner
/// becomes a column of its own.
const CORNER: i32 = 4;
const EDGE_GRID: i32 = 20;

/// The x tail for a glyph whose points have these x coordinates: every
/// edge point rounded to the pixel grid, then every corner point (one
/// [`CORNER`] outside an edge on the [`EDGE_GRID`]) aligned onto an edge
/// point at that x. It runs after ttfautohint's own code, which leaves the
/// zone pointers on the twilight zone, so it points them back at the
/// glyph first.
fn x_round_program(xs: &[i32]) -> Vec<u8> {
    const SVTCA_X: u8 = 0x01;
    const SRP0: u8 = 0x10;
    const SZPS: u8 = 0x16;
    const RTG: u8 = 0x18;
    const MDAP_ROUND: u8 = 0x2f;
    const ALIGNRP: u8 = 0x3c;
    const PUSHB_1: u8 = 0xb0;
    const PUSHW_1: u8 = 0xb8;
    let push = |out: &mut Vec<u8>, p: usize| {
        if p < 256 {
            out.extend([PUSHB_1, p as u8]);
        } else {
            out.push(PUSHW_1);
            out.extend((p as u16).to_be_bytes());
        }
    };
    let edge_of = |x: i32| -> Option<usize> {
        if x.rem_euclid(EDGE_GRID) == 0 {
            return None;
        }
        [x - CORNER, x + CORNER]
            .into_iter()
            .filter(|e| e.rem_euclid(EDGE_GRID) == 0)
            .find_map(|e| xs.iter().position(|&q| q == e))
    };
    let mut out = vec![PUSHB_1, 1, SZPS, SVTCA_X, RTG];
    let mut corners = Vec::new();
    for (p, &x) in xs.iter().enumerate() {
        match edge_of(x) {
            Some(edge) => corners.push((p, edge)),
            None => {
                push(&mut out, p);
                out.push(MDAP_ROUND);
            }
        }
    }
    for (p, edge) in corners {
        push(&mut out, edge);
        out.push(SRP0);
        push(&mut out, p);
        out.push(ALIGNRP);
    }
    out
}

/// The x coordinates of a simple glyph's `points` points, decoded from
/// its flags and x deltas, which start at `at`.
fn simple_xs(g: &[u8], mut at: usize, points: usize) -> Option<Vec<i32>> {
    const X_SHORT: u8 = 0x02;
    const REPEAT: u8 = 0x08;
    const X_SAME_OR_POSITIVE: u8 = 0x10;
    let mut flags = Vec::with_capacity(points);
    while flags.len() < points {
        let f = *g.get(at)?;
        at += 1;
        flags.push(f);
        if f & REPEAT != 0 {
            let n = *g.get(at)?;
            at += 1;
            flags.extend(std::iter::repeat_n(f, n as usize));
        }
    }
    flags.truncate(points);
    let mut x = 0i32;
    let mut xs = Vec::with_capacity(points);
    for f in flags {
        if f & X_SHORT != 0 {
            let d = *g.get(at)? as i32;
            at += 1;
            x += if f & X_SAME_OR_POSITIVE != 0 { d } else { -d };
        } else if f & X_SAME_OR_POSITIVE == 0 {
            x += u16_at(g, at)? as i16 as i32;
            at += 2;
        }
        xs.push(x);
    }
    Some(xs)
}

/// One glyph record with the x-rounding tail appended (simple glyph) or
/// its components' offsets rounded (composite). Empty glyphs pass through.
fn snap_glyph(g: &[u8]) -> Option<Vec<u8>> {
    if g.is_empty() {
        return Some(Vec::new());
    }
    let contours = u16_at(g, 0)? as i16;
    if contours >= 0 {
        let n = contours as usize;
        let ends = 10;
        let points = if n == 0 {
            0
        } else {
            u16_at(g, ends + 2 * (n - 1))? + 1
        };
        let len_at = ends + 2 * n;
        let ins_len = u16_at(g, len_at)? as usize;
        let ins_end = len_at + 2 + ins_len;
        g.get(ins_end..)?;
        let tail = x_round_program(&simple_xs(g, ins_end, points as usize)?);
        let mut out = Vec::with_capacity(g.len() + tail.len());
        out.extend_from_slice(&g[..len_at]);
        out.extend(u16::try_from(ins_len + tail.len()).ok()?.to_be_bytes());
        out.extend_from_slice(&g[len_at + 2..ins_end]);
        out.extend(tail);
        out.extend_from_slice(&g[ins_end..]);
        return Some(out);
    }
    // Composite: flags, glyph index, args, an optional transform — set
    // ROUND_XY_TO_GRID on each component, in place.
    const ARG_WORDS: u16 = 0x0001;
    const ROUND_XY_TO_GRID: u16 = 0x0004;
    const HAVE_SCALE: u16 = 0x0008;
    const MORE: u16 = 0x0020;
    const HAVE_XY_SCALE: u16 = 0x0040;
    const HAVE_2X2: u16 = 0x0080;
    let mut out = g.to_vec();
    let mut at = 10;
    loop {
        let flags = u16_at(&out, at)?;
        put_u16(&mut out, at, flags | ROUND_XY_TO_GRID);
        at += 4 + if flags & ARG_WORDS != 0 { 4 } else { 2 };
        at += if flags & HAVE_SCALE != 0 {
            2
        } else if flags & HAVE_XY_SCALE != 0 {
            4
        } else if flags & HAVE_2X2 != 0 {
            8
        } else {
            0
        };
        if flags & MORE == 0 {
            break;
        }
    }
    Some(out)
}

/// `ttf` with every glyph's x grid-fitted under hinting (see the module
/// docs). The glyf, loca, head and maxp tables are rewritten; everything
/// else is copied. `None` when the font is not a TrueType sfnt this can
/// read — the caller keeps the original.
pub(crate) fn snap_x(ttf: &[u8]) -> Option<Vec<u8>> {
    let num_tables = u16_at(ttf, 4)? as usize;
    let mut tables: Vec<([u8; 4], Vec<u8>)> = Vec::with_capacity(num_tables);
    for i in 0..num_tables {
        let rec = 12 + 16 * i;
        let tag: [u8; 4] = ttf.get(rec..rec + 4)?.try_into().ok()?;
        let off = u32_at(ttf, rec + 8)? as usize;
        let len = u32_at(ttf, rec + 12)? as usize;
        tables.push((tag, ttf.get(off..off + len)?.to_vec()));
    }
    let find = |tag: &[u8; 4]| tables.iter().position(|(t, _)| t == tag);
    let (head, loca, glyf, maxp) = (
        find(b"head")?,
        find(b"loca")?,
        find(b"glyf")?,
        find(b"maxp")?,
    );
    let glyphs = u16_at(&tables[maxp].1, 4)? as usize;
    let long = u16_at(&tables[head].1, 50)? == 1;
    let offset = |i: usize| -> Option<usize> {
        let l = &tables[loca].1;
        Some(if long {
            u32_at(l, 4 * i)? as usize
        } else {
            2 * u16_at(l, 2 * i)? as usize
        })
    };

    let mut new_glyf = Vec::new();
    let mut new_loca = Vec::with_capacity(4 * (glyphs + 1));
    let mut max_ins = u16_at(&tables[maxp].1, 26)?;
    for i in 0..glyphs {
        let (a, b) = (offset(i)?, offset(i + 1)?);
        let g = snap_glyph(tables[glyf].1.get(a..b)?)?;
        if g.len() >= 10 && (u16_at(&g, 0)? as i16) >= 0 {
            let n = u16_at(&g, 0)? as usize;
            max_ins = max_ins.max(u16_at(&g, 10 + 2 * n)?);
        }
        new_loca.extend((new_glyf.len() as u32).to_be_bytes());
        new_glyf.extend(g);
        while new_glyf.len() % 4 != 0 {
            new_glyf.push(0);
        }
    }
    new_loca.extend((new_glyf.len() as u32).to_be_bytes());
    tables[glyf].1 = new_glyf;
    tables[loca].1 = new_loca;
    // Long loca offsets now; the checksum adjustment is left stale (no
    // reader here verifies it).
    put_u16(&mut tables[head].1, 50, 1);
    // maxp 1.0: maxStackElements (24) — the tail pushes at most two values
    // at a time — and maxSizeOfInstructions (26).
    let stack = u16_at(&tables[maxp].1, 24)?;
    put_u16(&mut tables[maxp].1, 24, stack.saturating_add(2));
    put_u16(&mut tables[maxp].1, 26, max_ins);

    let mut out = Vec::new();
    out.extend_from_slice(ttf.get(..12)?);
    let mut data_at = 12 + 16 * tables.len();
    let mut body = Vec::new();
    for (tag, data) in &tables {
        out.extend_from_slice(tag);
        out.extend(checksum(data).to_be_bytes());
        out.extend((data_at as u32).to_be_bytes());
        out.extend((data.len() as u32).to_be_bytes());
        body.extend_from_slice(data);
        while body.len() % 4 != 0 {
            body.push(0);
        }
        data_at = 12 + 16 * tables.len() + body.len();
    }
    out.extend(body);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edges_round_and_corners_align_to_their_edge() {
        // 40 and 120 are edges; 36 is 40's corner, 124 is 120's, 230 is
        // off the edge grid and rounds on its own.
        let p = x_round_program(&[40, 36, 120, 124, 230]);
        let head = [0xb0, 1, 0x16, 0x01, 0x18];
        let rounds = [0xb0, 0, 0x2f, 0xb0, 2, 0x2f, 0xb0, 4, 0x2f];
        let aligns = [0xb0, 0, 0x10, 0xb0, 1, 0x3c, 0xb0, 2, 0x10, 0xb0, 3, 0x3c];
        assert_eq!(p, [&head[..], &rounds, &aligns].concat());
    }

    #[test]
    fn x_deltas_decode() {
        // Three points: a short positive 40, a repeated "same", a word -10.
        // flags: 0x12 (x short, positive), 0x10|0x08 repeat 0 (same),
        // 0x00 (word).
        let g = [0x12, 0x18, 0x00, 0x00, 40, 0xff, 0xf6];
        assert_eq!(simple_xs(&g, 0, 3), Some(vec![40, 40, 30]));
    }

    #[test]
    fn garbage_is_left_alone() {
        assert!(snap_x(b"not a font").is_none());
    }
}
