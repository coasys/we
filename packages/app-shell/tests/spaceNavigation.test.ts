/**
 * The space store's navigation part: the space on screen followed live and held in the list, what a
 * setting still being saved shows, its collection and landmarks, the address a space is reached at,
 * and going to one and back.
 *
 * Run once under each reactivity port, against the in-memory backend.
 */
import { Space } from '@we/entities';
import type { Setter } from '@we/reactivity';
import { afterEach, describe, expect, it } from 'vitest';

import { createModuleStoreDeps, resetModuleHostServices } from '../src/shared/registries/moduleHostServices';
import { writeSpaceLandmark } from '../src/shared/spaceLandmarks';
import { createSpaceNavigation, type SpaceNavigation } from '../src/shared/stores/space/navigation';
import { createSpaceOnScreen, type SpaceOnScreen } from '../src/shared/stores/space/onScreen';
import { createSpaceList, type SpaceList } from '../src/shared/stores/space/spaces';
import { reactivityPorts } from './support/engines';
import { flush, type SpaceHarness, spaceHarness } from './support/spaceParts';

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    resetModuleHostServices();
  });

  interface Built {
    h: SpaceHarness;
    spaces: SpaceList;
    navigation: SpaceNavigation;
    onScreen: SpaceOnScreen;
    go: (path: string) => void;
    navigated: string[];
    pending: Record<string, unknown>;
  }

  async function build(): Promise<Built> {
    const h = await spaceHarness(makePort(), [
      { id: 'ds-a', name: 'Allotment' },
      { id: 'ds-b', name: 'Bakery' },
    ]);
    const { reactivity } = h;
    for (const id of ['ds-a', 'ds-b']) {
      await Space.create((await h.datasets.get(id)).handle, { uuid: id, name: `Space ${id}` });
    }
    const navigated: string[] = [];
    const pending: Record<string, unknown> = {};
    let setPath!: Setter<string>;
    let setQuery!: Setter<Record<string, string>>;
    let spaces!: SpaceList;
    let navigation!: SpaceNavigation;
    let onScreen!: SpaceOnScreen;
    disposers.push(
      reactivity.root(() => {
        const [path, writePath] = reactivity.signal('/');
        const [query, writeQuery] = reactivity.signal<Record<string, string>>({});
        setPath = writePath;
        setQuery = writeQuery;
        const segments = () => path().split('/').filter(Boolean);
        onScreen = createSpaceOnScreen(reactivity);
        spaces = createSpaceList({
          ...h.ctx,
          routeStore: { segments, navigate: () => {} },
          templateStore: { appTemplate: () => null, preloadSpaceTemplates: () => Promise.resolve() } as never,
          shapeStore: { addRecordTypes: () => Promise.resolve([]) } as never,
        });
        navigation = createSpaceNavigation({
          ...h.ctx,
          routeStore: {
            segments,
            currentPath: path,
            params: query,
            navigate: (to: string) => {
              navigated.push(to);
              const [where, search = ''] = to.split('?');
              writePath(where);
              writeQuery(Object.fromEntries(new URLSearchParams(search)));
            },
            setParam: () => {},
          },
          templateStore: { preloadSpaceTemplates: () => Promise.resolve(), currentTemplate: {} } as never,
          shellStore: { activeShellView: () => null, closeShellView: () => {}, provideSpaceGate: () => {} } as never,
          spaces,
          writes: { pendingSaves: () => pending as never },
          onScreen,
          modules: { usesSectionsFor: () => true, members: { routableViews: () => [], spaceViews: () => [] } },
        });
      }),
    );
    const go = (to: string) => {
      const [where, search = ''] = to.split('?');
      reactivity.batch(() => {
        setPath(where);
        setQuery(Object.fromEntries(new URLSearchParams(search)));
      });
    };
    return { h, spaces, navigation, onScreen, go, navigated, pending };
  }

  it('follows the record of the space on screen, and holds it in the list', async () => {
    const { h, spaces, navigation, onScreen } = await build();
    h.datasets.show('ds-a');
    await flush();
    const ds = await h.datasets.get('ds-a');
    expect(navigation.members.currentSpace()?.name).toBe('Space ds-a');
    expect(onScreen.pushedOnScreen(navigation.members.currentSpace()!)).toBe(true);

    const [record] = await Space.findAll(ds.handle, {});
    await Space.update(ds.handle, record.id, { name: 'Renamed by a peer' });
    await flush();
    expect(navigation.members.currentSpace()?.name).toBe('Renamed by a peer');
    expect(spaces.heldSpace(ds)).toBe(navigation.members.currentSpace());

    h.datasets.show(null);
    await flush();
    expect(navigation.members.currentSpace()).toBeNull();
  });

  it('shows a setting still being saved over the record the live read brings', async () => {
    const { h, navigation, onScreen, pending } = await build();
    pending.defaultTemplateId = 'workshop';
    h.datasets.show('ds-a');
    await flush();
    expect(navigation.members.currentSpace()?.defaultTemplateId).toBe('workshop');
    expect(onScreen.pushedOnScreen(navigation.members.currentSpace()!)).toBe(true);
  });

  it('reads the space’s landmarks on entering it, and says when they are in', async () => {
    const { h, navigation } = await build();
    const ds = await h.datasets.get('ds-b');
    const [record] = await Space.findAll(ds.handle, {});
    await writeSpaceLandmark(ds.handle, record.id, 'board', 'board-1');
    h.datasets.show('ds-b');
    expect(navigation.members.landmarksLoaded()).toBe(false);
    await flush();
    expect(navigation.members.landmarks()).toEqual({ board: 'board-1' });
    expect(navigation.members.landmarksLoaded()).toBe(true);
    expect(navigation.members.rootLoaded()).toBe(true);
  });

  it('names a space’s path, and says when the address names one the agent has not joined', async () => {
    const { go, navigation } = await build();
    expect(navigation.members.spacePath()).toBe('');
    go('/space/ds-a/about');
    expect(navigation.members.spacePath()).toBe('/space/ds-a');
    expect(navigation.members.routeSpaceUnjoined()).toBe(false);
    go('/space/shared-elsewhere');
    expect(navigation.members.routeSpaceUnjoined()).toBe(true);
  });

  it('switches to the dataset the address names', async () => {
    const { h, go } = await build();
    go('/space/ds-b');
    await flush();
    expect(h.datasets.switched).toEqual(['ds-b']);
    expect(h.ctx.datasetStore.currentDataset()?.id).toBe('ds-b');
  });

  it('goes back to where somebody was in a space, query and all', async () => {
    const { h, go, navigation, navigated } = await build();
    go('/space/ds-a/board?call=c1');
    await flush();
    expect(h.ctx.datasetStore.currentDataset()?.id).toBe('ds-a');

    await navigation.members.navigateToSpace('ds-b');
    await flush();
    expect(navigated.at(-1)).toBe('/space/ds-b');
    await navigation.members.navigateToSpace('ds-a');
    expect(navigated.at(-1)).toBe('/space/ds-a/board?call=c1');
    // The space already on screen: its root, which is how the sidebar takes you home.
    await navigation.members.navigateToSpace('ds-a');
    expect(navigated.at(-1)).toBe('/space/ds-a');
  });

  it('tells a module which dataset went, by the uri it holds for it', async () => {
    const { h } = await build();
    await h.ports.lifecycle.publish('ds-a');
    h.datasets.track(await h.datasets.get('ds-a'));
    const uri = h.ctx.datasetStore.datasets().find((d) => d.id === 'ds-a')?.sharedUri;
    expect(uri).toBeTruthy();
    const heard: string[] = [];
    const stop = createModuleStoreDeps(h.reactivity).datasets!.onRemoved!((removed) => void heard.push(removed));
    await h.ctx.datasetStore.removeDataset('ds-a');
    // A personal space has no uri, and no module anchors to one.
    await h.ctx.datasetStore.removeDataset('ds-b');
    expect(heard).toEqual([uri]);
    stop();
  });
});
