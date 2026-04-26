import { appRegistry, type RegisteredApp } from '@shared/registries/appRegistry';
import { Accessor, createContext, createSignal, ParentProps, useContext } from 'solid-js';

export interface AppStore {
  /** All installed apps from the seed file */
  apps: Accessor<RegisteredApp[]>;
  /** ID of the currently displayed app, or null if a template is active */
  activeAppId: Accessor<string | null>;
  /** Show the given app's iframe, hiding the template content area */
  activateApp: (id: string) => void;
  /** Return to template view, keeping app iframes mounted */
  deactivateApp: () => void;
}

const AppContext = createContext<AppStore>();

export function AppStoreProvider(props: ParentProps) {
  const [apps] = createSignal<RegisteredApp[]>(appRegistry);
  const [activeAppId, setActiveAppId] = createSignal<string | null>(null);

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

  const store: AppStore = { apps, activeAppId, activateApp, deactivateApp };

  return <AppContext.Provider value={store}>{props.children}</AppContext.Provider>;
}

export function useAppStore(): AppStore {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppStore must be used within AppStoreProvider');
  return ctx;
}

export default AppStoreProvider;
