/**
 * The hue a kind is drawn in where nobody chose one: WE's own kinds by what they are, and any other
 * by its name — the same on every device, so a community's newest model is coloured at once.
 */
import { PALETTE_HUES } from '@we/tokens';
import { describe, expect, it } from 'vitest';

import { BLOCK_HUES, kindHue } from '../src/shared/kindHue';

describe('a kind’s hue', () => {
  it('is the one chosen for what it is, for WE’s own kinds', () => {
    expect(kindHue('TaskBlock')).toBe('blue');
    expect(kindHue('CollectionBlock')).toBe('yellow');
    for (const hue of Object.values(BLOCK_HUES)) expect(PALETTE_HUES).toContain(hue);
  });

  it('is taken from the name for any other, always a palette hue and always the same one', () => {
    for (const name of ['Proposal', 'Badge', 'Recipe', 'Sighting', 'Loan']) {
      expect(PALETTE_HUES).toContain(kindHue(name));
      expect(kindHue(name)).toBe(kindHue(name));
    }
    // Different names spread over the palette rather than landing on one hue.
    const hues = new Set(['Proposal', 'Badge', 'Recipe', 'Sighting', 'Loan', 'Vote', 'Seed'].map(kindHue));
    expect(hues.size).toBeGreaterThan(2);
  });
});
