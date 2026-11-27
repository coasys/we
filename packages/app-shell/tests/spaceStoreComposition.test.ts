/**
 * The space store composed whole, as `BootController` builds it, under each reactivity port: no part
 * reads a later one while the store is being built, the spaces list is answered by the parts that own
 * its columns, the template and theme stores are lent the spaces, and disposing the root takes back
 * what it lent.
 */
import { Space } from '@we/entities';
import type { Setter } from '@we/reactivity';
import { afterEach, describe, expect, it } from 'vitest';

import type { SpaceAppearance } from '../src/shared/spaceAppearance';
import { createSpaceStore, type SpaceStore } from '../src/shared/stores/SpaceStore';
import { createTaskWorkflowLive } from '../src/shared/taskWorkflowLive';
import { reactivityPorts } from './support/engines';
import { flush, type SpaceHarness, spaceHarness } from './support/spaceParts';

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  interface Built {
    h: SpaceHarness;
    store: SpaceStore;
    lent: { appearance: SpaceAppearance[]; vocabularies: number; homes: number; saver: number };
    go: Setter<string>;
    dispose: () => void;
  }

  async function build(): Promise<Built> {
    const h = await spaceHarness(makePort(), [
      { id: 'ds-a', name: 'Allotment' },
      { id: 'ds-root', name: 'we-root' },
    ]);
    await Space.create((await h.datasets.get('ds-a')).handle, { uuid: 'ds-a', name: 'The Allotment' });
    h.datasets.setRoot('ds-root');
    const { reactivity, ctx } = h;
    const lent = { appearance: [] as SpaceAppearance[], vocabularies: 0, homes: 0, saver: 0 };
    let store!: SpaceStore;
    let go!: Setter<string>;
    const dispose = reactivity.root(() => {
      const [path, setPath] = reactivity.signal('/');
      go = setPath;
      const segments = () => path().split('/').filter(Boolean);
      store = createSpaceStore({
        reactivity,
        platform: h.platform,
        toasts: ctx.toasts,
        firstScreen: ctx.firstScreen,
        sessionStore: ctx.sessionStore,
        datasetStore: ctx.datasetStore,
        appStore: { provideInstalledModules: () => {} },
        profileStore: { profiles: () => [], fetchProfile: () => Promise.resolve(undefined) } as never,
        recordStore: {
          provideVocabularies: () => {
            lent.vocabularies += 1;
            return () => (lent.vocabularies -= 1);
          },
          provideContentHomes: () => {
            lent.homes += 1;
            return () => (lent.homes -= 1);
          },
        },
        routeStore: {
          segments,
          currentPath: path,
          params: () => ({}),
          navigate: (to: string) => setPath(to.split('?')[0]),
          setParam: () => {},
        },
        shapeStore: {
          addRecordTypes: () => Promise.resolve([]),
          interpretationCandidates: () => [],
          interpretationCandidatesLoaded: () => true,
          interpretationCandidatesFor: () => Promise.resolve({ candidates: [], installed: [] }),
          provideInterpretationEnroller: () => () => {},
        } as never,
        shellStore: {
          activeShellView: () => null,
          closeShellView: () => {},
          provideSpaceGate: () => {},
          provideModuleGate: () => {},
          dockGeometry: () => ({}),
          revealDock: () => {},
          toggleModulePanel: () => {},
          provideTemplateSaver: () => void (lent.saver += 1),
        } as never,
        templateStore: {
          appTemplate: () => null,
          preloadSpaceTemplates: () => Promise.resolve(),
          currentTemplate: { type: 'Column' },
          allTemplates: () => [],
          draftOf: () => undefined,
          defaultTemplateId: () => '',
          provideSpaceAppearance: (appearance: SpaceAppearance) => void lent.appearance.push(appearance),
          saveTemplateAs: () => Promise.resolve(undefined),
        } as never,
        themeStore: {
          explainSpaceThemeHidden: () => {},
          provideSpaceAppearance: (appearance: SpaceAppearance) => void lent.appearance.push(appearance),
        },
        host: {
          signalOrder: { reset: () => {} },
          taskWorkflowLive: createTaskWorkflowLive(reactivity.signal),
        },
      });
    });
    disposers.push(dispose);
    return { h, store, lent, go, dispose };
  }

  it('builds whole, with every part’s members on the one store', async () => {
    const { store, lent } = await build();
    for (const member of [
      'mySpaces',
      'currentSpace',
      'viewNav',
      'autoInterpret',
      'roles',
      'taskStates',
      'involvementTypes',
      'unreadNodeIds',
      'createPost',
      'moveCardToColumn',
      'members',
      'spaceList',
      'exportCallTranscript',
    ] as const) {
      expect(store[member], member).toBeTypeOf('function');
    }
    expect(lent).toMatchObject({ vocabularies: 1, homes: 1, saver: 1 });
    // The template store and the theme store are each lent the same spaces.
    expect(lent.appearance).toHaveLength(2);
    expect(lent.appearance[0]).toBe(lent.appearance[1]);
  });

  it('answers the spaces list from the parts that own its columns', async () => {
    const { store, lent } = await build();
    await store.loadSpaces();
    await flush();
    const row = store.spaceList().find((entry) => entry.id === 'ds-a');
    expect(row).toMatchObject({ name: 'The Allotment', canAdminister: true });
    expect(lent.appearance[0].spaces().map((space) => space.uuid)).toEqual(['ds-a']);
  });

  it('goes to a space and reads its jobs there', async () => {
    const { h, store, go } = await build();
    await store.loadSpaces();
    h.datasets.show('ds-a');
    go('/space/ds-a');
    await flush();
    expect(store.currentSpace()?.uuid).toBe('ds-a');
    expect(store.rolesLoaded()).toBe(true);
    expect(store.taskStatesLoaded()).toBe(true);
    expect(store.involvementTypesLoaded()).toBe(true);
    expect(store.policy().loaded).toBe(true);
  });

  it('takes back what it lent when its root is disposed', async () => {
    const { lent, dispose } = await build();
    dispose();
    expect(lent).toMatchObject({ vocabularies: 0, homes: 0 });
  });
});
