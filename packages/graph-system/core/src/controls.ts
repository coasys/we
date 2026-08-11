/**
 * The graph's own chrome, as data.
 *
 * A control declares an icon, a title and what it does; the renderer draws every one of them the same
 * way. That is deliberate on two counts.
 *
 * It keeps them **framework-neutral** — a control is a plain object, so a module can contribute one
 * without shipping Solid code and without the second-runtime hazard that comes with it. And it keeps
 * them **consistent**: the first two modules to need an entry point each drew their own floating
 * button in a different corner, which is how the host-owned module rail came to exist. Controls are
 * the same lesson applied inside one component — the contributor knows what a control *means*, the
 * renderer knows where chrome goes and how it should look.
 *
 * The contract is narrow on purpose. A control nudges the view; it does not edit the graph. Anything
 * that needs to change data is a behaviour or an action on the host, not a button the engine draws.
 */
import type { ControlContext, GraphControl } from '@we/graph-protocol';

/** How much one press of the zoom buttons moves the camera. */
const ZOOM_STEP = 1.25;

export function zoomInControl(): GraphControl {
  return {
    id: 'zoom-in',
    icon: 'plus',
    title: 'Zoom in',
    run: (ctx: ControlContext) => ctx.zoomBy(ZOOM_STEP),
  };
}

export function zoomOutControl(): GraphControl {
  return {
    id: 'zoom-out',
    icon: 'minus',
    title: 'Zoom out',
    // The reciprocal rather than a rounder number, so in-then-out returns you exactly where you were.
    run: (ctx: ControlContext) => ctx.zoomBy(1 / ZOOM_STEP),
  };
}

export function fitControl(): GraphControl {
  return {
    id: 'fit',
    icon: 'arrows-out',
    title: 'Fit to view',
    // Frames what is there; deliberately not a re-layout, which would move nodes the user placed.
    run: (ctx: ControlContext) => ctx.fit(),
  };
}

/**
 * Re-run the layout.
 *
 * Not shown by default: on an explorer it is a rescue for a tangled force graph, and on a board it
 * would throw away every position somebody chose. A template asks for it when it makes sense.
 */
export function relayoutControl(): GraphControl {
  return {
    id: 'relayout',
    icon: 'arrows-clockwise',
    title: 'Re-run layout',
    run: (ctx: ControlContext) => ctx.relayout(),
  };
}

/**
 * Hold the selected nodes where they are, so the layout stops moving them.
 *
 * The standard way to shape a force layout: put the thing you care about where you want it, hold it
 * there, and let everything else settle around it. Acting on the selection rather than inventing a
 * gesture keeps it discoverable — there is a button, and it says what it will do — and reuses the
 * selection people are already making.
 *
 * Not shown by default. On a board every node is pinned already and the control means nothing; it
 * earns its place on a graph whose positions are derived.
 */
export function pinControl(): GraphControl {
  return {
    id: 'pin',
    icon: 'push-pin',
    title: 'Hold the selection in place',
    activeIcon: 'push-pin-slash',
    activeTitle: 'Release the selection back to the layout',
    // Active only when *every* selected node is held: a mixed selection offers to pin the rest,
    // which is the more useful of the two readings and the one that cannot lose work.
    active: (ctx) => ctx.selection().length > 0 && ctx.selection().every((id) => ctx.isPinned(id)),
    enabled: (ctx) => ctx.selection().length > 0,
    run: (ctx) => {
      const ids = ctx.selection();
      ctx.setPinned(ids, !ids.every((id) => ctx.isPinned(id)));
    },
  };
}

/**
 * Stop the graph being rearranged by accident.
 *
 * About the user, not the layout: a locked force graph still settles, it just cannot be dragged. The
 * request behind this is always "I am reading, or showing someone, and I do not want to nudge
 * anything" — freezing a simulation is a different thing that nobody asks for.
 *
 * Not shown by default either. It is only meaningful where dragging is possible, which the template
 * already decides by listing `drag-node`.
 */
export function lockControl(): GraphControl {
  return {
    id: 'lock',
    icon: 'lock-open',
    title: 'Lock the graph so nodes cannot be moved',
    activeIcon: 'lock',
    activeTitle: 'Unlock the graph',
    active: (ctx) => ctx.isLocked(),
    run: (ctx) => ctx.setLocked(!ctx.isLocked()),
  };
}

/** Shown when a template says nothing: look closer, look wider, see everything. */
export const DEFAULT_CONTROLS = ['zoom-in', 'zoom-out', 'fit'];

/** The built-in set, keyed by the id a template names. */
export function defaultControls(): Record<string, () => GraphControl> {
  return {
    'zoom-in': zoomInControl,
    'zoom-out': zoomOutControl,
    fit: fitControl,
    relayout: relayoutControl,
    pin: pinControl,
    lock: lockControl,
  };
}
