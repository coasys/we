/**
 * ShellRouteStore
 *
 * Provides an isolated RouteStore for the shell overlay (profile, settings, schema-tests,
 * landing-page). Uses a <MemoryRouter> so shell navigation never touches the browser URL.
 *
 * ## Why a separate router at all — a trust boundary, not a convenience
 *
 * Templates declare their own route tables, and templates install from strangers. `templateAcceptance`
 * vets structure and the store members a template may name; it does not inspect paths. So a template
 * sharing the browser Router's coordinate space could declare `/settings` and render whatever it
 * liked there. Out here that is not expressible.
 *
 * The quieter version of the same point: a surface you use to *fix* a bad template must not be
 * rendered by that template's route table. Settings has to look the same whichever template is
 * loaded, including a broken one, including one mid-install.
 *
 * Keeping the space mounted underneath is the other reason and the one usually given first, but it
 * is the weaker of the two — a cost people talk themselves out of, where a boundary is not. Both are
 * real: the overlay paints over a template that stays mounted, so a running call, a scroll position
 * and a half-typed draft all survive somebody opening their settings.
 *
 * The costs are accepted rather than overlooked: Back does not close an overlay and a reload does
 * not reopen it. See `docs/architecture/routing-and-view-state.md` for the shape a shareable
 * settings link would take if one is ever wanted — it is not a URL for this state.
 *
 * Mirrors the main template system's RouteStore + <Router>:
 * - createShellRouteStore makes the store, once per overlay, where the overlay is built
 * - the host's router binding (`ShellRouterRoot` under Solid, mounted as the <MemoryRouter> root) is
 *   handed that store and fills it from the router's location — exactly as the layout does for the
 *   main Router.
 *
 * Written against the reactivity port and nothing else, so it runs under any host.
 */
import type { ReactivityPort } from '@we/reactivity';

import {
  type NavigateFunction,
  type NavigateOptions,
  queryString,
  resolveNavigation,
  type RouteStore,
} from './RouteStore';

/**
 * The shell's store, plus the one setter only the host's router binding may call.
 *
 * The query string has to come from the MemoryRouter's location rather than `window.location`,
 * which is the whole reason this store exists separately: the overlay's URL is deliberately not
 * the browser's. Everything but the binding reads it as a {@link RouteStore}.
 *
 * A type alias rather than an interface: it is `routeStore` to the overlay's templates, not a store
 * of its own, so it is not described to them under a name of its own.
 */
export type ShellRouteStore = RouteStore & {
  setSearch: (search: string) => void;
};

/**
 * The overlay's route store, made by whatever renders the overlay and handed to its router
 * binding. The signals inside start empty; the binding fills them once it is mounted inside the
 * MemoryRouter.
 */
export function createShellRouteStore({ reactivity }: { reactivity: ReactivityPort }): ShellRouteStore {
  const { signal, memo, untrack } = reactivity;
  const [currentPath, writeCurrentPath] = signal('/');
  const [search, writeSearch] = signal('');
  const [navigateFunction, setNavigateFunction] = signal<NavigateFunction | null>(null);
  /*
    The router reports its location on every move, path and query apart, so most reports repeat one
    of them. Compared here rather than left to the signal, because whether an equal write wakes the
    readers of `segments` and `params` is not something the port promises.
  */
  const setCurrentPath = (path: string) => {
    if (untrack(currentPath) !== path) writeCurrentPath(path);
  };
  const setSearch = (next: string) => {
    if (untrack(search) !== next) writeSearch(next);
  };

  /** Lend the overlay router's `navigate`, and take it back — see `RouteStore.setNavigateFunction`. */
  function provideNavigate(navigate: NavigateFunction): () => void {
    setNavigateFunction(navigate);
    return () => {
      if (untrack(navigateFunction) === navigate) setNavigateFunction(null);
    };
  }
  const segments = memo(() => currentPath().split('/').filter(Boolean));
  const params = memo(() => Object.fromEntries(new URLSearchParams(search())));
  // As `RouteStore.page`: the path, and the record the page is about.
  const page = memo(() => {
    const id = params().id;
    return id ? `${currentPath()}?${queryString({ id })}` : currentPath();
  });

  // `number` as well as a path: the router takes a delta for history movement, which is what `back`
  // needs and what the store's public `navigate` deliberately does not offer.
  function go(to: string | number, options?: Record<string, unknown>) {
    const nav = navigateFunction();
    if (nav) nav(to, options);
    else console.warn('ShellRouteStore: navigate called before router was ready');
  }

  /**
   * As `RouteStore.navigate`: a relative path is resolved, `query` is written for the caller, the
   * rest goes to the router. Against the overlay's own address, whose root is its `/`: resolving
   * against the browser's would put an overlay link under whatever page is behind the overlay.
   */
  function navigate(to: string, options?: NavigateOptions) {
    // `fresh` is already how this one works: the overlay remembers no query to put back.
    const { query, base, fresh: _fresh, ...routerOptions } = options ?? {};
    const resolved = resolveNavigation(to, currentPath(), 0, base);
    const written = query && typeof query === 'object' ? queryString(query) : '';
    go(
      written ? `${resolved}${resolved.includes('?') ? '&' : '?'}${written}` : resolved,
      Object.keys(routerOptions).length ? routerOptions : undefined,
    );
  }

  /**
   * Writes one query parameter by navigating the memory router.
   *
   * The main `RouteStore` reaches for `history.replaceState` here so the route tree does not
   * re-resolve on a param-only change. That is not available to a MemoryRouter — its location is
   * not the browser's — so this navigates instead, and `replace` keeps it out of the overlay's
   * history the same way. The overlay's route tree is small enough that re-resolving costs
   * nothing worth engineering around.
   */
  function setParam(name: string, value: string | null, options?: { push?: boolean }) {
    const next = new URLSearchParams(search());
    if (value === null || value === undefined || value === '') next.delete(name);
    else next.set(name, value);
    const query = queryString(next);
    go(`${currentPath()}${query ? `?${query}` : ''}`, { replace: !options?.push });
  }

  const store: ShellRouteStore = {
    currentPath,
    segments,
    /*
      The same thing as `segments` here, because the overlay has no space prefix to sit below — its
      paths are its own from the first segment. Present so an overlay schema and a template schema
      can be written the same way, rather than because there is anything to strip.
    */
    templateSegments: segments,
    params,
    page,
    setNavigateFunction: provideNavigate,
    setCurrentPath,
    setSearch,
    navigate,
    setParam,
    /*
      The overlay's own history, not the browser's.

      `history.back()` would take the *page behind the overlay* back a step, which is the wrong
      stack entirely — an overlay is a memory router, so going back inside it means navigating this
      router. `navigate(-1)` is how a memory router expresses that, and at the start of its history
      it does nothing, which matches what the browser does.
    */
    back: () => go(-1),
  };

  return store;
}
