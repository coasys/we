/**
 * A `we-*` host's `flex` keeps its shrink factor.
 *
 * The host rule declares `flex-shrink` after the `flex` shorthand. Without a `flexShrink` prop the
 * `flex-shrink` variable was unset, which reset the shrink to 1: `flex: 'none'` on an icon or an
 * avatar still shrank, and a tight row squeezed an avatar to a sliver.
 */
import '../primitives/avatar';

import { describe, expect, it } from 'vitest';

import { flexShrinkOf } from './helpers';

describe('flexShrinkOf', () => {
  it('reads the shrink half of the shorthand', () => {
    expect(flexShrinkOf('none')).toBe('0');
    expect(flexShrinkOf('0 0 auto')).toBe('0');
    expect(flexShrinkOf('1 3 0')).toBe('3');
    expect(flexShrinkOf('0 0.5')).toBe('0.5');
  });

  it('is 1 where the shorthand leaves the shrink at its default', () => {
    expect(flexShrinkOf('auto')).toBe('1');
    expect(flexShrinkOf('1')).toBe('1');
    expect(flexShrinkOf('1 120px')).toBe('1');
    // Basis first: the number after it is the grow factor, not the shrink.
    expect(flexShrinkOf('100px 0')).toBe('1');
  });

  it('sets nothing without a flex', () => {
    expect(flexShrinkOf(undefined)).toBeUndefined();
    expect(flexShrinkOf('')).toBeUndefined();
  });
});

describe('a mounted avatar', () => {
  it('does not shrink: its default flex is 0 0 auto', async () => {
    const el = document.createElement('we-avatar') as HTMLElement & { updateComplete: Promise<unknown> };
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.style.getPropertyValue('--we-avatar-flex-shrink')).toBe('0');
  });
});
