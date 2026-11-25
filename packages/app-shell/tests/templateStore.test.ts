/**
 * The template store over a real in-memory backend: the agent's library, a space and the marketplace
 * are datasets of their own, the agent's settings a stand-in that records what is written.
 *
 * Plain store tests, run once under each reactivity port, each with its renderer's live documents —
 * Solid's nested store, and the plain documents any port can run.
 */
import { plainLiveTemplates } from '@shared/liveTemplate';
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { AGENT_DEFAULT, asFileField, encodeTemplateFile, FOLLOW_SPACE, Template } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import type { TemplateSchema } from '@we/schema-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { solidLiveTemplates } from '../src/frameworks/solid/liveTemplate';
import { provideSeed } from '../src/shared/seedRegistry';
import { createTemplateStore, type TemplateStore } from '../src/shared/stores/TemplateStore';
import { appearanceOf } from './support/spaceAppearance';

provideSeed({ name: 'test', modules: [] } as never);

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

const ME = 'did:test:me';
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

const shell = (id: string, name: string, text = 'Hello'): TemplateSchema =>
  ({
    schemaVersion: 1,
    id,
    type: 'Column',
    meta: { name, description: '', icon: 'browser' },
    children: [{ id: `${id.padEnd(8, 'x')}01`.slice(0, 10), type: 'we-text', children: [text] }],
  }) as TemplateSchema;

const textOf = (t: TemplateSchema) => (t.children![0] as { children: string[] }).children[0];

