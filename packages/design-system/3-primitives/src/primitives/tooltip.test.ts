/**
 * The wrapper that must not exist as a box.
 *
 * `we-tooltip` decorates a child with behaviour; it is not a region of its own. While it took a box
 * it took part in its parent's layout, and every consequence of that had to be paid for at the call
 * site: it became the flex item its child should have been, so a `we-badge` declaring
 * `flex-shrink: 0` was protected and the wrapper around it was not, and a tight row crushed the
 * badge anyway. That is the rule this file pins, along with the two things a missing box takes away
 * — geometry to position against, and the meaning of a geometry prop written on the host.
 *
 * The same decision `we-draggable` made, and the docblock there states the general form.
 */
import { describe, expect, it, vi } from 'vitest';

import { boxlessLayoutProps } from '../shared/boxless';
import Tooltip from './tooltip';

const css = () => (Tooltip as unknown as { styles: { cssText: string }[] }).styles.map((s) => s.cssText).join('\n');

const mount = async (props: Record<string, unknown> = {}, inner = '<we-badge>x</we-badge>') => {
  const el = document.createElement('we-tooltip') as HTMLElement & {
    updateComplete: Promise<unknown>;
    open: boolean;
  };
  Object.assign(el, props);
  el.innerHTML = inner;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
};

describe('the box it does not take', () => {
  it('generates none, so its child is the flex item', () => {
    expect(css()).toContain('display: var(--we-tooltip-host-display, contents)');
  });

  it('and neither does the trigger, or the box would only move down a level', () => {
    /*
      `display: contents` on the host alone is not enough: the shadow root's trigger span would then
      become the flex item instead, and the child would be laid out against *that*. Both have to go.
    */
    expect(css()).toMatch(/\[part='trigger'\][^}]*display:\s*contents/);
  });
});

describe('what the missing box takes away', () => {
  it('positions against the slotted child, which is the thing on screen', async () => {
    /*
      A boxless element has no rectangle: `getBoundingClientRect` collapses to zero at the origin,
      which would put every tooltip in the top-left corner. The child is what a reader is pointing
      at, so the child is what the bubble points at.
    */
    const el = await mount({ content: 'hello' });
    const anchor = (el as unknown as { anchorEl: HTMLElement }).anchorEl;
    expect(anchor.tagName.toLowerCase()).toBe('we-badge');
  });

  it('sees through the renderer wrapper, which is boxless for the same reason this is', async () => {
    /*
      THE regression, and the one the first version of this file could not have caught: it mounted
      the child directly, and the app does not. The schema renderer wraps every node in a
      `display: contents` div, so `assignedElements` hands back a wrapper with no box — and taking
      it at face value put every tooltip in the app's top-left corner while this suite stayed green.

      `we-sortable._resolveItem` sees through the same wrappers, and its docblock is where the
      behaviour is written down.
    */
    const el = await mount({ content: 'hello' }, '<div style="display: contents"><we-badge>x</we-badge></div>');
    const anchor = (el as unknown as { anchorEl: HTMLElement }).anchorEl;
    expect(anchor.tagName.toLowerCase()).toBe('we-badge');
  });

  it('descends more than one wrapper deep', async () => {
    // Nothing says the renderer wraps exactly once — a node with `styles` gets another.
    const el = await mount(
      { content: 'hello' },
      '<div style="display: contents"><div style="display: contents"><we-badge>x</we-badge></div></div>',
    );
    expect((el as unknown as { anchorEl: HTMLElement }).anchorEl.tagName.toLowerCase()).toBe('we-badge');
  });

  it('falls back to itself rather than throwing when it wraps nothing', async () => {
    const el = await mount({ content: 'hello' }, '');
    expect((el as unknown as { anchorEl: HTMLElement }).anchorEl).toBe(el);
  });

  it('says so when somebody writes a geometry prop on it', async () => {
    /*
      The one silent failure the change introduces, and the reason it does not stay silent. Before
      this was boxless the wrapper *was* the flex item, so putting a width on it was correct — the
      sidebar header did exactly that. Anything written in that period is now inert, and nothing
      else would report it.
    */
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount({ content: 'hello', width: '80px', flex: '0 0 auto' });
    expect(warn).toHaveBeenCalled();
    const said = warn.mock.calls.flat().join(' ');
    expect(said).toContain('width');
    expect(said).toContain('flex');
    warn.mockRestore();
  });

  it('stays quiet about props that still work through the child', async () => {
    // Behaviour, not geometry: a click reaches the child either way, and `content` is the API.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount({ content: 'hello', placement: 'right' });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('which props need a box', () => {
  it('counts geometry and painting, not behaviour', () => {
    expect(boxlessLayoutProps({ width: '10px', flexShrink: '0', bg: 'surface' })).toEqual([
      'width',
      'flexShrink',
      'bg',
    ]);
    expect(boxlessLayoutProps({ placement: 'top', content: 'hi', cursor: 'pointer' })).toEqual([]);
  });

  it('ignores a prop that is present but empty, which is how an unset one arrives', () => {
    expect(boxlessLayoutProps({ width: '', height: undefined, flex: null })).toEqual([]);
  });
});

describe('hover', () => {
  it('listens on the pair that bubbles, since the host is not on an enter/leave path it can rely on', async () => {
    const el = await mount({ content: 'hello' });
    const badge = el.querySelector('we-badge')!;

    // Over the child, from outside — the host sees it because mouseover bubbles.
    badge.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    expect(el.open).toBe(true);

    badge.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    expect(el.open).toBe(false);
  });

  it('ignores a crossing between the trigger own children', async () => {
    /*
      The cost of bubbling events, and the well-worn answer: moving from a label to an icon inside
      the same trigger fires `mouseout` then `mouseover`, which would flicker the bubble closed and
      open again on every internal boundary.
    */
    const el = await mount({ content: 'hello' }, '<we-badge><span id="a">a</span><span id="b">b</span></we-badge>');
    const a = el.querySelector('#a')!;
    const b = el.querySelector('#b')!;

    a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    expect(el.open).toBe(true);

    a.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: b }));
    expect(el.open).toBe(true);
  });
});
