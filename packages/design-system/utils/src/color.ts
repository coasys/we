/**
 * Colour maths — parsing, conversion and formatting.
 *
 * Lives here rather than inside the picker because it is not the picker's: a contrast check, a
 * theme's swatch sampling and any future palette generation all need the same conversions, and two
 * implementations of `hexToRgb` in one repo is how they drift.
 *
 * Everything is sRGB and deliberately plain. A perceptual space (OKLCH) is the right substrate for
 * generating *ramps*, and when that lands it belongs beside these rather than replacing them: a
 * colour picker still has to speak the formats a person types.
 */

export type Rgba = { r: number; g: number; b: number; a: number };

/** Colour notations a person can type or paste. */
export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'oklch';

const clamp = (n: number, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, n));
const hex2 = (n: number) => Math.round(clamp(n)).toString(16).padStart(2, '0');

export function rgbToHex({ r, g, b }: Pick<Rgba, 'r' | 'g' | 'b'>): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** HSV, which is what a saturation/value area is drawn in. h 0–360, s and v 0–1. */
export function rgbToHsv({ r, g, b }: Pick<Rgba, 'r' | 'g' | 'b'>): { h: number; s: number; v: number } {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): Pick<Rgba, 'r' | 'g' | 'b'> {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/*
  OKLCH ⇄ sRGB.

  Worth having even while the token ramps are still HSL, and for a reason that is not "it is
  newer": OKLCH lightness is *perceptual*, so two colours at the same L look equally bright
  whatever their hue, where HSL's 50% is far brighter for yellow than for blue. That is exactly the
  property a colour picker and a contrast check want, and it is why an author pasting an oklch()
  value from a modern palette tool should not be told it is unparseable.

  Converting rather than storing: everything downstream — the swatches, the contrast maths, the
  browser — speaks sRGB, so this is a front door, not a new internal representation. Moving the
  *ramps* to OKLCH is a separate decision that changes how every theme looks; this does not.
*/
export function oklchToRgb(l: number, c: number, hDeg: number): Pick<Rgba, 'r' | 'g' | 'b'> {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const bb = c * Math.sin(h);

  // OKLab → LMS (cube of the intermediate), → linear sRGB.
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * bb) ** 3;

  const lr = +4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const lg = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const lb = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;

  // Linear → gamma-encoded sRGB, clipped to the gamut. An out-of-gamut oklch() is clipped rather
  // than rejected, which is what a browser does with one.
  const enc = (v: number) => {
    const g = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, g * 255));
  };
  return { r: enc(lr), g: enc(lg), b: enc(lb) };
}

export function rgbToOklch({ r, g, b }: Pick<Rgba, 'r' | 'g' | 'b'>): { l: number; c: number; h: number } {
  const dec = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [dec(r), dec(g), dec(b)];

  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.sqrt(A * A + B * B);
  const h = c < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

function hslToRgb(h: number, s: number, l: number): Pick<Rgba, 'r' | 'g' | 'b'> {
  // Via HSV, so there is one conversion to be wrong in rather than two.
  const v = l + s * Math.min(l, 1 - l);
  return hsvToRgb(h, v === 0 ? 0 : 2 * (1 - l / v), v);
}

/**
 * Parse any colour notation a person might type, plus the ones `getComputedStyle` returns.
 *
 * Returns null for anything unparseable — including `var(--we-color-…)`, which is deliberate: a
 * token is an indirection, not a colour, and the only honest way to resolve one is to ask the
 * browser. Callers that need the resolved value sample it from the DOM instead.
 */
export function parseColor(input: string): Rgba | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;

  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    const d = hex[1];
    const pairs =
      d.length === 3 || d.length === 4
        ? [...d].map((c) => c + c)
        : d.length === 6 || d.length === 8
          ? [d.slice(0, 2), d.slice(2, 4), d.slice(4, 6), d.slice(6, 8)].filter(Boolean)
          : null;
    if (!pairs) return null;
    const [r, g, b, a] = pairs.map((p) => parseInt(p, 16));
    return { r, g, b, a: a === undefined ? 1 : a / 255 };
  }

  // rgb()/rgba()/hsl()/hsla()/oklch(), comma-separated or the modern space-separated form.
  const fn = /^(rgba?|hsla?|oklch)\(([^)]+)\)$/.exec(value);
  if (!fn) return null;
  const parts = fn[2]
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length < 3) return null;
  const num = (s: string) => parseFloat(s);
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? num(parts[3]) / 100 : num(parts[3]);

  if (fn[1].startsWith('rgb')) {
    const [r, g, b] = parts.slice(0, 3).map((p) => (p.endsWith('%') ? (num(p) / 100) * 255 : num(p)));
    return { r, g, b, a: alpha };
  }
  if (fn[1] === 'oklch') {
    // L may be written 0–1 or as a percentage; C is absolute, H in degrees.
    const l = parts[0].endsWith('%') ? num(parts[0]) / 100 : num(parts[0]);
    return { ...oklchToRgb(l, num(parts[1]), num(parts[2])), a: alpha };
  }
  const h = ((num(parts[0]) % 360) + 360) % 360;
  return { ...hslToRgb(h, num(parts[1]) / 100, num(parts[2]) / 100), a: alpha };
}

