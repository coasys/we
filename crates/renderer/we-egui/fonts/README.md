# Vendored fonts

Two subsets of Noto Sans Symbols, registered in `src/media.rs` as fallbacks after egui's own fonts
on the proportional and monospace families. They supply the arrows, technical symbols, circled
digits, geometric shapes, misc symbols and dingbats the bundles and widgets draw. egui's default
fonts have none of these (`tests/m1a.rs::needed_symbols_render_strictly_through_the_noto_fallbacks`
checks that, and checks that every needed symbol renders under `MissingGlyphPolicy::Panic`).

Licence: SIL Open Font License 1.1, in `OFL.txt`. That file is byte-identical to the `OFL.txt` in
both upstream release archives below (SHA-256
`b118dd41337806a5d4797052c77caf3bd096aed783e5eb21b4d11154351e1ac0`). The upstream notice declares
**no Reserved Font Name**: after the copyright line it goes straight to the licence, and the only
mention of "Reserved Font Name" is the licence's generic definition. The subsets keep the upstream
family names. A binary that embeds these fonts (`include_bytes!`) has to carry `OFL.txt` with it.

## Upstream

Repository: <https://github.com/notofonts/symbols>, GitHub release assets.

| Subset | Release tag | Tag object → commit | Archive (SHA-256) |
|---|---|---|---|
| `NotoSansSymbols.subset.ttf` | `NotoSansSymbols-v2.003` | `11e0c98f…` → `b61fa7f86fb7d4163ee11d46d0977393f98d4f7a` | `NotoSansSymbols-v2.003.zip` (`0c113cdcf6c31d050b80dac39fba2d804a6985281012e76e9220c0a00da007f3`) |
| `NotoSansSymbols2.subset.ttf` | `NotoSansSymbols2-v2.008` | `a7148cbc…` → `25b00f0d3f40873a005287514ba2a48558655314` | `NotoSansSymbols2-v2.008.zip` (`346c930bbe8eb946701a05c54e9c11a2094dee1d93c387bf1771c0a3e335688f`) |

The source file inside each archive:

| Archive path | Version (`name` 5) | SHA-256 |
|---|---|---|
| `NotoSansSymbols/hinted/ttf/NotoSansSymbols-Regular.ttf` | `Version 2.003; ttfautohint (v1.8.4.7-5d5b)` | `d0e98e9a2c046594c5021437273943be7e79e0fd980fde125279e22302212595` |
| `NotoSansSymbols2/hinted/ttf/NotoSansSymbols2-Regular.ttf` | `Version 2.008` | `c4a0a80f0041ce4be81e2478faad22776d23edb98ae3f0d19bd37044820ecf9d` |

(In the Symbols 2 archive, `unhinted/ttf/` holds the same bytes as `hinted/ttf/`.)

## Recipe

fontTools 4.68.0 (`pyftsubset`), Python 3.12.3. Default options otherwise — which keep `name`
IDs 0–6 only, so the licence description/URL records (IDs 13/14) are dropped from the binaries and
`OFL.txt` carries the notice instead.

```sh
pyftsubset NotoSansSymbols/hinted/ttf/NotoSansSymbols-Regular.ttf \
  --unicodes=U+2190-21FF,U+2300-23FF,U+2460-24FF \
  --no-hinting --output-file=NotoSansSymbols.subset.ttf

pyftsubset NotoSansSymbols2/hinted/ttf/NotoSansSymbols2-Regular.ttf \
  --unicodes=U+25A0-27BF,U+2B00-2BFF \
  --no-hinting --output-file=NotoSansSymbols2.subset.ttf
```

Both commands reproduce the committed files byte for byte with that fontTools version (checked
2026-11-14). A different fontTools version may produce different bytes with the same glyphs.

| Committed file | Size | SHA-256 |
|---|---|---|
| `NotoSansSymbols.subset.ttf` | 40,388 | `bb037cc6f0d7e48c642afb09af476fcc73d6ee44fdefe4b4327cc2028c5cf04f` |
| `NotoSansSymbols2.subset.ttf` | 86,520 | `f906dc558bc492f3efd27d958e1db08712bc1690a79c4764663f08a292b8d31e` |

## What each subset holds

The requested ranges are blocks; a subset keeps only the codepoints upstream actually has in them.

- **Noto Sans Symbols** (273 codepoints): U+2190–2199 (arrows), U+2300–230F, U+2311–2315, U+2317,
  U+231C–231F, U+2322–2323, U+2329–232A, U+232C–2335, U+237C, U+2380–2394, U+2396–239A, U+23AF,
  U+23BE–23CD, U+23D0–23DB, U+23E2–23E8 (misc technical), U+2460–24FF (enclosed alphanumerics:
  circled digits and letters).
- **Noto Sans Symbols 2** (581 codepoints): U+25A0–2609, U+260E–2612, U+2614–2623, U+2630–2637,
  U+263C, U+2654–2668, U+267F–268F, U+269E–26A1, U+26AA–26AC, U+26BD–26CD, U+26CF–26E1 (geometric
  shapes, misc symbols), U+2700–2704, U+2706–2709, U+270B–271C, U+2722–2727, U+2729–274B, U+274D,
  U+274F–2753, U+2756–2775, U+2794, U+2798–27AF, U+27B1–27BE (dingbats), U+2B00–2B0D, U+2B12–2B2F,
  U+2B4D–2B73, U+2B76–2B95, U+2B97–2BFD, U+2BFF (misc symbols and arrows).

To add a glyph: download the archives above, widen `--unicodes`, rerun, update the hashes here, and
add the character to `needed_symbols` in `tests/m1a.rs`.
