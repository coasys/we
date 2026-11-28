/**
 * The space store's modules-and-views part: which modules run here (registered, installed by this
 * agent, on in the space, not muted here), which sections the space has and this agent sees, the rail
 * of launchers, and the writes behind each switch.
 *
 * Run once under each reactivity port, against the in-memory backend.
 */
import { Space } from '@we/entities';
import type { ModuleDefinition } from '@we/module-shared';
import type { Setter } from '@we/reactivity';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createModuleStoreDeps } from '../src/shared/registries/moduleHostServices';
import { moduleRegistry } from '../src/shared/registries/moduleRegistry';
import { createSpaceModules, type SpaceModules } from '../src/shared/stores/space/modules';
import { createSpaceList, type SpaceList } from '../src/shared/stores/space/spaces';
import { createSpaceWrites } from '../src/shared/stores/space/writes';
import { reactivityPorts } from './support/engines';
import { flush, type SpaceHarness, spaceHarness } from './support/spaceParts';

const host = { backend: 'inmemory', framework: 'solid' };
const mod = (id: string, overrides: Partial<ModuleDefinition> = {}): ModuleDefinition => ({
  manifest: { id, name: id },
  contributes: { slots: [{ anchor: 'dock-right', node: { type: 'Column' } }] },
  ...overrides,
});

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  const registered: string[] = [];

  function register(definition: ModuleDefinition) {
    const result = moduleRegistry.register(
      definition,
      host as never,
      createModuleStoreDeps({ signal: makePort().signal, effect: () => {} }),
    );
    expect(result.problems ?? []).toEqual([]);
    registered.push(definition.manifest.id);
  }

  beforeEach(() => {
    register(mod('notes'));
    register(mod('polls', { createStore: () => ({ open: () => false }) }));
    register(mod('pocket', { manifest: { id: 'pocket', name: 'Pocket', scope: 'agent' } }));
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    for (const id of registered.splice(0)) moduleRegistry.unregister(id);
  });

  interface Built {
    h: SpaceHarness;
    spaces: SpaceList;
    modules: SpaceModules;
    setOnScreen: Setter<Space | null>;
  }

  async function build(): Promise<Built> {
    const h = await spaceHarness(makePort(), [
      { id: 'ds-a', name: 'Allotment' },
      { id: 'ds-root', name: 'we-root' },
    ]);
    await Space.create((await h.datasets.get('ds-a')).handle, {
      uuid: 'ds-a',
      name: 'The Allotment',
      enabledModules: ['notes', 'polls'],
    });
    h.datasets.setRoot('ds-root');
    const { reactivity } = h;
    let spaces!: SpaceList;
    let modules!: SpaceModules;
    let setOnScreen!: Setter<Space | null>;
    disposers.push(
      reactivity.root(() => {
        const [onScreen, writeOnScreen] = reactivity.signal<Space | null>(null);
        setOnScreen = writeOnScreen;
        spaces = createSpaceList({
          ...h.ctx,
          routeStore: { segments: () => [], navigate: () => {} },
          templateStore: { appTemplate: () => null, preloadSpaceTemplates: () => Promise.resolve() } as never,
          shapeStore: { addRecordTypes: () => Promise.resolve([]) } as never,
        });
        const writes = createSpaceWrites({
          ...h.ctx,
          spaces,
          onScreen: { currentSpace: onScreen, showOnScreen: () => {} },
        });
        modules = createSpaceModules({
          ...h.ctx,
          templateStore: {
            allTemplates: () => [],
            draftOf: () => undefined,
            defaultTemplateId: () => '',
            currentTemplate: { type: 'Column' },
          } as never,
          shellStore: {
            provideModuleGate: () => {},
            dockGeometry: () => ({}),
            revealDock: () => {},
            toggleModulePanel: () => {},
          } as never,
          spaces,
          onScreen: { currentSpace: onScreen },
          writes,
        });
      }),
    );
    await spaces.members.loadSpaces();
    h.datasets.show('ds-a');
    const ds = await h.datasets.get('ds-a');
    setOnScreen(spaces.heldSpace(ds)!);
    return { h, spaces, modules, setOnScreen };
  }

  /** What the space on screen's record now says, as the live read would bring it. */
  async function reread({ h, spaces, setOnScreen }: Built) {
    const ds = await h.datasets.get('ds-a');
    const [stored] = await Space.findAll(ds.handle, {});
    spaces.holdSpace(stored, ds);
    setOnScreen(stored);
  }

  it('installs everything registered until this agent decides, and pins the list when they do', async () => {
    const { h, modules } = await build();
    expect(modules.members.installedModules()).toEqual(['notes', 'polls', 'pocket']);
    await modules.members.setModuleInstalled('polls', false);
    expect(h.ctx.datasetStore.agentSettings()?.installedModules).toEqual(['notes', 'pocket']);
    expect(modules.members.installedModules()).toEqual(['notes', 'pocket']);
  });

  it('runs what is registered, installed, on in the space and not muted here — and agent modules anywhere', async () => {
    const built = await build();
    const { modules } = built;
    expect(modules.members.activeModules()).toEqual(['notes', 'polls', 'pocket']);

    await modules.members.setModuleEnabled('notes', false);
    await reread(built);
    expect(modules.members.enabledModules()).toEqual(['polls']);
    expect(modules.members.activeModules()).toEqual(['polls', 'pocket']);

    await modules.members.setModuleVisible('polls', false);
    await flush();
    expect(modules.members.activeModules()).toEqual(['pocket']);
    // The community's list is untouched by one agent hiding a module for themselves.
    expect(modules.members.enabledModules()).toEqual(['polls']);
  });

  it('lists the sections the community has, less those this agent hid — and gates routes on the first', async () => {
    const built = await build();
    const { modules } = built;
    const all = ['about', 'cards', 'graph', 'globe', 'boards', 'calendar'];
    expect(modules.members.enabledViewIds()).toEqual(all);

    await modules.members.setViewVisible('graph', false);
    await flush();
    expect(modules.members.spaceViews().map((view) => view.id)).toEqual(all.filter((id) => id !== 'graph'));
    expect(modules.members.viewNav().map((entry) => entry.path)).toContain('./cards');
    expect(modules.members.enabledViewIds()).toEqual(all);

    await modules.members.setViewEnabled('cards', false);
    await reread(built);
    expect(modules.members.enabledViewIds()).toEqual(all.filter((id) => id !== 'cards'));
  });

  it('hands the rail the same row while nothing about its button changes', async () => {
    const { modules, h } = await build();
    register(
      mod('timer', {
        manifest: { id: 'timer', name: 'Timer', scope: 'agent' },
        contributes: { launchers: [{ icon: 'clock', label: 'Timer', action: 'start' }] },
        createStore: () => ({ start: () => {} }),
      }),
    );
    const before = modules.members.moduleLaunchers();
    // The registry is not reactive, so the list is read again once something it follows changes.
    h.setAgentSettings({ installedModules: ['notes', 'polls', 'pocket', 'timer'] });
    const rows = modules.members.moduleLaunchers();
    const timer = rows.find((row) => row.id.startsWith('timer'));
    expect(timer).toMatchObject({ icon: 'clock', label: 'Timer', active: false });
    h.setAgentSettings({ installedModules: ['notes', 'polls', 'pocket', 'timer'], moduleSettings: '{}' } as never);
    expect(modules.members.moduleLaunchers().find((row) => row.id === timer!.id)).toBe(timer);
    expect(before).not.toBe(rows);
  });
});
