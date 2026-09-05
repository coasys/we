/* eslint-disable @typescript-eslint/no-explicit-any */
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { markReactive, type SchemaNode } from '@we/schema-shared';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';

type Callback = (entries: { isIntersecting: boolean }[]) => void;
const observers: { target: Element; root: Element | null; callback: Callback; disconnected: boolean }[] = [];

beforeEach(() => {
  observers.length = 0;
  (globalThis as any).IntersectionObserver = class {
    constructor(
      private callback: Callback,
      private options: { root?: Element | null },
    ) {}
    observe(target: Element) {
      observers.push({ target, root: this.options?.root ?? null, callback: this.callback, disconnected: false });
    }
    disconnect() {
      for (const o of observers) if (o.callback === this.callback) o.disconnected = true;
    }
  };
});
afterEach(() => {
  cleanup();
  delete (globalThis as any).IntersectionObserver;
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
/** The box the template scrolls in, below the app's own chrome. */
const scroller = (children: SchemaNode[]): SchemaNode => ({
  type: 'div',
  props: { id: 'scroller' },
  styles: { 'overflow-y': 'auto' },
  children,
});
const live = () => observers.filter((o) => !o.disconnected);
const wrapperIn = (container: HTMLElement) =>
  [...container.querySelectorAll('div')].find((el) => el.style.display === 'grid')!;

describe('$animate scrollPast — a sticky mini-profile keyed to a sentinel', () => {
  it('observes the sentinel against the box it scrolls in, not the window', () => {
    const { container } = render(() => (
      <RenderSchema node={scroller([sentinel, miniProfile])} stores={{}} registry={{}} />
    ));
    expect(live().map((o) => o.target.id)).toEqual(['sentinel']);
    // Node-level `styles` land on a wrapper div, so the scrolling box is the one carrying the overflow.
    const box = [...container.querySelectorAll('div')].find((el) => el.style.overflowY === 'auto');
    expect(live()[0].root).toBe(box);
  });

  it('opens once the sentinel is scrolled out of the box, and closes when it returns', async () => {
    const { container } = render(() => (
      <RenderSchema node={scroller([sentinel, miniProfile])} stores={{}} registry={{}} />
    ));
    const wrapper = wrapperIn(container);
    expect(wrapper.style.gridTemplateColumns).toBe('0fr');
    live()[0].callback([{ isIntersecting: false }]);
    await waitFor(() => expect(wrapper.style.gridTemplateColumns).toBe('1fr'));
    live()[0].callback([{ isIntersecting: true }]);
    await waitFor(() => expect(wrapper.style.gridTemplateColumns).toBe('0fr'));
  });

  it('still finds a sentinel that mounts after it does', async () => {
    // The header carrying the sentinel is gated on data the space loads; a lookup that ran once
    // before it existed left the mini-profile closed for good.
    const [ready, setReady] = createSignal(false);
    const stores = { spaceStore: { ready: markReactive(ready) } };
    const node = scroller([
      { type: '$if', props: { condition: { $: 'spaceStore.ready' }, then: sentinel } },
      miniProfile,
    ]);
    render(() => <RenderSchema node={node} stores={stores} registry={{}} />);
    expect(live()).toHaveLength(0);
    setReady(true);
    await waitFor(() => expect(live().map((o) => o.target.id)).toEqual(['sentinel']));
  });

  it('re-observes a sentinel that is replaced', async () => {
    const [generation, setGeneration] = createSignal(1);
    const stores = { spaceStore: { generation: markReactive(generation) } };
    // Two arms rendering the same sentinel: switching remounts it, as a space switch remounts the header.
    const node = scroller([
      { type: '$if', props: { condition: { $: 'spaceStore.generation == 1' }, then: sentinel, else: sentinel } },
      miniProfile,
    ]);
    const { container } = render(() => <RenderSchema node={node} stores={stores} registry={{}} />);
    const first = container.querySelector('#sentinel');
    setGeneration(2);
    await waitFor(() => expect(container.querySelector('#sentinel')).not.toBe(first));
    await waitFor(() => expect(live().map((o) => o.target)).toEqual([container.querySelector('#sentinel')]));
  });
});
