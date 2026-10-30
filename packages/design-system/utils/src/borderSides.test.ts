/**
 * A layout element with `hoverProps` and a `border` drew no border, at rest or lit: the state
 * stylesheet declares each side after the shorthand, and a side nobody set reset to none. Its sides
 * are written out from the shorthand before they become variables — what a primitive does already.
 */
import { describe, expect, it } from 'vitest';

import { type CSSStyleObject, withBorderSides } from './index';

const ACCENT = 'var(--we-border-width, 1px) solid var(--we-role-accent)';
const sides = (style: CSSStyleObject) => {
  const s = style as Record<string, string | undefined>;
  return [s['border-top'], s['border-right'], s['border-bottom'], s['border-left']];
};

describe('withBorderSides', () => {
  it('writes every side from the shorthand', () => {
    expect(sides(withBorderSides({ border: ACCENT } as CSSStyleObject))).toEqual([ACCENT, ACCENT, ACCENT, ACCENT]);
  });

  it('leaves a side the element names to win, as written', () => {
    const top = '4px solid var(--we-role-danger)';
    const out = withBorderSides({ border: ACCENT, 'border-top': top } as CSSStyleObject);
    expect(sides(out)).toEqual([top, ACCENT, ACCENT, ACCENT]);
  });

  it('draws a colour or width beside the shorthand on every side', () => {
    const out = withBorderSides({ border: ACCENT, 'border-color': 'var(--we-role-text)' } as CSSStyleObject);
    expect(sides(out)[0]).toBe('var(--we-border-width, 1px) solid var(--we-role-text)');
  });

  it('lights a state that changes only the colour in that colour, at the resting width and style', () => {
    const hover = withBorderSides(
      { 'border-color': 'var(--we-role-accent-border)' } as CSSStyleObject,
      {
        border: '2px dashed var(--we-role-border)',
      } as CSSStyleObject,
    );
    expect(sides(hover)[0]).toBe('2px dashed var(--we-role-accent-border)');
  });

  it('leaves a state alone where the resting style names the side itself', () => {
    const top = '4px solid var(--we-role-danger)';
    const hover = withBorderSides({ border: ACCENT } as CSSStyleObject, { 'border-top': top } as CSSStyleObject);
    expect(sides(hover)).toEqual([undefined, ACCENT, ACCENT, ACCENT]);
  });

  it('leaves a style with no border untouched', () => {
    const style = { 'background-color': 'red' } as CSSStyleObject;
    expect(withBorderSides(style)).toBe(style);
  });
});
