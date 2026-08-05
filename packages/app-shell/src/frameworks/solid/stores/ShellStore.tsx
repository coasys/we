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
   * Open the surface the app rests on when nothing else is chosen.
   *
   * Called once as boot completes. Named for the role rather than the id so the choice of which
   * page is "home" stays in the shell layer, where the shell-view registry already lives.
   */
  showHome: () => void;
  openShellView: (id: string) => void;
  closeShellView: () => void;
  /** Smooth-scroll the element with the given DOM id into view. */
  scrollToId: (id: string) => void;
}

const ShellContext = createContext<ShellStore>();

/** The surface the app rests on with nothing else open. See `ShellStore.showHome`. */
const HOME_VIEW = 'landing-page';

export function ShellStoreProvider(props: ParentProps) {
  // Null, not the home view. Defaulting to it made "open About" a no-op before sign-in — the id
  // was already set, so nothing changed and the page sat underneath the boot screen. The handoff
  // is now stated at the moment it happens (see `showHome`), which also makes a behaviour that was
  // only discoverable by reading a signal's initial value visible in the code that means it.
  const [activeShellView, setActiveShellView] = createSignal<string | null>(null);

  const store: ShellStore = {
    activeShellView,
    openShellView: (id: string) => setActiveShellView(id),
    showHome: () => setActiveShellView(HOME_VIEW),
    closeShellView: () => setActiveShellView(null),
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
