/**
 * The popover as a decoration on its trigger, not a box of its own.
 *
 * It was a box, and a box sits on its parent's line of text: a stack of avatars — which has no text
 * and so aligns by its bottom edge — rode higher than the buttons beside it on every task card. The
 * fix is `we-tooltip`'s, and so are the two things a missing box takes away, pinned here the same way.
 */
import { describe, expect, it } from 'vitest';

import Popover from './popover';

const css = () => {
  const styles = (Popover as unknown as { styles: { cssText: string } | { cssText: string }[] }).styles;
  return (Array.isArray(styles) ? styles : [styles]).map((s) => s.cssText).join('\n');
};

const mount = async (inner: string) => {
  const el = document.createElement('we-popover') as HTMLElement & { updateComplete: Promise<unknown> };
  el.innerHTML = inner;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
};

describe('the box it does not take', () => {
  it('generates none, and neither does its trigger', () => {
    expect(css()).toContain('display: var(--we-popover-host-display, contents)');
    expect(css()).toMatch(/\[part='trigger'\][^}]*display:\s*contents/);
  });
});

describe('what it opens from', () => {
  it('is the first thing in the trigger that has a box, seen through the renderer wrappers', async () => {
    const el = await mount(
      '<div slot="trigger" style="display: contents"><div style="display: contents"><we-button>x</we-button></div></div>',
    );
    expect((el as unknown as { anchorEl: HTMLElement }).anchorEl.tagName.toLowerCase()).toBe('we-button');
  });

  it('falls back to itself rather than throwing when the trigger is empty', async () => {
    const el = await mount('');
    expect((el as unknown as { anchorEl: HTMLElement }).anchorEl).toBe(el);
  });
});
