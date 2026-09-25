import { moduleRegistry, type RegisteredEmbed } from '@shared/registries/moduleRegistry';
import { Accessor, createContext, createEffect, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

import weLogo from '../../../shared/assets/we-icon.png';

export interface AppStore {
  /**
   * Embedded applications this agent has installed.
   *
   * Gated at the agent layer only, because that is where an app switcher renders. It sits in the
   * shell beside Spaces rather than inside one, and its iframes deliberately outlive navigation, so
   * a per-space gate would make an entry come and go as you moved between spaces that have nothing
   * to do with it — and would tear down a live session as a side effect of walking into a space.
   * A space that does not use an app expresses that by using a template without it.
   *
   * It used to be read once at construction and never filtered at all, so the toggle changed
   * nothing and the app stayed in the sidebar regardless.
   */
  apps: Accessor<RegisteredEmbed[]>;
  /** Apps list with a WE sentinel prepended — used by the sidebar app switcher */
  appsWithWe: Accessor<RegisteredEmbed[]>;
  /** ID of the currently displayed app, or null if a template is active */
  activeAppId: Accessor<string | null>;
  /** Show the given app's iframe, hiding the template content area */
  activateApp: (id: string) => void;
  /** Return to template view, keeping app iframes mounted */
  deactivateApp: () => void;
  /**
   * Lend this store the installed-module set.
   *
   * `SpaceStore` computes it but mounts below this one, so it hands the accessor down rather than
   * being reached upward for — the same arrangement as `templateStore.provideSpaceLookup`. Until it
   * is provided every registered embed counts as installed: nothing has decided otherwise yet, and
   * hiding apps during boot is a worse guess than showing them.
   */
  provideInstalledModules: (lookup: () => string[]) => void;
}

const WE_SENTINEL: RegisteredEmbed = { id: 'we', name: 'WE', image: weLogo, icon: '', url: '', allow: '' };

const AppContext = createContext<AppStore>();

export function AppStoreProvider(props: ParentProps) {
  const [installedModules, setInstalledModules] = createSignal<(() => string[]) | null>(null);
  const [activeAppId, setActiveAppId] = createSignal<string | null>(null);

  // A memo, not a snapshot: modules can register after this store is constructed, and the agent can
  // change their mind. Read once at construction, an app appeared for the session whatever anyone
  // did with it.
  const apps = createMemo<RegisteredEmbed[]>(() => {
    const embeds = moduleRegistry.embeds();
    const lookup = installedModules();
    if (!lookup) return embeds;
    const installed = new Set(lookup());
    return embeds.filter((embed) => installed.has(embed.id));
  });

  const appsWithWe = createMemo(() => [WE_SENTINEL, ...apps()]);

  function activateApp(id: string) {
    // Guards on the filtered list, so an uninstalled app cannot be opened by a stale control or a
    // restored route either.
    if (apps().some((a) => a.id === id)) {
      setActiveAppId(id);
    } else {
      console.warn(`AppStore: unknown or inactive app id "${id}"`);
    }
  }

  function deactivateApp() {
    setActiveAppId(null);
  }

  // Leaving an app open after it has been uninstalled would keep its iframe filling the content
  // area with no entry point left to close it.
  createEffect(() => {
    const id = activeAppId();
    if (id && !apps().some((a) => a.id === id)) setActiveAppId(null);
  });

  const store: AppStore = {
    apps,
    appsWithWe,
    activeAppId,
    activateApp,
    deactivateApp,
    provideInstalledModules: (lookup) => setInstalledModules(() => lookup),
  };

  return <AppContext.Provider value={store}>{props.children}</AppContext.Provider>;
}

export function useAppStore(): AppStore {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppStore must be used within AppStoreProvider');
  return ctx;
}

export default AppStoreProvider;
