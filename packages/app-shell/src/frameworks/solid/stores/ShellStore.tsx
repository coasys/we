/**
 * ShellStore — shell chrome state: which shell overlay (profile, settings, schema-tests,
 * landing-page) is open, plus small shell-level UI utilities.
 *
 * Lived in TemplateStore historically, but which overlay is open is shell state, not template
 * state — the overlay registry itself is in TemplateLayout. Kept separate from ShellRouteStore,
 * which is the *overlay-scoped* memory router mounted inside the overlay; this store is
 * app-level, because the controls that open an overlay render outside it.
 */
import {
  type ContentInset,
  contentInset,
  type DockGeometry,
  type DockRequest,
  dockThickness,
  MIN_DOCK_PX,
  resolveDock,
} from '@shared/dockGeometry';
import { dockRegistry } from '@shared/registries/dockRegistry';
import { moduleStores } from '@shared/registries/moduleRegistry';
import type { DockEdge, DockSize } from '@we/module-shared';
import { Accessor, createContext, createMemo, createSignal, onCleanup, ParentProps, useContext } from 'solid-js';

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
  /**
   * Every registered dock's resolved box, keyed by dock id.
   *
   * Read from schema through `dockGeometryPath` — the frame a dock is wrapped in binds each of its
   * geometric props to a path into this object, so a panel changing edge or size rewrites props on
   * a container that stays mounted rather than rebuilding it.
   */
  dockGeometry: Accessor<Record<string, DockGeometry>>;
  /** What the content viewport gives up to docked panels, in pixels per edge. */
  contentInset: Accessor<ContentInset>;
  /**
   * Tell the dock system about chrome it must keep clear of, beyond the shell's own furniture.
   *
   * Pushed in rather than read out, because the thing occupying the edge is the editor and this
   * store has no business importing it. See `computeEditorRightOffset`.
   */
  setReservedEdges: (reserved: Partial<ContentInset>) => void;
  /** True while a dock is being dragged, so transitions can be suspended and the edge track the cursor. */
  dockResizing: Accessor<boolean>;
  /** Remember a dock's current thickness, so the drag that follows is measured from it. */
  beginDockResize: (id: string) => void;
  /** Apply a drag, in pixels moved since `beginDockResize`. Signed in screen direction. */
  resizeDock: (id: string, delta: number) => void;
  endDockResize: () => void;
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

/**
 * Read one of a dock's declared store keys off the contributing module's store.
 *
 * A module publishes accessors, so the value has to be *called* — and reading it inside a memo is
 * what makes dock geometry track a panel opening, moving or resizing with no subscription wiring
 * between the module and the shell. A module that has not registered, or that names a key it does
 * not have, resolves to undefined and falls back, because a dock whose module is absent must render
 * nothing rather than throw at boot.
 */
function readModuleKey(moduleId: string, key: string | undefined): unknown {
  if (!key) return undefined;
  const store = moduleStores[moduleId] as Record<string, unknown> | undefined;
  const value = store?.[key];
  return typeof value === 'function' ? (value as () => unknown)() : value;
}

export function ShellStoreProvider(props: ParentProps) {
  const [activeShellView, setActiveShellView] = createSignal<string | null>(initialShellView());
  const [pendingPath, setPendingPath] = createSignal<string | null>(null);
  const [createSpaceOpen, setCreateSpaceOpen] = createSignal(false);

  // Docks are sized against the window, so the window is state. Tracked here rather than in each
  // module because the whole point of the arrangement is that a module never does viewport maths.
  const [viewport, setViewport] = createSignal({
    width: typeof window === 'undefined' ? 1440 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
  });
  if (typeof window !== 'undefined') {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
  }

  /** What the user has dragged each dock to, by dock id. Empty until somebody drags one. */
  const [dockSizes, setDockSizes] = createSignal<Record<string, number>>({});
  const [dockResizing, setDockResizing] = createSignal(false);
  /** The thickness a drag started from, so every move is measured against one fixed origin. */
  let resizeOrigin = 0;

  const dockRequests = createMemo<DockRequest[]>(() =>
    dockRegistry.ordered().map((entry) => ({
      id: entry.id,
      edge: (readModuleKey(entry.moduleId, entry.edge) as DockEdge) ?? null,
      size: (readModuleKey(entry.moduleId, entry.size) as DockSize) ?? 'md',
      float: Boolean(readModuleKey(entry.moduleId, entry.float)),
      resizedTo: dockSizes()[entry.id],
    })),
  );

  const [reservedEdges, setReservedEdges] = createSignal<ContentInset>({ left: 0, right: 0, top: 0, bottom: 0 });

  /** The window, less whatever else is already holding an edge. What every dock is measured against. */
  const region = createMemo(() => ({ ...viewport(), reserved: reservedEdges() }));

  const dockGeometry = createMemo(() =>
    Object.fromEntries(dockRequests().map((request) => [request.id, resolveDock(request, region())])),
  );

  const inset = createMemo(() => contentInset(dockRequests(), region()));

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
    dockGeometry,
    contentInset: inset,
    setReservedEdges: (next) => setReservedEdges((prev) => ({ ...prev, ...next })),
    dockResizing,

    beginDockResize: (id) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      resizeOrigin = dockThickness(request.edge, request.size, region(), request.resizedTo);
      setDockResizing(true);
    },

    /**
     * Turn a screen-space drag into a thickness.
     *
     * The sign lives here rather than in the handle because only the host knows which edge the panel
     * is on, and the answer inverts between edges: a right-hand panel's handle is on its *left*, so
     * dragging left — a negative delta — makes it wider. A handle that guessed would be wrong half
     * the time, which is why it reports raw screen movement and nothing else.
     */
    resizeDock: (id, delta) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      const grows = request.edge === 'right' || request.edge === 'bottom' ? -1 : 1;
      setDockSizes((prev) => ({ ...prev, [id]: Math.max(MIN_DOCK_PX, resizeOrigin + grows * delta) }));
    },

    endDockResize: () => setDockResizing(false),
  };

  return <ShellContext.Provider value={store}>{props.children}</ShellContext.Provider>;
}

export function useShellStore(): ShellStore {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShellStore must be used within ShellStoreProvider');
  return ctx;
}
