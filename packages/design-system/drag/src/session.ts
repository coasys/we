/**
 * The drag session — one at a time, per window.
 *
 * ## What this owns, and what it does not
 *
 * A drag has three parts, and only two of them are surface-specific:
 *
 * 1. **The gesture** — what counts as picking something up. Surface-specific, and correctly so: the
 *    graph has to arbitrate a press against pan and zoom, the editor's handle is also the OS
 *    file-drop path, a card is just a card.
 * 2. **The session** — what is in flight, what is under the pointer, what the ghost looks like, what
 *    happens on release, how it is cancelled. Identical everywhere, and before this was written
 *    five times.
 * 3. **The payload** — what the receiver is given. Each surface invented one; a panel that gathers
 *    things from anywhere needs one vocabulary.
 *
 * This is (2) and (3). Each existing mechanism *feeds* it rather than *becomes* it.
 *
 * ## Why coordinates rather than events
 *
 * The gesture captures the pointer on its origin, so for the rest of the drag **no other element
 * receives a pointer event**. Hit-testing is therefore done by asking every registered zone whether
 * its rectangle contains the point, innermost first. That is also what makes a drop work into a zone
 * the source has never heard of, which is the entire purpose.
 *
 * ## Why not native drag-and-drop
 *
 * Native DnD buys OS integration and nothing else: it cannot do touch at all, its drag image is a
 * fixed snapshot that cannot be restyled mid-drag, and a zone may inspect `dataTransfer` **types**
 * but not values until the drop fires — so "do I accept this?" has to be smuggled into a MIME
 * string. It stays as an adapter at the edges (OS files in, a `text/uri-list` out), never as the
 * substrate.
 */
import { autoscroll } from './autoscroll';
import { createGhost, type Ghost } from './ghost';
import type { DragPayload, DragPoint, DragZone, DropContext, GhostSpec } from './types';
import { createZoneRegistry } from './zoneRegistry';

/** Marks the zone a drop would land in. Zones style themselves off it. */
export const DROP_TARGET_ATTR = 'data-we-drop-target';
/** On `<html>` while any drag is in flight, so hover chrome elsewhere can stand down. */
export const DRAGGING_ATTR = 'data-we-dragging';
/** Fired on `document` whenever a drag starts or ends. */
export const DRAG_CHANGE_EVENT = 'we-drag-change';

/** How long the pointer must rest on a zone before its `onDwell` fires. */
const DWELL_MS = 600;

/** Where the pointer sits inside a chip ghost — below and right, so it never covers the target. */
const CHIP_OFFSET = { x: 14, y: 14 };

export interface BeginOptions {
  payload: DragPayload;
  /** Where the pointer is now. */
  pointer: DragPoint;
  /** Omit for a chip built from the payload — the right default for a drag that crosses the UI. */
  ghost?: GhostSpec;
  /** Where within the ghost the pointer sits. Defaults to the chip offset, or the clone's grab point. */
  ghostOffset?: DragPoint;
  /** The element the drag came from, for a zone that wants to refuse its own source. */
  from?: Element;
}

interface Current {
  payload: DragPayload;
  ghost: Ghost;
  offset: DragPoint;
  from?: Element;
  zone: DragZone | null;
  dwellTimer?: ReturnType<typeof setTimeout>;
  dwelledOn?: DragZone;
}

const registry = createZoneRegistry<DragZone>((zone) => zone.el);

let current: Current | null = null;
/** A keyboard-held payload: no pointer, a zone chosen with the arrow keys. */
let held: { payload: DragPayload; zone: DragZone | null; from?: Element } | null = null;
/** Presses another mechanism has taken, so two do not both claim one gesture. */
const claimed = new WeakSet<PointerEvent>();

function announce() {
  const on = !!current || !!held;
  if (on) document.documentElement.setAttribute(DRAGGING_ATTR, '');
  else document.documentElement.removeAttribute(DRAGGING_ATTR);
  document.dispatchEvent(new CustomEvent(DRAG_CHANGE_EVENT, { detail: { active: on } }));
}

function context(zone: DragZone, point: DragPoint): DropContext {
  return { payload: (current ?? held)!.payload, point, zone };
}

function accepts(zone: DragZone, payload: DragPayload, from?: Element): boolean {
  // Never into the thing being dragged: nesting is DOM containment, so this needs no knowledge of
  // anybody's data model — the same check `we-sortable` makes for cycles.
  if (from && from.contains(zone.el)) return false;
  return zone.accepts ? zone.accepts(payload) : true;
}

function leaveZone(zone: DragZone | null) {
  if (!zone) return;
  zone.el.removeAttribute(DROP_TARGET_ATTR);
  zone.onLeave?.();
}

