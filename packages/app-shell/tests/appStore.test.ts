/**
 * The embedded applications this agent has installed, and which one is on screen.
 *
 * A plain store test, run once under each reactivity port: Solid's, and the test port that runs a
 * new effect at once where Solid defers it.
 */
import type { ReactivityPort } from '@we/reactivity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { moduleRegistry } from '../src/shared/registries/moduleRegistry';
import { type AppStore, createAppStore } from '../src/shared/stores/AppStore';
import { reactivityPorts } from './support/engines';

const host = { backend: 'ad4m', framework: 'solid' };
const embed = (id: string) => ({
  manifest: { id, name: id.toUpperCase(), icon: 'app-window' },
  contributes: { embed: { url: `http://localhost/${id}`, allow: '', image: `/${id}.png` } },
});

describe.each(reactivityPorts)('appStore, under %s', (_name, makePort) => {
  let port: ReactivityPort;
  const disposers: (() => void)[] = [];

  function mountStore(): AppStore {
    let store!: AppStore;
    disposers.push(port.root(() => (store = createAppStore({ reactivity: port }))));
    return store;
  }

  beforeEach(() => {
    port = makePort();
    moduleRegistry.register(embed('flux'), host);
    moduleRegistry.register(embed('pad'), host);
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    moduleRegistry.unregister('flux');
    moduleRegistry.unregister('pad');
    vi.restoreAllMocks();
  });

  it('counts every embed as installed until the installed set is lent', () => {
    const store = mountStore();
    expect(store.apps().map((a) => a.id)).toEqual(['flux', 'pad']);
    expect(store.appsWithWe().map((a) => a.id)).toEqual(['we', 'flux', 'pad']);
  });

  it('keeps a lent lookup as the function it is, and lists only what it names', () => {
    const store = mountStore();
    const [installed, setInstalled] = port.signal<string[]>(['pad']);
    store.provideInstalledModules(installed);
    expect(store.apps().map((a) => a.id)).toEqual(['pad']);

    setInstalled(['flux', 'pad']);
    expect(store.apps().map((a) => a.id)).toEqual(['flux', 'pad']);
  });

  it('opens only an app that is installed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = mountStore();
    store.provideInstalledModules(() => ['flux']);

    store.activateApp('pad');
    expect(store.activeAppId()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();

    store.activateApp('flux');
    expect(store.activeAppId()).toBe('flux');
    store.deactivateApp();
    expect(store.activeAppId()).toBeNull();
  });

  it('closes an open app the moment it is uninstalled', () => {
    const store = mountStore();
    const [installed, setInstalled] = port.signal<string[]>(['flux', 'pad']);
    store.provideInstalledModules(installed);
    store.activateApp('flux');
    expect(store.activeAppId()).toBe('flux');

    setInstalled(['pad']);
    expect(store.activeAppId()).toBeNull();
  });

  it('wakes nothing that reads the open app when the same one is opened again', () => {
    const store = mountStore();
    const seen: (string | null)[] = [];
    disposers.push(port.root(() => port.effect(() => void seen.push(store.activeAppId()))));
    store.activateApp('flux');
    const after = seen.length;
    store.activateApp('flux');
    expect(seen.length).toBe(after);
  });
});
