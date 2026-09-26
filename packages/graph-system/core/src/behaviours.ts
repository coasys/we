/**
 * Built-in interactions.
 *
 * Framework-neutral, because they never touch a DOM event: each receives a normalised
 * {@link PointerInput} in screen space and asks the engine what is under it. That is what keeps a
 * canvas renderer additive later — none of these would need rewriting, because none of them knows
 * whether a node is an element or a painted circle.
 *
 * Behaviours are ordered and may claim an event by returning `true`, which stops later ones seeing
 * it. That is how dragging a node takes precedence over panning the canvas without either behaviour
 * knowing the other exists.
 */
import type { ArrangeState, Behaviour, BehaviourContext, Bounds, Point, PointerInput } from '@we/graph-protocol';

import { boundsFromPoints } from './viewport';

/** Pixels of movement before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 3;

export interface PanZoomOptions {
  /** Wheel sensitivity. */
  zoomSpeed?: number;
}

/**
 * Drag empty space to pan; wheel to zoom about the cursor.
 *
 * Claims only the background. A press on a node belongs to whatever handles nodes, which is why this
 * one is registered last by convention — it is the fallback, not the first refusal.
 */
export function panZoomBehaviour(rawOptions?: Record<string, unknown>): Behaviour {
  const options = { zoomSpeed: 0.0015, ...(rawOptions as PanZoomOptions) };
  let panning = false;
  let last = { x: 0, y: 0 };

  return {
    id: 'pan-zoom',
    description: 'Drag the background to pan, wheel to zoom about the pointer.',
    onPointerDown(input, ctx) {
      if (ctx.hitTest(ctx.toWorld(input.at)).length) return;
      panning = true;
      last = input.at;
      return true;
    },
    onPointerMove(input, ctx) {
      if (!panning) return;
      ctx.pan(input.at.x - last.x, input.at.y - last.y);
      last = input.at;
      return true;
    },
    onPointerUp() {
      if (!panning) return;
      panning = false;
      return true;
    },
    onPointerCancel() {
      panning = false;
    },
    onWheel(input, ctx) {
      if (input.delta === undefined) return;
      // Exponential so each notch is a constant *ratio*: zooming out then back in returns you to
      // exactly where you were, which linear stepping does not.
      ctx.zoomAt(input.at, Math.exp(-input.delta * options.zoomSpeed));
      return true;
    },
  };
}

/**
 * Drag a node to reposition it — and every other selected node with it.
 *
 * The grab offset is the whole difference between this feeling like dragging and feeling like
 * teleporting. Setting the node's position *to* the pointer snaps its centre under the cursor the
 * instant you move — so grabbing a node near its edge makes it jump, which reads as a glitch even
 * though the drag then tracks correctly. Recording where inside the node you took hold of it, and
 * preserving that, means the node moves with your hand.
 *
 * ## A selection travels together
 *
 * Taking hold of a card that is part of a selection drags the whole selection, each member holding
 * its offset from the one under the pointer. Anything else makes a selection almost useless on a
 * canvas: the reason to gather six cards is nearly always to put them somewhere, and a drag that
 * moved one of them and silently dropped the other five from the arrangement would be worse than no
 * multi-select at all.
 *
 * Offsets are captured once, at the press, and never recomputed. Recomputing them mid-drag against
 * live positions accumulates the floating-point error of every frame, and a group dragged twice
 * across a canvas visibly spreads apart.
 *
 * **A press on a card that is not selected drags only that card**, and leaves the selection alone.
 * That is `select`'s decision to make, not this one's — it already refuses to treat a drag as a
 * click — and a gesture that quietly reselected would make the two disagree about what is selected
 * for the length of the drag.
 */
