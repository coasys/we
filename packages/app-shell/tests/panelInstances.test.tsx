/**
 * A declared panel opened more than once: an instance per set of inputs, each a panel of its own
 * where the declaration puts it, its node reading what it was opened with. Through the real shell
 * store, a template's lane and the panel host.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PanelHost } from '../src/frameworks/solid/components/PanelHost';
import PanelLane from '../src/frameworks/solid/components/PanelLane';
import type { ShellStore } from '../src/frameworks/solid/stores/ShellStore';
import { ShellStoreProvider, useShellStore } from '../src/frameworks/solid/stores/ShellStore';
import { provideChromeBag, provideTemplateBag } from '../src/shared/registries/templateBag';
import { setTemplatePanels } from '../src/shared/registries/templatePanels';
import { buildTemplateBag, CHROME_TIER } from '../src/shared/registries/templateSurface';

let release: (() => void)[] = [];

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/space/test');
  release = [provideTemplateBag({} as never)];
  setTemplatePanels(
    [
      {
        id: 'inspector',
        title: 'Inspector',
        home: 'side',
        order: 0,
        node: { type: 'span', props: { class: 'inspecting' }, children: [{ $: "panel.inputs.name ?? 'nothing'" }] },
      },
    ],
    'instances-test',
  );
});

afterEach(() => {
  cleanup();
  setTemplatePanels(undefined);
  release.forEach((done) => done());
});

function mount() {
  let store!: ShellStore;
  const Grab = () => {
    store = useShellStore();
    release.push(provideChromeBag(buildTemplateBag({ shellStore: store } as never, { grants: CHROME_TIER }) as never));
    return null;
  };
  const { container } = render(() => (
    <ShellStoreProvider>
      <Grab />
      <PanelLane lane="side" width="320px" />
      <PanelHost />
    </ShellStoreProvider>
  ));
  const shown = () =>
    [...container.querySelectorAll('.inspecting')]
      .filter((el) => !el.closest('[style*="display: none"]'))
      .map((el) => el.textContent);
  const all = () => [...container.querySelectorAll('.inspecting')].map((el) => el.textContent).sort();
  return { store, shown, all };
}

describe('a panel opened more than once', () => {
  it('opens an instance per set of inputs, each reading its own, as tabs where the declaration has an order', async () => {
    const { store, shown, all } = mount();
    await vi.waitFor(() => expect(shown()).toEqual(['nothing']));

    const ada = store.openPanel('inspector', { name: 'Ada' });
    const bo = store.openPanel('inspector', { name: 'Bo' });
    expect(ada).not.toBe(bo);

    // Every one drawn, the last opened in front, in one place with the declared panel.
    await vi.waitFor(() => expect(all()).toEqual(['Ada', 'Bo', 'nothing']));
    expect(shown()).toEqual(['Bo']);
    expect(store.dockGeometry()[bo].tabs?.map((tab) => tab.id)).toEqual(['template:inspector', ada, bo]);
    expect(
      store
        .panelInstances()
        .map((instance) => instance.inputs.name)
        .sort(),
    ).toEqual(['Ada', 'Bo']);
  });

  it('brings the instance already open forward, rather than opening a second for the same inputs', async () => {
    const { store, shown } = mount();
    const ada = store.openPanel('inspector', { name: 'Ada' });
    store.openPanel('inspector', { name: 'Bo' });
    expect(store.openPanel('inspector', { name: 'Ada' })).toBe(ada);
    expect(store.panelInstances()).toHaveLength(2);
    await vi.waitFor(() => expect(shown()).toEqual(['Ada']));
  });

  it('closes one, forgetting where it was, and keeps the rest across a reload', async () => {
    const first = mount();
    const ada = first.store.openPanel('inspector', { name: 'Ada' });
    const bo = first.store.openPanel('inspector', { name: 'Bo' });
    first.store.closePanel(ada);
    expect(first.store.panelInstances().map((instance) => instance.id)).toEqual([bo]);
    expect(first.store.dockGeometry()[ada]).toBeUndefined();
    cleanup();

    const second = mount();
    expect(second.store.panelInstances().map((instance) => instance.id)).toEqual([bo]);
    await vi.waitFor(() => expect(second.all()).toEqual(['Bo', 'nothing']));
  });

  it('opens nothing for a panel the interface does not supply', () => {
    const { store } = mount();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(store.openPanel('nowhere', { name: 'Ada' })).toBe('');
    expect(store.panelInstances()).toHaveLength(0);
    warn.mockRestore();
  });
});
