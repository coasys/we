/**
 * The REAL template store across a switch of space: its other stores are the smallest doubles that
 * let it mount, and the records it reads are served by the test, so what is under test is the store's
 * own sequencing — which space a late read may still put its answer in front of.
 */
import { encodeTemplateFile, registerEntity } from '@we/entities';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { provideSeed } from '../src/shared/seedRegistry';

const h = vi.hoisted(() => ({
  setCurrent: (() => {}) as (ds: unknown) => void,
  setSpaces: (() => {}) as (spaces: { uuid: string; defaultTemplateId?: string }[]) => void,
}));

vi.mock('../src/frameworks/solid/stores/DatasetStore', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/frameworks/solid/stores/DatasetStore')>();
  const { createSignal } = await import('solid-js');
  const [current, setCurrent] = createSignal<unknown>(undefined);
  h.setCurrent = setCurrent;
  const root = { id: 'root', name: 'root', handle: { dataset: 'root' } };
  return {
    ...original,
    useDatasetStore: () => ({
      currentDataset: current,
      rootDataset: () => root,
      datasets: () => [],
      agentSettings: () => undefined,
      marketplaceDataset: () => undefined,
      refreshAgentSettings: async () => {},
      updateAgentSettings: async () => {},
    }),
  };
});
vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({ me: () => undefined, devTools: () => false }),
}));
vi.mock('../src/frameworks/solid/stores/ThemeStore', () => ({
  useThemeStore: () => ({ allThemes: () => [], provideAppTheme: () => {}, setDefaultTheme: () => {} }),
}));
vi.mock('../src/frameworks/solid/stores/RouteStore', () => ({
  useRouteStore: () => ({ navigate: () => {}, segments: () => [] }),
}));

import { TemplateStoreProvider, useTemplateStore } from '../src/frameworks/solid/stores/TemplateStore';

type Held<T> = { promise: Promise<T>; release: (value: T) => void };
const held = <T,>(): Held<T> => {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (release = resolve));
  return { promise, release };
};

const dataset = (id: string) => ({ id, name: id, handle: { dataset: id }, sharedId: null });
const record = (id: string, name: string) => ({
  id: `rec-${id}-${name}`,
  name,
  schema: encodeTemplateFile({
    id,
    type: 'Column',
    meta: { name, description: '', icon: 'browser' },
    children: [],
  }),
});

provideSeed({ name: 'test', modules: [] } as never);

describe('the template store across a switch of space', () => {
  let store: ReturnType<typeof useTemplateStore>;
  let dispose: () => void;
  let setNamed: (id: string | undefined) => void;
  let reads: { space: string; read: Held<unknown[]> }[] = [];
  const spacePreferenceReads: Held<unknown[]>[] = [];
  const templateReads = new Map<string, Held<unknown[]>>();

  beforeEach(() => {
    // A fresh list each time: what a previous store's unfinished work reads later lands in its own.
    const mine: typeof reads = (reads = []);
    spacePreferenceReads.length = 0;
    templateReads.clear();
    // The three record types this store reads, served from what the test holds and releases.
    registerEntity('Template', {
      findAll: async (handle: { dataset: string }) => templateReads.get(handle.dataset)?.promise ?? [],
      // The watch the store keeps on a space's templates: nothing changes here.
      query: () => ({ subscribe: () => Promise.resolve([]), dispose: () => {} }),
    } as never);
    registerEntity('SpaceTemplatePreference', { findAll: async () => [] } as never);
    registerEntity('SpacePreference', {
      findAll: (_handle: unknown, query: { where: { spaceUuid: string } }) => {
        const read = held<unknown[]>();
        mine.push({ space: query.where.spaceUuid, read });
        return read.promise;
      },
    } as never);
    // The doubled dataset store outlives a test: no space is on screen until the test puts one there.
    h.setCurrent(undefined);
    createRoot((d) => {
      dispose = d;
      const [named, setNamedSignal] = createSignal<string | undefined>(undefined);
      setNamed = setNamedSignal;
      TemplateStoreProvider({
        get children() {
          store = useTemplateStore();
          store.provideSpaceLookup(() => [{ uuid: 'A', defaultTemplateId: named() } as never]);
          return null;
        },
      });
    });
  });

  /** Two templates the store lists that no space brought, to name as a space's choice. */
  const shellTemplateIds = () =>
    store
      .allTemplates()
      .filter((t) => !t._fromSpace)
      .map((t) => t.id as string);

  afterEach(() => {
    reads.forEach(({ read }) => read.release([]));
    templateReads.forEach((read) => read.release([]));
    dispose();
  });

  it('does not put a slow load for one space in front of the space switched to', async () => {
    const a = dataset('A');
    const b = dataset('B');
    const slowA = held<unknown[]>();
    templateReads.set('A', slowA);
    templateReads.set('B', { promise: Promise.resolve([record('both', 'from B')]), release: () => {} });

    const loadingA = store.loadSpaceTemplates(a as never);
    await store.loadSpaceTemplates(b as never);
    slowA.release([record('both', 'from A')]);
    await loadingA;

    expect(
      store
        .allTemplates()
        .filter((t) => t._fromSpace)
        .map((t) => t.meta.name),
    ).toEqual(['from B']);
    // Not lost: the space that was left still has what it read, for the next visit.
    await store.preloadSpaceTemplates(a as never);
    expect(
      store
        .allTemplates()
        .filter((t) => t._fromSpace)
        .map((t) => t.meta.name),
    ).toEqual(['from A']);
  });

  it('does not repaint the space switched to with a choice for the one left, still being read', async () => {
    const [builtInOne] = shellTemplateIds();
    h.setCurrent(dataset('A'));
    await vi.waitFor(() => expect(reads.filter((r) => r.space === 'A')).toHaveLength(1));
    const before = store.currentTemplate.id;
    h.setCurrent(dataset('B'));
    await vi.waitFor(() => expect(reads.filter((r) => r.space === 'B')).toHaveLength(1));

    // A's own override names a template that exists; B is the space on screen now.
    reads.find((r) => r.space === 'A')!.read.release([{ templateId: builtInOne }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.currentTemplate.id).toBe(before);
    expect(store.currentTemplate.id).not.toBe(builtInOne);
  });

  it('does not repaint over a newer choice for the same space with an older one that answers late', async () => {
    const [builtInOne, builtInTwo] = shellTemplateIds();
    h.setCurrent(dataset('A'));
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    // The arrival's own choice settles with nothing to say, so later changes to the default follow.
    reads[0].read.release([]);
    await vi.waitFor(() => expect(store.currentTemplate).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 20));

    setNamed(builtInOne);
    await vi.waitFor(() => expect(reads).toHaveLength(2));
    // Let the first change be followed before the second arrives.
    await new Promise((resolve) => setTimeout(resolve, 100));
    setNamed(builtInTwo);
    await vi.waitFor(() => expect(reads).toHaveLength(3));

    // The newer choice answers first, the older one after it.
    reads[2].read.release([{ templateId: builtInTwo }]);
    await vi.waitFor(() => expect(store.currentTemplate.id).toBe(builtInTwo));
    reads[1].read.release([{ templateId: builtInOne }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.currentTemplate.id).toBe(builtInTwo);
  });
});
