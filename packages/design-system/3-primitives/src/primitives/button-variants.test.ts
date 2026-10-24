/**
 * The colour of a button is its tone, and what a tone does to the solid one.
 *
 * `success` and `danger` were variants once, beside `primary`, which mixed a colour into a list of
 * styles. They are tones now: a `solid` button with `tone: 'danger'` is the destructive one, and
 * with `tone: 'success'` the confirming half of a yes/no pair. What made the old variants right has
 * to survive the move — the fill is the family's role, its label the label measured against that
 * fill, and its states steps from it — and this is where that is asserted.
 */
import { toneVariables } from '@we/tokens';
import { describe, expect, it } from 'vitest';

import { VARIANT_DEFAULTS } from './button';

describe('a toned solid button', () => {
  it('draws with the accent’s roles, which the tone re-points', () => {
    expect(VARIANT_DEFAULTS.solid.toned).toMatchObject({ bg: 'accent', color: 'on-accent' });
  });

  it('reaches the family’s own fill and corrected label, not a scale position', () => {
    // `on-danger` is derived and contrast-corrected at apply time — see FILL_LABELS in @we/themes.
    for (const family of ['danger', 'success'] as const) {
      const vars = toneVariables(family);
      expect(vars['--we-role-accent']).toBe(`var(--we-role-${family})`);
      expect(vars['--we-role-on-accent']).toBe(`var(--we-role-on-${family})`);
    }
  });

  it('moves its states from the family’s fill', () => {
    // Steps from the fill rather than positions on the scale: the label is chosen against the worst
    // of the three states, so they have to stay together.
    const vars = toneVariables('danger');
    expect(vars['--we-role-accent-hover']).toBe('var(--we-role-danger-hover)');
    expect(vars['--we-role-accent-active']).toBe('var(--we-role-danger-active)');
  });
});

describe('an untoned button', () => {
  it('is the accent when solid and a quiet neutral otherwise', () => {
    // Every screen with a soft, outline or ghost button depends on these staying grey: a tone is
    // what colours them, never the variant alone.
    expect(VARIANT_DEFAULTS.solid.neutral.bg).toBe('accent');
    expect(VARIANT_DEFAULTS.soft.neutral.bg).toBe('control-surface');
    expect(VARIANT_DEFAULTS.ghost.neutral.color).toBe('text');
    expect(VARIANT_DEFAULTS.outline.neutral.color).toBe('text');
  });
});
