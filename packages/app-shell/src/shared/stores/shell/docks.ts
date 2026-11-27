/**
 * The docks: what each registered panel asks for and where it is placed, every panel's resolved box,
 * the lanes at the window's edges, what the content gives up and what is covered, and the actions
 * that rearrange panels without a drag — snap, fold, put a lane away, reveal, full screen, put every
 * panel away. The arithmetic is `dockGeometry.ts`; this reads the registry, the window and the
 * arrangement, and hands their values to it. Part of `ShellStore` — see `../ShellStore.ts`.
 */
import { dockIsOffered } from '@shared/dockGating';
import {
  arrangeDrop,
  arrangeHomeDrop,
  type ContentInset,
  contentInset,
  coveredInset,
  type DockMin,
  type DockRequest,
  type DockTab,
  dockThickness,
  edgeLaneLayout,
  edgeOfSnap,
  fitPlacement,
  type FloatPlacement,
  followSeat,
  laneable,
  laneSectionsOf,
  NO_INSET,
  occupiedById,
  panelFramesOf,
  placementFromDeclaration,
  railBand,
  type Rect,
  rectOf,
  resolveDocks,
  seatLanes,
  seatSize,
  seedPlacement,
  SIDEBAR_PX,
  stackCandidates,
  TITLE_BAR_PX,
  type TopChrome,
  unlaned,
  withChromeCovered,
} from '@shared/dockGeometry';
import {
  DOCK_CONTENT_ATTR,
  DOCK_FRAME_ATTR,
  dockRegistry,
  dockTitle,
  hostChromeReserves,
  hostDockStores,
  isFramed,
  onDockRegistryChanged,
} from '@shared/registries/dockRegistry';
import { homeLanes } from '@shared/registries/homeLanes';
import { moduleRegistry, moduleStores } from '@shared/registries/moduleRegistry';
import { templatePanelDockId } from '@shared/registries/templatePanels';
import { type ChromeReserve, type DockAspect, type DockEdge, type DockSize } from '@we/module-shared';
import { type ReactivityPort } from '@we/reactivity';

import { distinctSignal } from '../../distinctSignal';
import { type ShellHostState, type ShellStore } from '../ShellStore';
import { type ShellArrangement } from './arrangement';
import { type ShellViews } from './views';

/**
 * Read one of a dock's declared store keys.
 *
 * A store publishes accessors, so the value has to be *called* — and reading it inside a memo is
 * what makes dock geometry track a panel opening, moving or resizing with no subscription wiring
 * between the module and the shell. Which store: the entry's own plumbing where the registry built
 * one (every module panel), else the module's store, else the host's own for a dock the host
 * contributed — the editor's panels are docks and the editor is not a module. See `DockEntry.store`
 * and `hostDockStores`. A key the store does not have resolves to undefined and falls back, because a
 * dock whose module is absent must render nothing rather than throw at boot.
 */
function readDockKey(entry: { moduleId: string; store?: Record<string, unknown> }, key: string | undefined): unknown {
  if (!key) return undefined;
  const store = (entry.store ?? moduleStores[entry.moduleId] ?? hostDockStores[entry.moduleId]) as
    Record<string, unknown> | undefined;
  const value = store?.[key];
  return typeof value === 'function' ? (value as () => unknown)() : value;
}

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

