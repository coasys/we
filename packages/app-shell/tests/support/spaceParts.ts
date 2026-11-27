/**
 * What the space store's parts are built from in their tests: the in-memory backend, a session signed
 * in to it, and a stand-in for the dataset store holding the datasets the test seeds — all over the
 * reactivity port under test, so nothing in a part's graph is Solid's when the test port is the one.
 */
import { createInMemoryBackendPorts, type InMemoryDatasetSeed } from '@we/backend-inmemory';
import type { DatasetRef } from '@we/backend-shared';
import type { AgentSettings } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';

import { createTestPlatform, type TestPlatform } from '../../src/shared/platform/testPlatform';
import { provideSeed } from '../../src/shared/seedRegistry';
import type { AppDataset } from '../../src/shared/stores/DatasetStore';
import type { BootState } from '../../src/shared/stores/SessionStore';
import { createSpaceContext, type SpaceContext, type SpaceDatasets } from '../../src/shared/stores/space/context';
import type { ToastButton } from '../../src/shared/toasts';

// The deployment the parts read their defaults from: none beyond what the code has.
provideSeed({ name: 'test', modules: [] } as never);

export const ME = 'did:key:z6MkSpaceParts';

/** Long enough for the in-memory backend's promise chains — reads, a follow's first page — to land. */
export const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

export interface SpaceHarness {
  reactivity: ReactivityPort;
  /** The window the parts run in. */
  platform: TestPlatform;
  ctx: SpaceContext;
  ports: ReturnType<typeof createInMemoryBackendPorts>;
  /** Every toast said, in order, as `tone: message`, with the button when one was offered. */
  toasts: { said: string[]; actions: ToastButton[] };
  datasets: {
    /** Put a dataset the backend holds into the list, as a change event would. */
    track: (ref: DatasetRef) => void;
    /** Make one the dataset on screen, by id. */
    show: (id: string | null) => void;
    /** The dataset the backend holds by id, as the store would hold it. */
    get: (id: string) => Promise<AppDataset>;
    switched: string[];
    setRoot: (id: string | null) => void;
  };
  setBootState: (state: BootState) => void;
  setAgentSettings: (settings: Partial<AgentSettings> | null) => void;
}

/**
 * A signed-in session over a fresh in-memory backend holding `seeds`, every seeded dataset in the list.
 * Build each part inside `reactivity.root`, as a composition root builds the store.
 */
export async function spaceHarness(reactivity: ReactivityPort, seeds: InMemoryDatasetSeed[]): Promise<SpaceHarness> {
  const ports = createInMemoryBackendPorts(
    { selfId: () => ME },
    { agent: { id: ME, unlocked: true }, datasets: seeds },
  );
  const refs = await ports.lifecycle.list();

  const [list, setList] = reactivity.signal<AppDataset[]>(refs as AppDataset[]);
  const [current, setCurrent] = reactivity.signal<AppDataset | null>(null);
  const [root, setRootDataset] = reactivity.signal<AppDataset | null>(null);
  const [bootState, setBootState] = reactivity.signal<BootState>('ready');
  const [settings, setSettings] = reactivity.signal<AgentSettings | null>(null);
  const removed = new Set<(id: string) => void>();
  const switched: string[] = [];

  const datasetStore: SpaceDatasets = {
    currentDataset: current,
    datasets: list,
    orderedDatasets: () => list().filter((d) => !d.name.startsWith('we-')),
    datasetsLoaded: () => true,
    isWeSpace: () => current() !== null,
    currentDatasetEntities: () => [],
    rootDataset: root,
    personalDataset: () => null,
    testDataset: () => null,
    globalDataset: () => null,
    globalSpaceId: () => null,
    marketplaceId: () => null,
    systemDatasetUuids: () =>
      list()
        .filter((d) => d.name.startsWith('we-'))
        .map((d) => d.id),
    agentSettings: settings,
    updateAgentSettings: (fields: Partial<AgentSettings>) => {
      setSettings({ ...(reactivity.untrack(settings) ?? {}), ...fields } as AgentSettings);
      return Promise.resolve();
    },
    switchDataset: (id: string) => {
      switched.push(id);
      setCurrent(reactivity.untrack(list).find((d) => d.id === id) ?? null);
      return Promise.resolve();
    },
    trackDataset: (ref: DatasetRef) => {
      track(ref);
      return Promise.resolve();
    },
    removeDataset: async (id: string) => {
      await ports.lifecycle.remove(id);
      setList(reactivity.untrack(list).filter((d) => d.id !== id));
      for (const listener of [...removed]) listener(id);
    },
    clearCurrentDataset: () => setCurrent(null),
    onDatasetRemoved: (listener: (id: string) => void) => {
      removed.add(listener);
      return () => void removed.delete(listener);
    },
  } as unknown as SpaceDatasets;

  function track(ref: DatasetRef) {
    const held = reactivity.untrack(list);
    const next = held.some((d) => d.id === ref.id)
      ? held.map((d) => (d.id === ref.id ? (ref as AppDataset) : d))
      : [...held, ref as AppDataset];
    setList(next);
  }

  const toasts = { said: [] as string[], actions: [] as ToastButton[] };
  const say = (tone: string) => (message: string, _duration?: number, action?: ToastButton) => {
    toasts.said.push(`${tone}: ${message}`);
    if (action) toasts.actions.push(action);
    return toasts.said.length;
  };

  const platform = createTestPlatform();
  const ctx = createSpaceContext({
    reactivity,
    platform,
    toasts: { info: say('info'), success: say('success'), warning: say('warning'), error: say('error') },
    firstScreen: { open: () => true, whenOpen: () => Promise.resolve() },
    sessionStore: {
      me: () => ({ did: ME }),
      lifecycle: () => ports.lifecycle,
      backendPorts: () => ports,
      bootState,
      serverUrl: () => undefined,
    } as unknown as SpaceContext['sessionStore'],
    datasetStore,
  });

  return {
    reactivity,
    platform,
    ctx,
    ports,
    toasts,
    datasets: {
      track,
      show: (id) => setCurrent(id ? (reactivity.untrack(list).find((d) => d.id === id) ?? null) : null),
      get: async (id) => (await ports.lifecycle.get(id)) as AppDataset,
      switched,
      setRoot: (id) => setRootDataset(id ? (reactivity.untrack(list).find((d) => d.id === id) ?? null) : null),
    },
    setBootState,
    setAgentSettings: (fields) => setSettings(fields as AgentSettings | null),
  };
}
