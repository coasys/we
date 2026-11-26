/**
 * The REAL template store across a switch of space: its other stores are the smallest doubles that
 * let it mount, and the records it reads are served by the test, so what is under test is the store's
 * own sequencing — which space a late read may still put its answer in front of.
 *
 * Run once under each reactivity port, each with its renderer's live documents.
 */
import { plainLiveTemplates } from '@shared/liveTemplate';
import { encodeTemplateFile, registerEntity } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { solidLiveTemplates } from '../src/frameworks/solid/stores/liveTemplate';
import { createTestPlatform } from '../src/shared/platform/testPlatform';
import { provideSeed } from '../src/shared/seedRegistry';
import { createTemplateStore, type TemplateStore } from '../src/shared/stores/TemplateStore';
import { liveRows } from './liveRows';
import { appearanceOf } from './support/spaceAppearance';

const hosts: [string, () => { reactivity: ReactivityPort; liveTemplates: ReturnType<typeof plainLiveTemplates> }][] = [
  ['Solid', () => ({ reactivity: solidReactivity, liveTemplates: solidLiveTemplates })],
  [
    'the test port',
    () => {
      const reactivity = createTestReactivity();
      return { reactivity, liveTemplates: plainLiveTemplates(reactivity) };
    },
  ],
];

const root = { id: 'root', name: 'root', handle: { dataset: 'root' } };
const toasts = { info: () => {}, success: () => {}, warning: () => {}, error: () => {} };
const sessionStub = { me: () => undefined, devTools: () => false };
const themeStub = { allThemes: () => [], provideTemplates: () => {}, setDefaultTheme: () => {} };
const routeStub = { navigate: () => {}, segments: () => [] };

type Held<T> = { promise: Promise<T>; release: (value: T) => void };
const held = <T>(): Held<T> => {
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

describe.each(hosts)('the template store across a switch of space, under %s', (_name, host) => {
  let store: TemplateStore;
  let setCurrent: (dataset: unknown) => void;
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
      query: () => liveRows([]),
    } as never);
    registerEntity('SpaceTemplatePreference', { findAll: async () => [] } as never);
    registerEntity('SpacePreference', {
      findAll: (_handle: unknown, query: { where: { spaceUuid: string } }) => {
        const read = held<unknown[]>();
        mine.push({ space: query.where.spaceUuid, read });
        return read.promise;
      },
    } as never);
    const { reactivity, liveTemplates } = host();
    // No space is on screen until the test puts one there.
    const [current, writeCurrent] = reactivity.signal<unknown>(undefined);
    setCurrent = writeCurrent;
    const datasetStub = {
      currentDataset: current,
      rootDataset: () => root,
      datasets: () => [],
      agentSettings: () => undefined,
      marketplaceDataset: () => undefined,
      refreshAgentSettings: async () => {},
      updateAgentSettings: async () => true,
    };
    const [named, setNamedSignal] = reactivity.signal<string | undefined>(undefined);
    setNamed = setNamedSignal;
    dispose = reactivity.root(() => {
      store = createTemplateStore({
        reactivity,
        platform: createTestPlatform(),
        toasts,
        liveTemplates,
        sessionStore: sessionStub as never,
        datasetStore: datasetStub as never,
        themeStore: themeStub as never,
        routeStore: routeStub as never,
      });
      store.provideSpaceAppearance(appearanceOf(reactivity, () => [{ uuid: 'A', defaultTemplateId: named() }]));
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
    setCurrent(dataset('A'));
    await vi.waitFor(() => expect(reads.filter((r) => r.space === 'A')).toHaveLength(1));
    const before = store.currentTemplate.id;
    setCurrent(dataset('B'));
    await vi.waitFor(() => expect(reads.filter((r) => r.space === 'B')).toHaveLength(1));

    // A's own override names a template that exists; B is the space on screen now.
    reads.find((r) => r.space === 'A')!.read.release([{ templateId: builtInOne }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.currentTemplate.id).toBe(before);
    expect(store.currentTemplate.id).not.toBe(builtInOne);
  });

  it('does not repaint over a newer choice for the same space with an older one that answers late', async () => {
    const [builtInOne, builtInTwo] = shellTemplateIds();
    setCurrent(dataset('A'));
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
