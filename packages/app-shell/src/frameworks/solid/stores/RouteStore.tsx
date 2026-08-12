import { useNavigate } from '@solidjs/router';
import { Accessor, createContext, createMemo, createSignal, onCleanup, ParentProps, useContext } from 'solid-js';

type NavigateFunction = ReturnType<typeof useNavigate>;

export interface RouteStore {
  // State
  currentPath: Accessor<string>;
  segments: Accessor<string[]>;
  /**
   * The URL's query parameters, reactive. Read from schemas as
   * `{ $store: 'routeStore.params.<name>' }` — view state that belongs in the
   * URL (selected content type, sort, filters) lives here so a link reproduces
   * the view for whoever receives it. See docs/architecture/routing-and-view-state.md.
   */
  params: Accessor<Record<string, string>>;

  // Setters
  setNavigateFunction: (navigate: NavigateFunction) => void;
  setCurrentPath: (path: string) => void;

  // Actions
  navigate: (to: string, options?: Record<string, unknown>) => void;
  /**
   * Write one query parameter (null removes it). Defaults to replaceState —
   * filter/sort changes should not spam history; pass { push: true } for
   * changes that deserve a Back entry (a content-type switch).
   */
  setParam: (name: string, value: string | null, options?: { push?: boolean }) => void;
}

const RouteContext = createContext<RouteStore>();

function readParams(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

export function RouteStoreProvider(props: ParentProps) {
  const [currentPath, setCurrentPathSignal] = createSignal('');
  const [navigateFunction, setNavigateFunction] = createSignal<NavigateFunction | null>(null);
  const [params, setParamsSignal] = createSignal<Record<string, string>>(readParams());
  const segments = createMemo(() => currentPath().split('/').filter(Boolean));

  // The router reports every location change through setCurrentPath — refreshing
  // the params there keeps them in sync with router-driven navigation, and the
  // popstate listener covers Back/Forward over param-only history entries the
  // router never sees (setParam writes those directly).
  function setCurrentPath(path: string) {
    setCurrentPathSignal(path);
    setParamsSignal(readParams());
  }

  if (typeof window !== 'undefined') {
    const onPopState = () => setParamsSignal(readParams());
    window.addEventListener('popstate', onPopState);
    onCleanup(() => window.removeEventListener('popstate', onPopState));
  }

  function navigate(to: string, options?: Record<string, unknown>) {
    // Skip if already on the exact target path (no-op router push)
    if (window.location.pathname === to) return;

    const nav = navigateFunction();
    if (nav) nav(to, options);
    else console.warn('Navigate function not available yet');
  }

  function setParam(name: string, value: string | null, options?: { push?: boolean }) {
    if (typeof window === 'undefined') return;
    const search = new URLSearchParams(window.location.search);
    if (value === null || value === undefined || value === '') search.delete(name);
    else search.set(name, value);
    const query = search.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    // Written through history directly rather than the router: the path is
    // unchanged, so the route tree must not re-resolve — only the params signal
    // moves, and only its readers re-run.
    if (options?.push) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
    setParamsSignal(readParams());
  }

  const store: RouteStore = {
    // State
    currentPath,
    segments,
    params,

    // Setters
    setNavigateFunction,
    setCurrentPath,

    // Actions
    navigate,
    setParam,
  };

  return <RouteContext.Provider value={store}>{props.children}</RouteContext.Provider>;
}

export function useRouteStore(): RouteStore {
  const ctx = useContext(RouteContext);
  if (!ctx) throw new Error('useRouteStore must be used within RouteStoreProvider');
  return ctx;
}

export default RouteStoreProvider;
