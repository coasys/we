/**
 * What the renderer will accept as a colour.
 *
 * The function decides, per value, between "this is CSS, paint it" and "this is a token name, look
 * it up" — and the second branch is unfalsifiable at runtime: `var(--we-color-<anything>)` is valid
 * CSS that resolves to nothing, so a value on the wrong side of the line paints no colour and
 * reports no error. A card simply comes out unfilled, which is also what "nobody chose a colour"
 * looks like.
 *
 * The modern colour functions were on the wrong side. `we-color-picker` offers oklch as one of its
 * four output formats and a template may reasonably write a fill in one, so this was reachable by a
 * person choosing a colour rather than only by an author writing an unusual literal.
 */
import { describe, expect, it } from 'vitest';

import { arrowId, color } from './GraphView.solid';

describe('a colour reaching the renderer', () => {
  it('passes every CSS colour through untouched', () => {
    for (const value of [
      '#ffea9f',
      '#fff',
      'rgb(255 0 0)',
      'rgba(0, 0, 0, 0.5)',
      'hsl(210 50% 40%)',
      'hsla(210, 50%, 40%, 0.5)',
      'oklch(90% 0.06 150)',
      'oklch(0.9 0.06 150 / 0.4)',
      'oklab(59% 0.1 0.1)',
      'lch(59% 0.1 120)',
      'lab(59% 0.1 0.1)',
      'hwb(194 0% 0%)',
      'color(display-p3 1 0.5 0)',
      'color-mix(in oklab, red 20%, white)',
      'var(--we-role-page)',
      'transparent',
      'currentColor',
    ]) {
      expect(color(value, 'page'), value).toBe(value);
    }
  });

  it('still resolves a role and a scale position by name', () => {
    expect(color('page', 'surface')).toBe('var(--we-role-page)');
    expect(color('accent-muted', 'surface')).toBe('var(--we-role-accent-muted)');
    expect(color('primary-100', 'surface')).toBe('var(--we-color-primary-100)');
  });

  it('falls back when there is no value, and resolves the fallback too', () => {
    expect(color(undefined, 'page')).toBe('var(--we-role-page)');
    // `''` is "nothing chosen", not a choice — and the fallback is a role name, so returning it
    // raw would set `background: page`, which paints nothing.
    expect(color('', 'page')).toBe('var(--we-role-page)');
    expect(color(undefined, '')).toBe('');
  });
});

/**
 * The arrowhead's id, which is the second half of a coloured line.
 *
 * A marker paints in its own right rather than inheriting the stroke of the path referencing it, so
 * a coloured line needs a head of its own — and the id naming it is built from the colour. A colour
 * is `oklch(90% 0.06 150)` or `#86c2ff`, and an id carrying a bracket, a percent or a hash makes
 * `url(#…)` reference nothing: no head, no error, the same silent shape as a colour resolving to no
 * variable.
 */
describe('the arrowhead for a colour', () => {
  it('is usable as an id and as a url() reference', () => {
    for (const value of ['#86c2ff', 'oklch(90% 0.06 150)', 'var(--we-role-accent)', 'rgba(0, 0, 0, 0.5)']) {
      const id = arrowId(value);
      expect(id, value).toMatch(/^[A-Za-z][\w-]*$/);
    }
  });

  it('is one id per colour, so every line drawn in it shares a head', () => {
    expect(arrowId('#86c2ff')).toBe(arrowId('#86c2ff'));
    expect(arrowId('#86c2ff')).not.toBe(arrowId('#ff94f7'));
  });

  it('falls back to the default head where no colour was asked for', () => {
    expect(arrowId()).toBe('we-graph-arrow');
    expect(arrowId('')).toBe('we-graph-arrow');
  });
});
