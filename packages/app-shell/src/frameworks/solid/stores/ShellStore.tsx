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
  openShellView: (id: string) => void;
  closeShellView: () => void;
  /** Smooth-scroll the element with the given DOM id into view. */
  scrollToId: (id: string) => void;
}

const ShellContext = createContext<ShellStore>();

export function ShellStoreProvider(props: ParentProps) {
  const [activeShellView, setActiveShellView] = createSignal<string | null>('landing-page');

  const store: ShellStore = {
    activeShellView,
    openShellView: (id: string) => setActiveShellView(id),
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
