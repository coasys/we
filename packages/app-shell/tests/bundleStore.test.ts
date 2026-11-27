/**
 * bundleStore: an app read from a file, asked about, installed through the stores it writes into,
 * and removed again — and what it keeps for the next reload's first frame.
 *
 * Plain store tests, run once under each reactivity port: Solid's, and the test port that runs a new
 * effect at once where Solid defers it. The stores it writes through are stand-ins that record.
 */
import type { ReactivityPort, Setter } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import type { TemplateSchema } from '@we/schema-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { provideSeed } from '../src/shared/seedRegistry';
import { type BundleSpaceRow, type BundleStore, createBundleStore } from '../src/shared/stores/BundleStore';

provideSeed({ name: 'test', modules: [] } as never);

const reactivityPorts: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', createTestReactivity],
];

const DID = 'did:key:z6MkBundles';
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

const shell = (id: string, name: string) => ({
  id,
  schemaVersion: 1,
  type: 'Column',
  meta: { name, description: '', icon: 'leaf' },
  children: [],
});

const GARDEN = {
  format: 'we-bundle',
  formatVersion: 2,
  id: 'garden',
  version: '1.0.0',
  name: 'Garden',
  templates: [shell('garden-shell', 'Garden shell')],
};

const fileOf = (content: unknown, name = 'garden.bundle.json') =>
  new File([typeof content === 'string' ? content : JSON.stringify(content)], name, { type: 'application/json' });

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  let reactivity: ReactivityPort;
  const disposers: (() => void)[] = [];
  let toasts: string[];
  let written: string[];
  let settingsWrites: unknown[];
  let setLoading: Setter<boolean>;
  let setLibrary: Setter<TemplateSchema[]>;

  function mount(): BundleStore {
    let store!: BundleStore;
    const [loading, writeLoading] = reactivity.signal(true);
    const [library, writeLibrary] = reactivity.signal<TemplateSchema[]>([]);
    const [settings, setSettings] = reactivity.signal<Record<string, unknown> | null>({
      installedBundles: '',
      // The app in use is one of this agent's own, so there is something worth keeping for a reload.
      appTemplateId: 'kept',
    });
    const [spaces] = reactivity.signal<BundleSpaceRow[]>([]);
    setLoading = writeLoading;
    setLibrary = writeLibrary;
    disposers.push(
      reactivity.root(() => {
        store = createBundleStore({
          reactivity,
          toasts: { success: (message) => toasts.push(message), error: (message) => toasts.push(message) },
          sessionStore: { me: () => ({ id: DID, did: DID }), backendPorts: () => null },
          datasetStore: {
            agentSettings: settings as never,
            currentDataset: () => null,
            datasets: () => [],
            async updateAgentSettings(updates) {
              settingsWrites.push(updates);
              setSettings({ ...reactivity.untrack(settings), ...updates });
              return true;
            },
          },
          templateStore: {
            loading,
            allTemplates: library,
            async writeLibraryTemplates(templates) {
              written.push(...templates.map((t) => `template:${t.id}`));
              writeLibrary([...reactivity.untrack(library), ...templates]);
            },
            writeSpaceTemplates: async () => {},
            setAppTemplate: async () => true,
            async deleteTemplate(id) {
              written.push(`delete:${id}`);
            },
          },
          themeStore: {
            installedThemes: () => [],
            writeLibraryTheme: async (theme) => theme.id,
            deleteTheme: async () => {},
          },
          shapeStore: { spaceShapes: () => [], addRecordTypes: async () => [] },
          spaceStore: {
            spaceList: spaces,
            installedModules: () => [],
            setModuleInstalled: async () => {},
            setViewEnabled: async () => {},
          },
        });
      }),
    );
    return store;
  }

  beforeEach(() => {
    reactivity = makePort();
    toasts = [];
    written = [];
    settingsWrites = [];
    localStorage.clear();
  });
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it('refuses what is not an app, saying why', async () => {
    const store = mount();
    await store.installFromFile(null);
    expect(toasts).toEqual([]);
    await store.installFromFile(fileOf('not json at all'));
    await store.installFromFile(fileOf({ format: 'something-else' }));
    expect(toasts[0]).toBe('That file is not an app: it is not JSON');
    expect(toasts[1]).toContain('can read');
    expect(store.pendingInstall()).toBeNull();
  });

  it('asks about an app read from a file, in words, and forgets it when cancelled', async () => {
    const store = mount();
    // As a we-file-upload reports it: an event carrying a list of one.
    await store.installFromFile({ detail: [fileOf(GARDEN)] });
    expect(store.pendingInstall()).toMatchObject({
      name: 'Garden',
      version: '1.0.0',
      fileName: 'garden.bundle.json',
      updates: '',
      unchanged: false,
      needsSpace: false,
    });
    expect(store.pendingInstall()?.adds[0]).toContain('Garden shell');
    store.cancelInstall();
    expect(store.pendingInstall()).toBeNull();
  });

  it('installs through the template library and the settings, then says so', async () => {
    const store = mount();
    await store.installFromFile(fileOf(GARDEN));
    await store.confirmInstall();
    expect(written).toEqual(['template:garden--garden-shell']);
    expect(settingsWrites).toHaveLength(1);
    expect(toasts).toEqual(['“Garden” installed']);
    expect(store.pendingInstall()).toBeNull();
    expect(store.busy()).toBe(false);
    // Beside the deployment's own, which are built in.
    const fromFiles = () => store.installed().filter((entry) => entry.from === 'file');
    expect(fromFiles().map((entry) => entry.id)).toEqual(['garden']);

    // The same file again changes nothing, and says so rather than offering a button.
    await store.installFromFile(fileOf(GARDEN));
    expect(store.pendingInstall()).toMatchObject({ updates: '1.0.0', unchanged: true });
    store.cancelInstall();

    await store.removeBundle('garden');
    expect(written).toContain('delete:garden--garden-shell');
    expect(fromFiles()).toEqual([]);
    expect(toasts.at(-1)).toBe('“Garden” removed');
  });

  it('keeps the app for the next reload once the library has answered, and only when it changes', async () => {
    mount();
    await flush();
    const key = Object.keys(localStorage).find((k) => k.includes(DID));
    // Not while the library is still loading: the snapshot would be of the stand-in.
    expect(key).toBeUndefined();
    setLibrary([shell('kept', 'Kept') as never]);
    setLoading(false);
    await flush();
    const stored = Object.keys(localStorage).filter((k) => k.includes(DID));
    expect(stored).toHaveLength(1);
    const first = localStorage.getItem(stored[0]);
    expect(first).toContain('kept');

    // Written over by hand: an unchanged snapshot is not written again.
    localStorage.setItem(stored[0], 'untouched');
    setLibrary([shell('kept', 'Kept') as never]);
    await flush();
    expect(localStorage.getItem(stored[0])).toBe('untouched');
  });
});