export function dragNodeBehaviour(rawOptions?: Record<string, unknown>): Behaviour {
  const options = { pin: false, ...(rawOptions as { pin?: boolean }) };
  let dragging: string | null = null;
  let moved = false;
  /** Node position minus grab position, in world units. Constant for the life of one drag. */
  let grabOffset = { x: 0, y: 0 };
  /** The rest of the selection, each with its offset from the node under the pointer. */
  let companions: { id: string; dx: number; dy: number }[] = [];

  return {
    id: 'drag-node',
    description: 'Drag a node to move it, and the rest of the selection with it.',
    onPointerDown(input, ctx) {
      // Refused at the start of the gesture rather than by discarding its result: a drag that follows
      // the pointer and then snaps back has told you it worked and then taken it away.
      if (ctx.locked()) return;
      const world = ctx.toWorld(input.at);
      const [hit] = ctx.hitTest(world);
      if (!hit) return;
      dragging = hit;
      moved = false;
      const at = ctx.positionOf(hit);
      grabOffset = at ? { x: at.x - world.x, y: at.y - world.y } : { x: 0, y: 0 };

      const selection = ctx.selection();
      companions =
        at && selection.length > 1 && selection.includes(hit)
          ? selection.flatMap((id) => {
              if (id === hit) return [];
              const other = ctx.positionOf(id);
              // A selected node with no position is folded away or not laid out yet. It has nowhere
              // to be moved from, so it is left out rather than dragged to the origin.
              return other ? [{ id, dx: other.x - at.x, dy: other.y - at.y }] : [];
            })
          : [];
      return true;
    },
    onPointerMove(input, ctx) {
      if (!dragging) return;
      // Independent of the dispatch fix above: if no button is held there is no drag, whatever this
      // behaviour thinks. Covers the pointer leaving the window, a cancelled gesture, and any future
      // ordering mistake that swallows the pointer-up again.
      if (input.buttons === 0) {
        dragging = null;
        companions = [];
        return;
      }
      moved = true;
      const world = ctx.toWorld(input.at);
      const at = { x: world.x + grabOffset.x, y: world.y + grabOffset.y };
      ctx.pin(dragging, at);
      for (const other of companions) ctx.pin(other.id, { x: at.x + other.dx, y: at.y + other.dy });
      return true;
    },
    onPointerCancel() {
      dragging = null;
      companions = [];
    },
    onPointerUp(input, ctx) {
      if (!dragging) return;
      const id = dragging;
      const rest = companions;
      dragging = null;
      companions = [];
      if (!moved) return;
      const world = ctx.toWorld(input.at);
      const at = { x: world.x + grabOffset.x, y: world.y + grabOffset.y };
      // Released rather than left pinned by default: on an explorer, a dragged node that stays put
      // fights the layout for every subsequent expansion. A canvas passes `pin: true`.
      if (!options.pin) {
        ctx.pin(id, null);
        for (const other of rest) ctx.pin(other.id, null);
      }
      // The node's position, not the pointer's — what a canvas persists has to be where the node
      // actually ended up. `moved` carries the same for everything that travelled with it, so one
      // gesture is reported once and the consumer can write it as one act.
      ctx.emit({
        type: 'nodeDragEnd',
        node: { id, kind: 'entity', type: '' },
        position: at,
        ...(rest.length
          ? { moved: rest.map((other) => ({ id: other.id, position: { x: at.x + other.dx, y: at.y + other.dy } })) }
          : {}),
      });
      return true;
    },
  };
}

export interface SelectOptions {
  /** Emit `nodeClick` as well as changing the selection. */
  emitClick?: boolean;
}

/** Click to select; shift-click to extend. Clicking the background clears. */
export function selectBehaviour(rawOptions?: Record<string, unknown>): Behaviour {
  const options = { emitClick: true, ...(rawOptions as SelectOptions) };
  let pressedAt: { x: number; y: number } | null = null;
  let pressedId: string | null = null;

  return {
    id: 'select',
    description: 'Click to select a node, shift-click to extend, click the background to clear.',
    onPointerDown(input, ctx) {
      pressedAt = input.at;
      pressedId = ctx.hitTest(ctx.toWorld(input.at))[0] ?? null;
    },
    onPointerCancel() {
      pressedAt = null;
      pressedId = null;
    },
    onPointerUp(input, ctx) {
      if (!pressedAt) return;
      const travelled = Math.hypot(input.at.x - pressedAt.x, input.at.y - pressedAt.y);
      pressedAt = null;
      // A drag that happens to end on a node is not a click on it.
      if (travelled > DRAG_THRESHOLD) {
        pressedId = null;
        return;
      }
      const id = pressedId;
      pressedId = null;
      if (!id) {
        // Nothing on a node, so try an edge before treating this as a click on the background. Nodes
        // win by asking first: an edge passing behind a node is not what you meant to click.
        const edge = ctx.hitTestEdge(ctx.toWorld(input.at));
        if (edge) {
          // Selected as well as reported. Clicking a line is how its route is opened for editing,
          // and a click that only emitted would leave the handles unreachable by any gesture.
          ctx.selectEdge(edge);
          ctx.emit({ type: 'edgeClick', edge: { id: edge, source: '', target: '', type: '' } });
          return true;
        }
        ctx.select([]);
        return;
      }
      ctx.select([id], input.shiftKey ? 'toggle' : 'replace');
      if (options.emitClick) ctx.emit({ type: 'nodeClick', node: { id, kind: 'entity', type: '' } });
      return true;
    },
  };
}

export interface ConnectNodesOptions {
  /**
   * Whether the gesture is live. Defaults to true.
   *
   * An option rather than a modifier key, because the modifiers are taken and the ones left do not
   * travel. Shift already extends the selection; `PointerInput` carries no `ctrlKey`; and `metaKey`
   * is Command on a Mac and Super on Linux, where it is usually the window manager's. More
   * importantly a modifier-only gesture is invisible — nobody discovers it, and a touchscreen has
   * no modifiers at all.
   *
   * So a template arms it from its own control, which also gives the user somewhere to see that
   * dragging currently means connecting rather than moving. Disarmed, this claims nothing and the
   * press falls through to whatever handles nodes next — normally `drag-node`.
   */
  armed?: boolean;
}

/**
 * Drag from one node to another to connect them.
 *
 * Emits `edgeCreate` and writes nothing. What connecting two things *means* is the consumer's —
 * a knowledge map creates a relationship record, an outline would reparent — and a behaviour that
 * assumed one would be useless to the others. The same rule `we-sortable` follows.
 *
 * Must be listed **before** `drag-node`: both claim a press on a node, and whichever comes first
 * wins. After it, arming the gesture would do nothing at all and look like a broken toggle.
 */
