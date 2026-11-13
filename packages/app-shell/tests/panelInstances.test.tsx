/**
 * A declared panel opened more than once: an instance per set of inputs, each a panel of its own
 * where the declaration puts it, its node reading what it was opened with. Through the real shell
 * store, a template's lane and the panel host.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { runWithGesture } from '@we/schema-shared';
import { createEffect, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PanelHost } from '../src/frameworks/solid/components/PanelHost';
import PanelLane from '../src/frameworks/solid/components/PanelLane';
import type { ShellStore } from '../src/frameworks/solid/stores/ShellStore';
import { ShellStoreProvider, useShellStore } from '../src/frameworks/solid/stores/ShellStore';
import { APP_PANEL_SCOPE, panelInstances, publishPanelInstances } from '../src/shared/registries/panelInstances';
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
    // The store keeps instances under a DID — as SessionStore provides it in the app.
    store.provideAgentDid(() => 'did:test:me');
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

  it("keeps each interface's instances to itself, and brings them back with it", () => {
    const { store } = mount();
    const declaration = [{ id: 'inspector', title: 'Inspector', home: 'side', node: { type: 'span' } }];
    const ada = store.openPanel('inspector', { name: 'Ada' });

    setTemplatePanels(declaration, 'another-template');
    expect(store.panelInstances()).toEqual([]);

    setTemplatePanels(declaration, 'instances-test');
    expect(store.panelInstances().map((instance) => instance.id)).toEqual([ada]);
  });

  it('brings a panel asked for back out of hiding — whether its dock is there yet or not', async () => {
    const { store, shown } = mount();
    store.openPanel('inspector', { name: 'Ada' });
    await vi.waitFor(() => expect(shown()).toEqual(['Ada']));

    store.togglePanelsHidden();
    expect(store.panelsHidden()).toBe(true);

    // Asking for an instance already open reveals it: its dock exists, so `revealDock` answers.
    store.openPanel('inspector', { name: 'Ada' });
    expect(store.panelsHidden()).toBe(false);

    store.togglePanelsHidden();
    expect(store.panelsHidden()).toBe(true);

    // A brand-new one has no dock registered until an effect runs — the open itself clears it.
    store.openPanel('inspector', { name: 'Bo' });
    expect(store.panelsHidden()).toBe(false);
  });
});

describe('an instance kept under the app', () => {
  it('stays open across interfaces, where a template-scoped one would not', async () => {
    const { store, all } = mount();
    const declaration = [
      {
        id: 'inspector',
        title: 'Inspector',
        home: 'side',
        node: { type: 'span', props: { class: 'inspecting' }, children: [{ $: "panel.inputs.name ?? 'nothing'" }] },
      },
    ];
    const chat = store.openPanel('inspector', { name: 'Ada' }, { scope: APP_PANEL_SCOPE });
    await vi.waitFor(() => expect(all()).toContain('Ada'));

    setTemplatePanels(declaration, 'another-template');
    expect(store.panelInstances().map((instance) => instance.id)).toEqual([chat]);
    await vi.waitFor(() => expect(all()).toContain('Ada'));

    setTemplatePanels(declaration, 'instances-test');
    expect(store.panelInstances().map((instance) => instance.id)).toEqual([chat]);
  });

  it('shows a space-bound one only while its space is — hidden, not closed, elsewhere', async () => {
    const { store, all } = mount();
    const [here, setHere] = createSignal('uuid-a');
    store.provideSpaceGate((uuid) => uuid === here());

    const bound = store.openPanel(
      'inspector',
      { perspectiveUuid: 'uuid-a', name: 'Ada' },
      { key: 'uuid-a', scope: APP_PANEL_SCOPE },
    );
    const global = store.openPanel('inspector', { name: 'Bo' }, { key: 'global', scope: APP_PANEL_SCOPE });
    await vi.waitFor(() => expect(all()).toEqual(expect.arrayContaining(['Ada', 'Bo'])));

    setHere('uuid-b');
    await vi.waitFor(() => expect(all()).not.toContain('Ada'));
    // The space-bound one is out of the list but still kept — the global one never left.
    expect(store.panelInstances().map((instance) => instance.id)).toEqual([global]);
    const kept = JSON.parse(localStorage.getItem('we-local:shell.panelInstances') ?? '{}') as Record<
      string,
      Record<string, Record<string, { id: string }>>
    >;
    expect(kept['did:test:me']?.[APP_PANEL_SCOPE]?.[bound]?.id).toBe(bound);

    setHere('uuid-a');
    await vi.waitFor(() => expect(all()).toContain('Ada'));
    expect(
      store
        .panelInstances()
        .map((instance) => instance.id)
        .sort(),
    ).toEqual([bound, global].sort());
  });
});

describe('a logout that does not reload', () => {
  it("shows the next agent nothing of the last one's kept panels", async () => {
    const { store } = mount();
    const [who, setWho] = createSignal('did:test:me');
    store.provideAgentDid(who);

    // An app-scope chat open under one agent — the sort whose inputs name a perspective.
    store.openPanel('inspector', { name: 'Ada', perspectiveUuid: 'uuid-a' }, { scope: APP_PANEL_SCOPE });
    expect(store.panelInstances()).toHaveLength(1);

    // Out and in as somebody else, no reload: her panels are not there for him.
    setWho('did:test:other');
    await vi.waitFor(() => expect(store.panelInstances()).toHaveLength(0));

    // Nothing of hers persisted under his key; her records sit under hers.
    const kept = JSON.parse(localStorage.getItem('we-local:shell.panelInstances') ?? '{}') as Record<
      string,
      Record<string, Record<string, { id: string }>>
    >;
    expect(kept['did:test:other']?.[APP_PANEL_SCOPE]).toBeUndefined();
    expect(Object.keys(kept['did:test:me']?.[APP_PANEL_SCOPE] ?? {})).toHaveLength(1);
  });
});

describe('a template opening a panel unasked', () => {
  /*
    `openPanel` is ambient — a template's panels open without a press — but pulling Settings down
    or the hidden dock back up is nobody's click. The bag stamps `viaTemplate` on the call, and
    the store reveals only while a person is acting.
  */
  it('still opens, but leaves Settings in front and the dock hidden', () => {
    const { store } = mount();
    store.togglePanelsHidden();
    store.openShellView('settings');

    store.openPanel('inspector', { name: 'Ada' }, { viaTemplate: true });

    // The instance opened — ambient means ambient — and nothing moved for it.
    expect(store.panelInstances()).toHaveLength(1);
    expect(store.activeShellView()).toBe('settings');
    expect(store.panelsHidden()).toBe(true);

    // The same call with a person's press behind it brings the panel forward as it always did.
    runWithGesture({ at: {} as Event } as never, () =>
      store.openPanel('inspector', { name: 'Bo' }, { viaTemplate: true }),
    );
    expect(store.activeShellView()).toBe(null);
    expect(store.panelsHidden()).toBe(false);
  });
});

describe('a republish that changes no record', () => {
  it('fires nothing — a node drawn off the map is not redrawn for it', () => {
    const ada = { id: 'a', panel: 'inspector', inputs: { name: 'Ada' }, opened: 1 };
    const bo = { id: 'b', panel: 'inspector', inputs: { name: 'Bo' }, opened: 2 };
    let fired = 0;
    const dispose = createRoot((done) => {
      createEffect(() => {
        panelInstances();
        fired++;
      });
      return done;
    });
    try {
      publishPanelInstances({ a: ada, b: bo });
      const after = fired;
      // A fresh map carrying the same records — what a store republish looks like — is silent.
      publishPanelInstances({ a: ada, b: bo });
      publishPanelInstances({ b: bo, a: ada });
      expect(fired).toBe(after);
      // A record replaced fires again, and so does one leaving.
      publishPanelInstances({ a: { ...ada, inputs: { name: 'Ana' } }, b: bo });
      expect(fired).toBe(after + 1);
      publishPanelInstances({ a: ada });
      expect(fired).toBe(after + 2);
    } finally {
      publishPanelInstances({});
      dispose();
    }
  });
});
