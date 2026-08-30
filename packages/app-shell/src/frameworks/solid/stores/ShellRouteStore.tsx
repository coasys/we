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
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  JSX,
  onCleanup,
  onMount,
  ParentProps,
  useContext,
} from 'solid-js';

import type { RouteStore } from './RouteStore';
import { useShellStore } from './ShellStore';

/**
 * The shell's store, plus the one setter only {@link ShellRouterRoot} may call.
 *
 * The query string has to come from the MemoryRouter's location rather than `window.location`,
 * which is the whole reason this store exists separately: the overlay's URL is deliberately not
 * the browser's. Consumers get the narrowed {@link RouteStore} from `useShellRouteStore`.
 */
interface ShellRouteStore extends RouteStore {
  setSearch: (search: string) => void;
}

const ShellRouteContext = createContext<ShellRouteStore>();

/**
 * Provides the ShellRouteStore context. Must wrap everything that renders the shell overlay,
 * including the <MemoryRouter>. The signals inside start empty; ShellRouterRoot fills them
 * once it's mounted inside the MemoryRouter context.
 */
export function ShellRouteStoreProvider(props: ParentProps) {
  const [currentPath, setCurrentPath] = createSignal('/');
  const [search, setSearch] = createSignal('');
  const [navigateFunction, setNavigateFunction] = createSignal<ReturnType<typeof useNavigate> | null>(null);

  /** Lend the overlay router's `navigate`, and take it back — see `RouteStore.setNavigateFunction`. */
  function provideNavigate(navigate: ReturnType<typeof useNavigate>): () => void {
    setNavigateFunction(() => navigate);
    return () => setNavigateFunction((current) => (current === navigate ? null : current));
  }
  const segments = createMemo(() => currentPath().split('/').filter(Boolean));
  const params = createMemo(() => Object.fromEntries(new URLSearchParams(search())));

  // `number` as well as a path: the router takes a delta for history movement, which is what `back`
  // needs and what the store's public `navigate` deliberately does not offer.
  function navigate(to: string | number, options?: Record<string, unknown>) {
    const nav = navigateFunction();
    if (nav) nav(to as string, options);
    else console.warn('ShellRouteStore: navigate called before router was ready');
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
    const query = next.toString();
    navigate(`${currentPath()}${query ? `?${query}` : ''}`, { replace: !options?.push });
  }

  const store: ShellRouteStore = {
    currentPath,
    segments,
    params,
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
    back: () => navigate(-1),
  };

  return <ShellRouteContext.Provider value={store}>{props.children}</ShellRouteContext.Provider>;
}

/**
 * Mount as the `root` prop of <MemoryRouter>. Calls useNavigate()/useLocation()
 * from inside the router context and wires them into the ShellRouteStore signals.
 */
export function ShellRouterRoot(props: ParentProps): JSX.Element {
  const store = useContext(ShellRouteContext);
  if (!store) throw new Error('ShellRouterRoot must be mounted within ShellRouteStoreProvider');
  const shell = useShellStore();
  const navigate = useNavigate();
  const location = useLocation();

  /*
    Claimed synchronously, here in setup, rather than inside `onMount`.

    Effects run in creation order and `onMount` is one of them, so the location effect below fires
    first — with the *fresh* router's `/`, since a remounted `MemoryRouter` starts there. Asking
    afterwards therefore returned `/`: the answer had been overwritten by the question. Reading it
    before any effect exists is what makes the restore survive its own bookkeeping.
  */
  const restoreTo = shell.takePendingPath();

  // The overlay's own router, taken back when the overlay closes — see `RouteStore`, which had the
  // same slot and the same missing half.
  onCleanup(store.setNavigateFunction(navigate));
  createEffect(() => {
    store.setCurrentPath(location.pathname);
    // Reported upwards on every move, because this store does not outlive the overlay and the
    // question "where was I" is asked after it has already been destroyed. See `rememberShellPath`.
    shell.rememberShellPath(location.pathname + location.search);
  });
  createEffect(() => store.setSearch(location.search));

  // A control outside the overlay can ask for a page inside it — see `ShellStore.openShellView`.
  // Claimed here rather than by the opener because this is the first moment `navigate` exists, and
  // taken rather than read so a later open with no path does not replay the last one.
  //
  // With nothing pending this returns where the overlay was last standing, which is what makes a
  // remount survivable: `TemplateLayout` hosts this router, so rebuilding the main route table —
  // adding or removing a section, switching template — takes the overlay down and a fresh
  // `MemoryRouter` starts at `/`. Without this you were on a space's settings page and are now on
  // the account page, having asked for neither.
  onMount(() => {
    if (restoreTo && restoreTo !== location.pathname + location.search) navigate(restoreTo, { replace: true });
  });

  return <>{props.children}</>;
}

export function useShellRouteStore(): RouteStore {
  const ctx = useContext(ShellRouteContext);
  if (!ctx) throw new Error('useShellRouteStore must be used within ShellRouteStoreProvider');
  return ctx;
}