export function connectNodesBehaviour(rawOptions?: Record<string, unknown>): Behaviour {
  const options = { armed: true, ...(rawOptions as ConnectNodesOptions) };
  let from: string | null = null;

  /** End the gesture and take down the line, whatever the outcome. */
  function reset(ctx: BehaviourContext): void {
    from = null;
    ctx.drawConnection(null);
  }

  return {
    id: 'connect-nodes',
    description: 'Drag from one node to another to connect them.',
    onPointerDown(input, ctx) {
      if (!options.armed) return;
      const [hit] = ctx.hitTest(ctx.toWorld(input.at));
      if (!hit) return;
      from = hit;
      return true;
    },
    onPointerMove(input, ctx) {
      if (!from) return;
      // Same guard as the drag behaviour: no button held means no gesture, whatever this thinks.
      // Without it a dropped pointer-up leaves a line following the cursor around the canvas.
      if (input.buttons === 0) {
        reset(ctx);
        return;
      }
      ctx.drawConnection(from, ctx.toWorld(input.at));
      return true;
    },
    onPointerCancel(_input, ctx) {
      reset(ctx);
    },
    onPointerUp(input, ctx) {
      if (!from) return;
      const source = from;
      const [target] = ctx.hitTest(ctx.toWorld(input.at));
      reset(ctx);
      // A node cannot be connected to itself, and a release on empty canvas is an abandoned
      // gesture rather than a connection to nothing. Both end quietly: the line goes and no event
      // is emitted, so nothing opens a dialog about a connection the user did not make.
      if (!target || target === source) return;
      ctx.emit({
        type: 'edgeCreate',
        source: { id: source, kind: 'entity', type: '' },
        target: { id: target, kind: 'entity', type: '' },
      });
      return true;
    },
  };
}

export interface MarqueeSelectOptions {
  /**
   * Whether a *plain* background drag sweeps out a selection instead of panning. Defaults to false.
   *
   * Off, the gesture is still reachable by holding the multi-select modifier, which is what makes it
   * discoverable-by-accident for anyone who has used another canvas. On, it takes the background
   * outright and panning moves to the modifier — which is the mode a template arms from a visible
   * toggle, for the reason `connect-nodes` does: a touchscreen has no modifiers, and a gesture with
   * no control anywhere is a gesture nobody finds.
   */
  armed?: boolean;
}

/**
 * Sweep a rectangle over the canvas to select what it touches.
 *
 * ## Why this claims the background rather than owning a mode
 *
 * The obvious alternative was to make a plain left-drag on empty canvas always sweep, the way Figma
 * and Miro do, and move panning onto space-drag. That is a bigger change than it looks: panning is
 * this canvas's most-used gesture, it is the only one that works identically under a finger, and a
 * template cannot opt out of a decision made in the engine. So the sweep is *additive* — it takes
 * the press only when the modifier is down or a template has armed it, and otherwise the press falls
 * through to `pan-zoom` exactly as before.
 *
 * **List it before `pan-zoom`.** Both want a press on empty canvas and dispatch stops at the first
 * behaviour that claims, so listed after it this never runs at all — the same trap `select`
 * documents, and the same silent failure: the canvas pans, no rectangle appears, and nothing
 * anywhere says why.
 *
 * ## It selects while you sweep, not on release
 *
 * Every move recomputes the whole selection from the rectangle rather than adding to it, which is
 * what lets the sweep *shrink*: pull the corner back over a card and its ring goes away again. The
 * additive spelling — select what is inside, every frame — can only ever grow, so overshooting by a
 * card would leave it selected with no way back but starting over.
 *
 * The set the sweep starts from is captured at the press. With the modifier held that is whatever
 * was already selected, so a sweep adds to a selection built by clicking; without it, nothing.
 *
 * ## A press that never travels is not a sweep, and this has to say so itself
 *
 * Below the drag threshold nothing is drawn and no rectangle is ever selected from. But clearing the
 * selection on such a press is **this behaviour's job**, not `select`'s, and that is the one piece of
 * plumbing here that is not obvious.
 *
 * `onPointerDown` is not a broadcast phase: claiming it stops `select` seeing the press at all, so
 * `select` has nothing to compare the release against and its background-clear never runs. Armed,
 * that made the canvas impossible to deselect on — every click on empty space left the previous
 * selection ringed, with no gesture anywhere that would drop it.
 *
 * So a press that went nowhere clears, exactly as `select` would have. With the modifier held it
 * does not: that press was reaching for "add to what I have", and answering it by throwing the
 * selection away is the opposite of what was asked.
 */
