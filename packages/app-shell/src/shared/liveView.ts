/**
 * The screen, as the `view` kernel sees it — where this agent's pointer is, what is in view, and what
 * to draw on top of it.
 *
 * ## Why this is the host's and not a module's
 *
 * Every answer here comes from something a module cannot see: the graph engine's camera, the DOM under
 * the pointer, the router, and the insets the shell's panels have taken. A module that reached for any
 * of them would break the next time the shell rearranged itself. What is left for a module is the part
 * that is genuinely its own — when to publish, how often, what a mark looks like, who may see it — and
 * that is exactly the line `ViewKernel` draws.
 *
 * ## Two kinds of surface, because there are two kinds of coordinate
 *
 * A **world** surface is a canvas: it has a camera, its content is stored in its own coordinate space,
 * and it draws its own marks inside the layer that camera transforms. The graph registers one per
 * canvas and reads back the marks addressed to it; nothing here positions those, because doing it
 * outside the transformed layer would mean recomputing every mark on every pan.
 *
 * A **dom** surface is everything else — a board, a calendar, a feed. It has no camera, so a mark is
 * placed against a record's box or against a fraction of the content region, and the overlay does that
 * positioning in screen pixels. There is exactly one of these at a time and it is the route.
 *
 * ## Nothing here is a pixel on the wire
 *
 * `LiveAnchor` carries a frame and coordinates within it, and a receiver that does not have that frame
 * draws nothing. See the type's own note for why a pixel offset is wrong in every case that matters:
 * the sender cannot see it go wrong, because their own cursor is always in the right place.
 */
import { RECORD_ATTR } from '@we/design-utils';
import type { LiveAnchor, LiveDecoration, ViewFrame } from '@we/module-shared';

/** How long a region a follower was sent stays worth applying. See {@link requestRegion}. */
export const REGION_FRESH_MS = 2_000;

/** A surface's key, as {@link LiveAnchor.surface} carries it. */
export const canvasSurface = (canvasId: string): string => `canvas:${canvasId}`;
export const routeSurface = (path: string): string => `route:${path}`;

/**
 * Where a decoration's coordinates land, given a box to measure against.
 *
 * Fractions rather than pixels, and of the record's *own* box, so a card that is wider on the
 * receiving screen still has its marks in the same places relative to what it is showing.
 */
export function fractionsIn(
  box: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number },
) {
  return {
    x: box.width > 0 ? (point.x - box.x) / box.width : 0,
    y: box.height > 0 ? (point.y - box.y) / box.height : 0,
  };
}

/**
 * The box an element stands for, following the marker-has-no-box rule.
 *
 * `we-draggable` is `display: contents`, so the element carrying `data-we-record` very often has an
 * empty rect with the real box one level down — see `RECORD_ATTR`. Measuring the marker blindly
 * returns a zero rect and collapses every fraction into a corner, which looks like every cursor
 * stacking in the top-left of a card rather than like a bug.
 */
export function boxOf(element: Element): DOMRect | null {
  const own = element.getBoundingClientRect();
  if (own.width > 0 || own.height > 0) return own;
  for (const child of element.children) {
    const box = child.getBoundingClientRect();
    if (box.width > 0 || box.height > 0) return box;
  }
  return null;
}

/** The nearest element standing for a record, at or above this one. */
export function recordAt(target: Element | null): { record: string; box: DOMRect } | null {
  const marker = target?.closest(`[${RECORD_ATTR}]`);
  if (!marker) return null;
  const record = marker.getAttribute(RECORD_ATTR);
  const box = boxOf(marker);
  return record && box ? { record, box } : null;
}

/**
 * Where a client point is, in whichever frame best describes it — a record if there is one under it,
 * otherwise a fraction of the content region.
 *
 * The record is preferred whenever there is one because it is the frame that survives: a board with
 * different column widths puts the same fraction of the same card in the same place, where the same
 * fraction of the content region is a different card entirely.
 */
