import { semanticValues, themeFamily } from '@we/tokens';
import { describe, expect, it } from 'vitest';

import { THEME_CSS_MAP } from './themeStyles';

/**
 * Every shape and density group a theme can set is nameable from a call site.
 *
 * This is the test that stops the drift, rather than the table stopping it. The table is only a
 * source of truth if something notices when it falls behind — and what happened before it existed
 * is that groups were added to the theme and names were added one at a time, years apart, by
 * whoever hit the missing one. `avatar` and `media` arrived with `EditableImage`; `surface` arrived
 * when a cover image needed it; `control` and `input` were never named at all, and padding and gap
 * were never nameable, so `Card` spelled all three of its group values out by hand.
 *
 * None of that was visible, because a name that does not exist fails silently: it resolves to
 * `var(--we-radius-surface)`, a variable nothing declares, and the element paints nothing.
 *
 * So: add a radius or gap group to a theme and this fails until it is nameable. Padding is
 * deliberately exempt, for a reason the assertion below states.
 */

/** Theme keys ending in this axis, as the theme itself declares them. */
const themeKeysFor = (suffix: string) =>
  Object.keys(THEME_CSS_MAP)
    .filter((key) => key.endsWith(suffix))
    .map((key) => key.slice(0, -suffix.length).toLowerCase());

describe('the family table covers what a theme can set', () => {
  it('names every radius group', () => {
    // controlRadius, surfaceRadius, inputRadius, avatarRadius — all four reachable by name.
    const named = new Set(Object.keys(semanticValues('radius')));
    for (const family of themeKeysFor('Radius')) expect([...named]).toContain(family);
  });

  it('names every gap group', () => {
    const named = new Set(Object.keys(semanticValues('gap')));
    for (const family of themeKeysFor('Gap')) expect([...named]).toContain(family);
  });

  it('names the padding groups whose value is a single length, and only those', () => {
    /*
      Padding is the one axis that is not total, and the exclusions are constraints rather than
      omissions. `getPaddingValues` joins four values into one declaration, so a group whose value is
      a shorthand invalidates the whole thing when it lands in one slot — which rules out
      `inputPadding`, documented as a full shorthand because textarea has no fixed height to supply
      the vertical. `controlPaddingX` is horizontal only and answers nothing about the vertical,
      which is per size.

      Asserted as an exact set so that excluding one stays a decision somebody made rather than a
      name nobody got round to adding.
    */
    expect(Object.keys(semanticValues('padding'))).toEqual(['surface']);
  });
});

describe('every family reads a variable the theme actually writes', () => {
  const themeVars = new Set(Object.values(THEME_CSS_MAP));

  it.each(
    Object.entries(themeFamily).flatMap(([family, axes]) =>
      Object.entries(axes).map(([axis, spec]) => [`${family}.${axis}`, spec.var] as const),
    ),
  )('%s reads %s', (_label, cssVar) => {
    // A family pointing at a variable no theme key sets would be inert — themeable in appearance
    // and pinned in fact, which is the failure the names exist to prevent.
    expect(themeVars).toContain(cssVar);
  });
});

describe('media and surface are one family seen twice', () => {
  it('read the same variable', () => {
    expect(themeFamily.media.radius.var).toBe(themeFamily.surface.radius.var);
  });

  it('and differ only in what happens when a theme says nothing', () => {
    // The whole distinction: a full-bleed banner is square until a theme rounds it; a box inset in
    // a sheet takes the sheet's rounding. A theme setting surfaceRadius moves both together.
    expect(themeFamily.media.radius.fallback).not.toBe(themeFamily.surface.radius.fallback);
    expect(themeFamily.media.radius.fallback).toBe('0px');
  });
});