/** Render a colour in one of the notations a person reads. Alpha is dropped where it cannot show. */
export function formatColor(c: Rgba, format: ColorFormat): string {
  const r = Math.round(c.r);
  const g = Math.round(c.g);
  const b = Math.round(c.b);
  const a = Math.round(c.a * 100) / 100;
  if (format === 'rgb') return a < 1 ? `rgb(${r} ${g} ${b} / ${a})` : `rgb(${r} ${g} ${b})`;
  if (format === 'hsl') {
    const { h, s, v } = rgbToHsv(c);
    const l = v * (1 - s / 2);
    const sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
    const out = `hsl(${Math.round(h)} ${Math.round(sl * 100)}% ${Math.round(l * 100)}%`;
    return a < 1 ? `${out} / ${a})` : `${out})`;
  }
  if (format === 'oklch') {
    const { l, c: chroma, h } = rgbToOklch(c);
    const out = `oklch(${(l * 100).toFixed(1)}% ${chroma.toFixed(3)} ${h.toFixed(1)}`;
    return a < 1 ? `${out} / ${a})` : `${out})`;
  }
  // Hex cannot carry alpha in the form most people expect to paste back, so a translucent colour
  // is written as rgb() rather than silently losing its transparency.
  return a < 1 ? `rgb(${r} ${g} ${b} / ${a})` : rgbToHex(c);
}

/** The canonical string for a design token, as a theme and a schema both spell it. */
export function tokenColorVar(token: string): string {
  return `var(--we-color-${token})`;
}

/** The token a `var(--we-color-…)` string names, or null if it is not one. */
export function colorVarToken(value: string): string | null {
  const m = /^var\(--we-color-([a-z]+-\d+)\)$/.exec(value.trim());
  return m ? m[1] : null;
}

/**
 * Relative luminance, per WCAG 2.
 *
 * The sRGB channels are gamma-encoded, so they have to be linearised before they mean anything
 * photometric — averaging the raw bytes is the classic way to get a contrast check that passes
 * things nobody can read.
 */
export function relativeLuminance({ r, g, b }: Pick<Rgba, 'r' | 'g' | 'b'>): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * The WCAG 2 contrast ratio between two colours, 1 (identical) to 21 (black on white).
 *
 * A translucent foreground is composited over the background first — otherwise a 10%-alpha text
 * colour scores as though it were solid, which is exactly backwards: transparency is the thing
 * most likely to make text unreadable.
 *
 * WCAG 2 is used rather than APCA because it is what accessibility requirements are still written
 * against. It is known to be unkind to mid-tones; a check that disagrees with the standard people
 * are held to would be worse than one that is occasionally pessimistic.
 */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const composited: Rgba =
    foreground.a >= 1
      ? foreground
      : {
          r: foreground.r * foreground.a + background.r * (1 - foreground.a),
          g: foreground.g * foreground.a + background.g * (1 - foreground.a),
          b: foreground.b * foreground.a + background.b * (1 - foreground.a),
          a: 1,
        };
  const [hi, lo] = [relativeLuminance(composited), relativeLuminance(background)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** What a pair is for, and therefore what it has to clear. */
export type ContrastLevel = 'body' | 'large' | 'ui';

/** WCAG 2 AA thresholds: 4.5 for body text, 3 for large text and for non-text UI. */
export const CONTRAST_MINIMUM: Record<ContrastLevel, number> = { body: 4.5, large: 3, ui: 3 };
