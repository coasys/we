/**
 * The theme store over a real in-memory backend: the library, a space's themes and the marketplace
 * are datasets of their own, and the agent's settings are a stand-in that records what is written.
 *
 * Plain store tests, run once under each reactivity port. The document is jsdom's, so what a theme
 * does to the page — its variables, its stylesheet — can be read back.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { Theme } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { provideSeed } from '../src/shared/seedRegistry';
import { createThemeStore, type ThemeStore } from '../src/shared/stores/ThemeStore';

provideSeed({ name: 'test', modules: [] } as never);

const reactivityPorts: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', createTestReactivity],
];

const ME = 'did:test:me';
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

const dataUri = (text: string, type: string) => `data:${type};base64,${btoa(text)}`;

describe.each(reactivityPorts)('the theme store under %s', (_name, makePort) => {
  let reactivity: ReactivityPort;
  let handles: Record<'root' | 'space' | 'market', unknown>;
  let told: string[];
  let settingsWrites: Record<string, unknown>[];
  let installedRefs: string[];
  const disposers: (() => void)[] = [];

  async function mount(options: { space?: boolean } = {}) {
    const [settings, setSettings] = reactivity.signal<Record<string, unknown> | null>(null);
    const [current, setCurrent] = reactivity.signal<unknown>(
      options.space ? { id: 'space', name: 'Space', handle: handles.space } : null,
    );
    const record = (fields: Record<string, unknown>) => ({
      ...fields,
      installedThemes: installedRefs,
      async addInstalledThemes(model: { id: string }) {
        installedRefs.push(model.id);
      },
      async removeInstalledThemes(model: { id: string }) {
        installedRefs.splice(installedRefs.indexOf(model.id), 1);
      },
    });
    let store!: ThemeStore;
    disposers.push(
      reactivity.root(() => {
        store = createThemeStore({
          reactivity,
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
            datasets: () => [{ id: 'space', name: 'Space', handle: handles.space }] as never,
            async updateAgentSettings(updates) {
              settingsWrites.push(updates as Record<string, unknown>);
              setSettings(record({ ...(reactivity.untrack(settings) ?? {}), ...updates }));
              return true;
            },
          },
        });
      }),
    );
    setSettings(record({ defaultThemeId: '' }));
    await flush();
    return { store, setCurrent };
  }

  beforeEach(async () => {
    reactivity = makePort();
    told = [];
    settingsWrites = [];
    installedRefs = [];
    localStorage.clear();
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

  const custom = (dataset: unknown, slug: string, css = '') =>
    Theme.create(dataset, {
      name: slug,
      icon: 'palette',
      slug,
      origin: 'custom',
      version: 1,
      overrides: dataUri(JSON.stringify({ themeName: 'dark' }), 'application/json'),
      css: css ? dataUri(css, 'text/css') : null,
    } as never);

  it('lists the library once it loads, and makes each one visible the first time', async () => {
    const mine = await custom(handles.root, 'mine');
    const { store } = await mount();
    expect(store.installedThemes().map((t) => t.id)).toEqual([mine.id]);
    expect(store.allThemes().some((t) => t.id === mine.id)).toBe(true);
    expect(installedRefs).toEqual([mine.id]);
  });

  it('hides a theme from the pickers without deleting it', async () => {
    const mine = await custom(handles.root, 'mine');
    await custom(handles.root, 'other');
    const { store } = await mount();
    await store.setThemeInstalled(mine.id, false);
    expect(store.allThemes().some((t) => t.id === mine.id)).toBe(false);
    expect(store.installedThemes().map((t) => t.id)).toContain(mine.id);
    await store.setThemeInstalled(mine.id, true);
    expect(store.allThemes().some((t) => t.id === mine.id)).toBe(true);
  });

  it('hides the last theme shown as well, rather than showing every one again', async () => {
    const mine = await custom(handles.root, 'mine');
    const { store } = await mount();
    await store.setThemeInstalled(mine.id, false);
    expect(store.allThemes().some((t) => t.id === mine.id)).toBe(false);
  });

  it('lists a theme saved as a new one, beside the others', async () => {
    await custom(handles.root, 'mine');
    const { store } = await mount();
    store.startEditing('dark');
    const saved = await store.saveEditingThemeAs('Copy', 'palette');
    expect(store.allThemes().some((t) => t.id === saved?.id)).toBe(true);
    expect(store.currentTheme().id).toBe(saved?.id);
    expect(installedRefs).toContain(saved?.id);
  });

  it('reads the space’s own themes while it is open, and drops them when it closes', async () => {
    const theirs = await custom(handles.space, 'theirs');
    const { store, setCurrent } = await mount({ space: true });
    expect(store.spaceThemes().map((t) => t.id)).toEqual([theirs.id]);
    setCurrent(null);
    await flush();
    expect(store.spaceThemes()).toEqual([]);
  });

  it('wears the default the agent chooses, and remembers it for the next first paint', async () => {
    const { store } = await mount();
    expect(await store.setDefaultTheme('retro')).toBe(true);
    expect(store.currentThemeId()).toBe('retro');
    expect(store.defaultThemeId()).toBe('retro');
    expect(settingsWrites).toContainEqual({ defaultThemeId: 'retro' });
    expect(localStorage.getItem('we.theme')).toBe('retro');
  });

  it('wakes the editor for every request to show a role, the same one twice included', async () => {
    const { store } = await mount();
    const seen: string[] = [];
    disposers.push(reactivity.root(() => reactivity.effect(() => void seen.push(store.focusedRole()))));
    store.focusRole('surface');
    store.focusRole('surface');
    expect(seen).toEqual(['', 'surface', 'surface']);
  });

  it('edits a copy, and hands the edit to the list when the session ends', async () => {
    const mine = await custom(handles.root, 'mine');
    const { store } = await mount();
    store.startEditing(mine.id);
    expect(store.editingTheme()).toMatchObject({ id: mine.id, isDirty: false });
    store.updateEditingCss('.x { color: red; }');
    store.updateEditingMeta({ name: 'Renamed' });
    expect(store.editingTheme()).toMatchObject({ css: '.x { color: red; }', name: 'Renamed', isDirty: true });
    store.cancelEditing();
    expect(store.editingTheme()).toBeNull();
    expect(store.installedThemes().find((t) => t.id === mine.id)).toMatchObject({ name: 'Renamed' });
  });

  it('keeps an editing session through a recompute, and ends it for a choice somebody makes', async () => {
    const { store } = await mount();
    store.startEditing('dark');
    store.replaceTheme('retro');
    expect(store.currentThemeId()).not.toBe('retro');
    store.replaceTheme('retro', { explicit: true });
    expect(store.currentThemeId()).toBe('retro');
  });

  it('previews a scope without writing it, and drops the preview when one is chosen', async () => {
    const { store } = await mount();
    expect(store.themeScope()).toBe('scoped');
    store.previewThemeScope('global');
    expect(store.themeScope()).toBe('global');
    expect(store.themeScopePreviewing()).toBe(true);
    expect(settingsWrites).toEqual([]);
    await store.setThemeScopeGlobal(false);
    expect(store.themeScopePreviewing()).toBe(false);
    expect(store.themeScope()).toBe('scoped');
  });

  it('puts a named theme’s stylesheet in the document once the theme is known', async () => {
    const named = await custom(handles.root, 'named', '.card { border: 1px solid red; }');
    const { store } = await mount();
    store.requestNamedThemes({ type: 'Column', theme: { themeName: named.id }, children: [] });
    store.requestNamedThemes({ type: 'Column', theme: { themeName: 'not safe!' }, children: [] });
    await flush();
    const sheet = document.getElementById(`we-named-theme-css-${named.id}`);
    expect(sheet?.textContent).toContain(`[data-we-theme='${named.id}']`);
    expect(document.getElementById('we-named-theme-css-not safe!')).toBeNull();
  });

  it('installs a marketplace theme into the library, and updates it when installed again', async () => {
    const listing = await custom(handles.market, 'shared-look');
    const { store } = await mount();
    await store.installFromMarketplace(listing.id);
    expect(store.installedThemes().map((t) => t.slug)).toEqual(['shared-look']);
    await store.installFromMarketplace(listing.id);
    expect(store.installedThemes()).toHaveLength(1);
    expect(told).toEqual(['Theme "shared-look" installed', 'Theme "shared-look" updated to v1']);
  });

  it('installs a marketplace theme into the space once, for every member', async () => {
    const listing = await custom(handles.market, 'shared-look');
    const { store } = await mount({ space: true });
    await store.installToSpace(listing.id);
    expect(store.spaceThemes().map((t) => t.slug)).toEqual(['shared-look']);
    await store.installToSpace(listing.id);
    expect(store.spaceThemes()).toHaveLength(1);
    expect(told).toEqual(['"shared-look" added to this space', 'error: "shared-look" is already in this space']);
  });

  it('shares only the theme being edited, and lists it in the open space at once', async () => {
    const mine = await custom(handles.root, 'mine');
    const { store } = await mount({ space: true });
    expect(await store.publishToSpace('space', 'Space')).toBe(false);
    store.startEditing(mine.id);
    expect(await store.publishToSpace('space', 'Space')).toBe(true);
    expect(store.spaceThemes().map((t) => t.slug)).toEqual(['mine']);
    expect(told).toEqual(['error: No theme is being edited', 'Theme "mine" shared to space "Space"']);
  });
});
