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

/** Shown when a template says nothing: look closer, look wider, see everything. */
export const DEFAULT_CONTROLS = ['zoom-in', 'zoom-out', 'fit'];

/** The built-in set, keyed by the id a template names. */
export function defaultControls(): Record<string, () => GraphControl> {
  return {
    'zoom-in': zoomInControl,
    'zoom-out': zoomOutControl,
    fit: fitControl,
    relayout: relayoutControl,
  };
}
