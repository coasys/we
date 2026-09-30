/**
 * `whiteSpace` and `overflowWrap` reach a primitive.
 *
 * The static sheet has declared `white-space` and `overflow-wrap` on `[part='base']` from the shared
 * typography spec table for as long as the table has had them, and `updateCustomVars` never wrote
 * either variable. So both props typechecked, validated, worked on a Column, and did nothing at all
 * on every `we-*` element — found by the browser test, where `mdUpProps: { whiteSpace: 'normal' }`
 * left a truncated label on one line.
 */
import '../primitives/text';

import { describe, expect, it } from 'vitest';

type DSEl = HTMLElement & Record<string, unknown> & { updateComplete: Promise<unknown> };

async function mount(props: Record<string, unknown>): Promise<DSEl> {
  const el = document.createElement('we-text') as DSEl;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('typography props the sheet declares', () => {
  it('writes whiteSpace and overflowWrap at rest', async () => {
    const el = await mount({ whiteSpace: 'pre-wrap', overflowWrap: 'normal' });
    expect(el.style.getPropertyValue('--we-text-white-space')).toBe('pre-wrap');
    expect(el.style.getPropertyValue('--we-text-overflow-wrap')).toBe('normal');
  });

  it('writes them for a breakpoint and a state too', async () => {
    const el = await mount({ mdUpProps: { whiteSpace: 'normal' }, hoverProps: { overflowWrap: 'anywhere' } });
    expect(el.style.getPropertyValue('--we-text-md-white-space')).toBe('normal');
    expect(el.style.getPropertyValue('--we-text-hover-overflow-wrap')).toBe('anywhere');
  });

  it('clears them when the prop goes away', async () => {
    const el = await mount({ whiteSpace: 'nowrap' });
    el.whiteSpace = undefined;
    await el.updateComplete;
    expect(el.style.getPropertyValue('--we-text-white-space')).toBe('');
  });
});
