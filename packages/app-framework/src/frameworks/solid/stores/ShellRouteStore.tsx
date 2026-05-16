/**
 * ShellRouteStore
 *
 * Provides an isolated RouteStore for the shell overlay (profile, settings, schema-tests,
 * landing-page). Uses a <MemoryRouter> so shell navigation never touches the browser URL.
 *
 * Mirrors the pattern of RouteStoreProvider + <Router> used by the main template system:
 * - ShellRouteStoreProvider creates the store signals and context
 * - ShellRouterRoot is mounted as the <MemoryRouter> root prop and calls
 *   useNavigate()/useLocation() to populate the store — exactly as createLayout does
 *   for the main Router.
 *
 * Usage in TemplateProvider:
 *   const shellRouteStore = useShellRouteStore();
 *   <MemoryRouter root={ShellRouterRoot}>...</MemoryRouter>
 *   // pass shellRouteStore as routeStore in shellStores bag
 */
import { useLocation, useNavigate } from '@solidjs/router';
import { createContext, createEffect, createMemo, createSignal, JSX, ParentProps, useContext } from 'solid-js';

import type { RouteStore } from './RouteStore';

const ShellRouteContext = createContext<RouteStore>();

/**
 * Provides the ShellRouteStore context. Must wrap everything that renders the shell overlay,
 * including the <MemoryRouter>. The signals inside start empty; ShellRouterRoot fills them
 * once it's mounted inside the MemoryRouter context.
 */
export function ShellRouteStoreProvider(props: ParentProps) {
  const [currentPath, setCurrentPath] = createSignal('/');
  const [navigateFunction, setNavigateFunction] = createSignal<ReturnType<typeof useNavigate> | null>(null);
  const segments = createMemo(() => currentPath().split('/').filter(Boolean));

  function navigate(to: string, options?: Record<string, unknown>) {
    const nav = navigateFunction();
    if (nav) nav(to, options);
    else console.warn('ShellRouteStore: navigate called before router was ready');
  }

  const store: RouteStore = {
    currentPath,
    segments,
    setNavigateFunction,
    setCurrentPath,
    navigate,
  };

  return <ShellRouteContext.Provider value={store}>{props.children}</ShellRouteContext.Provider>;
}

/**
 * Mount as the `root` prop of <MemoryRouter>. Calls useNavigate()/useLocation()
 * from inside the router context and wires them into the ShellRouteStore signals.
 */
export function ShellRouterRoot(props: ParentProps): JSX.Element {
  const store = useShellRouteStore();
  const navigate = useNavigate();
  const location = useLocation();

  createEffect(() => store.setNavigateFunction(() => navigate));
  createEffect(() => store.setCurrentPath(location.pathname));

  return <>{props.children}</>;
}

export function useShellRouteStore(): RouteStore {
  const ctx = useContext(ShellRouteContext);
  if (!ctx) throw new Error('useShellRouteStore must be used within ShellRouteStoreProvider');
  return ctx;
}
