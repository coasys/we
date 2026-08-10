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
    onWheel(input, ctx) {
      if (input.delta === undefined) return;
      // Exponential so each notch is a constant *ratio*: zooming out then back in returns you to
      // exactly where you were, which linear stepping does not.
      ctx.zoomAt(input.at, Math.exp(-input.delta * options.zoomSpeed));
      return true;
    },
  };
}

/** Drag a node to reposition it. Pins while dragging; releases unless `pin` is set. */
export function dragNodeBehaviour(rawOptions?: Record<string, unknown>): Behaviour {
  const options = { pin: false, ...(rawOptions as { pin?: boolean }) };
  let dragging: string | null = null;
  let moved = false;

  return {
    id: 'drag-node',
    description: 'Drag a node to move it; optionally leaves it pinned where it was dropped.',
    onPointerDown(input, ctx) {
      const [hit] = ctx.hitTest(ctx.toWorld(input.at));
      if (!hit) return;
      dragging = hit;
      moved = false;
      return true;
    },
    onPointerMove(input, ctx) {
      if (!dragging) return;
      moved = true;
      ctx.pin(dragging, ctx.toWorld(input.at));
      return true;
    },
    onPointerUp(input, ctx) {
      if (!dragging) return;
      const id = dragging;
      dragging = null;
      if (!moved) return;
      const at = ctx.toWorld(input.at);
      // Released rather than left pinned by default: on an explorer, a dragged node that stays put
      // fights the layout for every subsequent expansion. A board passes `pin: true`.
      if (!options.pin) ctx.pin(id, null);
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
export function dispatchPointer(
  behaviours: Behaviour[],
  phase: 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onWheel' | 'onDoubleClick',
  input: PointerInput,
  ctx: BehaviourContext,
): void {
  for (const behaviour of behaviours) {
    if (behaviour[phase]?.(input, ctx) === true) return;
  }
}
