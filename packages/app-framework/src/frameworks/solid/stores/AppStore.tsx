import { moduleRegistry, type RegisteredEmbed } from '@shared/registries/moduleRegistry';
import { Accessor, createContext, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

import weLogo from '../../../shared/assets/we-logo-small.png';

export interface AppStore {
  /** Every registered module contributing an embedded application */
  apps: Accessor<RegisteredEmbed[]>;
  /** Apps list with a WE sentinel prepended — used by the sidebar app switcher */
  appsWithWe: Accessor<RegisteredEmbed[]>;
  /** ID of the currently displayed app, or null if a template is active */
  activeAppId: Accessor<string | null>;
  /** Show the given app's iframe, hiding the template content area */
  activateApp: (id: string) => void;
  /** Return to template view, keeping app iframes mounted */
  deactivateApp: () => void;
}

const WE_SENTINEL: RegisteredEmbed = { id: 'we', name: 'WE', image: weLogo, icon: '', url: '', allow: '' };

const AppContext = createContext<AppStore>();

export function AppStoreProvider(props: ParentProps) {
  const [apps] = createSignal<RegisteredEmbed[]>(moduleRegistry.embeds());
  const [activeAppId, setActiveAppId] = createSignal<string | null>(null);
  const appsWithWe = createMemo(() => [WE_SENTINEL, ...apps()]);

  function activateApp(id: string) {
    if (apps().some((a) => a.id === id)) {
      setActiveAppId(id);
    } else {
      console.warn(`AppStore: unknown app id "${id}"`);
    }
  }

  function deactivateApp() {
    setActiveAppId(null);
  }

  const store: AppStore = { apps, appsWithWe, activeAppId, activateApp, deactivateApp };

  return <AppContext.Provider value={store}>{props.children}</AppContext.Provider>;
}

export function useAppStore(): AppStore {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppStore must be used within AppStoreProvider');
  return ctx;
}

export default AppStoreProvider;
