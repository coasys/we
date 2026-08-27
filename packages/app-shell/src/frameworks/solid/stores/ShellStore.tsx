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
  CHROME_RAIL_PX,
  type ContentInset,
  contentInset,
  displaces,
  type DockGeometry,
  type DockRequest,
  edgeOfSnap,
  fitPlacement,
  type FloatPlacement,
  insertionSlots,
  MIN_DOCK_PX,
  MIN_FLOAT_PX,
  NO_INSET,
  occupiedFor,
  railBand,
  type Rect,
  rectOf,
  type ResizeSide,
  resolveDock,
  RESTORE_DRAG_PX,
  seedPlacement,
  SIDEBAR_PX,
  snapCandidate,
  type SnapPoint,
  snapTargetRects,
  TITLE_BAR_PX,
  type TopChrome,
} from '@shared/dockGeometry';
import {
  DOCK_CONTENT_ATTR,
  DOCK_FRAME_ATTR,
  dockRegistry,
  hostDockStores,
  onDockRegistryChanged,
  registerHostDockStore,
  unregisterHostDockStore,
} from '@shared/registries/dockRegistry';
import { moduleStores } from '@shared/registries/moduleRegistry';
import { SHELL_DOCK_STORE_ID } from '@shared/registries/shellDocks';
import type { ChromeReserve, DockAspect, DockEdge, DockSize } from '@we/module-shared';
import {
  Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  ParentProps,
  useContext,
} from 'solid-js';

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
   * Report where the open overlay currently is, so a remount can put it back.
   *
   * Called by `ShellRouterRoot` as the overlay navigates. It lives up here rather than in
   * `ShellRouteStore` because that store — and the `MemoryRouter` it mirrors — are mounted *inside*
   * `TemplateLayout`, so both are torn down by anything that rebuilds the main route table. This
   * store is above the Router, which is what makes it the only place the answer survives.
   */
  rememberShellPath: (path: string) => void;
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
  /**
   * Whether the space-settings panel is open.
   *
   * Shell state for the same reason `createSpaceOpen` is: more than one control opens it — the
   * chrome rail's gear and the About view's pencil — so it cannot belong to either, and two
   * page-scoped flags could disagree about whether the one panel was up.
   */
  spaceSettingsOpen: Accessor<boolean>;
  /**
   * Where that panel would like to open, or null while it is closed — the key its dock names.
   *
   * `right` because that is the edge the rail's gear is on and the edge every other panel opens at.
   * An opening bid only: the user drags it wherever they want and the host remembers.
   */
  spaceSettingsEdge: Accessor<DockEdge | null>;
  /** Open or close the space-settings panel; the rail's gear toggles, the pencil opens. */
  toggleSpaceSettings: () => void;
  openSpaceSettings: () => void;
  closeSpaceSettings: () => void;
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
  /** True while a dock is being dragged, so transitions can be suspended and the edge track the cursor. */
  dockResizing: Accessor<boolean>;
  /**
   * Whether any panel is maximised — read by the app's own chrome, which hides while one is.
   *
   * Full screen means the whole window, so the sidebar and the module rail take themselves out of
   * the layout rather than sitting on top of the panel. The way back out is the panel's own titlebar
   * and the Escape key.
   */
  panelMaximised: Accessor<boolean>;
  /** Remember a dock's current size, so the drag that follows is measured from it. */
  beginDockResize: (id: string) => void;
  /**
   * Apply a resize drag: which side or corner is being pulled, and how far in screen pixels.
   *
   * Both axes arrive on every call because a corner moves both, and an edge ignores the one it does
   * not own — cheaper than two actions that would have to agree about one origin.
   */
  resizeDock: (id: string, side: ResizeSide, dx: number, dy: number) => void;
  endDockResize: () => void;
  /**
   * Shrink the panel to the shape its contents actually want, when the module says what that is.
   *
   * Resizing by hand overshoots: a 16:9 grid inside a box dragged to some other proportion leaves a
   * band of empty panel above or below the picture, and there is no way to feel your way back to
   * exactly right. The module publishes the aspect its content wants (`DockContribution.aspect`) and
   * this solves for the height, keeping the width the user chose.
   */
  fitDock: (id: string) => void;
  /**
   * Where each panel is parked, for the frame to read: its snap, and whether it displaces.
   *
   * Separate from `dockGeometry`, which is the resolved box. This is the *state* a position menu
   * ticks and a displace toggle reflects — a box cannot answer "which of the eight are you at",
   * because a snapped panel and one dropped in the same spot resolve identically.
   */
  dockPlacement: Accessor<Record<string, FloatPlacement & { canDisplace: boolean }>>;
  /**
   * Begin a move: remembers where the panel started, and where the pointer was when it began.
   *
   * The pointer matters for one case — a maximised panel, which has to shrink back under the cursor
   * rather than to wherever it was before. See `moveDock`.
   */
  beginDockMove: (id: string, pointerX: number, pointerY: number) => void;
  /** Apply a move, in pixels from where `beginDockMove` was called. */
  moveDock: (id: string, dx: number, dy: number) => void;
  /** Drop it: takes the snap it is hovering, or leaves it where it is if that is nowhere. */
  endDockMove: (id: string) => void;
  /** The panel being moved right now, or null — what mounts the snap targets. */
  movingDock: Accessor<string | null>;
  /** The snap the moving panel would take if dropped now, so that target can light up. */
  activeSnap: Accessor<SnapPoint | null>;
  /**
   * Every snap target's box, for the overlay that shows where a panel can land.
   *
   * Measured against the room left for the panel being dragged, exactly as the panel itself is. They
   * were drawn against the whole window while the panel was already clamped out of the occupied part,
   * so the right-hand markers sat over a docked notes panel — pointing at a place the video was, by
   * then, correctly refusing to go.
   */
  snapTargets: Accessor<{ id: SnapPoint; top: string; left: string; width: string; height: string }[]>;
  /**
   * Where a dragged panel would slot into a strip that already has panels in it.
   *
   * The other half of dropping: a snap target answers *which edge*, and these answer *where in the
   * queue already there* — the line every application draws between panels while one is over them.
   * Empty unless a panel is being dragged and a strip exists to join.
   */
  insertSlots: Accessor<
    { index: number; edge: string; top: string; left: string; width: string; height: string; hit: Rect }[]
  >;
  /** The slot a drop would take right now, as `<edge>:<index>`, or null. */
  activeInsert: Accessor<string | null>;
  /** Park a panel at one of the eight, from the position menu — the keyboard's way to move it. */
  snapDock: (id: string, snap: SnapPoint) => void;
  /**
   * Join a strip at a position, renumbering it — what a drop on a gap between panels does.
   *
   * The stacking order used to be the registry's, so a panel dragged out of a strip returned to the
   * slot it left however far along the edge it was dropped. This is the answer a drop can give.
   */
  insertDock: (id: string, edge: Exclude<DockEdge, null>, position: number) => void;
  /**
   * Cover the content region, or go back to being a card.
   *
   * The host's rather than the module's, because "how much room" is a layout question like position
   * and size. The call module carried it as one of six placements and was the only module that could
   * do it at all; every panel has it now, from its own titlebar, and nothing about where the panel
   * was is overwritten while it is on.
   */
  toggleMaximiseDock: (id: string) => void;
  /**
   * Push the content aside, or stop — the one control that decides whether a panel takes room.
   *
   * A toggle rather than a setter taking the value, unlike the house rule for switches, because the
   * caller is a menu item that reports only that it was clicked. The store holds the current answer
   * anyway, and a schema cannot read it at click time to invert it.
   */
  toggleDockDisplace: (id: string) => void;
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
  // A module's store, or the host's own for a dock the host contributed — the editor's panels are
  // docks and the editor is not a module. See `hostDockStores`.
  const store = (moduleStores[moduleId] ?? hostDockStores[moduleId]) as Record<string, unknown> | undefined;
  const value = store?.[key];
  return typeof value === 'function' ? (value as () => unknown)() : value;
}

