/**
 * Colour parsing and conversion.
 *
 * The picker types a colour, drags it round an HSV square and reads it back, so every one of these
 * conversions is on a round trip a person can see. A wrong one shows up as a swatch that drifts
 * slightly each time the popover is opened, which is the kind of bug nobody reports precisely.
 */
import { describe, expect, it } from 'vitest';

import {
  colorVarToken,
  contrastRatio,
  formatColor,
  hsvToRgb,
  parseColor,
  relativeLuminance,
  rgbToHex,
  rgbToHsv,
} from './color';

describe('parseColor', () => {
  it('reads hex in every length a person might type', () => {
    expect(parseColor('#36f')).toEqual({ r: 51, g: 102, b: 255, a: 1 });
    expect(parseColor('#3366ff')).toEqual({ r: 51, g: 102, b: 255, a: 1 });
    expect(parseColor('#3366FF')).toEqual({ r: 51, g: 102, b: 255, a: 1 });
  });

  it('reads the alpha out of an 8-digit hex', () => {
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.5, 2);
  });

  it('reads both rgb() spellings — the comma one and the modern slash one', () => {
    expect(parseColor('rgb(255, 128, 0)')).toEqual({ r: 255, g: 128, b: 0, a: 1 });
    expect(parseColor('rgb(255 128 0 / 0.25)')).toEqual({ r: 255, g: 128, b: 0, a: 0.25 });
    expect(parseColor('rgba(255, 128, 0, 0.25)')).toEqual({ r: 255, g: 128, b: 0, a: 0.25 });
  });

  it('reads hsl(), which is what getComputedStyle hands back for a themed token', () => {
    const c = parseColor('hsl(210 100% 50%)')!;
    expect(rgbToHex(c)).toBe('#0080ff');
  });

  /*
    A token is an indirection, not a colour. Returning null rather than guessing is what makes the
    caller ask the browser instead — which is the only thing that knows what the theme resolves it to.
  */
  it('refuses a token, rather than inventing a colour for it', () => {
    expect(parseColor('var(--we-color-neutral-200)')).toBeNull();
    expect(parseColor('')).toBeNull();
    expect(parseColor('nonsense')).toBeNull();
  });
});

describe('round trips', () => {
  it('survives rgb → hsv → rgb', () => {
    for (const hex of ['#3366ff', '#ff8000', '#000000', '#ffffff', '#7f7f7f', '#00ff00']) {
      const rgb = parseColor(hex)!;
      const { h, s, v } = rgbToHsv(rgb);
      expect(rgbToHex(hsvToRgb(h, s, v))).toBe(hex);
    }
  });

  it('survives a format change without moving the colour', () => {
    const start = parseColor('#3366ff')!;
    for (const format of ['hex', 'rgb', 'hsl'] as const) {
      const written = formatColor(start, format);
      const back = parseColor(written)!;
      // hsl() rounds to whole percentages, so allow a channel to land one step out.
      expect(Math.abs(back.r - start.r)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.g - start.g)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.b - start.b)).toBeLessThanOrEqual(2);
    }
  });
});

describe('formatColor', () => {
  it('writes a translucent colour as rgb() even when asked for hex', () => {
    // Hex alpha is the notation people paste back least often, and losing the transparency
    // silently is how an overlay stops being an overlay.
    expect(formatColor({ r: 0, g: 0, b: 0, a: 0.6 }, 'hex')).toBe('rgb(0 0 0 / 0.6)');
    expect(formatColor({ r: 0, g: 0, b: 0, a: 1 }, 'hex')).toBe('#000000');
  });

  it('writes the modern space-separated forms', () => {
    expect(formatColor({ r: 1, g: 2, b: 3, a: 1 }, 'rgb')).toBe('rgb(1 2 3)');
    expect(formatColor({ r: 0, g: 128, b: 255, a: 1 }, 'hsl')).toBe('hsl(210 100% 50%)');
  });
});

describe('colorVarToken', () => {
  it('names the token a var() points at, and nothing else', () => {
    expect(colorVarToken('var(--we-color-neutral-200)')).toBe('neutral-200');
    expect(colorVarToken('var(--we-role-surface)')).toBeNull();
    expect(colorVarToken('#fff')).toBeNull();
  });
});

describe('contrast', () => {
  const c = (s: string) => parseColor(s)!;

  it('matches the values WCAG is checked against', () => {
    expect(contrastRatio(c('#000'), c('#fff'))).toBeCloseTo(21, 2);
    expect(contrastRatio(c('#fff'), c('#fff'))).toBeCloseTo(1, 2);
    // The canonical "just passes AA on white" grey.
    expect(contrastRatio(c('#767676'), c('#fff'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c('#777777'), c('#fff'))).toBeLessThan(4.5);
  });

  it('is symmetric — the ratio does not care which is on top', () => {
    expect(contrastRatio(c('#000'), c('#fff'))).toBeCloseTo(contrastRatio(c('#fff'), c('#000')), 6);
  });

  /*
    Transparency is the thing most likely to make text unreadable, so scoring a translucent
    foreground as though it were solid gets the check exactly backwards.
  */
  it('composites a translucent foreground over its background first', () => {
    const solid = contrastRatio(c('#000'), c('#fff'));
    const faded = contrastRatio(c('rgb(0 0 0 / 0.5)'), c('#fff'));
    expect(faded).toBeLessThan(solid);
    expect(faded).toBeGreaterThan(1);
  });

  it('linearises rather than averaging the raw bytes', () => {
    // Mid-grey is not half-way in luminance; a naive average would put this near 2:1.
    expect(relativeLuminance(c('#808080'))).toBeCloseTo(0.2159, 3);
  });
});

describe('oklch', () => {
  it('reads both the 0–1 and percentage spellings of lightness', () => {
    expect(rgbToHex(parseColor('oklch(0.7 0.15 250)')!)).toBe(rgbToHex(parseColor('oklch(70% 0.15 250)')!));
  });

  it('round-trips an sRGB colour exactly', () => {
    for (const hex of ['#3366ff', '#ff8000', '#ffffff', '#000000', '#7f7f7f']) {
      const written = formatColor(parseColor(hex)!, 'oklch');
      expect(rgbToHex(parseColor(written)!)).toBe(hex);
    }
  });

  it('carries alpha', () => {
    expect(parseColor('oklch(0.5 0.2 30 / 0.5)')!.a).toBe(0.5);
  });

  /*
    The property that makes OKLCH worth accepting at all: equal lightness reads as equal brightness
    whatever the hue. In HSL the same 50% is far brighter for yellow than for blue, which is why a
    contrast check over an HSL ramp is only ever approximate.
  */
  it('is perceptually even across hues, where HSL is not', () => {
    const spread = (fn: (h: number) => string) => {
      const ls = [30, 120, 210, 300].map((h) => relativeLuminance(parseColor(fn(h))!));
      return Math.max(...ls) - Math.min(...ls);
    };
    const oklchSpread = spread((h) => `oklch(0.6 0.12 ${h})`);
    const hslSpread = spread((h) => `hsl(${h} 60% 50%)`);
    expect(oklchSpread).toBeLessThan(hslSpread);
  });

  it('clips an out-of-gamut colour rather than refusing it, as a browser does', () => {
    const c = parseColor('oklch(0.9 0.4 140)')!;
    for (const channel of [c.r, c.g, c.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });
});
