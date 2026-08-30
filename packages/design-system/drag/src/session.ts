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
  /**
   * Stop watching the pointer that started this drag.
   *
   * ## The bug this closes
   *
   * `begin` ends a session already running rather than stacking a second one, which is right — and
   * it did so without telling the *first* pointer's watcher, which is not. That watcher kept
   * listening: a second finger landing on another card ended finger A's session and started B's,
   * after which A's moves drove B's ghost and A's release **dropped B's payload at A's point**. Two
   * fingers on a touch screen is not an exotic input.
   *
   * So a gesture hands over the way to abandon it, and the session calls it whenever the drag it
   * belongs to is over — superseded, dropped or cancelled. `watchPointerDrag` already returns
   * exactly this function.
   */
  release?: () => void;
}

interface Current {
  payload: DragPayload;
  ghost: Ghost;
  offset: DragPoint;
  from?: Element;
  /** See {@link BeginOptions.release}. */
  release?: () => void;
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

/*
  What a keyboard drag says out loud.

  The pointer path needs nothing here: the ghost is on screen, the target zone is outlined, and a
  sighted user can see both. The keyboard path has neither — arrow keys move a selection between
  zones with no visual anchor to follow — so without an announcement it is a gesture that reports
  nothing at all. `DragZone.label` was declared for exactly this ("Named for the keyboard path,
  which has to say where a held item would go") and read nowhere.

  A polite live region rather than an alert: this narrates a deliberate act, and interrupting the
  user with each arrow press is worse than following along.
*/
let liveRegion: HTMLElement | null = null;

function say(message: string): void {
  if (typeof document === 'undefined') return;
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('role', 'status');
    // Visually hidden without `display: none`, which removes it from the accessibility tree too.
    liveRegion.style.cssText =
      'position:fixed;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';
    document.body.appendChild(liveRegion);
  }
  // Cleared first, so repeating the same sentence is announced again rather than swallowed as a
  // no-change — which is what pressing the same arrow twice at the end of a list produces.
  liveRegion.textContent = '';
  liveRegion.textContent = message;
}

/** How a payload refers to itself in an announcement. */
function payloadLabel(payload: DragPayload): string {
  const first = payload.items[0];
  const name = first?.label || first?.ref.entity || 'item';
  return payload.items.length > 1 ? `${payload.items.length} items` : name;
}

function context(zone: DragZone, point: DragPoint): DropContext {
  return { payload: (current ?? held)!.payload, point, zone };
}

function accepts(zone: DragZone, payload: DragPayload, from?: Element): boolean {
  // Never into the thing being dragged: nesting is DOM containment, so this needs no knowledge of
  // anybody's data model — the same check `we-sortable` makes for cycles.
  if (from && from.contains(zone.el)) return false;
  /*
    A container that will not take back what it already holds.

    Picking up a row inside the Pocket lit the whole panel as though it were being dragged in, and a
    release there writes nothing — the panel already has it. Containment again, so it needs no data
    model: the zone refuses a drag that began anywhere inside it.

    Deliberately **not** transitive. It applied to nested zones too at first, which silenced the
    folders and crumbs along with the panel — right while re-filing was impossible, wrong the moment
    it worked. A sub-zone is a different destination, and whether it accepts is its own business.
  */
  if (from && zone.rejectsOwn && zone.el.contains(from)) return false;
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

/*
  A drag the window stopped being able to see is a drag that is over.

  `pointercancel` is the ordinary end of an interrupted gesture, and the UA is not obliged to send
  one: alt-tabbing away, a notification taking focus, the tab going to the background. When it does
  not, the ghost stays on the screen in the top layer with nothing left to move it — visible, above
  everything, unremovable without a reload, and every zone still armed.

  Both events, because they are different failures: `blur` is "the window lost the pointer",
  `visibilitychange` is "this tab is not on screen at all". Neither can be a *drop*, since there is
  no point to drop at.
*/
function onWindowBlur() {
  if (current) dragSession.cancel();
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden' && current) dragSession.cancel();
}

function watchInterruptions(on: boolean): void {
  if (typeof window === 'undefined') return;
  const bind = on ? window.addEventListener : window.removeEventListener;
  bind.call(window, 'blur', onWindowBlur);
  const bindDoc = on ? document.addEventListener : document.removeEventListener;
  bindDoc.call(document, 'visibilitychange', onVisibilityChange);
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
   * Whether this zone would take what is in flight right now.
   *
   * For a zone deciding whether to show itself as available. It must be this rather than the zone's
   * own `accepts`, because the session applies rules the zone cannot see — never into the thing
   * being dragged, and `rejectsOwn`. A zone answering from its own predicate alone advertised itself
   * as a target and then refused the drop.
   */
  wouldAccept(zone: DragZone): boolean {
    const payload = this.active();
    if (!payload) return false;
    return accepts(zone, payload, current?.from ?? held?.from);
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

    /*
      A `node` by default, which asks the host to draw the real card and falls back to a chip when
      no host has registered a renderer. The fallback is why this is the default rather than an
      opt-in: a consumer that wants a card gets one, a consumer with no host gets exactly what it
      got before, and neither has to know which.
    */
    const spec: GhostSpec = options.ghost ?? { kind: 'node', items: options.payload.items };
    const offset =
      options.ghostOffset ?? (spec.kind === 'clone' ? { x: 0, y: 0 } : { x: -CHIP_OFFSET.x, y: -CHIP_OFFSET.y });

    current = {
      payload: options.payload,
      ghost: createGhost(spec),
      offset,
      from: options.from,
      release: options.release,
      zone: null,
    };
    current.ghost.moveTo(options.pointer.x - offset.x, options.pointer.y - offset.y);
    document.addEventListener('keydown', onKeyDown, true);
    watchInterruptions(true);
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
      const what = payloadLabel(held.payload);
      held = null;
      announce();
      say(`${what} put back.`);
    }
    this.end();
  },

  /** Tear down without dropping. Public so a gesture that owns its own release can use it. */
  end(): void {
    if (!current) return;
    clearDwell();
    leaveZone(current.zone);
    current.ghost.destroy();
    /*
      The pointer's watcher goes with the session, and is cleared *before* it is called: a release
      that reports a cancellation would re-enter here, and the second pass must find nothing.
    */
    const release = current.release;
    current = null;
    watchInterruptions(false);
    try {
      release?.();
    } catch (error) {
      console.warn('drag: a gesture threw while being released', error);
    }
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
    if (!held.zone) say(`${payloadLabel(payload)} picked up. Nowhere to put it.`);
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
    // A zone that did not name itself still gets said, as its position: "1 of 4" is less use than a
    // name and far more use than silence.
    const where = next.label || `destination ${candidates.indexOf(next) + 1} of ${candidates.length}`;
    say(`${payloadLabel(held.payload)} over ${where}. Space to drop, Escape to cancel.`);
  },

  /** Drop what is held into the selected zone. */
  dropKeyboard(): void {
    if (!held) return;
    const { zone, payload } = held;
    leaveZone(zone);
    held = null;
    announce();
    say(zone ? `${payloadLabel(payload)} dropped on ${zone.label || 'the selected destination'}.` : 'Nothing to drop.');
    if (zone) zone.onDrop?.({ payload, point: { x: 0, y: 0 }, zone });
  },

  /** Whether a keyboard drag is running — the two paths differ only in how a zone is chosen. */
  keyboardActive(): boolean {
    return !!held;
  },
};