/**
 * Where panels are remembered, and why it is localStorage rather than the URL.
 *
 * Position and size are preferences about somebody's own window: sending a link should not impose
 * where the sender happened to park their video. The same reasoning `$localState`'s `persist` tier
 * carries, applied to state the host owns rather than a template.
 *
 * A read that fails is not worth a broken boot — a corrupt or foreign value simply means nobody has
 * moved anything yet, and every panel falls back to its module's bid.
 */
const PLACEMENTS_KEY = 'we-local:shell.dockPlacements';

/**
 * What the frame takes off a panel before its content sees the box, measured off the two elements.
 *
 * The titlebar, its padding and border, and the frame's own border. This was a constant, and the
 * constant drifted by eleven pixels the day the titlebar gained padding to clear the panel's corner
 * radius. That sounds negligible and was not: "fit to content" shortens the panel by whatever it
 * thinks the chrome is, so understating it leaves the content short — and tiles that go
 * height-limited hand the difference back on the *other* axis, multiplied by their aspect ratio.
 * Three 16:9 videos across turned eleven missing pixels into a fifty-four pixel band down each side.
 *
 * `undefined` when the panel is not on screen — a fit invoked from a keyboard shortcut before the
 * frame mounts — and `fitPlacement` falls back to the constants, which are correct as of writing.
 */
function measureDockChrome(id: string): { x: number; y: number } | undefined {
  if (typeof document === 'undefined') return undefined;
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
  const frame = document.querySelector(`[${DOCK_FRAME_ATTR}="${escaped}"]`);
  const content = document.querySelector(`[${DOCK_CONTENT_ATTR}="${escaped}"]`);
  if (!frame || !content) return undefined;

  const outer = frame.getBoundingClientRect();
  const inner = content.getBoundingClientRect();
  // A panel mid-transition measures as something neither box ever is, and a negative or absurd
  // answer is worse than the constant it would replace.
  const x = outer.width - inner.width;
  const y = outer.height - inner.height;
  return x >= 0 && y >= 0 && x < outer.width && y < outer.height ? { x, y } : undefined;
}

function loadPlacements(): Record<string, FloatPlacement> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(PLACEMENTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, FloatPlacement>) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function savePlacements(placements: Record<string, FloatPlacement>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PLACEMENTS_KEY, JSON.stringify(placements));
  } catch {
    // A full or disabled store costs the user their layout next boot, and nothing else.
  }
}

