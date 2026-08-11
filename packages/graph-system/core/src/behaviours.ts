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
import type { Behaviour, BehaviourContext, PointerInput } from '@we/graph-protocol';

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
 * Drag a node to reposition it. Pins while dragging; releases unless `pin` is set.
 *
 * The grab offset is the whole difference between this feeling like dragging and feeling like
 * teleporting. Setting the node's position *to* the pointer snaps its centre under the cursor the
 * instant you move — so grabbing a node near its edge makes it jump, which reads as a glitch even
 * though the drag then tracks correctly. Recording where inside the node you took hold of it, and
 * preserving that, means the node moves with your hand.
 */
export function dragNodeBehaviour(rawOptions?: Record<string, unknown>): Behaviour {
  const options = { pin: false, ...(rawOptions as { pin?: boolean }) };
  let dragging: string | null = null;
  let moved = false;
  /** Node position minus grab position, in world units. Constant for the life of one drag. */
  let grabOffset = { x: 0, y: 0 };

  return {
    id: 'drag-node',
    description: 'Drag a node to move it, from wherever you took hold of it.',
    onPointerDown(input, ctx) {
      const world = ctx.toWorld(input.at);
      const [hit] = ctx.hitTest(world);
      if (!hit) return;
      dragging = hit;
      moved = false;
      const at = ctx.positionOf(hit);
      grabOffset = at ? { x: at.x - world.x, y: at.y - world.y } : { x: 0, y: 0 };
      return true;
    },
    onPointerMove(input, ctx) {
      if (!dragging) return;
      // Independent of the dispatch fix above: if no button is held there is no drag, whatever this
      // behaviour thinks. Covers the pointer leaving the window, a cancelled gesture, and any future
      // ordering mistake that swallows the pointer-up again.
      if (input.buttons === 0) {
        dragging = null;
        return;
      }
      moved = true;
      const world = ctx.toWorld(input.at);
      ctx.pin(dragging, { x: world.x + grabOffset.x, y: world.y + grabOffset.y });
      return true;
    },
    onPointerCancel() {
      dragging = null;
    },
    onPointerUp(input, ctx) {
      if (!dragging) return;
      const id = dragging;
      dragging = null;
      if (!moved) return;
      const world = ctx.toWorld(input.at);
      const at = { x: world.x + grabOffset.x, y: world.y + grabOffset.y };
      // Released rather than left pinned by default: on an explorer, a dragged node that stays put
      // fights the layout for every subsequent expansion. A board passes `pin: true`.
      if (!options.pin) ctx.pin(id, null);
      // The node's position, not the pointer's — what a board persists has to be where the node
      // actually ended up.
      ctx.emit({ type: 'nodeDragEnd', node: { id, kind: 'entity', type: '' }, position: at });
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

/** The default set, keyed by the id a template names in `behaviours`. */
export function defaultBehaviours() {
  return {
    'pan-zoom': panZoomBehaviour,
    'drag-node': dragNodeBehaviour,
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
 * Getting this wrong produced a genuinely confusing bug. On a board the order is
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
