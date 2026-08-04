/**
 * Offsets resolve space tokens.
 *
 * They were raw passthrough, so `bottom: '400'` emitted an unitless `bottom: 400` — invalid CSS,
 * silently dropped by the browser, and invisible to typecheck and schema validation because the
 * prop is typed as a string and '400' is a string. It has caught two people: the call module
 * shipped a bar that "appeared at the top" for exactly this reason, and the sign-in screen's
 * account switcher was not in the corner it claimed to be.
 *
 * The point of the test is the silence, not the arithmetic — nothing else reports this.
 */
import { describe, expect, it } from 'vitest';

import { buildLayoutStyles } from './index';

const layout = (props: Record<string, unknown>) =>
  buildLayoutStyles(props as Parameters<typeof buildLayoutStyles>[0], 'column');

describe('CSS math functions are raw values', () => {
  // Not offset-specific: they were falling through to the token branch on every token-resolved
  // prop — padding, gap, margin — and coming back as a variable named after the expression.
  it('passes calc/min/max/clamp through on any token-resolved prop', () => {
    // Margin rather than padding only because padding is a flex-layer prop and this helper
    // builds the layout layer — both go through the same tokenVar.
    expect(layout({ mt: 'calc(100% - 8px)' })).toMatchObject({ margin: 'calc(100% - 8px) 0 0 0' });
    expect(layout({ top: 'clamp(1rem, 2vw, 3rem)' })).toMatchObject({ top: 'clamp(1rem, 2vw, 3rem)' });
  });
});

describe('offset props', () => {
  it('resolves a bare token to the space variable', () => {
    expect(layout({ bottom: '400', left: '400' })).toMatchObject({
      bottom: 'var(--we-space-400)',
      left: 'var(--we-space-400)',
    });
  });

  it('passes CSS lengths through untouched', () => {
    expect(layout({ top: '16px', right: '50%', bottom: 'calc(100% - 8px)' })).toMatchObject({
      top: '16px',
      right: '50%',
      bottom: 'calc(100% - 8px)',
    });
  });

  it('keeps bare zero as zero — unitless zero is valid CSS, not a token', () => {
    expect(layout({ top: '0', left: '0' })).toMatchObject({ top: '0', left: '0' });
  });

  it('passes negative offsets through', () => {
    expect(layout({ top: '-8px' })).toMatchObject({ top: '-8px' });
  });

  it('emits nothing for offsets that were never set', () => {
    const style = layout({ position: 'absolute' });
    expect('top' in style).toBe(false);
    expect('bottom' in style).toBe(false);
  });
});
