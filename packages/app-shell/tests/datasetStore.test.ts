/**
 * datasetStore: the dataset list, which dataset is on screen, and what a switch publishes — including
 * the switches that must not land, and a re-publish of the space on screen that must wake nobody.
 *
 * Plain store tests, run once under each reactivity port: Solid's, and the test port that runs a new
 * effect at once where Solid defers it.
 */
import type { DatasetChangeHandlers, DatasetRef } from '@we/backend-shared';
import { registerEntity } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { provideSeed } from '../src/shared/seedRegistry';
import { createDatasetStore, type DatasetStore } from '../src/shared/stores/DatasetStore';
import type { BootState } from '../src/shared/stores/SessionStore';
import { reactivityPorts } from './support/engines';

provideSeed({ name: 'test', modules: [] } as never);

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

const ref = (id: string, name = id, sharedUri?: string): DatasetRef => ({
  id,
  name,
  ...(sharedUri ? { sharedUri, sharedId: sharedUri.replace('neighbourhood://', '') } : {}),
  handle: { id } as never,
});

/** A backend's dataset lifecycle and schema ports over a list the test holds. */
function backend(list: DatasetRef[]) {
  const state = { list, failGet: false, gates: new Map<string, Promise<void>>() };
  let handlers: DatasetChangeHandlers | null = null;
  const lifecycle = {
    // This backend's own spelling of a shared dataset's address.
    sharedIdOf: (uri: string) => uri.replace('test://', ''),
    list: async () => state.list.map((d) => ({ ...d })),
    // A fresh object each time, as the real adapter builds one per call.
    async get(id: string) {
      if (state.failGet) throw new Error('unreachable');
      await state.gates.get(id);
      const found = state.list.find((d) => d.id === id);
      return found ? { ...found } : null;
    },
    create: async (name: string) => {
      const made = ref(`new-${name}`, name);
      state.list.push(made);
      return made;
    },
    async remove(id: string) {
      state.list = state.list.filter((d) => d.id !== id);
    },
    subscribe(h: DatasetChangeHandlers) {
      handlers = h;
      return () => {};
    },
  };
  const schemas = {
    installRoot: async () => {},
    hasCoreSchema: async () => true,
    hasAnySchema: async () => true,
    installModules: async () => {},
    refreshSpace: async () => [] as string[],
    foreignSchemas: async () => [{ name: 'Message', properties: [] }],
  };
  return { lifecycle, schemas, state, emit: () => handlers! };
}

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  let reactivity: ReactivityPort;
  const disposers: (() => void)[] = [];
  const toasts: string[] = [];

  function mount(b: ReturnType<typeof backend>): DatasetStore {
    let store!: DatasetStore;
    const [bootState] = reactivity.signal<BootState>('ready');
    disposers.push(
      reactivity.root(() => {
        store = createDatasetStore({
          reactivity,
          firstScreen: { whenOpen: () => Promise.resolve() },
          toasts: { error: (message) => toasts.push(message) },
          sessionStore: {
            bootState,
            lifecycle: () => b.lifecycle as never,
            backendPorts: () => ({ schemas: b.schemas }) as never,
            me: () => undefined,
            ephemeralPort: () => null,
          },
        });
      }),
    );
    return store;
  }

  beforeEach(() => {
    reactivity = makePort();
    toasts.length = 0;
  });
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it('asks the backend which shared ids the seed’s addresses name', () => {
    provideSeed({
      name: 'test',
      modules: [],
      globalSpaceUrl: 'test://global',
      marketplaceUrl: 'test://market',
    } as never);
    try {
      const store = mount(backend([]));
      expect(store.globalSpaceId()).toBe('global');
      expect(store.marketplaceId()).toBe('market');
    } finally {
      provideSeed({ name: 'test', modules: [] } as never);
    }
  });

  it('publishes the list, and says it has answered even when it could not be read', async () => {
    const b = backend([ref('a', 'Garden'), ref('root', 'we-root')]);
    const store = mount(b);
    expect(store.datasetsLoaded()).toBe(false);
    await store.loadDatasets([ref('a', 'Garden'), ref('root', 'we-root')] as never);
    expect(store.datasetsLoaded()).toBe(true);
    expect(store.datasets().map((d) => d.id)).toEqual(['a', 'root']);
    // The system datasets stay out of the sidebar's list.
    expect(store.orderedDatasets().map((d) => d.id)).toEqual(['a']);
    expect(store.systemDatasetUuids()).toEqual(['root']);
  });

  it('switches to a dataset, then reads its foreign models behind the switch', async () => {
    const b = backend([ref('a', 'Garden', 'neighbourhood://QmA')]);
    const store = mount(b);
    await store.switchDataset('a');
    expect(store.currentDataset()?.id).toBe('a');
    expect(store.currentDatasetCid()).toBe('QmA');
    expect(store.isWeSpace()).toBe(true);
    await flush();
    expect(store.currentDatasetEntitiesLoaded()).toBe(true);
    expect(store.currentDatasetEntities().map((e) => e.name)).toEqual(['Message']);
  });

  it('publishing the space on screen again wakes nothing that reads it', async () => {
    const b = backend([ref('a', 'Garden', 'neighbourhood://QmA')]);
    const store = mount(b);
    await store.switchDataset('a');
    let wakes = 0;
    disposers.push(reactivity.root(() => reactivity.effect(() => void (store.currentDataset(), wakes++))));
    const before = wakes;
    // The same dataset, a new object with the same handle, as the backend hands one back.
    b.state.list = [{ ...b.state.list[0] }];
    await store.switchDataset('a');
    expect(wakes).toBe(before);
  });

  it('a switch overtaken by a later one never lands', async () => {
    const b = backend([ref('a'), ref('b')]);
    let open!: () => void;
    b.state.gates.set('a', new Promise<void>((resolve) => (open = resolve)));
    const store = mount(b);
    const first = store.switchDataset('a');
    await store.switchDataset('b');
    open();
    await first;
    expect(store.currentDataset()?.id).toBe('b');
  });

  it('a switch the caller no longer wants is abandoned, and clearing withdraws one in flight', async () => {
    const b = backend([ref('a'), ref('b')]);
    const store = mount(b);
    await store.switchDataset('a', { stillWanted: () => false });
    expect(store.currentDataset()).toBeNull();
    let open!: () => void;
    b.state.gates.set('b', new Promise<void>((resolve) => (open = resolve)));
    const pending = store.switchDataset('b');
    store.clearCurrentDataset();
    open();
    await pending;
    expect(store.currentDataset()).toBeNull();
    expect(store.isWeSpace()).toBe(false);
  });

  it('says so when a space cannot be opened', async () => {
    const b = backend([ref('a')]);
    const store = mount(b);
    b.state.failGet = true;
    await store.switchDataset('a');
    expect(toasts).toEqual(['Could not open that space']);
  });

  it('follows the backend: added, published and removed datasets, telling who asked', async () => {
    const b = backend([ref('a')]);
    const store = mount(b);
    await store.loadDatasets([ref('a')] as never);
    await store.switchDataset('a');
    const removed: string[] = [];
    store.onDatasetRemoved((id) => removed.push(id));
    store.subscribeToChanges();
    b.emit().onAdded!(ref('c'));
    b.emit().onAdded!(ref('c'));
    expect(store.datasets().map((d) => d.id)).toEqual(['a', 'c']);
    // A publish of the space on screen gives it its shared address.
    b.emit().onUpdated!(ref('a', 'a', 'neighbourhood://QmA'));
    expect(store.currentDatasetUri()).toBe('neighbourhood://QmA');
    b.emit().onRemoved!('c');
    expect(store.datasets().map((d) => d.id)).toEqual(['a']);
    expect(removed).toEqual(['c']);
  });

  it('tracks a dataset the app made, replacing an entry the backend listed first', async () => {
    const b = backend([]);
    const store = mount(b);
    await store.trackDataset(ref('s', 'Space'));
    await store.trackDataset(ref('s', 'Space', 'neighbourhood://QmS'));
    expect(store.datasets()).toHaveLength(1);
    expect(store.joinedSpaceCids()).toEqual(['QmS']);
  });

  it('brings the system datasets up, and every settings write wakes its readers though the record is the same', async () => {
    const saved: unknown[] = [];
    let refuse = false;
    const settings = {
      datasetOrder: ['a'],
      async save() {
        if (refuse) throw new Error('offline');
        saved.push([...(this.datasetOrder as string[])]);
      },
    };
    // The settings model as a backend registers it, answering with the one record.
    registerEntity('AgentSettings', { findOne: async () => settings } as never);
    const b = backend([ref('root', 'we-root'), ref('me', 'we-personal'), ref('t', 'we-test'), ref('a')]);
    const store = mount(b);
    await store.initSystemDatasets();
    expect(store.rootDataset()?.id).toBe('root');
    expect(store.testDataset()?.id).toBe('t');
    expect(await store.whenPersonalDataset()).toMatchObject({ id: 'me' });
    expect(store.personalDataset()?.id).toBe('me');

    const orders: string[] = [];
    disposers.push(
      reactivity.root(() => reactivity.effect(() => void orders.push(String(store.agentSettings()?.datasetOrder)))),
    );
    await flush();
    const before = orders.length;
    expect(await store.updateAgentSettings({ datasetOrder: ['a', 'b'] })).toBe(true);
    expect(orders.slice(before)).toEqual(['a,b']);
    expect(saved).toEqual([['a', 'b']]);

    refuse = true;
    expect(await store.updateAgentSettings({ datasetOrder: ['b'] })).toBe(false);
    expect(store.agentSettings()?.datasetOrder).toEqual(['a', 'b']);
    expect(toasts).toEqual(['That setting could not be saved']);
  });
});
