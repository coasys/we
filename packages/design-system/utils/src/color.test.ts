/**
 * Colour parsing and conversion.
 *
 * The picker types a colour, drags it round an HSV square and reads it back, so every one of these
 * conversions is on a round trip a person can see. A wrong one shows up as a swatch that drifts
 * slightly each time the popover is opened, which is the kind of bug nobody reports precisely.
 */
import { describe, expect, it } from 'vitest';

import { colorVarToken, formatColor, hsvToRgb, parseColor, rgbToHex, rgbToHsv } from './color';

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