export function marqueeSelectBehaviour(rawOptions?: Record<string, unknown>): Behaviour {
  const options = { armed: false, ...(rawOptions as MarqueeSelectOptions) };
  /** Where the sweep began, in world units — see `drawMarquee` for why this is not screen space. */
  let from: Point | null = null;
  /** What was selected when it began, which an additive sweep adds to. */
  let base: string[] = [];
  /** Screen-space press point, for the threshold — a world-space one would change meaning with zoom. */
  let pressedAt: Point | null = null;
  let sweeping = false;
  /** Whether the press was adding to a selection, remembered so the release can tell. */
  let extending = false;

  function reset(ctx: BehaviourContext): void {
    from = null;
    pressedAt = null;
    sweeping = false;
    extending = false;
    base = [];
    ctx.drawMarquee(null);
  }

  return {
    id: 'marquee-select',
    description: 'Drag a rectangle over empty canvas to select everything it touches.',
    onPointerDown(input, ctx) {
      const adding = input.shiftKey || input.ctrlKey;
      if (!options.armed && !adding) return;
      // A press on a card is that card's, whatever mode this is in: sweeping out from under a node
      // would make it impossible to drag one while the tool is armed.
      if (ctx.hitTest(ctx.toWorld(input.at)).length) return;
      pressedAt = input.at;
      from = ctx.toWorld(input.at);
      extending = adding;
      base = adding ? ctx.selection() : [];
      sweeping = false;
      return true;
    },
    onPointerMove(input, ctx) {
      if (!from || !pressedAt) return;
      // The same guard `drag-node` carries: no button held means no gesture, whatever this thinks.
      if (input.buttons === 0) {
        reset(ctx);
        return;
      }
      if (!sweeping) {
        if (Math.hypot(input.at.x - pressedAt.x, input.at.y - pressedAt.y) <= DRAG_THRESHOLD) return true;
        sweeping = true;
      }
      const bounds = boundsFromPoints(from, ctx.toWorld(input.at));
      ctx.drawMarquee(bounds);
      // Recomputed from the base every frame rather than accumulated — see the note above.
      ctx.select([...new Set([...base, ...ctx.within(bounds)])], 'replace');
      return true;
    },
    onPointerCancel(_input, ctx) {
      reset(ctx);
    },
    onPointerUp(_input, ctx) {
      if (!from) return;
      const swept = sweeping;
      const wasExtending = extending;
      reset(ctx);
      // A press on empty canvas that went nowhere means "deselect" — and `select` never saw it, so
      // saying so is this behaviour's job. See the note above.
      if (!swept && !wasExtending) ctx.select([]);
      return true;
    },
  };
}

/** Double-click a node to open or close it — the gesture that drives resolution. */
export function expandOnDoubleClickBehaviour(rawOptions?: Record<string, unknown>): Behaviour {
  const options = (rawOptions ?? {}) as { direction?: 'in' | 'out' | 'both' };
  return {
    id: 'expand-on-double-click',
    description: 'Double-click a node to expand it, or collapse it if it is already open.',
    onDoubleClick(input, ctx) {
      const [hit] = ctx.hitTest(ctx.toWorld(input.at));
      if (!hit) return;
      ctx.expand(hit, options.direction);
      return true;
    },
  };
}

/**
 * Double-click a node to say "open this".
 *
 * The counterpart to `canvas-double-click`, and the thing that makes `onNodeDoubleClick` reachable
 * at all: the event was declared in the protocol and routed by the adapter, and **no behaviour ever
 * emitted it**, so a template binding the prop got silence. Declared-and-unimplemented is the
 * quietest kind of gap — everything typechecks, the wiring reads as complete, and the gesture just
 * does nothing.
 *
 * Emits and does nothing else. What opening a node *means* is the consumer's: a canvas opens the
 * card, an explorer might do what `expand-on-double-click` does instead. Which is why the two are
 * separate behaviours rather than one with a mode — a template lists whichever it means, and
 * listing both would have the first claim the gesture.
 */
export function nodeDoubleClickBehaviour(): Behaviour {
  return {
    id: 'node-double-click',
    description: 'Double-click a node to open it.',
    onDoubleClick(input, ctx) {
      const [hit] = ctx.hitTest(ctx.toWorld(input.at));
      if (!hit) return;
      ctx.emit({ type: 'nodeDoubleClick', node: { id: hit, kind: 'entity', type: '' } });
      return true;
    },
  };
}

/**
 * Double-click empty canvas to say "make something here".
 *
 * Emits `canvasDoubleClick` with the world point and writes nothing, like every other gesture here.
 * The position is the whole of the message: on a surface where position *is* the data, "make
 * something" is not a request anybody can act on and "make something here" is.
 *
 * Claims only the background, so it composes with `expand-on-double-click` — a double-click on a
 * node opens it, a double-click beside one creates. Which order they are listed in does not matter
 * for the same reason: they never both match.
 */
export function canvasDoubleClickBehaviour(): Behaviour {
  return {
    id: 'canvas-double-click',
    description: 'Double-click empty canvas to create something at that point.',
    onDoubleClick(input, ctx) {
      const at = ctx.toWorld(input.at);
      if (ctx.hitTest(at).length) return;
      ctx.emit({ type: 'canvasDoubleClick', at });
      return true;
    },
  };
}