export function ShellStoreProvider(props: ParentProps) {
  const [activeShellView, setActiveShellView] = createSignal<string | null>(initialShellView());
  const [pendingPath, setPendingPath] = createSignal<string | null>(null);
  /**
   * Where each shell view was last standing, so it can be put back after a remount.
   *
   * The overlay's `MemoryRouter` — and the store that mirrors it — both live *inside*
   * `TemplateLayout`, which is the main Router's root. So anything that rebuilds the main route
   * table takes the overlay down with it, and a `MemoryRouter` coming back up starts at `/`: you
   * were on a space's settings page and you are now on the account page, having asked for neither.
   *
   * A plain object rather than a signal: nothing renders from it, it is read once on mount, and
   * making it reactive would only invite an effect to depend on it.
   */
  const lastShellPath: Record<string, string> = {};
  const [createSpaceOpen, setCreateSpaceOpen] = createSignal(false);
  const [spaceSettingsOpen, setSpaceSettingsOpen] = createSignal(false);

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

  /**
   * Where each panel has been put, by dock id. Empty until somebody moves or resizes one.
   *
   * A preference about somebody's own window, so it persists per device and never travels in a
   * shared link — the same rule the sidebar's expanded state follows. Restored placements are
   * clamped into the viewport on resolve, so one saved on a monitor cannot leave a panel off-screen
   * on a laptop.
   */
  const [placements, setPlacements] = createSignal<Record<string, FloatPlacement>>(loadPlacements());
  const [dockResizing, setDockResizing] = createSignal(false);
  /**
   * Room taken by host chrome that is not a dock — the editor's rails and panels, today.
   *
   * Pushed in by the layout that can see both stores, rather than read from here: the editor is a
   * package this one knows nothing about, and its widths live in `editorStore`. One number in, and
   * every panel's geometry clears it.
   */
  const [movingDock, setMovingDock] = createSignal<string | null>(null);
  const [activeSnap, setActiveSnap] = createSignal<SnapPoint | null>(null);
  const [activeInsert, setActiveInsert] = createSignal<string | null>(null);
  /** The rect a drag started from, so every move is measured against one fixed origin. */
  let dragOrigin: FloatPlacement | null = null;
  /** Where the pointer was when it started, for restoring a maximised panel beneath it. */
  let dragPointer: { x: number; y: number } | null = null;

  /** How much of a target a dragged panel covers — the same measure `snapCandidate` ranks snaps by. */
  const overlapArea = (rect: Rect, box: Rect) => {
    const x = Math.max(0, Math.min(rect.x + rect.w, box.x + box.w) - Math.max(rect.x, box.x));
    const y = Math.max(0, Math.min(rect.y + rect.h, box.y + box.h) - Math.max(rect.y, box.y));
    return x * y;
  };

  const writePlacement = (id: string, next: FloatPlacement) => {
    setPlacements((prev) => {
      const merged = { ...prev, [id]: next };
      savePlacements(merged);
      return merged;
    });
  };

  /**
   * A placement with the box it currently *resolves* to, for a drag to measure from.
   *
   * A snapped panel stores no position at all — its x and y come from the snap on every frame — so a
   * drag that started from the stored values would jump to the origin as soon as it began.
   */
  const resolvedPlacement = (id: string, placement: FloatPlacement): FloatPlacement => ({
    ...placement,
    ...rectOf(dockGeometry()[id], viewport(), placement),
  });

  /** A panel's placement: what the user chose, or what the module's bid seeds it as. */
  const placementOf = (request: DockRequest): FloatPlacement =>
    placements()[request.id] ?? seedPlacement(request, viewport());

  /*
    A dependency on *registration itself*, so a store that arrives late is picked up.

    Without it the memo below can evaluate while `hostDockStores` is still empty, read no accessor,
    and therefore have nothing to re-run for — see the note in dockRegistry.ts. The counter is the
    dependency; nothing reads its value.
  */
  const [dockRegistryVersion, setDockRegistryVersion] = createSignal(0);
  onCleanup(onDockRegistryChanged(() => setDockRegistryVersion((v) => v + 1)));

  const dockRequests = createMemo<DockRequest[]>(() => {
    dockRegistryVersion();
    return dockRegistry.ordered().map((entry) => {
      const request: DockRequest = {
        id: entry.id,
        edge: (readModuleKey(entry.moduleId, entry.edge) as DockEdge) ?? null,
        size: (readModuleKey(entry.moduleId, entry.size) as DockSize) ?? 'md',
        float: Boolean(readModuleKey(entry.moduleId, entry.float)),
      };
      return { ...request, placement: placementOf(request) };
    });
  });

  /**
   * Chrome a floating panel must clear, live — see `DEFAULT_FLOAT_CHROME` for why floating and
   * displacing panels get different answers.
   *
   * The right edge is the module rail, always: it follows `--we-chrome-right`, which only a
   * displacing panel moves, so a floating one has to clear it itself.
   *
   * The horizontal edges are whatever the modules say they are holding there. It was the constant
   * `TOP_CHROME_PX`, sized for the call bar alone, and the call bar stopped being alone: the
   * transcribe module contributes an extraction status panel into the same fixed column, so the
   * band a panel had to clear grew and the number describing it did not. A panel snapped to that
   * corner landed under it.
   *
   * Both edges, because a module says which it is holding. The call bar is at the bottom — a panel
   * has a titlebar and no footer, so chrome along the top can cover the way out of one — but the
   * rule is the module's to state rather than this store's to assume.
   *
   * Declared rather than measured, deliberately. The status panel is a set of disclosures that grows
   * as rows are opened, and it goes to some trouble not to grow in steps — because, in its own
   * words, each step moves a floating object somebody is reading. A measured band would hand that
   * problem to the panel instead and shove it down the screen mid-read. So a module declares the
   * height of its chrome *collapsed*, the common case lands clear, and expanding a row may overlap
   * something the person expanding it can see.
   *
   * Reservations at an edge sum rather than max, because an anchor is a column: the status panel is
   * mounted below the call bar, not beside it.
   */
  const moduleChrome = createMemo<{ top: number; bottom: number; width: number }>(() => {
    // The registration dependency, for the same reason `dockRequests` takes it: a module store read
    // before its module registers has no accessor to have tracked, and so nothing to re-run for.
    dockRegistryVersion();
    let top = 0;
    let bottom = 0;
    let width = 0;
    for (const store of Object.values(moduleStores)) {
      const reserve = (store as Record<string, unknown> | undefined)?.chromeReserve;
      const value = typeof reserve === 'function' ? (reserve as () => unknown)() : reserve;
      const box = value as ChromeReserve | undefined;
      // Heights stack, widths do not: contributions to one anchor are a column.
      top += box?.top ?? 0;
      bottom += box?.bottom ?? 0;
      width = Math.max(width, box?.width ?? 0);
    }
    return { top, bottom, width };
  });

  /**
   * What the module rail has to dodge, which is only ever chrome at the *top*.
   *
   * The rail is a short column pinned at top-right, so chrome along the bottom is nowhere near it.
   * With the call bar down there this is zero in the ordinary case — kept rather than deleted
   * because the anchor is open: a module may still declare a top reserve, and the rail should still
   * move for it.
   */
  const topChrome = createMemo<TopChrome>(() => ({ height: moduleChrome().top, width: moduleChrome().width }));

  /**
   * How far down a maximised panel's titlebar reaches, or 0 when none is maximised.
   *
   * The one panel the rail has to be told about. Everything else is already out of its way by the
   * time `railBand` is asked — see its own note — but a maximised panel covers the whole window now,
   * and the rail is painted above it, so without this it lands on the position menu and the
   * un-maximise button: the two controls that panel is recovered with.
   *
   * `inset().top` rather than each panel's own `occupied`, and they are the same number here: a
   * maximised panel floats, so it contributes nothing to the inset it would be excluded from.
   */
  /*
    Escape leaves full screen.

    A maximised panel covers the whole window now, including the sidebar, so its own titlebar is the
    only way out. That is enough — the titlebar is always at the panel's top edge, and it carries the
    button — but "enough" is a poor standard for the one gesture that recovers the app, and every
    other full-screen surface on the machine answers to this key. It costs a listener.

    Only maximised panels, and only the maximised flag: Escape is understood as "leave the mode I am
    in", not "close what I am looking at". Closing a call panel with a stray keypress would be a
    different and much worse surprise.
  */
  if (typeof window !== 'undefined') {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const maximised = dockRequests().filter(
        (request) => request.edge && (request.size === 'full' || placementOf(request).maximised),
      );
      if (maximised.length === 0) return;
      event.preventDefault();
      for (const request of maximised) writePlacement(request.id, { ...placementOf(request), maximised: false });
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  }

  /**
   * Whether any panel is currently maximised — what the app's own chrome hides for.
   *
   * The sidebar and the module rail read this and take themselves out of the layout. Hiding rather
   * than restacking, because the two overlap for different reasons and only one of them is a
   * z-index: the sidebar is on the `chrome` layer and outranks every panel outright, while the rail
   * shares the panels' layer and wins on document order. One rule covers both, and neither has to
   * learn about the other's ordering.
   *
   * `display: none` rather than an unmount, so a rail that was expanded and had groups collapsed is
   * in the same state when full screen ends.
   */
  const panelMaximised = createMemo(() =>
    dockRequests().some((request) => request.edge && (request.size === 'full' || placementOf(request).maximised)),
  );

  const floatChrome = createMemo<ContentInset>(() => ({
    left: 0,
    right: CHROME_RAIL_PX,
    top: moduleChrome().top,
    bottom: moduleChrome().bottom,
  }));

  /**
   * What one panel has to keep clear of — the rule itself is in `dockGeometry`, pure and tested.
   *
   * Here it is only fed: the placements the panels currently have, and whatever non-dock chrome has
   * told this store it is holding.
   */
  const occupiedOf = (index: number, requests: DockRequest[]): ContentInset => occupiedFor(requests, index, viewport());

  /**
   * The same, by id — what the drag paths have, since a pointer knows which panel it has hold of and
   * not where that panel sits in the registry's order.
   */
  const occupiedForId = (id: string | null): ContentInset => {
    const requests = dockRequests();
    const index = requests.findIndex((request) => request.id === id);
    return index === -1 ? { ...NO_INSET } : occupiedOf(index, requests);
  };

  /**
   * Every dock's box, resolved against the room the others have left it.
   *
   * Resolved as a list rather than one at a time, because a panel's position depends on its
   * neighbours: two panels on the right are a column of panels, not two panels in the same place —
   * and a floating one has to clear both. The order is `dockRegistry.ordered()`, so it is the declared
   * `order` then the module id — stable, and never "whichever module registered first".
   */
  const dockGeometry = createMemo(() => {
    const requests = dockRequests();
    const resolved: Record<string, DockGeometry> = {};
    requests.forEach((request, index) => {
      resolved[request.id] = resolveDock(request, viewport(), occupiedOf(index, requests), floatChrome());
    });
    return resolved;
  });

  const inset = createMemo(() => contentInset(dockRequests(), viewport()));

  /**
   * Publish where the content's edges are, as CSS custom properties, so chrome can sit against the
   * *content* rather than the window.
   *
   * Anything pinned to a screen edge has to move when a dock takes that edge, and the things that
   * need to move — the module rail, the editor's floating toolbar, the call bar — live in three
   * different packages, none of which has any business importing this store. A custom property on
   * the root is the one channel all of them already share; `--we-sidebar-width` is set the same way
   * and for the same reason.
   *
   * ## Composed here, deliberately
   *
   * These used to be `--we-dock-<edge>`: the dock inset alone, leaving each consumer to add whatever
   * else held its edge. Nobody added the same list. The module rail summed the dock and a panel's
   * title band; the editing bar summed the dock and the rail's width and *forgot the vertical term
   * entirely*, so a panel docked along the top covered it; the call module's main bar composed the
   * sidebar into its centring while the two smaller bars beside it — the join prompt and the problem
   * alert — centred on the window and cleared nothing at all. Four consumers, four different sums,
   * three of them wrong, and each one wrong in a way that only shows in one arrangement.
   *
   * So the shell publishes the answer rather than the ingredients. `contentInset` and
   * `computeLeftOffset` in TemplateLayout are the same four numbers the content viewport is laid out
   * from — chrome now reads exactly what the content reads, which is what "sit beside the content"
   * should have meant all along. The one term that stays a consumer's own is `--we-chrome-rail-width`,
   * and it has to: the rail is chrome at that edge, so the rail must *not* clear itself while
   * everything outside it must.
   *
   * The left edge composes with the sidebar rather than replacing it — a left dock opens beside the
   * sidebar, not over it — and does so in CSS so `--we-sidebar-width` stays the only place that
   * width is decided.
   */
  createEffect(() => {
    if (typeof document === 'undefined') return;
    const edges = inset();
    const root = document.documentElement.style;
    root.setProperty('--we-chrome-left', `calc(var(--we-sidebar-width, ${SIDEBAR_PX}px) + ${edges.left}px)`);
    root.setProperty('--we-chrome-right', `${edges.right}px`);
    root.setProperty('--we-chrome-top', `${edges.top}px`);
    root.setProperty('--we-chrome-bottom', `${edges.bottom}px`);
    /*
      How far the content's centre has moved from the window's — the horizontal twin of the four
      above, for anything centred rather than pinned. Written as a calc over them rather than as a
      number so there is one subtraction in the codebase instead of one per centred bar.
    */
    root.setProperty('--we-chrome-center-x', 'calc((var(--we-chrome-left, 0px) - var(--we-chrome-right, 0px)) / 2)');
  });

  /**
   * The band a panel's own titlebar occupies at the top of the screen, for chrome to clear.
   *
   * The module rail is the case: it is pinned to the top-right and painted above the panels, so a
   * maximised panel — or one snapped along the top — had its position menu and its un-maximise button
   * underneath it. The panel cannot dodge the rail without giving up a column of width for chrome
   * that is a few hundred pixels tall, so the rail moves, which is what this is for and what the
   * right edge already does with `--we-chrome-right`.
   *
   * ## Only when something is actually under the rail
   *
   * This used to fire for *any* open panel, wherever it was. Starting a call opens the video panel,
   * so the rail dropped 98px the moment a call began — with the video floating in the bottom left,
   * nowhere near it, and nothing on screen to explain why the rail had moved. The band is real but
   * it is a collision, and a collision has a location.
   *
   * So it asks the resolved boxes instead. Since a floating panel now clears the rail on its own
   * (`floatChrome`) and a displacing one has already slid it aside, the answer is normally no — what
   * remains is a maximised panel, which spans the content region including the rail's column, and
   * which is the case the band was written for.
   *
   * ## Two things a naive overlap test gets wrong
   *
   * **A shared edge is not an overlap.** A panel docked on the right ends exactly where the rail
   * begins, so the two touch by definition — and the two numbers being compared come from different
   * places: the resolved box rounds its width to whole pixels and `contentInset` does not. So the
   * test flipped on the fractional part of a drag, and resizing a right-hand panel made the rail
   * flicker between its two positions once per pixel. Hence a tolerance rather than a strict
   * inequality: a couple of pixels of contact is two boxes meeting, not one covering the other.
   *
   * **The band is a distance, not a flag.** It was a constant, so a panel whose titlebar sat at the
   * very top pushed the rail down as far as one sitting below the call bar — which read as the rail
   * parking itself an arbitrary distance from the top with nothing in the gap. It is measured from
   * the panel now: far enough to clear that titlebar and no further, capped so a panel somewhere
   * unexpected can never push the rail off the screen.
   */
  createEffect(() => {
    if (typeof document === 'undefined') return;

    const band = railBand(viewport(), inset(), topChrome());
    document.documentElement.style.setProperty('--we-panel-chrome-top', `${band}px`);
  });

  /**
   * How long chrome should take to follow the dock — nothing, while it is being dragged.
   *
   * Anything animating its own position has to stop animating during a drag or it lags a third of a
   * second behind the cursor, which reads as the panel and the chrome disagreeing about where the
   * edge is. The content viewport reads `dockResizing` directly; the editor's toolbar cannot,
   * because it is in another package with no path to this store — so the same answer goes out as a
   * duration it can drop into its own `transition`.
   */
  createEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--we-chrome-transition', dockResizing() ? '0s' : '300ms');
  });

  const store: ShellStore = {
    activeShellView,
    openShellView: (id: string, path?: string) => {
      // An explicit path wins; otherwise the view reopens where it was last left, which is what a
      // person expects of somewhere they were half-way through configuring.
      setPendingPath(path ?? lastShellPath[id] ?? null);
      setActiveShellView(id);
    },
    closeShellView: () => setActiveShellView(null),
    createSpaceOpen,
    setCreateSpaceOpen,
    spaceSettingsOpen,
    spaceSettingsEdge: () => (spaceSettingsOpen() ? 'right' : null),
    toggleSpaceSettings: () => setSpaceSettingsOpen((open) => !open),
    openSpaceSettings: () => setSpaceSettingsOpen(true),
    closeSpaceSettings: () => setSpaceSettingsOpen(false),
    takePendingPath: () => {
      const path = pendingPath();
      setPendingPath(null);
      // Not cleared from `lastShellPath`: a remount asks again with nothing pending, and the answer
      // has to survive to be given.
      return path ?? lastShellPath[activeShellView() ?? ''] ?? null;
    },
    rememberShellPath: (path: string) => {
      const id = activeShellView();
      if (id) lastShellPath[id] = path;
    },
    scrollToId: (id: string) => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    dockGeometry,
    contentInset: inset,
    dockResizing,
    panelMaximised,

    dockPlacement: () =>
      Object.fromEntries(
        dockRequests().map((request) => {
          const placement = placementOf(request);
          /*
            `canDisplace` is derived here rather than recomputed in the frame, because a schema
            cannot ask "is this one of the four edges" — `$in` over a literal list would work but
            would restate a rule this file owns, and the two would drift the first time a snap was
            added. It is what greys the "push content aside" control out on a corner, where turning
            it on does nothing.
          */
          return [request.id, { ...placement, canDisplace: edgeOfSnap(placement.snap) !== null }];
        }),
      ),

    beginDockResize: (id) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      // The *resolved* rect, not the stored one: a snapped panel has no stored x/y, so a drag
      // measured from them would jump to the origin on the first frame. Same reason `beginDockMove`
      // reads the geometry.
      dragOrigin = resolvedPlacement(id, placementOf(request));
      setDockResizing(true);
    },

    /**
     * Turn a screen-space drag into a box.
     *
     * The edge being pulled is the one that moves, which sounds obvious and was not: the first
     * version changed `w` and `h` only, leaving the panel anchored at its stored top-left — so
     * dragging the left edge *leftwards* grew the panel to the right, and dragging the top edge up
     * grew it downwards. Every drag did the arithmetic correctly and looked backwards.
     *
     * So a left or top drag moves the origin by exactly what it takes off the size, pinning the
     * opposite edge and leaving the one under the pointer travelling with it. The floor applies to
     * the origin too, or a panel squashed past its minimum keeps sliding while its size stands still.
     *
     * A floating panel gives up its snap here. Its shape is something the user drew now rather than
     * something a corner implied, and a snap that survived would fight the next window resize by
     * pulling the panel back to a position they had just overridden. A *displacing* panel keeps its
     * snap and takes only a thickness — the edge it spans is the whole point of it.
     */
    resizeDock: (id, side, dx, dy) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge || !dragOrigin) return;

      const start = dragOrigin;
      const spanning = !dockGeometry()[id]?.floating;
      const min = spanning ? MIN_DOCK_PX : MIN_FLOAT_PX;
      const pulls = (edge: string) => side.includes(edge);

      let { x, y, w, h } = start;
      if (pulls('left')) {
        w = start.w - dx;
        x = start.x + dx;
      }
      if (pulls('right')) w = start.w + dx;
      if (pulls('top')) {
        h = start.h - dy;
        y = start.y + dy;
      }
      if (pulls('bottom')) h = start.h + dy;

      if (w < min) {
        if (pulls('left')) x = start.x + (start.w - min);
        w = min;
      }
      if (h < min) {
        if (pulls('top')) y = start.y + (start.h - min);
        h = min;
      }

      /*
        A spanning panel writes its *thickness*; a floating one writes the card.

        They shared `w`/`h` at first, so resizing a docked panel wrote the thickness over the card's
        width — and dragging it back out produced a full-height column instead of the card it had
        been. The two are different sizes of the same panel and each has to survive the other.
      */
      /*
        Written onto the *stored* placement, not onto the box the drag was measured from.

        `start` is the resolved rect, and for a spanning panel that is the full height of its edge —
        so spreading it stamped that height over the card, and the next drag carried a screen-tall bar
        around that covered every insertion line at once and reached the bottom edge's targets on its
        way to the left one. The measurement comes from the resolved box; only the one number the
        drag actually changed is kept.
      */
      const stored = placementOf(request);
      writePlacement(
        id,
        spanning
          ? { ...stored, thickness: edgeOfSnap(stored.snap) === 'left' || edgeOfSnap(stored.snap) === 'right' ? w : h }
          : { ...stored, snap: null, x, y, w, h },
      );
    },

    endDockResize: () => {
      dragOrigin = null;
      setDockResizing(false);
    },

    fitDock: (id) => {
      const entry = dockRegistry.get(id);
      const request = dockRequests().find((item) => item.id === id);
      if (!entry || !request?.edge) return;
      const aspect = readModuleKey(entry.moduleId, entry.aspect) as DockAspect | undefined;
      if (!aspect) return;

      // Measured from the resolved rect, because that is the panel you are looking at — a docked one
      // stores a thickness and a card, and only the box on screen says which is currently the shape.
      const measured = resolvedPlacement(id, placementOf(request));
      const spanning = !dockGeometry()[id]?.floating;
      const fitted = fitPlacement(measured, aspect, {
        spanning,
        edge: edgeOfSnap(measured.snap),
        chrome: measureDockChrome(id),
      });
      // Measured from the box on screen, written onto the stored placement — so fitting a docked panel
      // sets its thickness without stamping the edge's full height over the card it returns to.
      const stored = placementOf(request);
      writePlacement(
        id,
        spanning ? { ...stored, thickness: fitted.thickness } : { ...stored, w: fitted.w, h: fitted.h },
      );
    },

    beginDockMove: (id, pointerX, pointerY) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      dragOrigin = resolvedPlacement(id, placementOf(request));
      dragPointer = { x: pointerX, y: pointerY };
      setMovingDock(id);
      setDockResizing(true);
    },

    moveDock: (id, dx, dy) => {
      if (!dragOrigin || !dragPointer || movingDock() !== id) return;

      /*
        Dragging the titlebar of an attached panel — maximised, or displacing — restores the card,
        under the cursor.

        It did nothing at all before: the grip emitted moves, this wrote a position, and `resolveDock`
        ignored it because `maximised` short-circuits ahead of the placement. The panel looked stuck
        to the drag rather than unavailable to it, which is worse — and the button became the only way
        out of a state every window manager lets you drag out of.

        Not on the press, on the *movement*: a click on the titlebar must not restore, or the
        double-click below would restore the panel and then re-maximise it and appear to do nothing.
        Past the threshold the panel takes back its remembered card — which survives both states now
        that a dock writes its own thickness — and lands so the pointer keeps the same fraction along
        the titlebar it grabbed. Snapping the panel's centre to the cursor instead reads as a sideways
        jump when the grab was near an end.

        Both attached states are handled together because they are one gesture: pulling a panel off
        whatever it was stuck to. Only maximised did this at first, so undocking dragged a full-width
        panel around by its corner.
      */
      /*
        The panel's *stored* placement, or the seed — never `dragOrigin`, which is the resolved box.

        `dragOrigin` is where the panel is on screen, which for a docked one is the full height of the
        edge it spans. Falling back to it meant a panel nobody had moved yet "restored" to that full
        height and was then dragged around as a screen-tall bar: it covered every insertion line on a
        strip at once, so only the outermost could ever win, and it reached the bottom edge's targets
        while being carried to the left one.

        `placementOf` answers with the card instead, which is the size the panel should take the moment
        it leaves its edge.
      */
      const request = dockRequests().find((entry) => entry.id === id);
      const placement = request ? placementOf(request) : dragOrigin;
      const attached = placement.maximised || displaces(placement, viewport());
      if (attached) {
        if (Math.abs(dx) + Math.abs(dy) < RESTORE_DRAG_PX) return;
        const fraction = dragOrigin.w > 0 ? (dragPointer.x - dragOrigin.x) / dragOrigin.w : 0.5;
        dragOrigin = {
          ...placement,
          maximised: false,
          displace: false,
          snap: null,
          x: dragPointer.x - fraction * placement.w,
          y: dragPointer.y - TITLE_BAR_PX / 2,
          w: placement.w,
          h: placement.h,
        };
      }

      const next = { ...dragOrigin, snap: null, displace: false, x: dragOrigin.x + dx, y: dragOrigin.y + dy };

      /*
        A strip's gaps win over the edge target behind them.

        Both can be under the panel at once — the gaps run along the very edge the snap target sits
        on — and they mean different things: the target says "take this edge", a gap says "join this
        queue, here". The more specific answer is the one the user is pointing at, so it takes
        precedence and the edge target goes dark while it does.
      */
      /*
        The slot it covers *most*, not the first one it touches.

        A dragged panel is wide enough to be over two lines at once — the gap between two panels and
        the edge beyond them — and taking the first in the array meant always taking the outermost, so
        the only reachable answer on a populated strip was "outside everything". Same rule as
        `snapCandidate`, and for the same reason.
      */
      const slot = store
        .insertSlots()
        .map((candidate) => ({ candidate, area: overlapArea(next, candidate.hit) }))
        .filter((entry) => entry.area > 0)
        .sort((a, b) => b.area - a.area)[0]?.candidate;
      setActiveInsert(slot ? `${slot.edge}:${slot.index}` : null);
      setActiveSnap(slot ? null : snapCandidate(next, viewport(), occupiedForId(id), floatChrome()));
      writePlacement(id, next);
    },

    /**
     * Land it.
     *
     * Three outcomes, in order of how specific the thing under the panel is. A gap in a strip joins
     * that strip *at that position*. A snap zone takes that snap, so the panel aligns itself. Anything
     * else keeps the free position it already has.
     *
     * Displacing is deliberately not restored by the second or third of those, even if the panel was
     * displacing before the drag: pulling a panel off its edge is the gesture for "stop taking room",
     * and re-attaching it silently would make the drag look like it had failed.
     */
    endDockMove: (id) => {
      const insert = activeInsert();
      const snap = activeSnap();
      const current = placements()[id] ?? dragOrigin;

      if (dragOrigin && current && insert) {
        const [edge, position] = insert.split(':');
        store.insertDock(id, edge as Exclude<DockEdge, null>, Number(position));
      } else if (dragOrigin && current && snap) {
        writePlacement(id, { ...current, snap, displace: false });
      }

      dragOrigin = null;
      dragPointer = null;
      setMovingDock(null);
      setActiveSnap(null);
      setActiveInsert(null);
      setDockResizing(false);
    },

    /**
     * Put a panel into a strip at a given position, and renumber the strip around it.
     *
     * Sequential integers rather than fractions between neighbours: a strip is short, rewriting it is
     * cheap, and fractional indices eventually need a renumber anyway — at which point somebody has
     * to write this function regardless.
     *
     * The panel keeps whatever thickness it had. Its card size is untouched too, so pulling it back
     * out returns it to the shape it was before it ever joined.
     */
    insertDock: (id, edge, position) => {
      const requests = dockRequests();
      const request = requests.find((entry) => entry.id === id);
      if (!request?.edge) return;

      const strip = requests
        .filter((entry) => entry.id !== id && entry.edge && !dockGeometry()[entry.id]?.floating)
        .filter((entry) => edgeOfSnap(placementOf(entry).snap) === edge)
        .sort((a, b) => (placementOf(a).order ?? 0) - (placementOf(b).order ?? 0));

      const ids = strip.map((entry) => entry.id);
      ids.splice(Math.max(0, Math.min(position, ids.length)), 0, id);

      ids.forEach((entryId, order) => {
        const entry = requests.find((candidate) => candidate.id === entryId);
        if (!entry) return;
        const placement = placementOf(entry);
        writePlacement(entryId, {
          ...placement,
          order,
          ...(entryId === id ? { snap: edge, displace: true, maximised: false } : {}),
        });
      });
    },

    movingDock,
    activeSnap,

    /**
     * The eight places a panel can land, as boxes to draw.
     *
     * Sized as a fraction of the region rather than as the panel being dragged: a target the size of
     * the panel would be invisible for a small one and would cover the screen for a large one, and
     * what it has to communicate is *where*, not *how big*.
     */
    /**
     * The gaps in every strip a dragged panel could join, as boxes to draw.
     *
     * Built from the panels' *resolved* boxes, so a strip narrowed by the editor's rails or by
     * anything else already spoken for reports the gaps it really has. The panel being dragged is left
     * out of its own strip, or it would offer to be inserted either side of where it currently is.
     */
    insertSlots: () => {
      const moving = movingDock();
      if (!moving) return [];
      const boxes = dockGeometry();

      return (['left', 'right', 'top', 'bottom'] as const).flatMap((edge) => {
        /*
          Measured in a region that still contains the strip being described.

          `occupiedForId` answers "what must this panel keep clear of", which excludes every docked
          panel — including the ones these lines are *about*. Computed in that region, all of a
          strip's boundaries fall outside it and clamp to the same spot: three lines drawn on top of
          one another at the strip's inner edge, which is precisely the one place you cannot drop.

          So the panels on *this* edge are added back, and everything else — other edges, and chrome
          like the editor's rails — stays subtracted, because that space really is unavailable.
        */
        const occupied = { ...occupiedForId(moving) };
        occupied[edge] = 0;
        const inStrip = dockRequests()
          .filter((request) => request.id !== moving && request.edge && !dockGeometry()[request.id]?.floating)
          .filter((request) => edgeOfSnap(placementOf(request).snap) === edge)
          .map((request) => rectOf(boxes[request.id], viewport(), placementOf(request)));

        // An empty edge still offers its one slot — that is how a strip gets started. It used to
        // return nothing here, so an edge with no panels on it could only ever be *floated* against.
        return insertionSlots(edge, inStrip, viewport(), occupied).map((slot) => ({
          index: slot.index,
          edge,
          // The line, not the target: the frame draws what these describe, and the hit box it is
          // measured against stays here. Drawing the target put a 10px bar a dozen pixels off the
          // boundary it was describing.
          top: `${slot.line.y}px`,
          left: `${slot.line.x}px`,
          width: `${slot.line.w}px`,
          height: `${slot.line.h}px`,
          hit: slot.hit,
        }));
      });
    },

    activeInsert,

    snapTargets: () =>
      snapTargetRects(viewport(), occupiedForId(movingDock()), floatChrome()).map((target) => ({
        id: target.id,
        top: `${target.y}px`,
        left: `${target.x}px`,
        width: `${target.w}px`,
        height: `${target.h}px`,
      })),

    toggleMaximiseDock: (id) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      const placement = placementOf(request);
      writePlacement(id, { ...placement, maximised: !placement.maximised });
    },

    snapDock: (id, snap) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      const placement = placementOf(request);
      // A panel that was displacing keeps displacing when moved to another edge, and gives it up on
      // a corner, where the idea has no meaning. See the rule in dockGeometry.
      const stays = placement.displace && edgeOfSnap(snap) !== null;
      writePlacement(id, { ...placement, snap, displace: stays });
    },

    toggleDockDisplace: (id) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      const placement = placementOf(request);
      // Refused rather than hidden on a corner: the control stays in the menu wherever the panel is,
      // and declines the one arrangement it cannot honour. See `displaces` in dockGeometry.
      if (!placement.displace && edgeOfSnap(placement.snap) === null) return;
      writePlacement(id, { ...placement, displace: !placement.displace });
    },
  };

  /*
    This store publishes a dock of its own — the space-settings panel — so it has to be findable by
    the same lookup a module's store is. See `hostDockStores`, and `EditorStore` doing the same.

    Safe despite this being the store that *resolves* docks: `dockRequests` reads the accessor and
    the accessor writes nothing, so the dependency runs one way. It matters that the registration is
    here, after `store` exists and after `onDockRegistryChanged` is subscribed above — announcing
    into a listener that has not been added yet would leave the memo with nothing to re-run for,
    which is the failure the registry's own docblock describes.
  */
  registerHostDockStore(SHELL_DOCK_STORE_ID, store as unknown as Record<string, unknown>);
  onCleanup(() => unregisterHostDockStore(SHELL_DOCK_STORE_ID));

  return <ShellContext.Provider value={store}>{props.children}</ShellContext.Provider>;
}

export function useShellStore(): ShellStore {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShellStore must be used within ShellStoreProvider');
  return ctx;
}
