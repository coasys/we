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

describe('only the panel decides whether the panel is open', () => {
  /*
    The listener is bound to the panel, so anything dispatched INSIDE the panel's content reaches it
    too when it bubbles and crosses shadow boundaries — and `we-tooltip` dispatches exactly that: a
    `composed`, bubbling `toggle` CustomEvent each time it opens or closes. `newState` on a
    CustomEvent is undefined, which read as "not open", so the panel closed itself.

    Every tooltip inside a popover was therefore a way to shut the popover. A rating or a slider
    dragged inside one opened its value bubble and the popover went; hovering the clear button did
    the same. What kept working was everything with no tooltip in it — selecting the count, pressing
    a vote arrow — which is what made it look like a problem with dragging.
  */
  it('ignores a `toggle` raised by something inside it', async () => {
    const host = document.createElement('we-popover') as HTMLElement & {
      updateComplete: Promise<unknown>;
      open: boolean;
    };
    const content = document.createElement('div');
    content.slot = 'content';
    host.append(content);
    document.body.append(host);
    await host.updateComplete;

    host.open = true;
    await host.updateComplete;

    content.dispatchEvent(new CustomEvent('toggle', { bubbles: true, composed: true }));
    await host.updateComplete;

    expect(host.open, 'a tooltip opening inside the panel closed it').toBe(true);
  });

  it('still follows the browser closing the panel itself', async () => {
    // The event this handler is actually for: the panel's own state changing, `newState` and all.
    const host = document.createElement('we-popover') as HTMLElement & {
      updateComplete: Promise<unknown>;
      open: boolean;
    };
    document.body.append(host);
    await host.updateComplete;
    host.open = true;
    await host.updateComplete;

    const panel = host.shadowRoot!.querySelector('[popover]')!;
    const closed = new Event('toggle') as Event & { newState?: string };
    closed.newState = 'closed';
    panel.dispatchEvent(closed);
    await host.updateComplete;

    expect(host.open).toBe(false);
  });
});