/** Single click expands instead of selecting — for maps meant to be explored rather than edited. */
export function expandOnClickBehaviour(rawOptions?: Record<string, unknown>): Behaviour {
  const options = (rawOptions ?? {}) as { direction?: 'in' | 'out' | 'both' };
  let pressedId: string | null = null;

  return {
    id: 'expand-on-click',
    description: 'Click a node to expand it in place.',
    onPointerDown(input, ctx) {
      pressedId = ctx.hitTest(ctx.toWorld(input.at))[0] ?? null;
    },
    onPointerUp(_input, ctx) {
      const id = pressedId;
      pressedId = null;
      if (!id) return;
      ctx.expand(id, options.direction);
      return true;
    },
  };
}

export interface ArrangeNodesOptions {
  /**
   * Whether a drag may change the order of siblings. Default true. False where siblings are ordered by
   * something a drag cannot change — a date, a tally — so a card can still be moved under another parent,
   * and lands where that order puts it, but is never shown sliding into a place it would not keep.
   */
  reorder?: boolean;
  /**
   * Fields of a connection that keep a card in its tree. A drag into the unconnected zone is refused for a card
   * whose connection to its parent holds a value in any of them — and shown refused, rather than shown
   * happening and then turned down. Which connections are worth keeping is the host's to say: WE passes
   * `['commentsCount', 'signalsCount']`, because it will not delete a connection people have discussed.
   */
  keep?: string[];
  /** What the preview says when it refuses for that reason. */
  keepReason?: string;
  /**
   * For a layout that reports no hierarchy: how far from a card, in world units, a drop still counts as
   * beside it. Beyond it the drop is loose.
   */
  reach?: number;
  /** For a layout that reports no hierarchy: how tall the band searched for siblings is, in world units. */
  band?: number;
}

/** What a drop reports, in the terms the host writes it in. */
type ArrangeEvent = { into: 'child' | 'sibling' | 'loose'; target?: string; before?: boolean; order?: string[] };

/** What a drop at some point would do: where it puts the card, what it reports, and why not when it is refused. */
type Decision = { to: ArrangeState['to']; event?: ArrangeEvent; refused?: string };

/**
 * One place a held card could go, and where its ghost would be drawn there — asked of the layout the first
 * time the card reaches the place's level. `to` null is the card's own place.
 */
interface Place extends Decision {
  at?: Point | null;
}

/**
 * Drag a card to another place in a hierarchy — along a row to reorder it, under another parent to move it,
 * beneath a card with no children to make it the first, into the unconnected zone to take it out of its tree.
 *
 * ## Why this is not `drag-node` with a flag
 *
 * `drag-node` moves a card and reports where it ended up, because on a canvas the position **is** the
 * data. Here the position is derived: the layout decides it, and what the drag means is a change to the
 * *structure* the layout reads. Dropping a card two pixels to the left of where it started must write
 * nothing at all, where on a canvas it writes a coordinate. List this one where the layout derives
 * positions and `drag-node` where they come from the data — listing both has them fight for the press.
 *
 * ## The preview is the drop
 *
 * While a card is held, the engine lays the tree out as if the drop were already written: the other cards
 * make room, and the empty place the card would land in is drawn as a ghost with the line it would have —
 * see `ArrangeState`. So the reader sees the result before committing to it, and there is nothing to guess.
 * On release the card travels into that place and stays there while the write goes through.
 *
 * ## The place whose ghost is nearest the card
 *
 * Every place a card could go — each gap in each parent's row, the level beneath each card with no
 * children, and its own place — is asked of the layout: where would the card be drawn if it went there?
 * The place chosen is the one whose answer is nearest the middle of the card in the hand, on the level the
 * card is on. So the ghost is always the drop spot closest to the card, by construction.
 *
 * Measuring anything else drifts. A gap measured against the tree as it stood is a slot out once the
 * card's own slot has closed and the trees beside it have slid over; measured against the tree without
 * the card, the card's own place is claimed by whichever tree closed up into it; measured from the pointer,
 * a card picked up by its edge opens gaps beside itself. The layout's own answers need no correcting,
 * because making room is what the layout does.
 *
 * - **On a level**, the whole width belongs to one place or another, so moving along a level only ever
 *   moves the ghost along that level.
 * - **Between levels**, nothing changes: the last place shown stays, so crossing the gap between two ranks
 *   does not send the tree back to where it started and out again.
 * - **In the unconnected zone**, it comes out of its tree — unless {@link ArrangeNodesOptions.keep} says its
 *   connection cannot go, in which case the preview says so.
 * - **Over its own place, or well off the tree**, it goes back where it was, and a drop there writes nothing.
 *
 * Each level is asked once, when the card first reaches it, and kept: the answers do not depend on the
 * pointer, and a tree of a few hundred cards would pay a visible pause asking for every level at once.
 *
 * A card cannot go under itself or anything beneath it, so its own subtree offers no place at all.
 *
 * On a layout that reports no hierarchy there is nothing to preview against, and the gesture falls back to
 * reporting what a drop beside, onto or away from a card means — see `intentAt` below.
 */