export function anchorForPoint(
  surface: string,
  point: { x: number; y: number },
  target: Element | null,
  content: { x: number; y: number; width: number; height: number },
): LiveAnchor | null {
  const hit = recordAt(target);
  if (hit) {
    const at = fractionsIn(hit.box, point);
    return { surface, kind: 'record', record: hit.record, x: at.x, y: at.y };
  }
  if (content.width <= 0 || content.height <= 0) return null;
  const at = fractionsIn(content, point);
  // Outside the content region entirely — over a panel, over the sidebar. Nothing to say: the
  // reader has left the shared surface, and a fraction outside 0..1 would be drawn off the edge of
  // somebody else's content box as though it meant something.
  if (at.x < 0 || at.x > 1 || at.y < 0 || at.y > 1) return null;
  return { surface, kind: 'viewport', x: at.x, y: at.y };
}

/**
 * Where an anchor sits **inside a container laid over the content box** — as CSS, ready for `left`/`top`.
 *
 * ## Why this is not `pointForAnchor` with a subtraction
 *
 * Because of what it must NOT do. A mark that is eased carries a transition, and a transition
 * interpolates whatever value changes — so every quantity baked into that value becomes something the
 * easing animates. Two quite different motions reach a mark:
 *
 * - **its own**, as a new position arrives: a peer moved their pointer, or the harness ticked. Arriving
 *   at about twelve hertz, this is exactly what wants smoothing, and is the only reason `ease` exists.
 * - **the projection**, as the box the anchor is a fraction *of* changes: a panel is dragged, a lane is
 *   resized, the window changes. The mark has not moved at all; where that fraction lands has.
 *
 * Easing the second one is wrong twice over. It makes a mark lag behind the layout it is pinned to, and
 * the updates arrive far faster than the transition lasts, so each one restarts from wherever the last
 * had reached and the mark shakes in place making almost no progress until the drag ends.
 *
 * Suspending the easing during a drag — which is what this replaced — trades that for the other half of
 * the same problem: the mark's *own* motion stops being smoothed too, so the twelve-hertz arrivals
 * become visible hops for as long as the drag lasts. Better, and still wrong.
 *
 * So the two motions are separated instead, and CSS does it for nothing. A **percentage** is the whole
 * trick: `left: 52%` has a computed value that does not change when its container is resized, so the
 * painted position follows the box instantly with no transition to fire, while a genuinely new anchor
 * changes the percentage and is interpolated as before. The container absorbs the projection; the
 * percentage carries the motion.
 *
 * A record-anchored mark is in pixels, because a record's box is not the container and cannot be made
 * into one. That is sound because such a mark is never eased: it is where its card is.
 *
 * `null` on the same terms as `pointForAnchor`.
 */
