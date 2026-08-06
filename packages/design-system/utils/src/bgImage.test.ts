/**
 * `bgImage` carries gradients as well as image references.
 *
 * CSS's `background-image` accepts both, ours accepted only URLs — so the one way to express a
 * soft, organic background without shipping an asset was the `styles` escape hatch, which then
 * lost a fight with `bg` (see the ordering test at the bottom) and produced a screen that was
 * either invisible or transparent depending on which prop you removed.
 *
 * The failure mode was silent in the way that matters: a gradient went through the URL path, came
 * out whitespace-stripped and wrapped in `url("…")`, and the browser dropped the whole declaration
 * without complaint. Nothing typechecked it, because both are strings.
 */
import { describe, expect, it } from 'vitest';

import { bgImageLayer, buildLayoutStyles, computeBgImageComposite, isGradientValue } from './index';

const MESH =
  'radial-gradient(55% 45% at 18% 22%, red, transparent 70%), radial-gradient(45% 40% at 82% 12%, blue, transparent)';

describe('bgImageLayer', () => {
  it('passes a gradient through verbatim rather than wrapping it as a URL', () => {
    // The old path produced url("radial-gradient(55%45%at18%22%,red,transparent70%)…") — mangled
    // by whitespace stripping *and* invalid as a URL, so nothing rendered.
    const out = bgImageLayer(MESH);
    expect(out).not.toContain('url(');
    expect(out).toContain('radial-gradient(55% 45% at 18% 22%');
  });

  it('keeps the spaces a gradient depends on, collapsing only runs', () => {
    // `at 18% 22%` is not optional whitespace — strip it and the value stops parsing.
    expect(bgImageLayer('linear-gradient(  to   right,  red,  blue )')).toBe('linear-gradient( to right, red, blue )');
  });

  it('still wraps a plain URL', () => {
    expect(bgImageLayer('https://example.com/a.png')).toBe('url("https://example.com/a.png")');
  });

  it('recognises every gradient function, including repeating and conic', () => {
    for (const value of [
      'linear-gradient(red, blue)',
      'radial-gradient(red, blue)',
      'conic-gradient(red, blue)',
      'repeating-linear-gradient(red, blue)',
      '  RADIAL-GRADIENT(red, blue)',
    ]) {
      expect(isGradientValue(value)).toBe(true);
    }
    // A URL that merely mentions one is not a gradient.
    expect(isGradientValue('https://example.com/linear-gradient.png')).toBe(false);
  });
});

describe('fading a gradient', () => {
  it('layers the tint over a gradient the same way it does over an image', () => {
    const out = computeBgImageComposite({ bgImage: MESH, bgImageOpacity: 0.5, bg: 'neutral-0' });
    // The wash becomes the first of several layers rather than the only one over a url().
    expect(out?.startsWith('linear-gradient(color-mix')).toBe(true);
    expect(out).toContain('radial-gradient(55% 45% at 18% 22%');
    expect(out).not.toContain('url(');
  });
});

describe('bg and bgImage compose', () => {
  it('puts the colour beneath the gradient, which is the point of using both', () => {
    const style = buildLayoutStyles({ bg: 'neutral-0', bgImage: MESH }, 'column');

    // `bg` emits the `background` shorthand, which would reset background-image — so ordering is
    // load-bearing. It is assigned first, and `background-image` after, which is what lets the two
    // compose rather than one silently winning.
    const keys = Object.keys(style);
    expect(keys.indexOf('background')).toBeLessThan(keys.indexOf('background-image'));
    expect(style['background-image']).toContain('radial-gradient');
  });
});

describe('styles is a genuine override', () => {
  it('wins against a DS prop that sets the same property', () => {
    // Spread before the DS props, `styles` lost to anything assigned later — so `bg` silently beat
    // a background set here, despite the spread being commented as allowing custom overrides.
    const style = buildLayoutStyles({ bg: 'primary-500', styles: { background: 'rebeccapurple' } }, 'column');
    expect(style['background']).toBe('rebeccapurple');
  });

  it('leaves DS props alone when it does not collide', () => {
    const style = buildLayoutStyles({ bg: 'primary-500', styles: { cursor: 'pointer' } }, 'column');
    expect(style['cursor']).toBe('pointer');
    expect(style['background']).toContain('primary');
  });
});