export function arrangeNodesBehaviour(rawOptions?: Record<string, unknown>): Behaviour {
  const options = { reach: 240, band: 0, reorder: true, ...(rawOptions as ArrangeNodesOptions) };
  let dragging: string | null = null;
  let moved = false;
  let grabOffset = { x: 0, y: 0 };

  // ─── With a hierarchy: the preview ──────────────────────────────────────────

  /** The places a drop can land, by the depth of the level they are on. */
  let levels = new Map<number, Place[]>();
  /** How far down each level's ghosts are drawn — asked once per level, for the band a card is in. */
  let levelY = new Map<number, number>();
  /** Half the height of the card in the hand: how far from a level's line it still counts as on it. */
  let halfHeight = 0;
  let home: { parent: string | null; index: number } = { parent: null, index: 0 };
  /** The connection holding the dragged card under its parent, if it has one. */
  let homeEdge: string | undefined;
  /** How far past the tree the card can go before a drop means "never mind". */
  let reach: Bounds | null = null;
  /** The place last shown, which holds while the card is between levels. */
  let current: Decision = { to: null };

  const inside = (box: Bounds, at: Point) =>
    at.x >= box.minX && at.x <= box.maxX && at.y >= box.minY && at.y <= box.maxY;

  /** Every place the card could go, by level, with where each level lies — taken when a drag begins. */
  const snapshot = (ctx: BehaviourContext, id: string): boolean => {
    const tree = ctx.hierarchy();
    if (!tree) return false;
    const subtree = new Set([id]);
    for (const member of subtree) for (const child of tree.children.get(member) ?? []) subtree.add(child);
    const parent = tree.parents.get(id) ?? null;
    home = { parent, index: parent ? (tree.children.get(parent) ?? []).indexOf(id) : 0 };
    homeEdge = tree.parentEdges.get(id);
    current = { to: null };
    levels = new Map();
    levelY = new Map();

    const depthOf = (card: string) => {
      let depth = 0;
      for (let at = tree.parents.get(card); at && depth < 1000; at = tree.parents.get(at)) depth++;
      return depth;
    };
    const add = (depth: number, place: Place) => (levels.get(depth) ?? levels.set(depth, []).get(depth)!).push(place);

    // Its own place, where it is drawn now — the one place that needs no asking.
    const own = ctx.boundsOf(id);
    const ownAt = ctx.positionOf(id);
    halfHeight = own ? (own.maxY - own.minY) / 2 : 0;
    add(depthOf(id), { to: null, at: ownAt });

    const inTree = new Set([...tree.parents.keys(), ...tree.parents.values()]);
    for (const card of inTree) {
      if (!card || subtree.has(card)) continue;
      const kids = (tree.children.get(card) ?? []).filter((kid) => kid !== id);
      const depth = depthOf(card) + 1;
      if (!options.reorder) {
        // No position to ask for: the card joins that parent wherever the order puts it, and is written last.
        if (card !== home.parent) add(depth, { to: { parent: card }, event: { into: 'child', target: card } });
        continue;
      }
      for (let index = 0; index <= kids.length; index++) {
        if (card === home.parent && index === home.index) continue;
        const order = [...kids];
        order.splice(index, 0, id);
        add(depth, {
          to: { parent: card, index },
          event: kids.length
            ? { into: 'sibling', target: kids[Math.min(index, kids.length - 1)], before: index < kids.length, order }
            : { into: 'child', target: card, order },
        });
      }
    }

    // Where each level lies: one answer per level, from any place on it.
    for (const [depth, places] of levels) {
      const probe = places.find((place) => place.to);
      const at = probe ? ctx.placesOf(id, [probe.to!])[0] : places[0].at;
      if (probe) probe.at = at;
      if (at) levelY.set(depth, at.y);
    }

    /*
      Off the tree is past every card in a tree and every level a place is on, by a card's size — a drop
      out there means "never mind", which is how a reader takes a card back and has to stay easy to reach.
    */
    const boxes = [...inTree]
      .flatMap((card) => (card ? [ctx.boundsOf(card)] : []))
      .filter((box): box is Bounds => !!box);
    const width = own ? own.maxX - own.minX : 0;
    const ys = [...levelY.values()];
    reach = boxes.length
      ? {
          minX: Math.min(...boxes.map((box) => box.minX)) - width,
          maxX: Math.max(...boxes.map((box) => box.maxX)) + width,
          minY: Math.min(...boxes.map((box) => box.minY), ...ys) - 2 * halfHeight,
          maxY: Math.max(...boxes.map((box) => box.maxY), ...ys) + 2 * halfHeight,
        }
      : null;
    return true;
  };

  /** A level's places with where each would be drawn, asking the layout for any not yet known. */
  const placesOn = (depth: number, ctx: BehaviourContext): Place[] => {
    const places = levels.get(depth) ?? [];
    const unknown = places.filter((place) => place.at === undefined && place.to);
    if (unknown.length && dragging) {
      const answers = ctx.placesOf(
        dragging,
        unknown.map((place) => place.to!),
      );
      unknown.forEach((place, i) => (place.at = answers[i]));
    }
    return places;
  };

  /** Whether a connection holds anything {@link ArrangeNodesOptions.keep} says it must be kept for. */
  const kept = (ctx: BehaviourContext): boolean => {
    const edge = homeEdge ? ctx.edgeOf(homeEdge) : null;
    const data = (edge?.data ?? {}) as Record<string, unknown>;
    return (options.keep ?? []).some((field) => {
      const value = data[field];
      return value !== undefined && value !== null && value !== '' && value !== 0 && value !== false;
    });
  };

  /** What a drop with the card's middle here would do. */
  const decide = (centre: Point, ctx: BehaviourContext): Decision => {
    if (ctx.regionAt(centre)) {
      if (!home.parent) return { to: null };
      if (kept(ctx))
        return { to: null, refused: options.keepReason || 'This connection can’t be removed by dragging.' };
      return { to: { parent: null }, event: { into: 'loose' } };
    }
    if (!reach || !inside(reach, centre)) return { to: null };
    // The level the card is on — within half a card of its line — or none, between two.
    let depth: number | undefined;
    let nearest = Infinity;
    for (const [level, y] of levelY) {
      const off = Math.abs(y - centre.y);
      if (off <= halfHeight && off < nearest) [depth, nearest] = [level, off];
    }
    if (depth === undefined) return current;
    let best: Place | undefined;
    let gap = Infinity;
    for (const place of placesOn(depth, ctx)) {
      if (!place.at) continue;
      const off = Math.abs(place.at.x - centre.x);
      if (off < gap) [best, gap] = [place, off];
    }
    if (!best) return current;
    return { to: best.to, ...(best.event ? { event: best.event } : {}) };
  };

  /**
   * The middle of the card in the hand, which is what a place is decided from.
   *
   * Not the pointer: a card picked up by its edge has most of itself off to one side, and a gap that opened
   * where the pointer is rather than where the card visibly is would open beside the card, not under it.
   */
  const centreOf = (world: Point): Point => ({ x: world.x + grabOffset.x, y: world.y + grabOffset.y });

  /** Hold the card at the pointer, and tell the engine where the drop would put it. */
  const show = (world: Point, ctx: BehaviourContext) => {
    if (!dragging) return;
    current = decide(centreOf(world), ctx);
    ctx.arrange({
      id: dragging,
      at: centreOf(world),
      to: current.to,
      ...(current.refused ? { refused: current.refused } : {}),
    });
  };

  // ─── Without one: reporting the intent ──────────────────────────────────────

  /** The height of the card being dragged, for the band searched for siblings. */
  let bandHeight = 0;
  let previewing = false;

  /** What a drop at this point means, and what it is about — for a layout that reports no hierarchy. */
  const intentAt = (world: Point, ctx: BehaviourContext, id: string): ArrangeEvent => {
    // A named zone first: the `forest`'s unconnected cards are cards at similar heights, so without
    // this a drop into it reads as a reorder — the opposite of what dragging out of a tree means.
    if (ctx.regionAt(world)) return { into: 'loose' };

    const over = ctx.hitTest(world).find((other) => other !== id);
    if (over) return { into: 'child', target: over };

    const half = (options.band || bandHeight || 0) / 2;
    if (half > 0) {
      const band = ctx.within({
        minX: world.x - options.reach,
        minY: world.y - half,
        maxX: world.x + options.reach,
        maxY: world.y + half,
      });
      let nearest: string | undefined;
      let distance = Infinity;
      for (const other of band) {
        if (other === id) continue;
        const at = ctx.positionOf(other);
        if (!at) continue;
        const gap = Math.abs(at.x - world.x);
        // Ties break on the id so a pointer exactly between two cards does not depend on index order.
        if (gap < distance || (gap === distance && nearest !== undefined && other < nearest)) {
          distance = gap;
          nearest = other;
        }
      }
      if (nearest !== undefined && distance <= options.reach) {
        const at = ctx.positionOf(nearest)!;
        return { into: 'sibling', target: nearest, before: world.x < at.x };
      }
    }
    return { into: 'loose' };
  };

  const release = () => {
    dragging = null;
    moved = false;
    current = { to: null };
  };

  return {
    id: 'arrange-nodes',
    description:
      'Drag a card along a row to reorder it, under another parent to move it, beneath a card with no children to make it the first, or into the unconnected zone to take it out of its tree — with the tree making room as you go. Reports the result; writes nothing.',
    onPointerDown(input, ctx) {
      // Refused at the start rather than by discarding the result, like every other gesture that moves
      // a card: a drag that follows the pointer and then snaps back has told you it worked.
      if (ctx.locked()) return;
      const world = ctx.toWorld(input.at);
      const [hit] = ctx.hitTest(world);
      if (!hit) return;
      dragging = hit;
      moved = false;
      const at = ctx.positionOf(hit);
      grabOffset = at ? { x: at.x - world.x, y: at.y - world.y } : { x: 0, y: 0 };
      bandHeight = 0;
      previewing = snapshot(ctx, hit);
      return true;
    },
    onPointerMove(input, ctx) {
      if (!dragging) return;
      // No button held means no drag, whatever this behaviour thinks — the pointer left the window, or
      // something upstream swallowed the release.
      if (input.buttons === 0) {
        if (previewing && moved) ctx.arrange(null);
        else ctx.drawConnection(null);
        release();
        return;
      }
      moved = true;
      const world = ctx.toWorld(input.at);
      if (previewing) {
        show(world, ctx);
        return true;
      }
      ctx.pin(dragging, { x: world.x + grabOffset.x, y: world.y + grabOffset.y });
      /*
        Measured from where the card is, not from a constant: the band searched for siblings should be
        one rank tall, and a rank is as tall as the cards on it. Taken from the grab offset, which is
        half the card's height at most — so a card grabbed near its edge searches a narrower band, which
        errs toward "loose" and therefore toward writing nothing.
      */
      if (!options.band) bandHeight = Math.max(bandHeight, Math.abs(grabOffset.y) * 2, 1);
      const fallback = intentAt(world, ctx, dragging);
      // A line only for `child`, which is the one intent the geometry cannot show.
      ctx.drawConnection(fallback.into === 'child' && fallback.target ? fallback.target : null, world);
      return true;
    },
    onPointerCancel(_input, ctx) {
      if (previewing && moved) ctx.arrange(null);
      ctx.drawConnection(null);
      release();
    },
    onPointerUp(input, ctx) {
      if (!dragging) return;
      const id = dragging;
      const wasMoved = moved;
      const world = ctx.toWorld(input.at);
      const at = { x: world.x + grabOffset.x, y: world.y + grabOffset.y };

      if (previewing) {
        const { to, event } = wasMoved ? decide(centreOf(world), ctx) : { to: null, event: undefined };
        release();
        /*
          A press that went nowhere is a click, and must fall through: `select` is listed after this one
          and would otherwise never see a press on a card at all, so nothing on the tree could be
          selected or opened.
        */
        if (!wasMoved) return;
        // Back where it was: the card travels home and nothing is written.
        if (!to || !event) {
          ctx.arrange(null);
          return true;
        }
        // Into the place the preview showed, held there until the write comes back.
        ctx.arrange({ id, at: null, to });
        ctx.emit({
          type: 'nodeArrange',
          node: { id, kind: 'entity', type: '' },
          into: event.into,
          ...(event.target ? { target: { id: event.target, kind: 'entity' as const, type: '' } } : {}),
          ...(event.before === undefined ? {} : { before: event.before }),
          ...(event.order ? { order: event.order } : {}),
          at,
        });
        return true;
      }

      release();
      ctx.drawConnection(null);
      if (!wasMoved) {
        ctx.pin(id, null);
        return;
      }
      const fallback = intentAt(world, ctx, id);
      /*
        Released back to the layout, whatever the consumer decides. The drop wrote nothing here, so the card
        has to be governed by the arrangement again — left pinned, a card whose move the consumer refused
        would sit in the gap it was dropped in, looking as though the refusal had worked.
      */
      ctx.pin(id, null);
      ctx.emit({
        type: 'nodeArrange',
        node: { id, kind: 'entity', type: '' },
        into: fallback.into,
        ...(fallback.target ? { target: { id: fallback.target, kind: 'entity' as const, type: '' } } : {}),
        ...(fallback.before === undefined ? {} : { before: fallback.before }),
        at,
      });
      return true;
    },
  };
}

