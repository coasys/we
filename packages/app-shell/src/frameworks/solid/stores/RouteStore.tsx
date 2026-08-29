import { useNavigate } from '@solidjs/router';
import { Accessor, createContext, createMemo, createSignal, onCleanup, ParentProps, useContext } from 'solid-js';

type NavigateFunction = ReturnType<typeof useNavigate>;

export interface RouteStore {
  // State
  currentPath: Accessor<string>;
  segments: Accessor<string[]>;
  /**
   * The URL's query parameters, reactive. Read from schemas as
   * `{ $: 'routeStore.params.<name>' }` — view state that belongs in the
   * URL (selected content type, sort, filters) lives here so a link reproduces
   * the view for whoever receives it. See docs/architecture/routing-and-view-state.md.
   */
  params: Accessor<Record<string, string>>;

  // Setters
  setNavigateFunction: (navigate: NavigateFunction) => void;
  setCurrentPath: (path: string, search?: string) => void;

  // Actions
  navigate: (to: string, options?: Record<string, unknown>) => void;
  /**
   * Write one query parameter (null removes it). Defaults to replaceState —
   * filter/sort changes should not spam history; pass { push: true } for
   * changes that deserve a Back entry (a content-type switch).
   */
  setParam: (name: string, value: string | null, options?: { push?: boolean }) => void;
  /**
   * Go back one entry, the browser's own way.
   *
   * `history.back()` rather than navigating to a computed parent, because "where did I come from"
   * is not derivable from a path: a record page is reached from a list, from a search, from a link
   * somebody sent, and only one of those has a parent worth guessing. A guessed destination is worse
   * than none — it silently sends people somewhere they have never been.
   *
   * Does nothing at the start of the session's history, which is the honest outcome: there is
   * nowhere back to go, and inventing a destination would be the same guess.
   */
  back: () => void;
}

const RouteContext = createContext<RouteStore>();

function readParams(search?: string): Record<string, string> {
  if (search === undefined && typeof window === 'undefined') return {};
  return Object.fromEntries(new URLSearchParams(search ?? window.location.search));
}

export function RouteStoreProvider(props: ParentProps) {
  const [currentPath, setCurrentPathSignal] = createSignal('');
  const [navigateFunction, setNavigateFunction] = createSignal<NavigateFunction | null>(null);
  const [params, setParamsSignal] = createSignal<Record<string, string>>(readParams());
  const segments = createMemo(() => currentPath().split('/').filter(Boolean));

  /**
   * Last-seen query string per pathname, restored by navigate(). Keep-alive
   * routes stay mounted across navigation with their live state intact, but the
   * router strips the query string on the way out — so returning landed on the
   * bare path, the screen showed one sort order and the URL claimed another,
   * and a reload believed the URL. In-memory only: a reload starts from the
   * URL itself, which this keeps truthful.
   */
  const rememberedSearch = new Map<string, string>();
  function rememberCurrentSearch() {
    if (typeof window === 'undefined') return;
    const { pathname, search } = window.location;
    if (search) rememberedSearch.set(pathname, search);
    else rememberedSearch.delete(pathname);
  }

  // The router reports every location change through setCurrentPath — refreshing
  // the params there keeps them in sync with router-driven navigation, and the
  // popstate listener covers Back/Forward over param-only history entries the
  // router never sees (setParam writes those directly).
  /**
   * The router reporting where it is. `search` is separate because it is a separate signal there,
   * and taking it as an argument is what makes the caller's effect depend on it.
   *
   * A location change that alters only the query is one the router makes and nothing else here sees
   * — the popstate listener below covers Back/Forward over `setParam`'s own history entries, which
   * the router never sees, and the two gaps are not the same one. Missing this leaves
   * `routeStore.params` describing the page you came from: two record pages differ only by `?id=`,
   * so following a link from one to another rendered the first record's content under the second
   * record's URL.
   */
  function setCurrentPath(path: string, search?: string) {
    setCurrentPathSignal(path);
    setParamsSignal(readParams(search));
    rememberCurrentSearch();
  }

  if (typeof window !== 'undefined') {
    const onPopState = () => setParamsSignal(readParams());
    window.addEventListener('popstate', onPopState);
    onCleanup(() => window.removeEventListener('popstate', onPopState));
  }

  function navigate(to: string, options?: Record<string, unknown>) {
    // Skip if already on the exact target path (no-op router push)
    if (window.location.pathname === to) return;

    // A bare path restores that route's remembered query string, so a
    // kept-alive route's URL params survive leaving and returning. An explicit
    // `?` in `to` always wins.
    const target = !to.includes('?') && rememberedSearch.has(to) ? `${to}${rememberedSearch.get(to)}` : to;

    const nav = navigateFunction();
    if (nav) nav(target, options);
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
    rememberCurrentSearch();
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
    back: () => window.history.back(),
  };

  return <RouteContext.Provider value={store}>{props.children}</RouteContext.Provider>;
}

export function useRouteStore(): RouteStore {
  const ctx = useContext(RouteContext);
  if (!ctx) throw new Error('useRouteStore must be used within RouteStoreProvider');
  return ctx;
}

export default RouteStoreProvider;