function clearDwell() {
  if (current?.dwellTimer !== undefined) clearTimeout(current.dwellTimer);
  if (current) {
    current.dwellTimer = undefined;
    current.dwelledOn = undefined;
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  if (!current && !held) return;
  e.preventDefault();
  dragSession.cancel();
}

export const dragSession = {
  /** What is in flight, or `null`. Chrome that should stand down mid-drag reads this. */
  active(): DragPayload | null {
    return current?.payload ?? held?.payload ?? null;
  },

  /** The zone a release would drop into right now, or `null`. */
  targetZone(): DragZone | null {
    return current?.zone ?? held?.zone ?? null;
  },

  /**
   * Register a drop target. Returns the unregistration.
   *
   * Registration is tied to connect/disconnect at every call site, so a zone removed mid-drag stops
   * being a candidate rather than leaving a stale rectangle behind.
   */
  registerZone(zone: DragZone): () => void {
    registry.add(zone);
    return () => {
      if (current?.zone === zone) current.zone = null;
      if (held?.zone === zone) held.zone = null;
      zone.el.removeAttribute(DROP_TARGET_ATTR);
      registry.remove(zone);
    };
  },

  /**
   * Say a press belongs to one mechanism, so another does not also claim it.
   *
   * Two gesture systems on one page must not both act on one press — a `we-draggable` card inside a
   * `we-sortable` row is the case that forced this. The deeper element claims first, because its
   * `pointerdown` handler runs before the ancestor's on the way up.
   */
  claimPress(e: PointerEvent): void {
    claimed.add(e);
  },

  isClaimed(e: PointerEvent): boolean {
    return claimed.has(e);
  },

  /** Pick something up. Ends any drag already running rather than stacking a second one. */
  begin(options: BeginOptions): void {
    if (current || held) this.cancel();

    const spec: GhostSpec = options.ghost ?? {
      kind: 'chip',
      label: options.payload.items[0]?.label ?? 'Item',
      icon: options.payload.items[0]?.icon,
      count: options.payload.items.length,
    };
    const offset =
      options.ghostOffset ?? (spec.kind === 'chip' ? { x: -CHIP_OFFSET.x, y: -CHIP_OFFSET.y } : { x: 0, y: 0 });

    current = {
      payload: options.payload,
      ghost: createGhost(spec),
      offset,
      from: options.from,
      zone: null,
    };
    current.ghost.moveTo(options.pointer.x - offset.x, options.pointer.y - offset.y);
    document.addEventListener('keydown', onKeyDown, true);
    announce();
    this.move(options.pointer);
  },

  /** The pointer moved. Updates the ghost, the target zone, and the scroll. */
  move(point: DragPoint): void {
    if (!current) return;
    current.ghost.moveTo(point.x - current.offset.x, point.y - current.offset.y);
    autoscroll(point.x, point.y);

    const next = registry.at(point.x, point.y, (zone) => accepts(zone, current!.payload, current!.from));
    if (next !== current.zone) {
      leaveZone(current.zone);
      clearDwell();
      current.zone = next;
      if (next) {
        next.el.setAttribute(DROP_TARGET_ATTR, '');
        next.onEnter?.(context(next, point));
        // Spring-loading: resting on a collapsed drawer or a closed panel opens it, so a drag can
        // reach somewhere that is not on screen when it starts.
        if (next.onDwell) {
          const zone = next;
          current.dwellTimer = setTimeout(() => {
            if (current?.zone === zone) {
              current.dwelledOn = zone;
              zone.onDwell?.();
            }
          }, DWELL_MS);
        }
      }
    }
    current.zone?.onOver?.(context(current.zone, point));
  },

  /** Release. Drops into whatever is under the pointer, or does nothing if that is nowhere. */
  drop(point?: DragPoint): void {
    if (!current) return;
    const { zone, payload } = current;
    const at = point ?? { x: 0, y: 0 };
    this.end();
    if (zone) zone.onDrop?.({ payload, point: at, zone });
  },

  /** Abandon. Escape, a cancelled pointer, or a second drag beginning. */
  cancel(): void {
    if (held) {
      leaveZone(held.zone);
      held = null;
      announce();
    }
    this.end();
  },

  /** Tear down without dropping. Public so a gesture that owns its own release can use it. */
  end(): void {
    if (!current) return;
    clearDwell();
    leaveZone(current.zone);
    current.ghost.destroy();
    current = null;
    document.removeEventListener('keydown', onKeyDown, true);
    announce();
  },

  // ── The keyboard path ─────────────────────────────────────────────────────
  //
  // Built in rather than added later, because a panel you can only fill by dragging is a panel some
  // people cannot fill at all — and because the drop is the same call, a zone gets it for nothing.

  /** Pick something up without a pointer. The first accepting zone is selected. */
  beginKeyboard(payload: DragPayload, from?: Element): void {
    if (current || held) this.cancel();
    held = { payload, zone: null, from };
    document.addEventListener('keydown', onKeyDown, true);
    this.cycleKeyboard(1);
    announce();
  },

  /** Move the selection to the next (or previous) accepting zone, in registration order. */
  cycleKeyboard(delta: 1 | -1): void {
    if (!held) return;
    const candidates = registry
      .list()
      .filter((zone) => zone.el.isConnected && accepts(zone, held!.payload, held!.from));
    if (!candidates.length) return;
    const at = held.zone ? candidates.indexOf(held.zone) : -1;
    const next = candidates[(at + delta + candidates.length) % candidates.length];
    if (next === held.zone) return;
    leaveZone(held.zone);
    held.zone = next;
    next.el.setAttribute(DROP_TARGET_ATTR, '');
    next.onEnter?.(context(next, { x: 0, y: 0 }));
  },

  /** Drop what is held into the selected zone. */
  dropKeyboard(): void {
    if (!held) return;
    const { zone, payload } = held;
    leaveZone(zone);
    held = null;
    announce();
    if (zone) zone.onDrop?.({ payload, point: { x: 0, y: 0 }, zone });
  },

  /** Whether a keyboard drag is running — the two paths differ only in how a zone is chosen. */
  keyboardActive(): boolean {
    return !!held;
  },
};
