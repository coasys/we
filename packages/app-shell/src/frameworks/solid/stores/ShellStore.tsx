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
  /** Smooth-scroll the element with the given DOM id into view. */
  scrollToId: (id: string) => void;
}

const ShellContext = createContext<ShellStore>();

export function ShellStoreProvider(props: ParentProps) {
  const [activeShellView, setActiveShellView] = createSignal<string | null>('landing-page');
  const [pendingPath, setPendingPath] = createSignal<string | null>(null);

  const store: ShellStore = {
    activeShellView,
    openShellView: (id: string, path?: string) => {
      setPendingPath(path ?? null);
      setActiveShellView(id);
    },
    closeShellView: () => setActiveShellView(null),
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