export function createShellDocks(deps: {
  reactivity: ReactivityPort;
  host: Pick<ShellHostState, 'appFrame' | 'appEdgeFrames' | 'laneFrames'>;
  views: ShellViews;
  arrangement: ShellArrangement;
}) {
  const { reactivity } = deps;
  const { signal, memo, effect, untrack, onCleanup } = reactivity;
  const { appFrame, appEdgeFrames, laneFrames } = deps.host;
  const { activeShellView, setActiveShellView } = deps.views;
  const {
    activation,
    declarationFor,
    declaredPanels,
    dockIdFor,
    instancesHere,
    placementKey,
    placements,
    raise,
    sectionDockId,
    writePlacement,
  } = deps.arrangement;
  // Docks are sized against the window, so the window is state. Tracked here rather than in each
  // module because the whole point of the arrangement is that a module never does viewport maths.
  const [viewportSize, setViewport] = signal({
    width: typeof window === 'undefined' ? 1440 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
  });
  if (typeof window !== 'undefined') {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
  }
  /*
    The window, as every geometry memo here reads it — and the app's frame with it, since every
    function in `dockGeometry` measures against that too. Reading it here is what makes them all
    follow an app template that changes its chrome, without each memo having to know.
  */
  const viewport = () => {
    appFrame();
    return viewportSize();
  };
  /**
   * The panel that has just joined or left a seat — see `settling` on `DockGeometry`.
   *
   * Cleared on the next frame rather than by a timer: what it has to outlast is exactly one geometry
   * recompute, so the panel lands in its new box with no transition and eases normally from there.
   */
  const [settling, setSettling] = distinctSignal(reactivity, '');
  const landInPlace = (id: string) => {
    setSettling(id);
    if (typeof requestAnimationFrame === 'function')
      requestAnimationFrame(() => {
        if (untrack(settling) === id) setSettling('');
      });
    else setSettling('');
  };

  /**
   * The tab that has just arrived at the front of its stack, while it flashes — see
   * `DockGeometry.landedTab`.
   *
   * Lit two frames after it is asked for, and cleared by a timer. The delay is what lets the flash
   * fade *in*: a drop or a raise rebuilds the strip (a new member, a new front), and a tab row that
   * mounts already lit has nothing to transition from. The timer is for a person to notice — long
   * enough to be seen — and the fade out is the strip's own transition, a theme animation token, so a
   * reduced-motion setting still decides.
   */
  const [landedTab, setLandedTab] = distinctSignal(reactivity, '');
  let landedTimer: ReturnType<typeof setTimeout> | undefined;
  let landedFlash = 0;
  const flashTab = (id: string) => {
    if (landedTimer !== undefined) clearTimeout(landedTimer);
    const flash = ++landedFlash;
    const light = () => {
      if (flash !== landedFlash) return;
      setLandedTab(id);
      landedTimer = setTimeout(() => {
        landedTimer = undefined;
        if (untrack(landedTab) === id) setLandedTab('');
      }, 1800);
    };
    if (typeof requestAnimationFrame !== 'function') return light();
    requestAnimationFrame(() => requestAnimationFrame(light));
  };
  onCleanup(() => {
    if (landedTimer !== undefined) clearTimeout(landedTimer);
  });

  /**
   * Every panel put away — on purpose (`panelsHidden`), or because a shell overlay is up.
   *
   * An overlay is drawn inside the content region with every panel layered above it, so a settings page
   * opened from a space came up squeezed between that space's sidebars with its floating cards over the
   * top — reading as part of the workshop rather than as somewhere else. Opening one is already the end
   * of template editing; it is now the end of the panels being on screen, until it closes.
   */
  const [panelsHiddenByUser, setPanelsHiddenByUser] = distinctSignal(reactivity, false);
  const panelsAway = memo(() => panelsHiddenByUser() || activeShellView() !== null);

  /**
   * Where the panels are in going away or coming back — so they fade rather than vanish.
   *
   * `leaving` fades them out on screen and `away` hides them, the way a closing lane does; `arriving`
   * holds them at zero for the two frames a fade needs something painted to start from. A quick toggle
   * back mid-fade reverses from wherever the fade had got to. Starts `away` rather than fading out, for
   * the boot that opens on the landing page.
   */
  const [awayPhase, setAwayPhase] = distinctSignal<'shown' | 'leaving' | 'away' | 'arriving'>(
    reactivity,
    panelsAway() ? 'away' : 'shown',
  );
  let awayTimer: ReturnType<typeof setTimeout> | undefined;
  let wasAway = untrack(panelsAway);
  effect(() => {
    const away = panelsAway();
    if (away === wasAway) return;
    wasAway = away;
    if (awayTimer !== undefined) clearTimeout(awayTimer);
    if (away) {
      setAwayPhase('leaving');
      awayTimer = setTimeout(() => {
        awayTimer = undefined;
        if (untrack(awayPhase) === 'leaving') setAwayPhase('away');
      }, 340);
      return;
    }
    setAwayPhase('arriving');
    const show = () => {
      if (untrack(awayPhase) === 'arriving') setAwayPhase('shown');
    };
    if (typeof requestAnimationFrame !== 'function') return show();
    requestAnimationFrame(() => requestAnimationFrame(show));
  });
  onCleanup(() => {
    if (awayTimer !== undefined) clearTimeout(awayTimer);
  });

  /**
   * The lane a resize drag has pulled past `STOW_DRAG_PX`, which letting go will collapse — by the id
   * of the panel being dragged. Null otherwise. See `resizeDock`.
   */
  const [stowPending, setStowPending] = distinctSignal<string | null>(reactivity, null);
  /**
   * Room taken by host chrome that is not a dock — the editor's rails and panels, today.
   *
   * Pushed in by the layout that can see both stores, rather than read from here: the editor is a
   * package this one knows nothing about, and its widths live in `editorStore`. One number in, and
   * every panel's geometry clears it.
   */
  const [movingDock, setMovingDock] = distinctSignal<string | null>(reactivity, null);
  /**
   * What a tab drag is carrying, since the panel itself stays in its seat. Null for every other
   * gesture and between drags. See `previewDrop`.
   *
   * A rect rather than the CSS the outline is drawn from, because it answers a second question: the
   * drop targets are offered against what is being carried, and asking that in pixel strings would
   * mean parsing them back. `dragGhost` derives the CSS from it, so the outline on screen and the
   * box the targets are measured against cannot drift apart.
   */
  const [dragCarry, setDragCarry] = signal<{ box: Rect; title: string } | null>(null);
  /** The seat-mates of the panel being dragged, which land wherever it does. See `beginDockMove`. */
  /**
   * The panels sharing a seat with the one being dragged — reactive, because they travel with it.
   *
   * A stack IS carried, the same as a single panel: writing the leader a position is what moves it,
   * and the mates ride along hidden rather than being left standing in a lane the leader has gone
   * from. `seatOrigins` is what they are put back to when a drag ends nowhere they can all land.
   */
  const [movingSeat, setMovingSeat] = signal<string[]>([]);
  /**
   * What the stack in the air is called, while it is in the air.
   *
   * A loose seat names itself (see `FloatPlacement.seat`), and the panel being dragged is the obvious
   * name: unique, already to hand, and stable for as long as the stack holds together. Every member
   * carries it from the first frame of the drag, which is what keeps the tab strip on screen while
   * the stack crosses open space rather than emptying the titlebar the moment its lane is left.
   */
  const movingSeatKey = () => movingDock() ?? '';
  /**
   * The middle of a seated panel, as the target for stacking behind it.
   *
   * Inset by a quarter on every side: well clear of the seams either side of the seat, which are
   * `columnSlots`' targets, so the two never fight over the same pixels. Big enough to land on
   * without aiming; small enough that a drag across a lane does not light every seat it passes.
   */
  /**
   * The floating panels a dragged one could stack onto, in a fixed order.
   *
   * Two panels in open space had no way to become a stack: every drop target is built per edge, out
   * of the lanes on it, and a float is in no lane. Now that a seat can exist off the lanes there is
   * somewhere for such a drop to land, so this is the list of places — one per panel you can point
   * at, which is why the ones stacked *behind* another are left out. There is only ever one card on
   * top to aim for, and it is the one that answers for its seat.
   *
   * Ordered by the registry, and derived here rather than at either call site, because the slot and
   * the drop have to agree on what "the third one" means — the same reason the edge slots are keyed
   * by position rather than by a panel's id, which cannot go in a key that splits on colons.
   */
  const stackTargets = (moving: string | null) => {
    const requests = dockRequests();
    return stackCandidates(requests, laneSeating().hidden, moving).map((index) => ({
      request: requests[index],
      index,
    }));
  };
  /**
   * Fold or unfold a panel and every tab stacked with it.
   *
   * A fold belongs to the seat because the titlebar does: there is one bar, and it folds. Written per
   * panel, bringing a background tab forward would unfold the seat under the pointer — the tab was
   * never told — and on a top or bottom edge an unfolded tab behind a folded one would hold the
   * lane's thickness open, since a lane there is as thick as its tallest open member.
   */
  const setSeatFolded = (id: string, folded: boolean) => {
    const seat = dockGeometry()[id]?.tabs ?? [];
    const members = seat.length > 1 ? seat.map((tab) => tab.id) : [id];
    for (const memberId of members) {
      const member = dockRequests().find((entry) => entry.id === memberId);
      if (member) writePlacement(memberId, { ...placementOf(member), collapsed: folded });
    }
  };

  /**
   * A lane easing in or out of its strip — which way, and for which panels.
   *
   * **Opening**, the panels hold their contents at the size the frame is heading for, and fade them
   * in: `faded` is true until the contents have been painted once at zero, which takes two frames
   * rather than `settling`'s one, since the box was hidden until now.
   *
   * **Closing**, they stay on screen while the frame shrinks onto the strip, holding their contents at
   * the size they had (`sizes`) and fading them out, and only then are hidden. Without it a lane
   * vanished on the press and the strip appeared where it had been.
   *
   * Held past the frame's 300 transition in both directions: opening, so a theme with slower animation
   * does not let the contents go and squeeze in the last stretch; closing, for the same reason with the
   * opposite cost, which is why it is held for less — a closed frame lingering at the strip's size sits
   * over the strip's names.
   */
  const [laneMove, setLaneMove] = signal<{
    ids: readonly string[];
    closing: boolean;
    faded: boolean;
    sizes: Record<string, { width?: string; height?: string }>;
  } | null>(null);
  let laneMoveTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (laneMoveTimer !== undefined) clearTimeout(laneMoveTimer);
  });
  const beginLaneMove = (ids: readonly string[], closing: boolean) => {
    // The size each is drawn at now — held while it shrinks onto the strip. See `boxOnScreen`.
    const sizes = Object.fromEntries(
      ids.map((id) => {
        const request = dockRequests().find((entry) => entry.id === id);
        if (!request) return [id, {}];
        const box = boxOnScreen(id, placementOf(request));
        return [id, { width: `${Math.round(box.w)}px`, height: `${Math.round(box.h)}px` }];
      }),
    );
    const move = { ids, closing, faded: true, sizes };
    setLaneMove(move);
    if (laneMoveTimer !== undefined) clearTimeout(laneMoveTimer);
    laneMoveTimer = setTimeout(
      () => {
        laneMoveTimer = undefined;
        if (untrack(laneMove)?.ids === ids) setLaneMove(null);
      },
      closing ? 340 : 700,
    );
    if (closing) return;
    const unfade = () => {
      const was = untrack(laneMove);
      if (was?.ids === ids) setLaneMove({ ...was, faded: false });
    };
    if (typeof requestAnimationFrame !== 'function') return unfade();
    requestAnimationFrame(() => requestAnimationFrame(unfade));
  };

  /** Collapse every panel of a lane to its strip, or bring them all back. See `toggleStowLane`. */
  const setLaneStowed = (ids: readonly string[], on: boolean) => {
    // Before the write, so a close captures the sizes the panels have open.
    beginLaneMove(ids, on);
    for (const memberId of ids) {
      const member = dockRequests().find((entry) => entry.id === memberId);
      if (!member) continue;
      const { stowed: _stowed, ...rest } = placementOf(member);
      // Dropped rather than written false when opening, so an open lane's placement reads as it did
      // before stowing existed.
      writePlacement(memberId, on ? { ...rest, stowed: true } : rest);
    }
  };

  /**
   * A placement with the box it currently *resolves* to, for a drag to measure from.
   *
   * A snapped panel stores no position at all — its x and y come from the snap on every frame — so a
   * drag that started from the stored values would jump to the origin as soon as it began.
   */
  /**
   * A panel's box as it is drawn — the one answer every drop target, drag origin and divider reads.
   *
   * In a lane (an edge's, or a template's) the lane lays its panels out, so the box is the frame
   * measured on screen; anywhere else the engine places the frame, and its box is the engine's. One
   * question, asked the same way of every place, is the whole of the drop model: a lane offers what
   * it actually shows. Where nothing is laid out — off screen, or a test without a layout — the
   * engine's box stands in, which matches the lane's by construction (`laneBase`).
   */
  const boxOnScreen = (id: string, placement: FloatPlacement): Rect => {
    const box = dockGeometry()[id];
    if ((box?.inLane || box?.home) && typeof document !== 'undefined') {
      const frame = document.querySelector(`[${DOCK_FRAME_ATTR}="${CSS.escape(id)}"]`);
      const drawn = frame?.getBoundingClientRect();
      if (drawn && drawn.width > 0 && drawn.height > 0)
        return { x: drawn.x, y: drawn.y, w: drawn.width, h: drawn.height };
    }
    return rectOf(box, viewport(), placement);
  };

  const resolvedPlacement = (id: string, placement: FloatPlacement): FloatPlacement => ({
    ...placement,
    ...boxOnScreen(id, placement),
  });

  /**
   * A panel's placement, in three rungs: what the user last dragged it to, then what the interface
   * asked for, then the module's own opening bid.
   *
   * The middle rung is resolved live and never written — so switching template or view is
   * non-destructive, switching back restores what was there, and an author improving a layout is not
   * overruled forever by one stray drag. The same shape `meta.themeId` follows for themes.
   */
  const placementOf = (request: DockRequest): FloatPlacement => {
    const stored = placements()[placementKey(request.id)];
    /*
      A lane holds only what the interface declared for one — the rule a drop into a lane has always
      kept (\`insertHome\`). A placement in a lane for any other panel is not honoured: it came from
      stacking onto a section, which skipped that rule, and it outlives every template, since an
      undeclared panel's placement is not scoped to one — so the call's stage, stacked into an
      inspector's lane, followed its owner into every space and froze each on its next call (a lane
      grows to fit what is in it, and the stage sizes itself to the box it is in). Read as no
      placement, it goes back to its own bid.
    */
    if (stored && !(stored.snap === 'home' && !declarationFor()[request.id]?.home)) return stored;
    const declared = declarationFor()[request.id];
    if (declared) return placementFromDeclaration(declared, viewport());
    return seedPlacement(request, viewport());
  };
  /*
    A dependency on *registration itself*, so a store that arrives late is picked up.

    Without it the memo below can evaluate while `hostDockStores` is still empty, read no accessor,
    and therefore have nothing to re-run for — see the note in dockRegistry.ts. The counter is the
    dependency; nothing reads its value.
  */
  const [dockRegistryVersion, setDockRegistryVersion] = signal(0);
  onCleanup(onDockRegistryChanged(() => setDockRegistryVersion(untrack(dockRegistryVersion) + 1)));
  /**
   * Whether a module's chrome renders here at all — injected, because only `SpaceStore` knows.
   *
   * ## What this fixes
   *
   * A module dock's *frame* is gated by `gateOnSpace`, so it unmounts in a space that has not
   * enabled the module. Its **request** was not, so `contentInset` went on reserving 200–500px for
   * a panel that was no longer on screen. Open notes or transcribe displacing in space A, walk into
   * space B: the frame goes, the room it took does not, and the close button is inside the frame
   * that went. A reload was the only way out.
   *
   * The same predicate as the frame's, so the two cannot disagree — including the `holds` key
   * escape hatch, which is how a call keeps its bar in a space that never enabled calls.
   *
   * Defaults to "everything is active", so a host that never injects behaves exactly as before.
   */
  const [moduleGate, setModuleGate] = signal<(moduleId: string) => boolean>(() => true);
  const dockRequests = memo<DockRequest[]>(() => {
    dockRegistryVersion();
    return (
      dockRegistry
        .ordered()
        // Only *module* chrome is gated on the space — host chrome (the settings panel, the editor's
        // four) registers docks under a store id that is not a module id, and the gate has no true
        // answer for those. See `dockIsOffered`, which is where that decision lives and is tested.
        .filter((entry) => dockIsOffered(entry.moduleId, (id) => Boolean(moduleRegistry.get(id)), moduleGate()))
        .map((entry) => {
          const request: DockRequest = {
            id: entry.id,
            edge: (readDockKey(entry, entry.edge) as DockEdge) ?? null,
            size: (readDockKey(entry, entry.size) as DockSize) ?? 'md',
            float: Boolean(readDockKey(entry, entry.float)),
            min: readDockKey(entry, entry.min) as DockMin | undefined,
          };
          /*
            A seat-mate of the panel being dragged has left its lane along with the leader.

            Derived rather than written: while the drag is live the mate is drawn nowhere and its
            real placement is untouched, so a drop that lands nowhere leaves nothing to undo. Saying
            it here rather than in the geometry is what takes it out of `edgeGroups` — otherwise its
            old lane keeps its width open around nothing, and offers its own band lines and seams as
            somewhere to drop the very stack that just left it.
          */
          const placement = placementOf(request);
          const travelling = movingSeat().includes(entry.id);
          return {
            ...request,
            placement: travelling ? { ...placement, snap: null, displace: false, seat: movingSeatKey() } : placement,
          };
        })
    );
  });

  /*
    A panel that comes open comes to the front of its seat — the settings opened from a gear, a panel
    a template opens, a module's panel opening itself. What `openTemplatePanel` already did for a
    template's own panel, for every panel: opened on purpose is wanted in sight, not behind a tab.
  */
  // Undefined until the first run, which only records: what was open on arrival was not *opened*,
  // and raising all of it would reshuffle the stacking somebody left on every reload.
  let wasOpen: Set<string> | undefined;
  effect(() => {
    const open = new Set(
      dockRequests()
        .filter((request) => request.edge)
        .map((request) => request.id),
    );
    const before = wasOpen;
    if (before) untrack(() => open.forEach((id) => before.has(id) || raise(id)));
    wasOpen = open;
  });

  /*
    A module-owned panel can re-ask to be seen — "go to the call" pressed while the stage is already
    open. `revealDock` is what "seen" means here, since open-but-out-of-sight is exactly folded,
    stowed or tab-behind: the flag already did its work, and the counter is the event.
  */
  // As `wasOpen`, the first run records rather than acts: a call joined before the layout mounted
  // gets its raise from the edge appearing above, not a second one from the counter's first read.
  const wasAsked = new Map<string, unknown>();
  effect(() => {
    for (const request of dockRequests()) {
      const ask = moduleRegistry.panel(request.id)?.revealRequest;
      if (!ask) continue;
      const value = ask();
      const before = wasAsked.has(request.id) ? wasAsked.get(request.id) : value;
      wasAsked.set(request.id, value);
      if (value !== before && request.edge) untrack(() => members.revealDock(request.id));
    }
    for (const id of [...wasAsked.keys()]) {
      if (!dockRequests().some((request) => request.id === id)) wasAsked.delete(id);
    }
  });

  const laneSections = memo(() =>
    laneSectionsOf({
      requests: dockRequests(),
      homes: Object.fromEntries(Object.entries(declarationFor()).map(([id, declared]) => [id, declared.home])),
      declared: declaredPanels()
        .map((panel) => dockIdFor(panel))
        .filter((id): id is string => id !== null),
      instances: Object.fromEntries(
        Object.values(instancesHere()).map((instance) => [
          instance.id,
          { of: templatePanelDockId(instance.panel), opened: instance.opened },
        ]),
      ),
    }),
  );

  /** How recently each dock was touched, by dock id — activation is kept by placement key. */
  const touchedById = memo(() => {
    const touched = activation();
    return Object.fromEntries(dockRequests().map((request) => [request.id, touched[placementKey(request.id)]]));
  });
  /** What each dock's tab says. */
  const dockTitles = memo(() =>
    Object.fromEntries(
      dockRequests().map((request) => {
        const entry = dockRegistry.get(request.id);
        return [request.id, entry ? dockTitle(entry) : request.id];
      }),
    ),
  );

  /**
   * Chrome a floating panel must clear, live — see `DEFAULT_FLOAT_CHROME` for why floating and
   * displacing panels get different answers.
   *
   * The right edge is the module rail, always: it follows `--we-chrome-right`, which only a
   * displacing panel moves, so a floating one has to clear it itself.
   *
   * The horizontal edges are whatever the modules say they are holding there. It was the constant
   * `TOP_CHROME_PX`, sized for the call bar alone, and the call bar stopped being alone: the
   * transcribe module contributes an interpretation status panel into the same fixed column, so the
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
  const sumReserves = (reserves: (ChromeReserve | undefined)[]) => {
    let top = 0;
    let bottom = 0;
    let width = 0;
    for (const box of reserves) {
      // Heights stack, widths do not: contributions to one anchor are a column.
      top += box?.top ?? 0;
      bottom += box?.bottom ?? 0;
      width = Math.max(width, box?.width ?? 0);
    }
    return { top, bottom, width };
  };
  /** What the modules alone are holding — the chrome on the `chrome` layer, painted over panels. */
  const moduleReserves = memo<{ top: number; bottom: number; width: number }>(() => {
    // The registration dependency, for the same reason `dockRequests` takes it: a module store read
    // before its module registers has no accessor to have tracked, and so nothing to re-run for.
    dockRegistryVersion();
    // Declared: a module names the key its reserve is published under (`contributes.reserve`),
    // rather than the shell scanning every store for a member of a magic name.
    return sumReserves(
      moduleRegistry.all().map(({ definition, store }) => {
        const key = definition.contributes?.reserve;
        if (!key || !store) return undefined;
        const reserve = (store as Record<string, unknown>)[key];
        return (typeof reserve === 'function' ? (reserve as () => unknown)() : reserve) as ChromeReserve | undefined;
      }),
    );
  });
  const moduleChrome = memo<{ top: number; bottom: number; width: number }>(() =>
    /*
      And the chrome that is not a module's — a shell template's pinned nav strip, say.

      Summed here rather than in a second place for the reason the four `--we-chrome-*` properties
      are composed here: `DEFAULT_FLOAT_CHROME` was a constant sized for the call bar, the call bar
      stopped being alone, and a panel snapped to that corner landed under whatever had joined it.
      A template pinning its own bar is the same failure with a different author.
    */
    sumReserves([moduleReserves(), ...Object.values(hostChromeReserves)]),
  );

  /**
   * What the module rail has to dodge, which is only ever chrome at the *top*.
   *
   * The rail is a short column pinned at top-right, so chrome along the bottom is nowhere near it.
   * With the call bar down there this is zero in the ordinary case — kept rather than deleted
   * because the anchor is open: a module may still declare a top reserve, and the rail should still
   * move for it.
   */
  const topChrome = memo<TopChrome>(() => ({ height: moduleChrome().top, width: moduleChrome().width }));

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
      /*
        Cmd/Ctrl+\ puts every panel away, or brings them back — Figma's key for hiding the interface,
        and one no text field here claims. Not while an overlay is up: the panels are away already, and
        a toggle flipped where nobody can see it would surprise the next time they came back.
      */
      if (event.key === '\\' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.defaultPrevented) {
        if (activeShellView()) return;
        event.preventDefault();
        setPanelsHiddenByUser(!untrack(panelsHiddenByUser));
        return;
      }
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // A maximised panel that is away is not the mode Escape would be leaving.
      if (panelsAway()) return;
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
  const panelMaximised = memo(
    () =>
      // A maximised panel put away with the rest is not covering anything, and the sidebar and rail that
      // hide for one would otherwise go with it — taking the way back to the panels along too.
      !panelsAway() &&
      dockRequests().some((request) => request.edge && (request.size === 'full' || placementOf(request).maximised)),
  );

  const floatChrome = memo<ContentInset>(() => ({
    left: 0,
    right: appFrame().right,
    top: moduleChrome().top,
    bottom: moduleChrome().bottom,
  }));

  /*
    What a full-screen panel pads its content by: only chrome painted *over* it.

    `floatChrome` also carries the template's own reserve — a workshop's route and call pills — which
    a card has to clear because the template's header is on screen beside it. A full-screen panel
    covers that header, so reserving its band left an empty strip across the top of the panel for
    chrome that was underneath. The modules' bars are on the `chrome` layer and stay over the panel;
    they are what is left, and the call bar's is zero whenever no call is up.
  */
  const fullScreenChrome = memo<ContentInset>(() => ({
    left: 0,
    right: 0,
    top: moduleReserves().top,
    bottom: moduleReserves().bottom,
  }));

  /**
   * The same, by id — what the drag paths have, since a pointer knows which panel it has hold of and
   * not where that panel sits in the registry's order.
   *
   * ## A tab being dragged out is asked about as the card it is becoming
   *
   * `occupiedFor` exempts a displacing panel from its own lane and everything inboard of it, which is
   * right for a panel that is *staying*: it is holding that edge, so stepping around itself would
   * walk it off the screen one width per frame.
   *
   * A panel being dragged has left, and every other gesture says so before this is asked —
   * `moveDock` restores a docked panel to a card at the drag threshold, which writes a placement with
   * no snap. A **tab** drag deliberately writes nothing: the tab cannot leave its seat without taking
   * the strip and the pointer capture with it. So the tab kept the exemption, its lane counted as
   * nothing, and the floating snap markers on that edge — top-left, left, bottom-left for a stack
   * docked on the left — were measured against a content region that still included the stack, and
   * drawn on top of it rather than beside it.
   *
   * Only for a seat with tabs, because only a tab is dragged this way: several panels sharing that
   * edge one above the other are each dragged by their own titlebar, and are restored to cards first.
   */
  const occupiedForId = (id: string | null): ContentInset =>
    occupiedById(dockRequests(), id, viewport(), Boolean(dragCarry()));

  /**
   * Every dock's box, resolved against the room the others have left it.
   *
   * Resolved as a list rather than one at a time, because a panel's position depends on its
   * neighbours: two panels on the right are a column of panels, not two panels in the same place —
   * and a floating one has to clear both. The order is `dockRegistry.ordered()`, so it is the declared
   * `order` then the module id — stable, and never "whichever module registered first".
   */
  /**
   * Where each floating panel sits when it shares its edge with others, by dock id.
   *
   * Worked out per edge rather than per panel, because a seat depends on the neighbours — how many
   * there are, how tall each asked to be, which of them wants the slack. `resolveDock` is about one
   * panel and cannot see that, so the answer is computed here and handed to it, exactly as
   * `occupied` already is.
   *
   * Every floating panel clears the same things (`occupiedFor` only ever counts panels that
   * *displace*, and a float is not one), so one member's `occupied` serves the whole column.
   */
  /**
   * Every lane's division, in one walk: where each panel sits, who it shares a boundary with, and
   * which way its lane runs.
   *
   * One memo rather than three because all of it comes from the same grouping, and three walks that
   * could disagree about which lane a panel is in would disagree about where its divider goes — a
   * grip drawn at a seam the layout does not have.
   *
   * A lane of one is skipped entirely. It has no boundaries to draw and no division to make, so its
   * panel keeps the position it has always had: a card at its snap, or a displacing panel spanning
   * its whole edge. That is what makes lanes free for every arrangement that predates them.
   */
  /**
   * The last strip handed to each seat's front panel, so an unchanged one keeps its identity.
   *
   * `$each` renders with Solid's `<For>`, which is keyed by reference: a fresh array of fresh
   * objects every time the geometry recomputes means every tab button is destroyed and rebuilt. The
   * geometry recomputes on every frame of a drag and on every raise, so that is both a needless
   * churn and — when it happens between a press and its release — a click that never fires.
   */
  let lastStrips: Record<string, DockTab[]> = {};
  const stableStrip = (key: string, strip: DockTab[]) => {
    const previous = lastStrips[key];
    const same =
      previous?.length === strip.length &&
      previous.every(
        (tab, i) => tab.id === strip[i].id && tab.title === strip[i].title && tab.active === strip[i].active,
      );
    if (!same) lastStrips[key] = strip;
    return lastStrips[key];
  };

  /** Every lane's division and which tab of each seat shows — see `seatLanes`. */
  const laneSeating = memo(() =>
    seatLanes({
      requests: dockRequests(),
      viewport: viewport(),
      chrome: floatChrome(),
      touched: touchedById(),
      titles: dockTitles(),
    }),
  );

  const dockGeometry = memo(() => {
    const resolved = resolveDocks({
      requests: dockRequests(),
      seating: laneSeating(),
      viewport: viewport(),
      chrome: floatChrome(),
      fullScreenChrome: fullScreenChrome(),
      touched: touchedById(),
      titles: dockTitles(),
      settling: settling(),
      landedTab: landedTab(),
      laneMove: laneMove(),
      stowPending: stowPending(),
      away: awayPhase(),
      sections: laneSections(),
      fixed: Object.fromEntries(
        Object.entries(declarationFor()).map(([id, declared]) => [id, Boolean(declared.fixed)]),
      ),
      framed: Object.fromEntries(dockRequests().map((request) => [request.id, isFramed(request.id)])),
    });
    // An unchanged strip keeps its identity, so its tab buttons are not rebuilt — see `stableStrip`.
    for (const [id, box] of Object.entries(resolved))
      if (box.tabs?.length) resolved[id] = { ...box, tabs: stableStrip(id, box.tabs) };
    return resolved;
  });

  // Nothing taken while the panels are away: the overlay or the content gets the whole region, and
  // gets it back the moment they return, before they fade in.
  const inset = memo(() => (panelsAway() ? { ...NO_INSET } : contentInset(dockRequests(), viewport())));

  /*
    The lanes the host draws at the window's edges — every lane pushing the content aside, its
    thickness (the same number the inset sums) and its seats, each with its share of the lane worked
    out as `columnLayout` works it out, for flex to hand out. See `EdgeLanes`.
  */
  const edgeLanes = memo(() => edgeLaneLayout(dockRequests(), viewport(), floatChrome(), touchedById()));
  /*
    The same requests, asked the other question: not what the panels take, but what they hide.

    Its own memo rather than a second return from `contentInset`, because the two walks disagree
    about arithmetic — a strip of displacing panels sums and a column of floating ones takes the
    maximum — and a function answering both would have to explain which number it was returning.
  */
  //
  // And the chrome floating over the content — the call bar above all — which stays while the panels
  // are away, so a composer pinned to the bottom of a view can rise above it and settle when it goes.
  const covered = memo(() =>
    withChromeCovered(panelsAway() ? { ...NO_INSET } : coveredInset(dockRequests(), viewport()), moduleChrome()),
  );

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
   * The shell publishes the answer rather than the ingredients: a dock inset alone leaves each
   * consumer to add whatever else holds its edge, and each consumer then sums a different list. `contentInset` and
   * `computeLeftOffset` in TemplateLayout are the same four numbers the content viewport is laid out
   * from — chrome reads exactly what the content reads. The one term that stays a consumer's own is `--we-chrome-rail-width`,
   * and it has to: the rail is chrome at that edge, so the rail must *not* clear itself while
   * everything outside it must.
   *
   * The left edge composes with the sidebar rather than replacing it — a left dock opens beside the
   * sidebar, not over it — and does so in CSS so `--we-sidebar-width` stays the only place that
   * width is decided.
   */
  /*
    What is covered, published the same way — `--we-covered-<edge>`, the CSS face of `coveredInset`.

    A space's template cannot read the store member, which is chrome's, but it can pad by a variable:
    a composer pinned to the bottom of a view writes `pb: 'calc(var(--we-space-500) +
    var(--we-covered-bottom, 0px))'` and rises above the call bar while one is up. Geometry it is
    drawn into, not anything it can move.
  */
  effect(() => {
    if (typeof document === 'undefined') return;
    const edges = covered();
    const root = document.documentElement.style;
    for (const edge of ['top', 'right', 'bottom', 'left'] as const)
      root.setProperty(`--we-covered-${edge}`, `${edges[edge]}px`);
  });

  effect(() => {
    if (typeof document === 'undefined') return;
    /*
      Full screen has no content edges but the window's. The sidebar hides and every other panel is
      eclipsed (see `dockGeometry`), so chrome still painted over the panel — the call bar — centres
      on the window rather than on a content box nobody can see.
    */
    const fullScreen = panelMaximised();
    const edges = fullScreen ? { ...NO_INSET } : inset();
    const root = document.documentElement.style;
    root.setProperty(
      '--we-chrome-left',
      fullScreen ? '0px' : `calc(var(--we-sidebar-width, ${SIDEBAR_PX}px) + ${edges.left}px)`,
    );
    root.setProperty('--we-chrome-right', `${edges.right}px`);
    // The app's own top and bottom bands are chrome too, so anything clearing the edges clears them.
    root.setProperty('--we-chrome-top', `${edges.top + (fullScreen ? 0 : appFrame().top)}px`);
    root.setProperty('--we-chrome-bottom', `${edges.bottom + (fullScreen ? 0 : appFrame().bottom)}px`);
    /*
      How far the content's centre has moved from the window's — the horizontal twin of the four
      above, for anything centred rather than pinned. Written as a calc over them rather than as a
      number so there is one subtraction in the codebase instead of one per centred bar.
    */
    root.setProperty('--we-chrome-center-x', 'calc((var(--we-chrome-left, 0px) - var(--we-chrome-right, 0px)) / 2)');
    /*
      Which way centred chrome spills when the content is narrower than it is.

      A bar centred on the content and wider than it overhangs both sides equally, and the half that
      crosses the sidebar leaves the window — which is what happened to the call controls whenever a
      panel took enough of the right. The bars clamp to the content's edge now (a flex strip with
      `justify-content: safe center`, which centres while the child fits and pins it to the strip's
      start when it does not), so the only question left is which end is the start: a bar that
      cannot fit has to cover *something*, and the least bad thing is the dock that squeezed it —
      a panel's controls are all in its titlebar, so an overlap along its bottom covers content
      rather than the way out. The sidebar is never the answer, being navigation and 80px wide.

      Published as the `flex-direction` the strip should use, because that is the one property CSS
      can switch a start edge with — a keyword like `left` would leave every consumer needing a
      comparison CSS cannot make. The strip has a single child, so reversing it reorders nothing.
      Ties go right, which is where panels open by default.
    */
    root.setProperty('--we-chrome-give', edges.left > edges.right ? 'row-reverse' : 'row');
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
   * Not for *any* open panel, wherever it is: the band is a collision, and a collision has a
   * location. So it asks the resolved boxes. Since a floating panel now clears the rail on its own
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
  effect(() => {
    if (typeof document === 'undefined') return;

    const band = railBand(viewport(), inset(), topChrome());
    document.documentElement.style.setProperty('--we-panel-chrome-top', `${band}px`);
  });

  const members: Pick<
    ShellStore,
    | 'provideModuleGate'
    | 'dockGeometry'
    | 'contentInset'
    | 'coveredInset'
    | 'panelMaximised'
    | 'dockPlacement'
    | 'fitDock'
    | 'insertDock'
    | 'laneSections'
    | 'edgeLanes'
    | 'setSectionGrow'
    | 'panelFrames'
    | 'panelsHidden'
    | 'togglePanelsHidden'
    | 'hasPanels'
    | 'layoutPinned'
    | 'snapDock'
    | 'breakOut'
    | 'returnHome'
    | 'stackDock'
    | 'insertHome'
    | 'toggleCollapseDock'
    | 'toggleStowLane'
    | 'revealDock'
    | 'toggleDockDisplace'
  > = {
    provideModuleGate: setModuleGate,
    dockGeometry,
    contentInset: inset,
    coveredInset: covered,
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
          return [
            request.id,
            {
              ...placement,
              canDisplace: edgeOfSnap(placement.snap) !== null,
              // Answered by the geometry, which knows whether the panel has lane-mates.
              canCollapse: dockGeometry()[request.id]?.canCollapse ?? false,
            },
          ];
        }),
      ),

    fitDock: (id) => {
      const entry = dockRegistry.get(id);
      const request = dockRequests().find((item) => item.id === id);
      if (!entry || !request?.edge) return;
      const aspect = readDockKey(entry, entry.aspect) as DockAspect | undefined;
      if (!aspect) return;

      // Measured from the resolved rect, because that is the panel you are looking at — a docked one
      // stores a thickness and a card, and only the box on screen says which is currently the shape.
      const measured = resolvedPlacement(id, placementOf(request));
      const spanning = !dockGeometry()[id]?.floating;
      const edge = edgeOfSnap(measured.snap);
      const fitted = fitPlacement(measured, aspect, {
        spanning,
        edge,
        chrome: measureDockChrome(id),
        /*
          The most a fit may take, so one that cannot be honoured declines rather than writing a
          number the paint step then clamps.

          `lg` rather than `full`: the largest size a dock is ever *asked* for, viewport-aware
          already, and computed by the same function that answers every other thickness question.
          Bounding at the whole region is barely a bound — on a 4K side edge it still allowed one
          16:9 tile to take 92% of the screen.
        */
        maxThickness: edge ? dockThickness(edge, 'lg', viewport(), undefined, occupiedForId(id)) : undefined,
      });
      // Measured from the box on screen, written onto the stored placement — so fitting a docked panel
      // sets its thickness without stamping the edge's full height over the card it returns to.
      const stored = placementOf(request);
      writePlacement(
        id,
        spanning
          ? { ...stored, thicknessX: fitted.thicknessX, thicknessY: fitted.thicknessY }
          : { ...stored, w: fitted.w, h: fitted.h },
      );
    },

    /**
     * Put a panel somewhere on an edge, and renumber whatever it landed among.
     *
     * The two axes of an edge, as two modes:
     *
     * - **`band`** — a lane of its own, at `position` counting inward from the edge. Every displacing
     *   lane on that edge is renumbered around it, so `band` afterwards means the same thing for all
     *   of them. This is the old strip drop, said in the coordinate that now owns it.
     * - **`lane`** — a seat in the lane named by `lane`, at `position` along it. `'float'` is the
     *   floating lane, a number is that many lanes in from the edge. The lane's members are
     *   renumbered by `order`, and the newcomer takes the lane's `band` so it shares the band's width
     *   rather than opening one of its own.
     *
     * Sequential integers rather than fractions between neighbours: an edge is short, rewriting it is
     * cheap, and fractional indices eventually need a renumber anyway — at which point somebody has
     * to write this function regardless.
     *
     * ## Joining an unnamed lane names it
     *
     * A lane nobody has arranged has no `band`, because absent means "a lane of my own" and that is
     * what keeps every arrangement predating lanes working. The moment a second panel joins it, that
     * stops being true of either of them — so the whole edge is renumbered and both come out with the
     * band they now share. Nothing else is a stable way to say "these two", since the alternative is
     * an implied identity that changes the next time a module registers.
     *
     * The panel keeps whatever thickness it had. Its card size is untouched too, so pulling it back
     * out returns it to the shape it was before it ever joined.
     */
    insertDock: (id, edge, position, mode = 'band', lane) => {
      const requests = dockRequests();
      const moving = requests.findIndex((entry) => entry.id === id);
      if (moving === -1 || !requests[moving].edge) return;

      // The arrangement itself is `arrangeDrop`, pure and tested; this only writes what it decides.
      // The same list `insertSlots` numbered its offers against, so the lane a slot named is the lane
      // that gets joined.
      const arranged = arrangeDrop(laneable(requests, viewport()), moving, { edge, mode, position, lane }, viewport());
      /*
        Which lane the panel landed in, so the one it joins opens. A lane is stowed when every member
        is, so a panel arriving open beside stowed mates would leave the lane open around members
        still flagged away — and the moment it left again, the lane would snap shut behind it.
      */
      const joinedBand = arranged.find((entry) => entry.index === moving)?.band;

      for (const { index, band, order, tab } of arranged) {
        const entry = requests[index];
        if (!entry) continue;
        // Dropped, not set to a number: absent is the floating lane's answer, and a stale band left
        // on a panel that has stopped displacing would claim a lane the next time it does. The same
        // for a tab: a seat of one names none.
        const { band: _previousBand, tab: _previousTab, stowed, ...rest } = placementOf(entry);
        writePlacement(entry.id, {
          ...rest,
          // The panel being placed arrives open, and so does the lane it joins; every other lane on the
          // edge keeps whether it was put away.
          ...(stowed && index !== moving && (band === undefined || band !== joinedBand) ? { stowed } : {}),
          ...(band !== undefined ? { band } : {}),
          order,
          ...(tab !== undefined ? { tab } : {}),
          ...(index === moving ? { snap: edge, displace: band !== undefined, maximised: false } : {}),
        });
      }
      // Landing in a seat is touching it: the newcomer shows, which is what dropping something on
      // top of something else looks like everywhere.
      raise(id);
      // And says so. The frame did not move — a stack took the drop in the box it already had — so
      // the only change on screen is which tab is lit, and that is easy to miss without a flash.
      if (mode === 'tab') flashTab(id);

      /*
        And it takes the seat's size — see `seatSize`. Read back from the geometry rather than from
        the drop that was asked for, so this is the seat the panel actually landed in.
      */
      const joined = (dockGeometry()[id]?.tabs ?? []).map((tab) => tab.id).find((other) => other !== id);
      const held = joined ? dockRequests().find((entry) => entry.id === joined) : undefined;
      const joiner = held ? dockRequests().find((entry) => entry.id === id) : undefined;
      if (held && joiner) writePlacement(id, seatSize(placementOf(joiner), placementOf(held)));
    },

    laneSections,
    edgeLanes,
    setSectionGrow: (grows) => {
      for (const [id, grow] of Object.entries(grows)) {
        const request = dockRequests().find((entry) => entry.id === id);
        if (request && placementOf(request).snap === 'home')
          writePlacement(id, { ...placementOf(request), grow: Math.max(0, grow) });
      }
    },
    panelFrames: memo(() =>
      panelFramesOf({
        geometry: dockGeometry(),
        edges: appEdgeFrames(),
        requests: dockRequests().map((request) => ({ ...request, placement: placementOf(request) })),
        laneFrames: laneFrames(),
        declared: Object.fromEntries(Object.entries(declarationFor()).map(([id, declared]) => [id, declared.frame])),
      }),
    ),
    panelsHidden: panelsHiddenByUser,
    togglePanelsHidden: () => {
      // Not while an overlay is up — see the keyboard shortcut, which says why.
      if (activeShellView()) return;
      setPanelsHiddenByUser(!untrack(panelsHiddenByUser));
    },
    hasPanels: memo(() => dockRequests().some((request) => request.edge && placementOf(request).snap !== 'home')),

    layoutPinned: () =>
      Object.fromEntries(
        dockRequests().map((request) => [
          request.id,
          Boolean(placements()[placementKey(request.id)]) && Boolean(declarationFor()[request.id]),
        ]),
      ),

    snapDock: (id, snap) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      const placement = placementOf(request);
      // A panel that was displacing keeps displacing when moved to another edge, and gives it up on
      // a corner, where the idea has no meaning. See the rule in dockGeometry.
      const stays = placement.displace && edgeOfSnap(snap) !== null;
      // Parking one panel in a corner takes it off every lane, so its lane coordinates go with it —
      // `seat` above all, which would otherwise fuse this card into a stack it is not part of. A panel
      // sent to another edge leaves its strip too: it arrives as itself, not as a strip of one.
      const { stowed: _stowed, ...onEdge } = placement;
      writePlacement(id, edgeOfSnap(snap) ? { ...onEdge, snap, displace: stays } : unlaned(placement, snap));
    },

    breakOut: (panelId, x, y) => {
      const id = sectionDockId(panelId);
      const request = dockRequests().find((entry) => entry.id === id);
      const declared = declarationFor()[id];
      if (!request?.edge || declared?.fixed) return;
      const placement = placementOf(request);
      /*
        Under the pointer, or at the declared snap.

        Press-and-drag hands the section over mid-gesture, so it appears where the hand is — the
        titlebar under the pointer, which is where a drag holds a panel. A click has no pointer to
        follow and goes to the snap the declaration named, or the corner every picture-in-picture has
        trained people to look for.
      */
      const away =
        x !== undefined && y !== undefined
          ? { snap: null, x: x - placement.w / 2, y: y - TITLE_BAR_PX / 2 }
          : { snap: declared?.snap ?? 'bottom-right' };
      writePlacement(id, { ...placement, ...away, displace: false, maximised: false, collapsed: false });
      raise(id);
    },

    returnHome: (panelId) => {
      const id = sectionDockId(panelId);
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      const placement = placementOf(request);
      const home = placement.home ?? declarationFor()[id]?.home;
      if (!home) return;
      writePlacement(id, { ...placement, snap: 'home', home, displace: false, maximised: false, collapsed: false });
    },

    stackDock: (id, position) => {
      const target = stackTargets(id)[position];
      const joiner = dockRequests().find((entry) => entry.id === id);
      if (!target || !joiner) return;

      /*
        Two floats become a stack, which needs a name for the seat they are now both in — see
        `FloatPlacement.seat`. Whichever was already there supplies it: it is the one the other was
        dropped onto, so naming the seat after it survives the newcomer being dragged out again.

        A seat it is already in keeps its key, so a third panel joins the stack rather than pairing
        off with whichever tab happened to be showing.
      */
      const held = placementOf(target.request);
      const seat = held.seat ?? target.request.id;
      if (held.seat === undefined) writePlacement(target.request.id, { ...held, seat });
      writePlacement(id, followSeat(placementOf(joiner), { ...held, seat }));
      // The newcomer shows, which is what dropping something on top of something else looks like —
      // and its tab flashes, since the card it landed on did not move. See `insertDock`.
      raise(id);
      flashTab(id);
    },

    insertHome: (id, lane, position) => {
      const requests = dockRequests();
      const moving = requests.findIndex((entry) => entry.id === id);
      if (moving === -1 || !requests[moving].edge) return;
      const outlet = homeLanes().find((entry) => entry.lane === lane);
      const panelId = id.replace(/^template:/, '');
      // Only a template's own sections, and only into a lane that takes them — the same refusal a
      // `we-drop-zone` makes, and for the same reason: a lane says what it holds.
      if (!declarationFor()[id] || (outlet && outlet.accepts.length > 0 && !outlet.accepts.includes(panelId))) return;

      for (const { index, order } of arrangeHomeDrop(laneable(requests, viewport()), moving, lane, position)) {
        const entry = requests[index];
        if (!entry) continue;
        const placement = placementOf(entry);
        writePlacement(entry.id, {
          ...placement,
          order,
          ...(index === moving
            ? { snap: 'home', home: lane, displace: false, maximised: false, collapsed: false }
            : {}),
        });
      }
    },

    toggleCollapseDock: (id) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge || !dockGeometry()[id]?.canCollapse) return;
      setSeatFolded(id, !placementOf(request).collapsed);
    },

    toggleStowLane: (id) => {
      const geometry = dockGeometry()[id];
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge || !geometry) return;
      // Stowed panels resolve with an empty `laneAxis`; the lane itself is still in `lanes`.
      const members = laneSeating().lanes[id] ?? [id];
      if (geometry.stowed) {
        // No raise: each seat comes back showing the tab it showed before it was put away.
        setLaneStowed(members, false);
        return;
      }
      if (!geometry.canStow) return;
      setLaneStowed(members, true);
    },

    revealDock: (id) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      /*
        A panel asked for is a panel wanted on screen, so the rest come back with it: out of the way
        on purpose, or behind a shell overlay — which is closed, since what was asked for was the
        space's panel and not the settings page in front of it.
      */
      if (panelsHiddenByUser()) setPanelsHiddenByUser(false);
      if (activeShellView()) setActiveShellView(null);
      const before = dockGeometry()[id];
      // Out of sight before this, including closed a moment ago — a panel already in front, pressed
      // again, has nothing to point at.
      const wasOutOfSight = !before?.edge || Boolean(before.hidden || before.collapsed || before.stowed);
      /*
        A collapsed lane opens whole. There is no showing one panel of it on its own: that was a peek,
        and a panel floating out of a strip looked like the arrangement had come apart. First, so the
        fold and the raise below act on the lane as it will be on screen.
      */
      if (before?.stowed) setLaneStowed(laneSeating().lanes[id] ?? [id], false);
      if (placementOf(request).collapsed) setSeatFolded(id, false);
      raise(id);
      // A tab brought to the front of a stack flashes, so the change is findable in a frame that did
      // not move. A panel alone has nothing beside it to be confused with.
      if (wasOutOfSight && (dockGeometry()[id]?.tabs?.length ?? 0) > 1) flashTab(id);
    },

    toggleDockDisplace: (id) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      const placement = placementOf(request);
      // Refused rather than hidden on a corner: the control stays in the menu wherever the panel is,
      // and declines the one arrangement it cannot honour. See `displaces` in dockGeometry.
      if (!placement.displace && edgeOfSnap(placement.snap) === null) return;
      // A panel that stops taking room has no strip to be in, and coming back should not find one.
      const { stowed: _stowed, ...rest } = placement;
      writePlacement(id, { ...rest, displace: !placement.displace });
    },
  };
  return {
    members,
    boxOnScreen,
    dockGeometry,
    dockRegistryVersion,
    dockRequests,
    dragCarry,
    floatChrome,
    inset,
    landInPlace,
    laneSeating,
    movingDock,
    movingSeat,
    movingSeatKey,
    occupiedForId,
    panelsHiddenByUser,
    placementOf,
    resolvedPlacement,
    setDragCarry,
    setLaneStowed,
    setMovingDock,
    setMovingSeat,
    setPanelsHiddenByUser,
    setSeatFolded,
    setStowPending,
    stackTargets,
    stowPending,
    viewport,
  };
}

export type ShellDocks = ReturnType<typeof createShellDocks>;