/** The default set, keyed by the id a template names in `behaviours`. */
export function defaultBehaviours() {
  return {
    'pan-zoom': panZoomBehaviour,
    'drag-node': dragNodeBehaviour,
    'arrange-nodes': arrangeNodesBehaviour,
    'connect-nodes': connectNodesBehaviour,
    'canvas-double-click': canvasDoubleClickBehaviour,
    'node-double-click': nodeDoubleClickBehaviour,
    'marquee-select': marqueeSelectBehaviour,
    select: selectBehaviour,
    'expand-on-click': expandOnClickBehaviour,
    'expand-on-double-click': expandOnDoubleClickBehaviour,
  };
}

/**
 * Dispatch one input through an ordered behaviour list, stopping at the first that claims it.
 *
 * Here rather than in the renderer so the ordering rule has exactly one implementation — a second
 * renderer resolving precedence slightly differently would be a bug nobody could see.
 */
/**
 * Phases where "I claimed this" must **not** stop later behaviours running.
 *
 * Claiming answers "who is handling this gesture", and that is the right rule while a gesture is in
 * progress. It is the wrong rule for the event that *ends* one: a behaviour holding state across a
 * gesture has to be told the gesture finished, whether or not something ahead of it also cared.
 *
 * Getting this wrong produced a genuinely confusing bug. On a canvas the order is
 * `[pan-zoom, select, drag-node]`; a plain click on a node let `select` claim the pointer-up, so
 * `drag-node` never learned the press had ended, kept its node latched, and the next mouse movement —
 * with no button held — dragged it. From the outside: click a node once and it sticks to the cursor,
 * with no obvious way to put it down.
 */
const BROADCAST_PHASES = new Set(['onPointerUp', 'onPointerCancel']);

export function dispatchPointer(
  behaviours: Behaviour[],
  phase: 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onWheel' | 'onDoubleClick',
  input: PointerInput,
  ctx: BehaviourContext,
): void {
  const broadcast = BROADCAST_PHASES.has(phase);
  for (const behaviour of behaviours) {
    const claimed = behaviour[phase]?.(input, ctx) === true;
    if (claimed && !broadcast) return;
  }
}