describe.each(hosts)('the template store under %s', (_name, host) => {
  let reactivity: ReactivityPort;
  let liveTemplates: ReturnType<typeof plainLiveTemplates>;
  let handles: Record<'root' | 'space' | 'market', unknown>;
  let told: string[];
  let settingsWrites: Record<string, unknown>[];
  let navigated: string[];
  let hidden: string[];
  const disposers: (() => void)[] = [];

  async function mount(options: { space?: boolean } = {}) {
    const record = (fields: Record<string, unknown>) => ({
      ...fields,
      hiddenTemplates: [...hidden],
      async addHiddenTemplates(model: { id: string }) {
        hidden.push(model.id);
      },
      async removeHiddenTemplates(model: { id: string }) {
        if (hidden.includes(model.id)) hidden.splice(hidden.indexOf(model.id), 1);
      },
    });
    const [settings, setSettings] = reactivity.signal<Record<string, unknown> | null>(record({}));
    const space = { id: 'space', name: 'Space', handle: handles.space, sharedId: null };
    const [current, setCurrent] = reactivity.signal<unknown>(options.space ? space : null);
    let store!: TemplateStore;
    disposers.push(
      reactivity.root(() => {
        store = createTemplateStore({
          reactivity,
          liveTemplates,
          toasts: {
            info: (m) => told.push(m),
            success: (m) => told.push(m),
            warning: (m) => told.push(`warning: ${m}`),
            error: (m) => told.push(`error: ${m}`),
          },
          sessionStore: { me: () => ({ did: ME }) as never, devTools: () => false },
          datasetStore: {
            agentSettings: settings as never,
            rootDataset: () => ({ id: 'root', name: 'root', handle: handles.root }) as never,
            currentDataset: current as never,
            marketplaceDataset: () => ({ id: 'market', name: 'market', handle: handles.market }) as never,
            datasets: () => [space] as never,
            refreshAgentSettings: async () => {},
            async updateAgentSettings(updates) {
              settingsWrites.push(updates as Record<string, unknown>);
              setSettings(record({ ...(reactivity.untrack(settings) ?? {}), ...updates }));
              return true;
            },
          },
          routeStore: { navigate: (to: string) => void navigated.push(to), segments: () => [] },
          themeStore: { allThemes: () => [], provideTemplates: () => {}, setDefaultTheme: async () => true },
        });
        store.provideSpaceAppearance(appearanceOf(reactivity, () => [{ uuid: 'space' }]));
      }),
    );
    await flush();
    return { store, setCurrent };
  }

  const stored = (dataset: unknown, schema: TemplateSchema | Record<string, unknown>, extra = {}) =>
    Template.create(dataset, {
      name: (schema as TemplateSchema).meta?.name ?? 'Broken',
      slug: (schema as TemplateSchema).id,
      origin: 'custom',
      version: 1,
      schema: asFileField(encodeTemplateFile(schema as TemplateSchema)),
      ...extra,
    } as never);

  beforeEach(async () => {
    ({ reactivity, liveTemplates } = host());
    told = [];
    settingsWrites = [];
    navigated = [];
    hidden = [];
    sessionStorage.clear();
    const ports = createInMemoryBackendPorts(
      { selfId: () => ME },
      {
        agent: { id: ME, unlocked: true },
        datasets: [
          { id: 'root', name: 'root' },
          { id: 'space', name: 'Space' },
          { id: 'market', name: 'market' },
        ],
      },
    );
    handles = {
      root: (await ports.lifecycle.get('root'))!.handle,
      space: (await ports.lifecycle.get('space'))!.handle,
      market: (await ports.lifecycle.get('market'))!.handle,
    };
  });

  afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
  });

  it('lists the library, and keeps a template that no longer validates where it can be deleted', async () => {
    await stored(handles.root, shell('mine', 'Mine'));
    // A format newer than this host reads.
    const broken = await stored(handles.root, { ...shell('broken', 'Broken'), schemaVersion: 99 });
    const { store } = await mount();
    expect(store.myTemplates().map((t) => t.id)).toEqual(['mine']);
    expect(store.isInstalled('mine')).toBe(true);
    expect(store.refusedTemplates().map((t) => t.id)).toEqual([broken.id]);

    await store.deleteRefusedTemplate(broken.id);
    expect(store.refusedTemplates()).toEqual([]);
    expect(await Template.findAll(handles.root)).toHaveLength(1);
  });

  it('hides a library template from the lists and shows it again', async () => {
    await stored(handles.root, shell('mine', 'Mine'));
    const { store } = await mount();
    await store.toggleInstalled('mine');
    expect(store.isInstalled('mine')).toBe(false);
    expect(store.myTemplates()).toEqual([]);
    await store.toggleInstalled('mine');
    expect(store.isInstalled('mine')).toBe(true);
  });

  it('diffs an edit into the template on screen, and refuses one that does not validate', async () => {
    await stored(handles.root, shell('mine', 'Mine'));
    const { store } = await mount();
    store.switchTemplate('mine');
    expect(store.currentTemplate.id).toBe('mine');
    const seen: string[] = [];
    disposers.push(reactivity.root(() => reactivity.effect(() => void seen.push(textOf(store.currentTemplate)))));

    store.updateTemplate(shell('mine', 'Mine', 'Edited'));
    expect(textOf(store.currentTemplate)).toBe('Edited');
    store.updateTemplate({ ...shell('mine', 'Mine', 'Never'), schemaVersion: 99 } as never);
    expect(textOf(store.currentTemplate)).toBe('Edited');
    expect(seen).toEqual(['Hello', 'Edited']);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatch(/^error: Schema validation failed/);
  });

  it('switches template, remembering the choice', async () => {
    await stored(handles.root, shell('mine', 'Mine'));
    const { store } = await mount();
    store.switchTemplate('mine');
    expect(store.currentTemplate.id).toBe('mine');
    expect(store.currentSwitcherId()).toBe('mine');
    expect(settingsWrites).toContainEqual({ currentTemplateId: 'mine' });
    expect(navigated).toEqual(['/']);
  });

  it('saves a fork beside the built-in it came from, under a name of its own', async () => {
    const { store } = await mount();
    const builtIn = store.builtInTemplates()[0];
    expect(await store.saveTemplateAs(builtIn)).toBe(true);
    const fork = store.myTemplates()[0];
    expect(fork.id).not.toBe(builtIn.id);
    expect(fork.meta.name).toBe(`${builtIn.meta.name} (yours)`);
    expect(store.currentTemplate.id).toBe(fork.id);
  });

  it('opens a working copy of a section, edits it, and drops it', async () => {
    const { store } = await mount();
    const section = shell('about', 'About');
    const draft = store.openDraft(section);
    store.updateDraft(draft, shell('about', 'About', 'Draft'));
    expect(textOf(store.draftOf(section)!)).toBe('Draft');
    store.closeDraft(draft);
    expect(store.draftOf(section)).toBeUndefined();
  });

  it('shows what a marketplace template will be able to do before installing it', async () => {
    const listing = await stored(handles.market, shell('shared', 'Shared'));
    const { store } = await mount();
    await store.installFromMarketplace(listing.id);
    expect(store.pendingInstall()).toMatchObject({
      marketplaceId: listing.id,
      destination: 'personal',
      name: 'Shared',
    });
    expect(store.myTemplates()).toEqual([]);

    await store.confirmInstall();
    expect(store.pendingInstall()).toBeNull();
    expect(store.myTemplates().map((t) => t.meta.name)).toEqual(['Shared']);
    expect(told).toEqual(['"Shared" installed']);
  });

  it('installs a marketplace template into the space on screen for every member', async () => {
    const listing = await stored(handles.market, shell('shared', 'Shared'));
    const { store } = await mount({ space: true });
    await store.installToSpace(listing.id);
    await store.confirmInstall();
    expect(store.spaceTemplates().map((t) => t.meta.name)).toEqual(['Shared']);
    expect(told).toContain('"Shared" installed to space');
  });

  it('shares the template on screen into a space once', async () => {
    await stored(handles.root, shell('mine', 'Mine'));
    const { store } = await mount();
    store.switchTemplate('mine');
    expect(await store.publishToSpace('space', 'Space')).toBe(true);
    expect(await store.publishToSpace('space', 'Space')).toBe(false);
    expect((await Template.findAll(handles.space)).map((t) => t.slug)).toEqual(['mine']);
    expect(told).toEqual(['Template "Mine" shared to space "Space"', 'error: Template "Mine" is already in "Space"']);
  });

  it('publishes the template on screen to the marketplace, and updates its own listing', async () => {
    await stored(handles.root, shell('mine', 'Mine'));
    const { store } = await mount();
    store.switchTemplate('mine');
    const options = { name: 'Mine', description: 'Mine to share', screenshots: [] };
    expect(await store.publishToMarketplace(options)).toBe(true);
    expect(await store.publishToMarketplace(options)).toBe(true);
    const listings = await Template.findAll(handles.market);
    expect(listings.map((t) => [t.slug, t.version])).toEqual([['mine', 2]]);
  });

  it('paints the template an agent overrides a space with, and offers the way back', async () => {
    await stored(handles.root, shell('mine', 'Mine'));
    const { store } = await mount({ space: true });
    await store.setSpaceTemplateOverride('mine');
    expect(store.currentTemplate.id).toBe('mine');
    const [follow, own] = store.templateOverrideOptions();
    expect([follow.value, own.value]).toEqual([FOLLOW_SPACE, AGENT_DEFAULT]);
    expect(store.templateOverrideOptions().some((option) => option.value === 'mine')).toBe(true);
  });
});
