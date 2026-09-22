import { useNavigate } from '@solidjs/router';
import { SPACE_ROUTE_DEPTH } from '@we/schema-shared';
import {
  Accessor,
  createContext,
  createMemo,
  createSignal,
  onCleanup,
  ParentProps,
  untrack,
  useContext,
} from 'solid-js';

type NavigateFunction = ReturnType<typeof useNavigate>;

export interface RouteStore {
  // State
  currentPath: Accessor<string>;
  segments: Accessor<string[]>;
  /**
   * The segments below the space prefix — a template's own coordinate space.
   *
   * `segments` is the whole URL, so anything reading it by index is pinned to where the host happens
   * to mount things. That was fine while a self-routing template sat at the top level and its
   * `/photo/:postId` made `segments[1]` the id; once every template moved under `/space/:spaceId`
   * the same index became the space, and four templates would have silently read the wrong value —
   * a query for a post whose id is a space.
   *
   * Reading positions relative to the template's own root fixes that once rather than per move:
   * these indices are the same numbers they always were, and the only thing that has to change if
   * the prefix ever changes again is `SPACE_ROUTE_DEPTH`.
   *
   * Outside a space this is the whole path, so a template rendered without one is unaffected.
   */
  templateSegments: Accessor<string[]>;
  /**
   * The URL's query parameters, reactive. Read from schemas as
   * `{ $: 'routeStore.params.<name>' }` — view state that belongs in the
   * URL (selected content type, sort, filters) lives here so a link reproduces
   * the view for whoever receives it. See docs/architecture/routing-and-view-state.md.
   */
  params: Accessor<Record<string, string>>;

  // Setters
  /**
   * Lend the router's `navigate`. Returns the disposer — hand it to `onCleanup`.
   *
   * Without one, a layout that unmounted (a template switch is exactly that) left this holding the
   * dead router's function, and every subsequent `routeStore.navigate` went to a router that no
   * longer renders anything: a link that visibly does nothing, with no warning, because the slot
   * was full. Clearing it restores the honest "Navigate function not available yet" instead.
   */
  setNavigateFunction: (navigate: NavigateFunction) => () => void;
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

  /** Lend a `navigate`, and take it back again — but only if it is still the one that was lent. */
  function provideNavigate(navigate: NavigateFunction): () => void {
    setNavigateFunction(() => navigate);
    return () => setNavigateFunction((current) => (current === navigate ? null : current));
  }
  /*
    Equal when every parameter is, so a write that changes nothing wakes nothing. Pressing a card that
    is already selected writes the same two parameters again, and every reader of `params` — each
    query naming the selection among them — re-ran and resubscribed for it.
  */
  const [params, setParamsSignal] = createSignal<Record<string, string>>(readParams(), {
    equals: (a, b) => {
      const keys = Object.keys(a);
      return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
    },
  });
  const segments = createMemo(() => currentPath().split('/').filter(Boolean));
  const templateSegments = createMemo(() => {
    const all = segments();
    return all[0] === 'space' ? all.slice(SPACE_ROUTE_DEPTH) : all;
  });

  /**
   * Last-seen query string per pathname, restored by navigate(). Keep-alive
   * routes stay mounted across navigation with their live state intact, but the
   * router strips the query string on the way out — so returning landed on the
   * bare path, the screen showed one sort order and the URL claimed another,
   * and a reload believed the URL. In-memory only: a reload starts from the
   * URL itself, which this keeps truthful.
   */
  const rememberedSearch = new Map<string, string>();
  function rememberCurrentSearch(at?: { pathname: string; search: string }) {
    if (typeof window === 'undefined') return;
    const { pathname, search } = at ?? window.location;
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
    // What the router reported rather than the address bar, for `setParam`'s reason below.
    if (search !== undefined) rememberCurrentSearch({ pathname: path, search });
    else rememberCurrentSearch();
  }

  if (typeof window !== 'undefined') {
    const onPopState = () => setParamsSignal(readParams());
    window.addEventListener('popstate', onPopState);
    onCleanup(() => window.removeEventListener('popstate', onPopState));
  }

  function navigate(to: string, options?: Record<string, unknown>) {
    // Skip if already on the exact target path (no-op router push). The router's path, not the
    // address bar's, for `setParam`'s reason below: against a stale bar this refused to go to the
    // page the bar wrongly named, and let through a navigation to the page already on screen.
    if ((untrack(currentPath) || window.location.pathname) === to) return;

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
    /*
      Built from what the app is showing, not from the address bar.

      The two should agree, and when they do this changes nothing. When they did not, reading the
      address bar turned a one-parameter write into a rewrite of the page: a discarded router's
      navigation had landed in `history` after its replacement mounted, so the bar said `/about` while
      the canvas was on screen, and clearing the selected card wrote `/about` with no query — taking
      the call the canvas was about with it. See the section guard in TemplateProvider for how the
      bar got there. The router's path and the params it last reported are what every reader is
      rendering against, so they are the state a write should extend.

      The bar's path only before the router has reported one. Untracked, because a write made from
      inside an effect must not make that effect depend on what it just wrote.
    */
    const search = new URLSearchParams(untrack(params));
    if (value === null || value === undefined || value === '') search.delete(name);
    else search.set(name, value);
    const query = search.toString();
    const url = `${untrack(currentPath) || window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
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
    templateSegments,
    params,

    // Setters
    setNavigateFunction: provideNavigate,
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
