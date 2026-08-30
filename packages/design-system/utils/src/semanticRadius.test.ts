import { describe, expect, it } from 'vitest';

import { tokenVar } from './index';

/**
 * The radius names that resolve to a theme group rather than to a length.
 *
 * Worth asserting because the failure mode is silence. A radius name that is not one of these falls
 * through to `var(--we-{prefix}-{token})`, so `r: 'surface'` — before there was such a name —
 * emitted `var(--we-radius-surface)`, a variable nothing declares: no radius, no warning, and
 * nothing to distinguish it from a theme that had chosen square corners.
 */

describe('semantic radii resolve to their theme group', () => {
  it.each([
    ['avatar', '--we-theme-avatar-radius', '50%'],
    ['media', '--we-theme-surface-radius', '0px'],
    ['surface', '--we-theme-surface-radius', 'var(--we-radius-400)'],
  ])('%s follows %s', (name, group, fallback) => {
    expect(tokenVar('radius', name)).toBe(`var(${group}, ${fallback})`);
  });
});

describe('surface and media are the same group, different defaults', () => {
  // The entire distinction, and the reason both exist. A full-bleed banner is square until a theme
  // rounds it; a box inset inside a sheet takes the sheet's rounding, because square corners inside
  // a rounded container read as a mistake rather than as a choice. A theme setting surfaceRadius
  // moves both together.
  it('agree on the group', () => {
    const groupOf = (name: string) => /var\((--[a-z-]+),/.exec(tokenVar('radius', name))?.[1];
    expect(groupOf('surface')).toBe(groupOf('media'));
  });

  it('disagree on what happens when a theme sets nothing', () => {
    expect(tokenVar('radius', 'media')).toContain('0px');
    expect(tokenVar('radius', 'surface')).not.toContain('0px');
  });
});

describe('an unknown radius name', () => {
  it('still falls through to a scale variable, which is why the names have to be right', () => {
    // Not a behaviour to rely on — a record of the trap. This is what `r: 'surface'` did before the
    // name existed, and what any typo still does.
    expect(tokenVar('radius', 'sunken')).toBe('var(--we-radius-sunken)');
  });

  it('leaves scale positions and raw lengths alone', () => {
    expect(tokenVar('radius', '400')).toBe('var(--we-radius-400)');
    expect(tokenVar('radius', '8px')).toBe('8px');
  });
});
