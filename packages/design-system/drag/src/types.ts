/**
 * What a drag carries, and what a zone is handed.
 *
 * The payload is **references, never DOM**. That is the whole distinction between this and the five
 * drag mechanisms that predate it: each of those carries something meaningful only to its own
 * surface — an index within a zone, a position in one document, a dock id — so nothing can be
 * carried from one surface to another. A reference is meaningful everywhere the app is.
 */

/**
 * What the app already calls a thing: (dataset, entity, id).
 *
 * `dataset` is **optional, and usually absent at the source**. A card in a feed cannot name its own
 * dataset without reading a store, and the fragments that render cards name no store by
 * construction — so the receiver stamps it, from whichever dataset was current when the drop
 * happened. A source in some *other* dataset sets it explicitly.
 */
export interface DragRef {
  dataset?: string;
  /** The model name — `CollectionBlock`, `Space`, `Agent`. What a zone's `accepts` tests. */
  entity: string;
  /** The record's id within its dataset. A DID, for an agent. */
  id: string;
}

/** One thing in flight. */
export interface DragItem {
  ref: DragRef;
  /** For the ghost, and for whatever the receiver writes down about it. */
  label: string;
  icon?: string;
  /** The source's own handle on it, for a move. Opaque to the session. */
  origin?: unknown;
}

/**
 * What the drop means to the *source*.
 *
 * `copy` is the default and what gathering is: the thing stays where it was. `move` says the source
 * will remove it, `link` that neither end changes and a third record now points at both.
 */
export type DragEffect = 'move' | 'copy' | 'link';

export interface DragPayload {
  items: DragItem[];
  effect: DragEffect;
}

export interface DragPoint {
  x: number;
  y: number;
}

/** What a zone's callbacks are handed. */
export interface DropContext {
  payload: DragPayload;
  /** Where the pointer is, in client coordinates. */
  point: DragPoint;
  /** The zone itself, so one handler can serve several registrations. */
  zone: DragZone;
}

/**
 * A registered drop target.
 *
 * Registered with an element rather than by listening on it, because hit-testing is done against
 * **coordinates**: a drag captures the pointer on its origin, so no other element sees a pointer
 * event for the rest of the gesture. That is also what makes a drop into a scrolled-away, nested or
 * newly-mounted zone work without any of them knowing about the source.
 */
export interface DragZone {
  el: Element;
  /**
   * Whether this zone will take that payload. Absent means yes.
   *
   * Asked on every move rather than once, so a zone may refuse on state that changes mid-drag.
   */
  accepts?: (payload: DragPayload) => boolean;
  onEnter?: (ctx: DropContext) => void;
  onOver?: (ctx: DropContext) => void;
  onLeave?: () => void;
  onDrop?: (ctx: DropContext) => void;
  /**
   * The pointer has rested here — open a collapsed drawer, or the panel this zone is inside.
   *
   * Spring-loading. Without it a drag can only reach a target that was already on screen when it
   * began, which for a docked panel means opening it first and remembering to.
   */
  onDwell?: () => void;
  /** Named for the keyboard path, which has to say where a held item would go. */
  label?: string;
}

/**
 * What the ghost looks like.
 *
 * Two kinds on purpose. `chip` is built from the payload and is right for a drag that crosses the
 * whole UI — a full-size card travelling that far covers the target it is aiming at. `clone` copies
 * an element already on screen, which is right for a reorder, where the thing being moved is the
 * thing you are looking at.
 *
 * A clone is **not** the general answer: `cloneNode(true)` does not copy shadow roots, so a clone of
 * anything containing a `we-image` or a block input is an empty box — exactly the case where a
 * ghost matters most. Reach for `clone` only where the items are plain light DOM.
 */
export type GhostSpec =
  | { kind: 'chip'; label: string; icon?: string; count?: number }
  | { kind: 'clone'; source: HTMLElement; rect: DOMRect };
