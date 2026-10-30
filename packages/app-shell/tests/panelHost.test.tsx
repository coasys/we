/**
 * A panel drawn once and moved between places — see `PanelHost`. Drawn by its place, a move built
 * it again: an embedded page reloaded, focus and a WebGL context were lost, and the redraw-on-drag
 * judder in a lane was the same thing on every frame.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PanelHost, PanelSlot } from '../src/frameworks/solid/components/PanelHost';
import { registerPanelContent } from '../src/shared/registries/panelContents';
import { provideChromeBag } from '../src/shared/registries/templateBag';

let release: () => void;

beforeEach(() => {
  release = provideChromeBag({} as never);
  registerPanelContent('test:panel', { type: 'span', props: { id: 'content' }, children: ['Hello'] });
});

afterEach(() => {
  cleanup();
  release();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('a panel drawn once', () => {
  it('moves to another place as the same element, never drawn again', () => {
    const [where, setWhere] = createSignal<'edge' | 'lane'>('edge');
    const { container } = render(() => (
      <>
        <div id="edge">
          <Show when={where() === 'edge'}>
            <PanelSlot id="test:panel" />
          </Show>
        </div>
        <div id="lane">
          <Show when={where() === 'lane'}>
            <PanelSlot id="test:panel" />
          </Show>
        </div>
        <PanelHost />
      </>
    ));
    const drawn = container.querySelector('#edge #content');
    expect(drawn?.textContent).toBe('Hello');

    setWhere('lane');
    expect(container.querySelector('#edge #content')).toBeNull();
    expect(container.querySelector('#lane #content')).toBe(drawn);
  });

  it('goes once no place holds it, rather than living on unseen', async () => {
    const [open, setOpen] = createSignal(true);
    const { container } = render(() => (
      <>
        <Show when={open()}>
          <PanelSlot id="test:panel" />
        </Show>
        <PanelHost />
      </>
    ));
    expect(container.querySelector('#content')).not.toBeNull();

    setOpen(false);
    await settle();
    expect(container.querySelector('#content')).toBeNull();
  });
});
