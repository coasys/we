import { useNavigate } from '@solidjs/router';
import { Accessor, createContext, createSignal, ParentProps, useContext } from 'solid-js';

type NavigateFunction = ReturnType<typeof useNavigate>;

export interface RouteStore {
  // State
  currentPath: Accessor<string>;

  // Setters
  setNavigateFunction: (navigate: NavigateFunction) => void;
  setCurrentPath: (path: string) => void;

  // Actions
  navigate: (to: string, options?: Record<string, unknown>) => void;
}

const RouteContext = createContext<RouteStore>();

export function RouteStoreProvider(props: ParentProps) {
  const [currentPath, setCurrentPath] = createSignal('');
  const [navigateFunction, setNavigateFunction] = createSignal<NavigateFunction | null>(null);

  function navigate(to: string, options?: Record<string, unknown>) {
    // Skip if already on target path
    if (window.location.pathname === to) return;

    const nav = navigateFunction();
    if (nav) nav(to, options);
    else console.warn('Navigate function not available yet');
  }

  const store: RouteStore = {
    // State
    currentPath,

    // Setters
    setNavigateFunction,
    setCurrentPath,

    // Actions
    navigate,
  };

  return <RouteContext.Provider value={store}>{props.children}</RouteContext.Provider>;
}

export function useRouteStore(): RouteStore {
  const ctx = useContext(RouteContext);
  if (!ctx) throw new Error('useRouteStore must be used within RouteStoreProvider');
  return ctx;
}

export default RouteStoreProvider;