export function placementIn(
  anchor: LiveAnchor,
  content: { x: number; y: number; width: number; height: number },
  root: ParentNode = document,
): { left: string; top: string } | null {
  if (anchor.kind === 'viewport') {
    // Straight through, with no reference to the box at all — which is the point.
    return { left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` };
  }
  const at = pointForAnchor(anchor, content, root);
  if (!at) return null;
  return { left: `${at.x - content.x}px`, top: `${at.y - content.y}px` };
}

/**
 * Where an anchor lands on *this* screen, in client pixels — the inverse, for drawing.
 *
 * `null` where the frame cannot be resolved: a record that is not on screen, a surface that is not the
 * one being shown. That is the ordinary case for a peer looking at something else, and drawing nothing
 * is the right answer rather than a guess.
 */
export function pointForAnchor(
  anchor: LiveAnchor,
  content: { x: number; y: number; width: number; height: number },
  root: ParentNode = document,
): { x: number; y: number } | null {
  if (anchor.kind === 'record') {
    if (!anchor.record) return null;
    // Attribute selectors need the value escaped: a record id is a uri in some backends, and a
    // stray quote or bracket turns a lookup into a thrown `SyntaxError` inside a pointer handler.
    const marker = markerFor(anchor.record, root);
    if (!marker) return null;
    const box = boxOf(marker);
    if (!box) return null;
    return { x: box.x + anchor.x * box.width, y: box.y + anchor.y * box.height };
  }
  if (anchor.kind === 'viewport') {
    return { x: content.x + anchor.x * content.width, y: content.y + anchor.y * content.height };
  }
  // A world point belongs to a canvas, which draws its own marks inside the layer its camera
  // transforms — see the note at the top of this file.
  return null;
}

/**
 * `CSS.escape`, with a fallback for a host that lacks it.
 *
 * **Called on `CSS`, not extracted from it.** `CSS.escape` is a static method that checks its
 * receiver, so `const escape = CSS.escape; escape(value)` throws `'escape' called on an object that is
 * not a valid instance of CSS` — under jsdom certainly, and by specification anywhere. The thrown
 * version of this sat inside a pointer handler, which is the worst place for it.
 */
/**
 * The element standing for a record on this screen, or null.
 *
 * One place, because the escaping is not optional: a record id is a uri in some backends, and a stray
 * quote or bracket turns a lookup into a thrown `SyntaxError` inside a pointer handler.
 */
export function markerFor(record: string, root: ParentNode = document): Element | null {
  if (!record) return null;
  return root.querySelector(`[${RECORD_ATTR}="${cssEscape(record)}"]`);
}

/**
 * What to scroll to put a record where a driver had it, and by how much.
 *
 * ## Why the window is the wrong answer
 *
 * A scroll anchor used to be applied with `window.scrollBy`, which works only where the content
 * scrolls the page. Half of what a person reads in WE does not: a transcript scrolls inside its panel, a
 * board column scrolls inside itself, a thread scrolls inside a card. Following somebody reading a
 * transcript therefore did nothing at all, silently, because the window had nothing to scroll.
 *
 * So the scroller is the record's own nearest scrollable ancestor, and the window is the fallback rather
 * than the assumption.
 *
 * ## Why the target edge differs
 *
 * An anchor means "this record was at the top of what I could see, scrolled past by this fraction of its
 * own height". For the page, the top of what you can see is the top of the content box. For a nested
 * scroller it is that element's own top edge, which is where the record has to end up.
 *
 * Returns the delta rather than performing the scroll, so the arithmetic can be tested without a layout.
 */
export function scrollPlan(
  marker: Element,
  at: { y: number },
  content: { y: number },
): { scroller: Element | null; top: number } {
  const scroller = scrollerFor(marker);
  const edge = scroller ? scroller.getBoundingClientRect().top : content.y;
  return { scroller, top: at.y - edge };
}

/**
 * The nearest ancestor that actually scrolls, or null for the window.
 *
 * Both halves are needed. An element can declare `overflow: auto` and have nothing to scroll, in which
 * case scrolling it is a no-op and the page was meant; and an element can have overflowing content with
 * `overflow: visible`, in which case it is the page that scrolls. So the test is a scrolling overflow
 * *and* something to scroll.
 */
export function scrollerFor(element: Element): Element | null {
  let node: Element | null = element.parentElement;
  const root = element.ownerDocument?.documentElement;
  while (node && node !== root && node !== element.ownerDocument?.body) {
    const style = element.ownerDocument?.defaultView?.getComputedStyle(node);
    const overflow = `${style?.overflowY ?? ''} ${style?.overflow ?? ''}`;
    const scrolls = /auto|scroll|overlay/.test(overflow);
    if (scrolls && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

function cssEscape(value: string): string {
  const css = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS;
  if (typeof css?.escape === 'function') return css.escape(value);
  // Enough for an attribute selector's quoted value, which is the only thing this builds.
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * The record nearest the top of what is visible, and how far it is scrolled past.
 *
 * What a scrolling surface has instead of a camera. A pixel offset is the same mistake as a pixel
 * cursor one axis along — the follower's content is a different height, so the same number is a
 * different place in the list — where "this card, a third of the way past it" survives a different
 * column width, a different font size and a different window.
 *
 * The first record whose box reaches the top of the content region, in document order. Reading the DOM
 * rather than tracking scroll, because it is asked for at whatever rate a module samples it and the
 * alternative is a scroll listener maintaining state nobody may ever read.
 */
export function scrollAnchor(
  content: { x: number; y: number; width: number; height: number },
  root: ParentNode = document,
): { record: string; offset: number } | undefined {
  for (const marker of root.querySelectorAll(`[${RECORD_ATTR}]`)) {
    const box = boxOf(marker);
    const record = marker.getAttribute(RECORD_ATTR);
    if (!box || !record || box.height <= 0) continue;
    // Its bottom is still below the top edge, so this is the first one not yet scrolled away.
    if (box.y + box.height <= content.y) continue;
    if (box.y > content.y + content.height) break;
    return { record, offset: (content.y - box.y) / box.height };
  }
  return undefined;
}

// ── The registry ─────────────────────────────────────────────────────────────

/** A world surface that draws its own marks — a canvas, registered by the graph host. */
interface WorldSurface {
  key: string;
  /** The region the surface last reported as visible, for {@link composeFrame}. */
  region?: { x: number; y: number; width: number; height: number };
}

/**
 * The live-view state the host holds, as one object.
 *
 * A plain module rather than a store, for the reason `moduleHostServices` is one: this is a seam
 * between the host's own components and the modules it lends capabilities to, and it is never read by
 * a template. A store would have to be classified in `templateSurface.ts` and described in the
 * generated reference, which would be claiming a public API for something deliberately internal.
 */
export interface LiveViewState {
  /** Canvases on screen, by surface key, in registration order. */
  surfaces: Map<string, WorldSurface>;
  /** Accessors a module registered through `decorate`. */
  marks: Set<() => LiveDecoration[]>;
  /** Callbacks a module registered through `onPointer`. */
  pointerListeners: Set<(at: LiveAnchor | null) => void>;
  /** The last anchor reported per source, so the more precise one wins — see {@link reportPointer}. */
  pointerBySource: Map<string, LiveAnchor | null>;
  /** A region a follower was asked to frame, by surface key, with when it was asked. */
  requested: Map<string, { region: { x: number; y: number; width: number; height: number }; at: number }>;
}

export function createLiveViewState(): LiveViewState {
  return {
    surfaces: new Map(),
    marks: new Set(),
    pointerListeners: new Set(),
    pointerBySource: new Map(),
    requested: new Map(),
  };
}

/**
 * Which anchor to publish, given what each source last said.
 *
 * A canvas's report wins over the document's whenever it has one. Both sources see the same pointer —
 * a `pointermove` over a canvas reaches the document handler as well — and the canvas's answer is the
 * better one: world coordinates in the surface the content is actually stored in, rather than a
 * fraction of the content region that happens to contain a canvas. The document's answer is what is
 * left when the pointer is over anything else.
 */
export function currentPointer(state: LiveViewState): LiveAnchor | null {
  for (const [source, anchor] of state.pointerBySource) {
    if (source !== 'document' && anchor) return anchor;
  }
  return state.pointerBySource.get('document') ?? null;
}

/** Report a pointer position from one source, and tell every listener what the answer now is. */
export function reportPointer(state: LiveViewState, source: string, anchor: LiveAnchor | null): void {
  state.pointerBySource.set(source, anchor);
  const at = currentPointer(state);
  for (const listener of state.pointerListeners) {
    try {
      listener(at);
    } catch (error) {
      // One module throwing must not deafen another, and must not unwind into a pointer handler.
      console.warn('view: a pointer listener threw', error);
    }
  }
}

/** Every mark a module currently wants drawn, whatever surface it is for. */
export function allMarks(state: LiveViewState): LiveDecoration[] {
  const out: LiveDecoration[] = [];
  for (const read of state.marks) {
    try {
      out.push(...read());
    } catch (error) {
      console.warn('view: a decoration accessor threw', error);
    }
  }
  return out;
}

/**
 * What this agent has in view.
 *
 * `surface` and `region` come from the canvas that most recently reported a camera. In every interface
 * that has one there is exactly one on screen, and picking the freshest is what keeps that true after a
 * route change without anything having to say which canvas is "the" canvas.
 *
 * ## Two halves of one address, and they are not interchangeable
 *
 * `path` is the **whole** address, query included, because that is what following somebody has to
 * reproduce — in WE half of what a page is showing lives in the query, so a follower sent a bare
 * pathname lands on the same route showing a different subject.
 *
 * `pathname` is what the **surface key** is built from, and it must not carry the query. A surface is a
 * piece of screen geometry, and two people on the same page with different view state are looking at the
 * same geometry. Building the key from the full address instead is a bug that hides well: the publisher
 * and the overlay both key on the pathname, so they agree with each other and disagree only with *this*
 * — which drops every mark whose surface came from here while real cursors between two peers keep
 * working. It is how the development harness came to draw nothing at all.
 */
export function composeFrame(
  state: LiveViewState,
  address: { path: string; pathname: string },
  content: { x: number; y: number; width: number; height: number },
  root: ParentNode = document,
): ViewFrame {
  const canvas = [...state.surfaces.values()].reverse().find((surface) => surface.region);
  if (canvas) return { path: address.path, surface: canvas.key, region: canvas.region };
  const anchor = scrollAnchor(content, root);
  return { path: address.path, surface: routeSurface(address.pathname), ...(anchor ? { anchor } : {}) };
}

/** Hold a region a follower should frame, until a surface picks it up or it goes stale. */
export function requestRegion(
  state: LiveViewState,
  key: string,
  region: { x: number; y: number; width: number; height: number },
  now = Date.now(),
): void {
  state.requested.set(key, { region, at: now });
}

/**
 * The region a surface should frame right now, or `null`.
 *
 * Expires, and that is the whole reason it is timestamped. A held region would re-frame a canvas that
 * remounts — a tab switched away from and back — long after anybody stopped following, dragging the
 * reader somewhere they did not ask to go. A follower who lands too late for one simply gets the
 * driver's next publish, which is why the protocol repeats a view on a slow timer rather than only on
 * change.
 */
export function regionFor(
  state: LiveViewState,
  key: string,
  now = Date.now(),
): { x: number; y: number; width: number; height: number } | null {
  const held = state.requested.get(key);
  if (!held) return null;
  if (now - held.at > REGION_FRESH_MS) return null;
  return held.region;
}

// ── The one registry, and why it is not the component's ──────────────────────

/**
 * The live-view state for this app.
 *
 * Module-level, and that is the whole point rather than a convenience. `PlatformProvider` builds every
 * module store *before* `App` renders, so a module registering a decoration accessor or a pointer
 * listener does so before any component exists. Forwarding those registrations through a component's
 * binding therefore threw them away: `services.view?.decorate(get)` was `undefined?.decorate` and
 * answered with a no-op unsubscribe, for ever, so nothing a module asked to draw was ever drawn and
 * this agent's pointer was never reported. Nothing threw; the feature simply did not exist.
 *
 * So registration lands here, where there is nothing to be early for. What genuinely needs the
 * component — the router, the DOM under the pointer, the shell's insets — stays behind
 * {@link ViewKernel.frame} and `apply`, which a module calls later and can honestly degrade.
 */
export const liveView = createLiveViewState();

/** Told whenever something registers or unregisters, so a renderer can re-read. */
const changeListeners = new Set<() => void>();

/**
 * Subscribe to registration changes. Returns its own unsubscribe.
 *
 * A plain listener set rather than a signal, because this file is framework-neutral and the thing that
 * needs to react is a Solid memo. The component turns these into a signal; nothing here knows how.
 */
export function onLiveViewChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function notifyLiveViewChanged(): void {
  for (const listener of changeListeners) {
    try {
      listener();
    } catch (error) {
      console.warn('view: a change listener threw', error);
    }
  }
}

/** Register a module's decoration accessor. Never forwarded — see {@link liveView}. */
export function addLiveMarks(get: () => LiveDecoration[]): () => void {
  liveView.marks.add(get);
  notifyLiveViewChanged();
  return () => {
    liveView.marks.delete(get);
    notifyLiveViewChanged();
  };
}

/** Register a module's pointer listener. Never forwarded, for the same reason. */
export function addLivePointerListener(cb: (at: LiveAnchor | null) => void): () => void {
  liveView.pointerListeners.add(cb);
  return () => liveView.pointerListeners.delete(cb);
}
