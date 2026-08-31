import { afterEach, describe, expect, it, vi } from 'vitest';

import { getMarginValues, getPaddingValues, getRadiusValues, tokenVar } from './index';

/**
 * Theme-family names: which props take them, which do not, and what a mistyped one does.
 *
 * The failure mode this guards is silence. An unrecognised name falls through to
 * `var(--we-{prefix}-{token})`, a variable nothing declares, so the property is invalid at
 * computed-value time and the element paints none of it — indistinguishable from a theme that chose
 * square corners or no padding. That is how `r: 'surface'` looked correct for as long as it did.
 */

afterEach(() => vi.restoreAllMocks());

describe('radius names resolve to their family', () => {
  it.each([
    ['control', '--we-theme-control-radius', 'var(--we-radius-400)'],
    ['surface', '--we-theme-surface-radius', 'var(--we-radius-400)'],
    ['input', '--we-theme-input-radius', 'var(--we-radius-300)'],
    ['avatar', '--we-theme-avatar-radius', '50%'],
    ['media', '--we-theme-surface-radius', '0px'],
  ])('%s → %s', (name, themeVar, fallback) => {
    expect(tokenVar('radius', name)).toBe(`var(${themeVar}, ${fallback})`);
  });

  it('works through the shorthand a component actually builds', () => {
    const chain = 'var(--we-theme-surface-radius, var(--we-radius-400))';
    expect(getRadiusValues({ r: 'surface' })).toBe([chain, chain, chain, chain].join(' '));
  });
});

describe('spacing names are scoped to the axis that has them', () => {
  it('padding resolves on padding', () => {
    expect(tokenVar('space', 'surface', '0', 'padding')).toBe('var(--we-theme-surface-padding, var(--we-space-500))');
  });

  it('gap resolves on gap', () => {
    expect(tokenVar('space', 'surface', '0', 'gap')).toBe('var(--we-theme-surface-gap, var(--we-space-400))');
  });

  it('the same name means a different variable per axis', () => {
    // The point of keying on axis rather than prefix: one family, three decisions, and padding and
    // gap are not interchangeable.
    expect(tokenVar('space', 'surface', '0', 'padding')).not.toBe(tokenVar('space', 'surface', '0', 'gap'));
  });

  it('control has a gap and no padding', () => {
    // --we-theme-control-padding-x is horizontal only, and the vertical comes from the control's
    // height per size — so there is no answer to put on four sides. See themeFamily.ts.
    expect(tokenVar('space', 'control', '0', 'gap')).toBe('var(--we-theme-control-gap, var(--we-space-300))');
    expect(tokenVar('space', 'control', '0', 'padding')).toBe('var(--we-space-control)');
  });

  it('a margin reads no family at all', () => {
    // A family says how much room a card puts inside itself, which answers nothing about the space
    // between it and its neighbour.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getMarginValues({ m: 'surface' })).not.toContain('--we-theme-surface-padding');
    expect(getPaddingValues({ p: 'surface' })).toContain('--we-theme-surface-padding');
  });
});

describe('a name nobody declared is loud', () => {
  it('warns rather than painting nothing in silence', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(tokenVar('radius', 'sunken')).toBe('var(--we-radius-sunken)');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('sunken');
    // The message names what is available, since the mistake is usually a near-miss.
    expect(warn.mock.calls[0]?.[0]).toContain('surface');
  });

  it('says nothing about a scale position, a raw length or a CSS keyword', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(tokenVar('radius', '400')).toBe('var(--we-radius-400)');
    expect(tokenVar('space', '8px')).toBe('8px');
    expect(tokenVar('space', 'auto')).toBe('auto');
    expect(tokenVar('space', 'calc(100% - 8px)')).toBe('calc(100% - 8px)');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once per name, not once per render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    tokenVar('radius', 'nonsense-name');
    tokenVar('radius', 'nonsense-name');
    tokenVar('radius', 'nonsense-name');
    expect(warn).toHaveBeenCalledOnce();
  });
});

/**
 * A real token is not a typo, and a warning that says otherwise is worse than none.
 *
 * `warnUnknownToken` knew the theme families and nothing else, so every *named* token of a scale —
 * radius `pill` and `full`, letter spacing `wide`, font size `base` — was reported as unknown, with
 * the advice that it "resolves to a variable nothing declares, which paints nothing". `--we-radius-pill`
 * is declared and does paint. The console filled with warnings about correct code, which is exactly
 * where a real one goes unnoticed.
 */
describe('named tokens of a scale', () => {
  const warn = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['radius', 'pill'],
    ['radius', 'full'],
    ['letter-spacing', 'wide'],
    ['font-size', 'base'],
    ['shadow', 'lg'],
  ])('resolves %s "%s" without reporting it', (prefix, token) => {
    const spy = warn();

    expect(tokenVar(prefix, token)).toBe(`var(--we-${prefix}-${token})`);
    expect(spy).not.toHaveBeenCalled();
  });

  it('still reports a name no scale and no family has', () => {
    const spy = warn();

    // A name of its own: reports are deduped for the life of the process, so a name another test
    // has already used would pass this whatever the rule underneath did.
    expect(tokenVar('radius', 'recessed')).toBe('var(--we-radius-recessed)');
    expect(spy).toHaveBeenCalledOnce();
  });
});
