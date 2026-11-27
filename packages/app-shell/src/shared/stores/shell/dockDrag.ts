/**
 * Dragging a panel: moving it by its titlebar, tearing a tab out of a stack, resizing it by an edge or
 * a lane's boundary, and the targets a drag is offered while it is in the air. Each gesture settles
 * through the docks' own actions (`insertDock`, `stackDock`, `insertHome`, `breakOut`).
 * Part of `ShellStore` — see `../ShellStore.ts`.
 */
import {
  chooseTarget,
  displaces,
  type DockRequest,
  edgeDropSlots,
  edgeOfSnap,
  edgeSeatOrder,
  type FloatPlacement,
  floorOf,
  followSeat,
  homeDropSlots,
  liftedCard,
  movedBoundary,
  type Rect,
  resizedBox,
  RESTORE_DRAG_PX,
  seatSize,
  snapBeatsSlot,
  snapCandidate,
  type SnapPoint,
  snapTargetRects,
  stackDropSlots,
  STOW_DRAG_PX,
  takenSnapsOf,
  thicknessOf,
  TITLE_BAR_PX,
  unlaned,
} from '@shared/dockGeometry';
import { dockRegistry, dockTitle } from '@shared/registries/dockRegistry';
import { HOME_SECTION_ATTR, homeLanes } from '@shared/registries/homeLanes';
import { declaredPanelOf } from '@shared/registries/panelInstances';
import { DRAGGING_ATTR } from '@we/drag';
import { type DockEdge } from '@we/module-shared';
import { type ReactivityPort } from '@we/reactivity';

import { distinctSignal } from '../../distinctSignal';
import type { PlatformPort } from '../../platform/port';
import { type ShellStore } from '../ShellStore';
import { type ShellArrangement } from './arrangement';
import { type ShellDocks } from './docks';

