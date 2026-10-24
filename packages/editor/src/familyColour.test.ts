/**
 * A picked colour, as the settings that make it.
 *
 * The property worth holding is the round trip: settings made from a colour draw that colour again,
 * so picking `#3b82f6` for the accent gives a theme whose accent is `#3b82f6`, while still being a
 * hue, a saturation and a lightness the rest of the theme follows.
 */
import { describe, expect, it } from 'vitest';

import {
  colourToFamily,
  familyPatch,
  familyResetPatch,
  familyToColour,
  PALETTE_HUE_REACH,
  scaledSaturations,
  visiblyDifferent,
} from './familyColour';

describe('a picked colour', () => {
  it('comes back as itself from the settings made from it', () => {
    for (const hex of ['#3b82f6', '#e11d48', '#16a34a', '#f59e0b', '#7c3aed']) {
      const settings = colourToFamily(hex, 'accent')!;
      expect(visiblyDifferent(familyToColour(settings), hex), hex).toBe(false);
    }
  });

  it('keeps a palette hue near the colour it is named for', () => {
    // A blue picked for "red" is pulled back to the edge of red's reach, never across to blue.
    const red = colourToFamily('#3b82f6', 'red')!;
    const named = 25;
    const distance = Math.abs(((((red.hue - named) % 360) + 540) % 360) - 180);
    expect(distance).toBeLessThanOrEqual(PALETTE_HUE_REACH);
  });

  it('keeps the family’s hue for a grey, which has none', () => {
    expect(colourToFamily('#808080', 'accent', 200)!.hue).toBe(200);
    expect(colourToFamily('#808080', 'accent', 200)!.saturation).toBe(0);
  });

  it('refuses what is not a colour', () => {
    expect(colourToFamily('not a colour', 'accent')).toBeNull();
  });
});

describe('the patch a pick writes', () => {
  it('sets the family’s three settings and unpins its fill and label', () => {
    const patch = familyPatch({ roles: { page: '#fff' } }, 'accent', { hue: 250, saturation: 80, lightness: 55 });
    expect(patch).toMatchObject({ accentHue: 250, accentSaturation: 80, accentLightness: 55 });
    expect(patch.roles).toEqual({ page: '#fff', accent: '', onAccent: '' });
  });

  it('writes a palette hue into the palette, beside the hues already moved', () => {
    const patch = familyPatch({ palette: { hues: { red: { hue: 30 } } } }, 'teal', {
      hue: 190,
      saturation: 60,
      lightness: 66,
    });
    expect(patch.palette?.hues).toEqual({ red: { hue: 30 }, teal: { hue: 190, saturation: 60, lightness: 66 } });
  });

  it('is undone by a reset, leaving everything else as it was', () => {
    const theme = { roles: { page: '#fff', accent: '', onAccent: '' }, accentHue: 250 };
    const reset = familyResetPatch(theme, 'accent');
    expect(reset).toMatchObject({ accentHue: undefined, roles: { page: '#fff' } });
  });
});

describe('moving the whole theme’s saturation', () => {
  const start = {
    saturation: 50,
    accentSaturation: 80,
    neutralSaturation: 20,
    palette: { hues: { teal: { hue: 190, saturation: 40 } } },
  };

  it('moves every family that has its own by the same ratio, and leaves neutral alone', () => {
    const patch = scaledSaturations(start, 50, 25, 'theme');
    expect(patch).toMatchObject({ saturation: 25, accentSaturation: 40 });
    expect(patch.palette?.hues?.teal).toEqual({ hue: 190, saturation: 20 });
    expect('neutralSaturation' in patch).toBe(false);
  });

  it('lands back where it began when dragged there and back', () => {
    expect(scaledSaturations(start, 50, 50, 'theme')).toMatchObject({ saturation: 50, accentSaturation: 80 });
  });

  it('moves only the palette from the palette’s own slider', () => {
    const patch = scaledSaturations(start, 50, 100, 'palette');
    expect(patch.palette).toEqual({ saturation: 100, hues: { teal: { hue: 190, saturation: 80 } } });
    expect('accentSaturation' in patch).toBe(false);
  });
});
