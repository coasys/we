/**
 * ShellStore — shell chrome state: which shell overlay (profile, settings, schema-tests,
 * landing-page) is open, plus small shell-level UI utilities.
 *
 * Lived in TemplateStore historically, but which overlay is open is shell state, not template
 * state — the overlay registry itself is in TemplateLayout. Kept separate from ShellRouteStore,
 * which is the *overlay-scoped* memory router mounted inside the overlay; this store is
 * app-level, because the controls that open an overlay render outside it.
 */
import { Accessor, createContext, createSignal, ParentProps, useContext } from 'solid-js';

export interface ShellStore {
  /** Id of the currently open shell overlay, or null. */
  activeShellView: Accessor<string | null>;
  /**
   * Open an overlay, optionally at a route inside it.
   *
   * The path is what lets a control outside the overlay point at a page within it — a gear beside a
   * space opening that space's settings directly, rather than the settings root with the space still
   * to be found. The overlay keeps its own memory router, so this never touches the browser URL.
   */
  openShellView: (id: string, path?: string) => void;
  closeShellView: () => void;
  /**
   * The route the overlay should open at, read once by the overlay's router as it mounts.
   *
   * Handed over rather than navigated to, because the overlay's navigate function does not exist
   * until its router has mounted — which is after the click that asked for the page.
   */
  takePendingPath: () => string | null;
  /**
   * Whether the create-space modal is open.
   *
   * Shell state rather than a page's `$localState`, because more than one place opens it: the
   * settings page, and the `+` on the sidebar's spaces group. Scoped to a page, the modal could
   * only ever be opened from inside that page — and mounting a second copy elsewhere would be two
   * modals that could disagree about whether they were open.
   */
  createSpaceOpen: Accessor<boolean>;
  setCreateSpaceOpen: (open: boolean) => void;
  /** Smooth-scroll the element with the given DOM id into view. */
  scrollToId: (id: string) => void;
}

const ShellContext = createContext<ShellStore>();

/**
 * The overlay to open at boot: the landing page, unless the URL already points somewhere.
 *
 * Opening it unconditionally meant every refresh covered whatever route was showing, so a deep
 * link never reached its destination — the routing beneath it worked fine and nobody could tell.
 * That also made shared links useless, since the only way to arrive at one is by URL.
 *
 * Anything other than `/` is a destination someone asked for, so the landing page would be in the
 * way rather than a starting point.
 */
function initialShellView(): string | null {
  if (typeof window === 'undefined') return 'landing-page';
  return window.location.pathname === '/' ? 'landing-page' : null;
}

export function ShellStoreProvider(props: ParentProps) {
  const [activeShellView, setActiveShellView] = createSignal<string | null>(initialShellView());
  const [pendingPath, setPendingPath] = createSignal<string | null>(null);
  const [createSpaceOpen, setCreateSpaceOpen] = createSignal(false);

  const store: ShellStore = {
    activeShellView,
    openShellView: (id: string, path?: string) => {
      setPendingPath(path ?? null);
      setActiveShellView(id);
    },
    closeShellView: () => setActiveShellView(null),
    createSpaceOpen,
    setCreateSpaceOpen,
    takePendingPath: () => {
      const path = pendingPath();
      setPendingPath(null);
      return path;
    },
    scrollToId: (id: string) => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  };

  return <ShellContext.Provider value={store}>{props.children}</ShellContext.Provider>;
}

export function useShellStore(): ShellStore {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShellStore must be used within ShellStoreProvider');
  return ctx;
}