export function createShellDockDrag(deps: {
  reactivity: ReactivityPort;
  /** The window a drag is followed on once its grip is gone, and the document's drag marks. */
  platform: Pick<PlatformPort, 'listen' | 'document'>;
  arrangement: ShellArrangement;
  docks: ShellDocks;
}) {
  const { reactivity, platform } = deps;
  const { memo, effect } = reactivity;
  const { declarationFor, placementKey, placements, raise, writePlacement } = deps.arrangement;
  const {
    boxOnScreen,
    dockGeometry,
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
    placementOf,
    resolvedPlacement,
    setDragCarry,
    setLaneStowed,
    setMovingDock,
    setMovingSeat,
    setSeatFolded,
    setStowPending,
    stackTargets,
    stowPending,
    viewport,
  } = deps.docks;
  const { breakOut, insertDock, insertHome, stackDock } = deps.docks.members;
  const [dockResizing, setDockResizing] = distinctSignal(reactivity, false);
  /** The lane's thickness when that drag began, which a collapse puts back so the lane reopens at it. */
  let stowFrom: number | null = null;

  /**
   * Whether the drag in progress has travelled far enough to be one — see `endDockMove`.
   *
   * A press on a titlebar that goes nowhere is a click, and a click on a folded bar unfolds it. The
   * move handle reports both gestures as a start and an end, so the difference is whether anything in
   * between got past `RESTORE_DRAG_PX`.
   */
  let dragTravelled = false;
  /**
   * The panel a click just unfolded, and when — so the second click of a double-click, which would
   * otherwise land on a panel that is no longer folded, does not maximise it. See
   * `toggleMaximiseDock`.
   */
  let clickUnfolded: { id: string; at: number } | null = null;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  /** The outline following the cursor, for a drag that cannot carry the panel. See `previewDrop`. */
  const dragGhost = memo(() => {
    const carry = dragCarry();
    if (!carry) return null;
    return {
      top: `${Math.round(carry.box.y)}px`,
      left: `${Math.round(carry.box.x)}px`,
      width: `${Math.round(carry.box.w)}px`,
      height: `${Math.round(carry.box.h)}px`,
      title: carry.title,
    };
  });
  const [activeSnap, setActiveSnap] = distinctSignal<SnapPoint | null>(reactivity, null);
  const [activeInsert, setActiveInsert] = distinctSignal<string | null>(reactivity, null);
  /** The rect a drag started from, so every move is measured against one fixed origin. */
  let dragOrigin: FloatPlacement | null = null;
  /**
   * The two stored bases a divider drag moves the boundary between, and which axis they are on —
   * see `resizeColumn`.
   */
  let columnDrag: { along: 'w' | 'h'; top: number; bottom: number } | null = null;
  /** Where the pointer was when it started, for restoring a maximised panel beneath it. */
  let dragPointer: { x: number; y: number } | null = null;
  /** The panel being resized, for the length of one resize drag — see `endDockResize`. */
  let resizingDock: string | null = null;
  /**
   * A press on a tab, before it is known whether it is a click or a drag.
   *
   * A tab cannot own its gesture the way a titlebar grip can, because acting on the press destroys
   * the element holding the pointer capture: raising a tab hides the frame its strip lives in, and
   * tearing one out of a seat of two takes the strip away with it. So the press records, and nothing
   * else happens until the pointer has travelled — by which point the answer is "a drag", and the
   * panel is *not* moved out of the seat until the drop, exactly as every tab strip behaves.
   */
  let tabGesture: { id: string; x: number; y: number; dragging: boolean } | null = null;
  /**
   * The snap a drop would take, once the places that are already occupied are struck out.
   *
   * See `takenSnaps` for why. The panel being dragged is excluded along with the seat-mates riding
   * with it — a stack must not be refused the place it is leaving, or a drag that changes its mind
   * has nowhere to put it back.
   */
  const snapFor = (rect: Rect, id: string | null, pointer: { x: number; y: number }) => {
    const candidate = snapCandidate(rect, viewport(), occupiedForId(id), floatChrome(), pointer);
    if (!candidate || takenSnapPoints(id).includes(candidate)) return null;
    const hit = snapTargetRects(viewport(), occupiedForId(id), floatChrome()).find((t) => t.id === candidate);
    return hit ? { snap: candidate, hit } : null;
  };

  /**
   * What a drag is pointing at right now, across both families of target.
   *
   * The slots describe places *within* an arrangement and the eight describe places to put a card,
   * and they are arbitrated separately before being weighed against each other here — see
   * `snapBeatsSlot`. One place rather than two so a titlebar drag and a tab drag cannot drift apart.
   */
  const settleTargets = (id: string, pointer: { x: number; y: number }, would: Rect) => {
    const slot = chooseTarget(members.insertSlots(), pointer, would);
    const snap = snapFor(would, id, pointer);
    const snapWins = snapBeatsSlot(snap?.hit ?? null, slot?.hit ?? null, pointer);
    setActiveInsert(snapWins ? null : (slot?.key ?? null));
    setActiveSnap(snapWins || !slot ? (snap?.snap ?? null) : null);
  };

  /**
   * The seat a panel snapping to an edge takes in that edge's floating lane — see `seatOrder`.
   *
   * The mover and the seat-mates coming with it are left out of what counts as taken: they are the
   * ones being placed, and a stack must be allowed to land back on the number it already holds.
   */
  const laneSeatOrder = (id: string, snap: SnapPoint, mine: number | undefined) =>
    edgeSeatOrder(dockRequests(), [id, ...movingSeat()], snap, mine);

  const takenSnapPoints = (moving: string | null) =>
    takenSnapsOf(dockRequests(), laneSeating().hidden, moving ? [moving, ...movingSeat()] : []);
  /*
    A drag carried on from the window once its grip is gone.

    The grip a panel is dragged by belongs to the place holding it — a lane's section, an edge lane's
    frame — and the first thing a drag does is take the panel out of that place, which takes the grip
    out of the page and its pointer capture with it. So the window follows the same pointer for as long
    as the move lasts: while the grip is still there both report the same distance from the same start,
    and the move answers the second as it did the first (`moveDock` is measured from where the drag
    began); once it is gone the window is all there is.
  */
  let releaseCarry: (() => void) | null = null;
  /** The move under way began on a grip whose press breaks a section out — see `beginDockMove`. */
  let pressBreaksOut = false;
  const carryPastTheGrip = (id: string, startX: number, startY: number) => {
    releaseCarry?.();
    const follow = (event: PointerEvent) => members.moveDock(id, event.clientX - startX, event.clientY - startY);
    const land = () => {
      releaseCarry?.();
      if (movingDock() === id) members.endDockMove(id);
    };
    const removals = [
      platform.listen('pointermove', follow),
      platform.listen('pointerup', land),
      platform.listen('pointercancel', land),
    ];
    releaseCarry = () => {
      for (const remove of removals) remove();
      releaseCarry = null;
    };
  };
  /**
   * How long chrome should take to follow the dock — nothing, while it is being dragged.
   *
   * Anything animating its own position has to stop animating during a drag or it lags a third of a
   * second behind the cursor, which reads as the panel and the chrome disagreeing about where the
   * edge is. The content viewport reads `dockResizing` directly; the editor's toolbar cannot,
   * because it is in another package with no path to this store — so the same answer goes out as a
   * duration it can drop into its own `transition`.
   */
  effect(() => {
    platform.document.setRootProperty('--we-chrome-transition', dockResizing() ? '0s' : '300ms');
  });
  /**
   * Show where a **tab** would land, and move nothing.
   *
   * A panel is carried — it follows the cursor, which is what a window does — and so is a whole
   * stack, whose mates ride along hidden. One tab of a stack cannot be: it would have to leave the
   * seat to be carried, and leaving takes the strip away along with the pointer capture on it, so
   * the drag dies where it stands. It shows the drop guides and an outline instead, and settles
   * nothing until it is let go, which is what every tab strip does.
   */
  const previewDrop = (id: string, pointer: { x: number; y: number }, placement: FloatPlacement) => {
    const would = {
      x: pointer.x - placement.w / 2,
      y: pointer.y - TITLE_BAR_PX / 2,
      w: placement.w,
      h: placement.h,
    };
    /*
      What is being carried, since the panel itself is not.

      A drag with nothing following the cursor reads as a drag that is not working — the guides say
      where it *would* go and nothing says what is going there. Every application that cannot carry
      the real thing carries an outline of it instead, and this is that outline: the box the panel
      would occupy, at the pointer, named.

      Published **before** the targets are settled, because they are offered against it: `insertSlots`
      asks each edge "has what is being carried reached you", and a tab drag is the one gesture where
      the panel's own resolved box is not the answer. Set afterwards, every frame would gate on the
      previous one — a lag nobody would see, and a wrong answer on the first frame of the drag.
    */
    const entry = dockRegistry.get(id);
    setDragCarry({ box: would, title: entry ? dockTitle(entry) : id });
    settleTargets(id, pointer, would);
  };

  const members: Pick<
    ShellStore,
    | 'dockResizing'
    | 'beginDockResize'
    | 'resizeDock'
    | 'resizeColumn'
    | 'endDockResize'
    | 'beginDockMove'
    | 'beginTabDrag'
    | 'moveTab'
    | 'endTabDrag'
    | 'moveDock'
    | 'endDockMove'
    | 'movingDock'
    | 'activeSnap'
    | 'insertSlots'
    | 'activeInsert'
    | 'dragGhost'
    | 'snapTargets'
    | 'toggleMaximiseDock'
  > = {
    dockResizing,
    beginDockResize: (id) => {
      // Remembered so `endDockResize` knows whose seat-mates to bring to the same size; a resize is
      // not a move, so `movingDock` is null throughout one.
      resizingDock = id;
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      raise(id);
      const belowId = dockGeometry()[id]?.below;
      const lower = belowId ? dockRequests().find((entry) => entry.id === belowId) : undefined;
      // The base on the axis the lane divides — `h` down a side lane, `w` across a top or bottom one.
      // Reading `h` either way wrote a height nobody in a horizontal lane reads, so the boundary
      // between two panels along the top edge could be dragged and nothing moved.
      const along = dockGeometry()[id]?.laneAxis === 'horizontal' ? 'w' : 'h';
      if (lower) {
        /*
          A divider drag begins by making the lane's stored sizes what is on screen.

          A member's rendered extent is its base plus a share of the lane's spare room, handed out by
          grow. Moving the boundary within the sum of the two *bases* alone would leave slack each
          panel holds by its grow ratio and cannot give up.

          So every member's base becomes its rendered extent and its grow becomes the same number.
          The slack is then zero, the clamp below is in real pixels, and — since the grows are now in
          proportion to the sizes — a later window resize keeps the split where it was dragged
          instead of pulling it back toward the declared ratio. The ratio was the author's guess;
          the drag is the reader's decision.
        */
        /*
          Measured in full BEFORE any of it is written, because writing changes what is measured.

          `dockGeometry` is derived from the placements, so normalising the first member re-solved the
          lane around it — and the second was then measured against a lane where one panel had taken
          its share of the spare room and the other had not. Its rendered extent read back as near its
          base, that became its new base, and the boundary jumped a third of the way down the lane on
          the click that was only meant to grab it. Reading and writing the same derived value in one
          pass is the whole of the bug; the normalisation itself is exactly a fixed point.
        */
        const lane = (laneSeating().lanes[id] ?? [])
          .map((memberId) => dockRequests().find((entry) => entry.id === memberId))
          // A folded member is its titlebar tall whatever it stores, and its stored size is what it
          // unfolds back to — writing the bar's height over it would lose that.
          .filter((member): member is DockRequest => member !== undefined && !placementOf(member).collapsed)
          .map((member) => ({
            member,
            rendered: boxOnScreen(member.id, placementOf(member))[along],
          }));

        for (const { member, rendered } of lane) {
          writePlacement(member.id, { ...placementOf(member), [along]: rendered, grow: rendered });
        }
        columnDrag = { along, top: placementOf(request)[along], bottom: placementOf(lower)[along] };
      } else {
        columnDrag = null;
      }
      // The *resolved* rect, not the stored one: a snapped panel has no stored x/y, so a drag
      // measured from them would jump to the origin on the first frame. Same reason `beginDockMove`
      // reads the geometry.
      dragOrigin = resolvedPlacement(id, placementOf(request));
      // What the lane reopens at if this drag ends by putting it away — see `resizeDock`.
      const snapEdge = edgeOfSnap(placementOf(request).snap);
      stowFrom =
        dockGeometry()[id]?.floating === false && snapEdge ? thicknessOf(placementOf(request), snapEdge) : null;
      setStowPending(null);
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
      /*
        A maximised panel has no size to change, and a drag that reached here would not be harmless.

        `dragOrigin` is the box on screen, which while maximised is the whole window — so the write
        below stamped that over the card, and the panel silently lost both the size it restores to and
        (where a dock's thickness falls back to the card) the size it docks at. `grips` no longer draws
        anything to start such a drag; this is the same answer at the end that owns the data, since a
        handle is not the only way to call a store action.
      */
      if (dockGeometry()[id]?.maximised) return;

      const start = dragOrigin;
      const spanning = !dockGeometry()[id]?.floating;
      // The panel's own floor per axis, over the host's default — see `DockRequest.min`.
      const minW = floorOf(request.min, 'w', spanning);
      const minH = floorOf(request.min, 'h', spanning);
      const {
        box: { x, y, w, h },
        asked,
      } = resizedBox(start, side, dx, dy, { w: minW, h: minH });

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
      const vertical = edgeOfSnap(stored.snap) === 'left' || edgeOfSnap(stored.snap) === 'right';
      /*
        Resizing a *snapped* panel changes its size, not where it is parked.

        The free-floating branch writes `snap: null` because a panel dragged to a size is a panel the
        reader has taken charge of — but it was reached by every snapped panel that is not currently
        *spanning*, which is any snapped card and, below `NARROW_VIEWPORT_PX`, every displacing panel
        (where `displaces()` refuses the trade and `floating` comes back true). So resizing a docked
        panel on a narrow window silently un-docked it, permanently, and the only sign was that it
        stopped taking room.

        A snap is a statement about position; a resize is a statement about size. Neither implies the
        other, so a snapped panel keeps its snap and takes the new dimensions — its origin is derived
        from the snap on every frame, which is why `x`/`y` are not written with them.
      */
      const keepsSnap = stored.snap !== null;
      if (spanning) {
        /*
          A lane has one thickness, so widening any member widens the lane.

          The alternative is writing it to the panel that was dragged and letting `laneThickness` take
          the largest — which works while you pull outward and does nothing at all when you push back,
          since the neighbour's untouched number goes on being the largest. The sidebar would widen
          and refuse to narrow, and nothing on screen would say which panel was holding it open.
        */
        const thickness = vertical ? { thicknessX: w } : { thicknessY: h };
        for (const memberId of laneSeating().lanes[id] ?? [id]) {
          const member = dockRequests().find((entry) => entry.id === memberId);
          if (member) writePlacement(memberId, { ...placementOf(member), ...thickness });
        }
        /*
          Pulled well past its floor, the lane is being put away — the gesture that closes a side bar
          in every editor with one.

          Decided on release rather than here, because collapsing mid-drag unmounts the very grip the
          pointer is captured by: the lane's edge is drawn from its open geometry and a strip has none,
          so the drag would end with no `resizeend` and leave every transition suspended. So this only
          says what letting go will do, and the lane dims while it does; dragging back out cancels it.
          Only for a drag on the side that faces the content — a lane's thickness — which is the one
          this branch writes.
        */
        const pulled = vertical ? asked.w : asked.h;
        setStowPending(pulled < STOW_DRAG_PX ? id : null);
        return;
      }
      writePlacement(id, keepsSnap ? { ...stored, w, h } : { ...stored, snap: null, x, y, w, h });
    },

    /**
     * Move the boundary between two stacked panels, giving one what the other loses.
     *
     * A column member's *rendered* height is its stored base plus a share of the column's spare
     * room, and `resizeDock` writes what it measured — the rendered height — back into the base. In
     * a column that is the same slack counted twice: the panel jumped taller by its own share the
     * instant a drag began, before the pointer had moved. That is what made the pair unresizable
     * rather than merely awkward.
     *
     * A divider has no such problem, because it does not change the total. Moving the boundary adds
     * to one base exactly what it takes from the other, so the sum is unchanged, so the slack is
     * unchanged, and each panel's rendered height moves by precisely the pixels the pointer did.
     *
     * Both floors apply at once. Pushing past either end stops the boundary rather than letting one
     * panel eat the other and slide on — the same rule the edge grips keep, asked of a pair.
     */
    resizeColumn: (id, delta) => {
      const belowId = dockGeometry()[id]?.below;
      if (!belowId || !columnDrag) return;
      const upper = dockRequests().find((entry) => entry.id === id);
      const lower = dockRequests().find((entry) => entry.id === belowId);
      if (!upper || !lower) return;

      const { along } = columnDrag;
      // Each panel's own floor: its declared minimum, the host's default, or its titlebar if it is
      // folded. Both apply at once — the boundary stops at whichever it reaches first.
      const spanning = dockGeometry()[id]?.floating === false;
      const floorTop = floorOf(upper.min, along, spanning, placementOf(upper).collapsed);
      const floorBottom = floorOf(lower.min, along, spanning, placementOf(lower).collapsed);
      const { top, bottom } = movedBoundary(columnDrag, delta, { top: floorTop, bottom: floorBottom });

      writePlacement(id, { ...placementOf(upper), [along]: top });
      writePlacement(belowId, { ...placementOf(lower), [along]: bottom });
    },

    endDockResize: () => {
      /*
        A seat is resized as one — see `seatSize`. A lane solves its length from the member showing,
        and off every lane each member resolves from its own placement, so either way resizing the
        one in front and leaving the rest puts the panel back to its old shape on the next tab.

        A loose seat takes the position too, having nothing else to compute one.
      */
      const id = movingDock() ?? resizingDock;
      const box = id ? placements()[placementKey(id)] : undefined;
      if (id && box) {
        const loose = edgeOfSnap(box.snap) === null;
        for (const tab of dockGeometry()[id]?.tabs ?? []) {
          if (tab.id === id) continue;
          const mate = dockRequests().find((entry) => entry.id === tab.id);
          if (!mate) continue;
          const sized = seatSize(placementOf(mate), box);
          writePlacement(tab.id, loose ? { ...sized, x: box.x, y: box.y } : sized);
        }
      }
      /*
        Let go past the threshold: put the lane away, at the thickness it had before the drag — so
        opening it again brings back the sidebar somebody had, not the floor the drag pinned it to on
        the way past.
      */
      const stowing = stowPending();
      if (stowing) {
        const request = dockRequests().find((entry) => entry.id === stowing);
        const edge = request ? edgeOfSnap(placementOf(request).snap) : null;
        const members = laneSeating().lanes[stowing] ?? [stowing];
        if (edge && stowFrom !== null) {
          const vertical = edge === 'left' || edge === 'right';
          for (const memberId of members) {
            const member = dockRequests().find((entry) => entry.id === memberId);
            if (member)
              writePlacement(memberId, {
                ...placementOf(member),
                ...(vertical ? { thicknessX: stowFrom } : { thicknessY: stowFrom }),
              });
          }
        }
        // After the drag has let go of the transitions, so the lane eases onto its strip like a press.
        setDockResizing(false);
        setLaneStowed(members, true);
        setStowPending(null);
      }
      stowFrom = null;

      resizingDock = null;
      dragOrigin = null;
      columnDrag = null;
      setDockResizing(false);
    },

    beginDockMove: (id, pointerX, pointerY, breakOutOnPress) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      raise(id);
      pressBreaksOut = Boolean(breakOutOnPress);
      /*
        The titlebar moves the **seat**, not the one panel showing in it.

        A stack of tabs is one surface with several things in it, and its titlebar is the surface's:
        dragging it took the panel in front and left its tabs behind, which reads as the grip tearing
        out the very tab you were looking at. The mates are recorded here and land wherever this one
        does — see `endDockMove`. A drag that starts on a *tab* records none, which is the whole
        difference between the two gestures.
      */
      setMovingSeat((dockGeometry()[id]?.tabs ?? []).map((tab) => tab.id).filter((tab) => tab !== id));
      dragOrigin = resolvedPlacement(id, placementOf(request));
      dragPointer = { x: pointerX, y: pointerY };
      dragTravelled = false;
      /*
        The drag package's global: `html[data-we-dragging]`, which every surface's hover chrome
        stands down for. A panel drag is not a session — it carries a dock id and lands on computed
        rects, not a record reference on a registered zone — but it is a drag, and the corner grips
        on home sections are hover chrome that must not flicker under a passing panel.
      */
      platform.document.setRootAttribute(DRAGGING_ATTR, '');
      setMovingDock(id);
      setDockResizing(true);
      carryPastTheGrip(id, pointerX, pointerY);
    },

    beginTabDrag: (id, pointerX, pointerY) => {
      // Records only. Acting on the press is what broke both halves of a tab: see `tabGesture`.
      tabGesture = { id, x: pointerX, y: pointerY, dragging: false };
    },

    moveTab: (id, dx, dy) => {
      if (!tabGesture || tabGesture.id !== id) return;
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;

      if (!tabGesture.dragging) {
        // Still a click until the pointer has actually travelled. The same threshold that tells a
        // click on a maximised panel's titlebar from a drag off it.
        if (Math.abs(dx) + Math.abs(dy) < RESTORE_DRAG_PX) return;
        tabGesture.dragging = true;
        dragTravelled = true;
        dragOrigin = resolvedPlacement(id, placementOf(request));
        dragPointer = { x: tabGesture.x, y: tabGesture.y };
        // A tab drag takes exactly one panel out of the seat, so nothing rides along with it — the
        // whole difference between this gesture and the titlebar's.
        setMovingSeat([]);
        platform.document.setRootAttribute(DRAGGING_ATTR, '');
        setMovingDock(id);
        setDockResizing(true);
      }

      // The tab stays where it is; only the guides and the outline follow. A tab may land anywhere a
      // single panel can, corners included, since one tearing out is one card. See `previewDrop`.
      previewDrop(id, { x: tabGesture.x + dx, y: tabGesture.y + dy }, placementOf(request));
    },

    endTabDrag: (id, pointerX, pointerY) => {
      const gesture = tabGesture;
      tabGesture = null;
      if (!gesture || gesture.id !== id) return;

      // A press that went nowhere is a click, and a click on a tab brings it forward. Safe to
      // re-render the strip now: the gesture is over.
      if (!gesture.dragging) {
        raise(id);
        return;
      }

      /*
        Let go over nothing, and the tab leaves its seat as a card under the pointer.

        `endDockMove` settles a target and otherwise leaves the panel where it is — which for a tab
        is where it started, since nothing has been written. Tearing one out to no particular place
        is the gesture's whole point, so the float is written here first and `endDockMove` then finds
        nothing to override it with.
      */
      const request = dockRequests().find((entry) => entry.id === id);
      if (request && !activeInsert() && !activeSnap()) {
        const placement = placementOf(request);
        // Under the hand, not gliding to it from the seat it left — see `settling`.
        landInPlace(id);
        writePlacement(id, {
          // `unlaned`, so the tab actually LEAVES. Writing a free position while keeping the seat key
          // only made it the member of that seat which is showing, so the whole stack appeared to
          // move to where one tab had been dropped, the rest hidden behind it at the new spot.
          ...unlaned(placement, null),
          maximised: false,
          // Where it was let go, so the card appears under the hand rather than where the drag began.
          x: pointerX - placement.w / 2,
          y: pointerY - TITLE_BAR_PX / 2,
        });
      }
      members.endDockMove(id);
      raise(id);
    },

    moveDock: (id, dx, dy) => {
      if (!dragOrigin || !dragPointer || movingDock() !== id) return;

      /*
        Nothing moves until the pointer has, for every panel.

        The threshold applies to a free card too: otherwise a click on a card's titlebar is a
        one-pixel drag whenever the hand wobbles, which un-snaps it from its corner and swallows the
        click that opens a folded bar. Past the threshold the drag is measured
        from where it began, so nothing is lost by waiting for it.
      */
      if (!dragTravelled) {
        if (Math.abs(dx) + Math.abs(dy) < RESTORE_DRAG_PX) return;
        dragTravelled = true;
        /*
          A section at home in a template leaves its lane here, under the pointer where the press was,
          and is carried from there like any card. Not on the press: a press on a window titlebar in a
          lane is a click, and a click must not take the section out of the page.
        */
        const home = dockRequests().find((entry) => entry.id === id);
        if (home && placementOf(home).snap === 'home') {
          breakOut(id, dragPointer.x, dragPointer.y);
          const away = dockRequests().find((entry) => entry.id === id);
          if (away) dragOrigin = placementOf(away);
        }
      }

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
      if (attached) dragOrigin = liftedCard(placement, dragOrigin, dragPointer);

      /*
        In the air, a stack is a **loose seat** — which is what keeps its tabs on screen.

        The leader is written free like any dragged panel, and its mates are derived free alongside it
        (see `dockRequests`), all three carrying the same `seat` key. So the strip goes on naming them
        while the stack crosses the screen, instead of the titlebar emptying out the moment the lane
        was left and leaving no sign of what was being carried.

        A panel travelling alone drops its lane coordinates instead: `order` and `band` describe a
        place it is no longer in, and a stale `order` is what would fuse two unrelated floats.
      */
      const carrying = movingSeat().length > 0;
      const next = {
        ...(carrying
          ? { ...dragOrigin, snap: null, displace: false, seat: movingSeatKey() }
          : unlaned(dragOrigin, null)),
        x: dragOrigin.x + dx,
        y: dragOrigin.y + dy,
      };

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
      /*
        Which of them is being offered is `chooseTarget`, pure and tested: the pointer first, then the
        smallest box it is inside. Both halves are answers to things that went wrong here — see there.
      */
      settleTargets(id, { x: dragPointer.x + dx, y: dragPointer.y + dy }, next);
      writePlacement(id, next);
    },

    /**
     * Land it.
     *
     * Three outcomes, in order of how specific the thing under the panel is. A boundary on an edge
     * puts the panel there — a new lane at that position, or a seat in the lane it was dropped into.
     * A snap zone takes that snap, so the panel aligns itself. Anything else keeps the free position
     * it already has.
     *
     * Displacing is deliberately not restored by the second or third of those, even if the panel was
     * displacing before the drag: pulling a panel off its edge is the gesture for "stop taking room",
     * and re-attaching it silently would make the drag look like it had failed.
     */
    endDockMove: (id) => {
      const insert = activeInsert();
      const snap = activeSnap();
      /*
        The panel's own placement, through the three-rung chain — not `placements()[id]`, which asked
        the map with the *bare* id where a template panel's is scoped to the interface. It answered
        undefined for every authored panel and fell through to `dragOrigin`, the resolved box: a
        sidebar snapped to an edge kept the full height of the edge it left as its card size. A stack
        made it visible, being the first drag that never writes a position on the way.
      */
      const moving = dockRequests().find((entry) => entry.id === id);
      const current = moving ? placementOf(moving) : dragOrigin;

      if (dragOrigin && current && insert) {
        // The four fields `insertSlots` built it from — see `draw` there. A home slot carries the
        // lane's name where an edge slot carries the edge.
        const [mode, edge, lane, position] = insert.split(':');
        // A tab slot naming no edge is a floating panel offered as somewhere to stack: no edge means
        // no lane, and a seat with no lane is the loose kind. Checked before `insertDock`, which has
        // no answer for an empty edge.
        // Joining a seat is not a journey — see `settling`. Both shapes of it: a loose stack, and a
        // seat in a lane.
        if (mode === 'tab') landInPlace(id);
        if (mode === 'tab' && !edge) stackDock(id, Number(position));
        else if (mode === 'home') insertHome(id, edge, Number(position));
        else
          insertDock(
            id,
            edge as Exclude<DockEdge, null>,
            Number(position),
            mode as 'band' | 'lane' | 'tab',
            lane === 'float' ? 'float' : lane === '' ? undefined : Number(lane),
          );
      } else if (dragOrigin && current && snap) {
        /*
          Who keeps the seat: a drag carrying the whole stack, and nothing else.

          Back on an edge a seat is arithmetic again — the lane and the `order` in it say who is
          stacked with whom — so the loose key carried through the air is dropped either way. A corner
          is off every lane, so a stack landing in one stays a stack, and a panel *taken out* of a
          stack must not, or parking a torn-out tab in a corner puts it straight back.
        */
        const { seat: _seat, ...bare } = current;
        if (edgeOfSnap(snap))
          writePlacement(id, { ...bare, snap, displace: false, order: laneSeatOrder(id, snap, current.order) });
        else
          writePlacement(id, movingSeat().length > 0 ? { ...current, snap, displace: false } : unlaned(current, snap));
      }

      /*
        The seat follows where its titlebar went.

        Copied rather than re-arranged: a seat is "the same lane, and the same `order` in it", so
        handing the mates the four coordinates the drop settled on re-forms them around the panel
        that led. Their own `tab` is untouched, so the strip keeps the order it had.
      */
      const mates = movingSeat();
      const landed = placements()[placementKey(id)];
      if (landed) {
        for (const mate of mates) {
          const entry = dockRequests().find((request) => request.id === mate);
          if (entry) writePlacement(mate, followSeat(placementOf(entry), landed));
        }
      }
      setMovingSeat([]);

      /*
        A press on the titlebar that went nowhere is a click, and a click on a folded bar opens it.

        The bar is the panel's name now, and a name on a bar is something people press expecting it to
        open — every folded section in every sidebar does. Only a folded one: on an open panel a click
        on the titlebar is how it is brought to the front, which the frame's own pointer handler has
        already done, and folding it for that would be a surprise on the most ordinary click there is.

        Remembered, because the same press is usually the first half of a double-click, and by the
        second half the bar is open — see `toggleMaximiseDock`.
      */
      const clickedFolded = Boolean(dragOrigin && !dragTravelled && !insert && !snap && dockGeometry()[id]?.collapsed);
      // A press on a section's break-out grip that went nowhere: out, to its declared snap.
      const pressedOut = Boolean(dragOrigin && !dragTravelled && pressBreaksOut && dockGeometry()[id]?.home);
      pressBreaksOut = false;
      dragTravelled = false;

      dragOrigin = null;
      dragPointer = null;
      releaseCarry?.();
      setDragCarry(null);
      platform.document.setRootAttribute(DRAGGING_ATTR, null);
      setMovingDock(null);
      setActiveSnap(null);
      setActiveInsert(null);
      setDockResizing(false);

      // After the drag has ended rather than inside it, so the panel eases open instead of jumping:
      // transitions are suspended for as long as `dockResizing` says a drag is live.
      if (clickedFolded) {
        setSeatFolded(id, false);
        clickUnfolded = { id, at: now() };
      }
      if (pressedOut) breakOut(id);
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
      const requests = dockRequests();
      /*
        What is being carried — the box the targets are offered against. A titlebar drag writes the
        panel's own placement every frame, so its box on screen is the answer; a **tab** drag carries an
        outline and leaves the panel in its seat, so the outline is. Asking the panel then would answer
        about the seat it is still sitting in, and every edge's targets would follow where the stack was
        docked rather than where the tab was being dragged.
      */
      const dragged = requests.find((entry) => entry.id === moving);
      const carried = dragCarry()?.box ?? (dragged ? boxOnScreen(moving, placementOf(dragged)) : null);
      const boxes = Object.fromEntries(
        requests.map((request) => [request.id, boxOnScreen(request.id, request.placement ?? placementOf(request))]),
      );

      /*
        The home lanes: every `$panels` outlet on screen that would take this panel, measured, because an
        outlet is an element the template laid out and only it knows where it is. Only for a panel an
        interface declared at home in a lane — a lane keeps nothing else (see `placementOf`) — and only
        an outlet it has been carried to, which `homeDropSlots` decides from the outlet's box.
      */
      const homeSlots = () => {
        if (!declarationFor()[moving]?.home || !carried) return [];
        const panelId = moving.replace(/^template:/, '');
        return homeLanes().flatMap((outlet) => {
          // An instance is taken where the panel it is of is.
          if (outlet.accepts.length > 0 && !outlet.accepts.includes(declaredPanelOf(moving))) return [];
          const drawn = outlet.el.getBoundingClientRect();
          const box = { x: drawn.x, y: drawn.y, w: drawn.width, h: drawn.height };
          const sections = [...outlet.el.querySelectorAll<HTMLElement>(`[${HOME_SECTION_ATTR}]`)]
            .filter((section) => section.getAttribute(HOME_SECTION_ATTR) !== panelId)
            .map((section) => {
              const at = section.getBoundingClientRect();
              return { x: at.x, y: at.y, w: at.width, h: at.height };
            });
          return homeDropSlots(outlet.lane, outlet.direction, sections, box, carried);
        });
      };

      const edgeSlots = edgeDropSlots({
        requests,
        moving,
        boxes,
        hidden: laneSeating().hidden,
        viewport: viewport(),
        inset: inset(),
        occupied: occupiedForId(moving),
        carried,
      });
      const stackSlots = stackDropSlots(stackTargets(moving).map(({ request }) => boxes[request.id]));
      return [...homeSlots(), ...edgeSlots, ...stackSlots];
    },

    activeInsert,
    dragGhost,

    snapTargets: () =>
      snapTargetRects(viewport(), occupiedForId(movingDock()), floatChrome())
        // Not drawn where a panel already is — see `takenSnaps`. Half the complaint was the target
        // sitting on top of the card being aimed at, hiding the seams and the seat behind it.
        .filter((target) => !takenSnapPoints(movingDock()).includes(target.id))
        .map((target) => ({
          id: target.id,
          top: `${target.y}px`,
          left: `${target.x}px`,
          width: `${target.w}px`,
          height: `${target.h}px`,
        })),

    toggleMaximiseDock: (id) => {
      const request = dockRequests().find((entry) => entry.id === id);
      // Nor a section at home in the page, which its lane sizes — see `outOfPage` in dockRegistry.
      if (!request?.edge || placementOf(request).snap === 'home') return;
      /*
        The second click of a double-click on a folded bar.

        The first click opened the bar (see `endDockMove`), so by the time the double-click arrives
        the panel is open and the titlebar's ordinary answer — full screen — would follow. Somebody
        double-clicking a folded bar is asking for it open, which it now is; taking it over the whole
        window as well is the surprise. The window is the platform's double-click interval, give or
        take, which is the only span in which the two clicks can be one gesture.
      */
      if (clickUnfolded?.id === id && now() - clickUnfolded.at < 600) {
        clickUnfolded = null;
        return;
      }
      const placement = placementOf(request);
      // Maximising is an activation: a panel asked to cover everything comes to the front of it.
      raise(id);
      writePlacement(id, { ...placement, maximised: !placement.maximised });
    },
  };
  return { members };
}

export type ShellDockDrag = ReturnType<typeof createShellDockDrag>;
