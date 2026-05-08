import { useNavigate } from '@solidjs/router';
import { Accessor, createContext, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

type NavigateFunction = ReturnType<typeof useNavigate>;

export interface RouteStore {
  // State
  currentPath: Accessor<string>;
  segments: Accessor<string[]>;

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
  const segments = createMemo(() => currentPath().split('/').filter(Boolean));

  function navigate(to: string, options?: Record<string, unknown>) {
    // Skip if already on the target path or already drilling into a sub-route of it.
    // e.g. clicking the "global" space while at /space/global/globe should be a no-op
    // so the CesiumGlobe doesn't unmount/remount unnecessarily.
    const current = window.location.pathname;
    if (current === to || current.startsWith(to + '/')) return;

    const nav = navigateFunction();
    if (nav) nav(to, options);
    else console.warn('Navigate function not available yet');
  }

  const store: RouteStore = {
    // State
    currentPath,
    segments,

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
