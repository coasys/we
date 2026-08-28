import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { markReactive, type SchemaNode } from '@we/schema-shared';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const miniProfile: SchemaNode = {
  type: '$animate',
  props: {
    scrollPast: 'sentinel',
    enterTransition: [
      { type: 'reveal', axis: 'inline', duration: 10 },
      { type: 'fade', duration: 10 },
    ],
    exitTransition: [
      { type: 'reveal', axis: 'inline', duration: 10 },
      { type: 'fade', duration: 10 },
    ],
  },
  children: [{ type: 'span', children: ['Space'] }],
};
const sentinel: SchemaNode = { type: 'div', props: { id: 'sentinel' }, styles: { height: '0px' } };
/** The bar the mini-profile lives in — sticky, with padding around its contents as the real one has. */
const stickyBar: SchemaNode = { type: 'div', styles: { position: 'sticky', padding: '16px' }, children: [miniProfile] };

/** jsdom has no layout: give the sentinel and the sticky bar the positions a scroll would. */
function place(container: HTMLElement, sentinelTop: number, barTop: number) {
  const marker = container.querySelector('#sentinel')!;
  const bar = [...container.querySelectorAll('div')].find((el) => el.style.position === 'sticky')!;
  const wrapper = [...container.querySelectorAll('div')].find((el) => el.style.display === 'grid')!;
  const rect = (top: number, height: number) =>
    ({ top, bottom: top + height, left: 0, right: 100, width: 100, height }) as DOMRect;
  vi.spyOn(marker, 'getBoundingClientRect').mockImplementation(() => rect(sentinelTop, 0));
  vi.spyOn(bar, 'getBoundingClientRect').mockImplementation(() => rect(barTop, 72));
  // Inside the bar's padding: at rest the wrapper's top is already below the sentinel, which is
  // why the bar, not the wrapper, is the edge that counts.
  vi.spyOn(wrapper, 'getBoundingClientRect').mockImplementation(() => rect(barTop + 16, 40));
  window.dispatchEvent(new Event('scroll'));
  return wrapper;
}

describe('$animate scrollPast — a sticky mini-profile keyed to a sentinel', () => {
  it('stays closed while the sentinel sits above it, and opens once the sentinel scrolls behind it', async () => {
    const { container } = render(() => (
      <RenderSchema node={{ type: 'div', children: [sentinel, stickyBar] }} stores={{}} registry={{}} />
    ));
    // The header is still on screen: the sentinel touches the bar's top edge.
    const wrapper = place(container, 400, 400);
    await new Promise((r) => setTimeout(r, 30));
    expect(wrapper.style.gridTemplateColumns).toBe('0fr');

    // The bar has stuck and the header kept going: the sentinel is now under the bar, still on
    // screen — the case a viewport-based observer never reported.
    place(container, 20, 60);
    await waitFor(() => expect(wrapper.style.gridTemplateColumns).toBe('1fr'));

    // Scrolled back up.
    place(container, 400, 400);
    await waitFor(() => expect(wrapper.style.gridTemplateColumns).toBe('0fr'));
  });

  it('still finds a sentinel that mounts after it does', async () => {
    // The header carrying the sentinel is gated on data the space loads; a lookup that ran once
    // before it existed left the mini-profile closed for good.
    const [ready, setReady] = createSignal(false);
    const stores = { spaceStore: { ready: markReactive(ready) } };
    const node: SchemaNode = {
      type: 'div',
      children: [{ type: '$if', props: { condition: { $: 'spaceStore.ready' }, then: sentinel } }, stickyBar],
    };
    const { container } = render(() => <RenderSchema node={node} stores={stores} registry={{}} />);
    expect(container.querySelector('#sentinel')).toBeNull();
    setReady(true);
    await waitFor(() => expect(container.querySelector('#sentinel')).not.toBeNull());
    const wrapper = place(container, -50, 60);
    await waitFor(() => expect(wrapper.style.gridTemplateColumns).toBe('1fr'));
  });
});
