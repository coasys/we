/**
 * `top` / `right` / `bottom` / `left` on a Lit primitive resolve space tokens.
 *
 * The offsets are typed `string` and documented as taking "a space token or a CSS length", exactly
 * as `margin`, `padding` and `gap` do — so `bottom: '200'` is the ordinary spelling and has to
 * become `var(--we-space-200)` before it reaches CSS.
 *
 * It did not. This path wrote the prop through untouched, so the element got `bottom: 200`, which
 * is invalid CSS and which the browser therefore drops. The reason that is worth a test of its own
 * rather than a shrug is what happens next: `position: absolute` still applies, and an absolutely
 * positioned box with no valid offsets is laid out at its *static* position. Inside a centring
 * parent that is dead centre — so a control pinned to a corner appears in the middle of the box,
 * looking like a decision somebody made. The call tile's reconnect button sat in the middle of
 * everybody's video for as long as the button existed.
 *
 * `buildLayoutStyles` in @we/design-utils resolves these for the Solid components and had already
 * been fixed; this is the parallel implementation for the Lit primitives, and it was missed. Two
 * implementations of one job is why the bug could exist at all, so both now have a test.
 *
 * The rendered consequence — that the box actually lands in the corner — is measured in a real
 * browser by `tests/browser/cases/tokenOffsets.mjs` in @we/app-shell, since jsdom computes no
 * layout. This asserts the narrower thing that file cannot: the value written to the variable.
 */
import { describe, expect, it } from 'vitest';

import { updateAllCustomVars } from './helpers';

describe('position offsets on a primitive', () => {
  const varsFor = (props: Record<string, unknown>) => {
    const el = document.createElement('div');
    updateAllCustomVars(el, 'button', props);
    return el.style;
  };

  it('resolves a space token on every side', () => {
    const style = varsFor({ position: 'absolute', top: '200', right: '300', bottom: '200', left: '400' });
    expect(style.getPropertyValue('--we-button-top')).toBe('var(--we-space-200)');
    expect(style.getPropertyValue('--we-button-right')).toBe('var(--we-space-300)');
    expect(style.getPropertyValue('--we-button-bottom')).toBe('var(--we-space-200)');
    expect(style.getPropertyValue('--we-button-left')).toBe('var(--we-space-400)');
  });

  it('leaves a CSS length alone', () => {
    // tokenVar discriminates by shape, so the other half of the documented contract still holds —
    // and a negative offset, which is not a token at all, must survive untouched.
    const style = varsFor({ top: '12px', right: '50%', bottom: 'calc(100% + 4px)', left: '-8px' });
    expect(style.getPropertyValue('--we-button-top')).toBe('12px');
    expect(style.getPropertyValue('--we-button-right')).toBe('50%');
    expect(style.getPropertyValue('--we-button-bottom')).toBe('calc(100% + 4px)');
    expect(style.getPropertyValue('--we-button-left')).toBe('-8px');
  });

  it("keeps '0' unitless, which is valid CSS and not a token name", () => {
    // The case that masked the bug: every offset in the call tile that worked was a '0'. A tile's
    // video is pinned `top/right/bottom/left: '0'` and was always correct, so the fault only ever
    // showed on the one element that asked for a real distance.
    const style = varsFor({ position: 'absolute', top: '0', left: '0' });
    expect(style.getPropertyValue('--we-button-top')).toBe('0');
    expect(style.getPropertyValue('--we-button-left')).toBe('0');
  });

  it('writes nothing for a side that was not asked for', () => {
    // An offset must stay absent rather than resolving to tokenVar's '0' fallback: a box pinned
    // `bottom` only would otherwise also be pinned to the top and get stretched between the two.
    const style = varsFor({ position: 'absolute', bottom: '200' });
    expect(style.getPropertyValue('--we-button-bottom')).toBe('var(--we-space-200)');
    expect(style.getPropertyValue('--we-button-top')).toBe('');
  });
});
