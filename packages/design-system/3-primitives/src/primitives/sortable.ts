import {
  createDropLine,
  createGhost,
  createZoneRegistry,
  dragSession,
  DROP_LINE_THICKNESS,
  type DropLine,
  type Ghost,
  watchPointerDrag,
} from '@we/drag';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const CSS_STYLES = css`
  :host {
    display: block;
    touch-action: none;
  }

  [part='container'] {
    display: flex;
    width: 100%;
    user-select: none;
  }

  /* The zone a drop would land in. Subtle on purpose: the indicator says *where*, this says
     *which* — and on a nested board both are on screen at once. */
  :host([data-drop-target]) [part='container'] {
    outline: 2px solid var(--we-role-accent, #93c5fd);
    outline-offset: 2px;
    border-radius: var(--we-radius-400, 8px);
  }
`;

/**
 * Every connected sortable, so a drag can find the zone under the pointer.
 *
 * Module-level rather than passed in, because the whole point is that a drag crosses elements that
 * do not know about each other: a card leaving one column has no reference to the column it lands
 * in, and threading one through every template that composes a board would defeat the purpose.
 *
 * Membership is tied to connect/disconnect, so a zone removed mid-drag simply stops being a
 * candidate rather than leaving a stale rectangle behind.
 *
 * The registry itself is `@we/drag`'s, along with the ghost, the drop line, the top-layer
 * promotion and the press-to-drag threshold — the awkward parts, which this element solved first
 * and every other draggable surface would otherwise have solved again. **The zones stay its own**:
 * a sortable item carries an index within a list, which is not a reference to anything, so it is
 * not yet a session payload and a card cannot be dropped into a column. Moving that boundary is a
 * separate piece of work with its own consequences for what a drop means.
 */
const zones = createZoneRegistry<Sortable>((zone) => zone);

/** What a drop is: an item, the zone it left, the zone it landed in, and where. */
export interface SortableMoveDetail {
  /** `data-we-id` of the item that moved. */
  id: string;
  /** `zone` of the sortable it came from. */
  from: string;
  /** `zone` of the sortable it landed in. */
  to: string;
  /** Position within the destination, after the move. */
  index: number;
  /** The destination's full order after the move — what a same-zone reorder needs. */
  ids: string[];
}

/**
 * A drop zone whose items can be picked up, reordered, and moved to other zones.
 *
 * ## One element, not two
 *
 * A zone *is* the container and its children *are* the items, which is what makes nesting free: a
 * sortable inside an item of another sortable is simply a zone inside a zone, with no special case
 * anywhere. A separate `we-drag-item` would buy nothing and cost boilerplate at every call site.
 *
 * ## It emits intent, it never mutates
 *
 * A drop fires {@link SortableMoveDetail} — "this item moved from there to here, at this index" —
 * and nothing else. What that *means* is the consumer's business, and it differs: a kanban route
 * keyed on `status` writes a scalar, a board built from containment relinks two `children` edges, an
 * outline reparents a node. A primitive that assumed one of those would be useless to the others.
 *
 * This is also why the element does not reorder its own DOM. The list is rendered from data; the
 * data changes; the list re-renders. A primitive that moved nodes itself would fight whatever
 * renders them.
 *
 * ## Nesting, and why cycles are not a problem
 *
 * The hard part of nested drag-and-drop is refusing to drop a container into its own descendant.
 * Because nesting here is expressed *in the DOM*, that check is `dragged.contains(zone)` — correct
 * by construction, needing no knowledge of the consumer's data shape. The innermost matching zone
 * under the pointer wins, so dropping into a nested list does not also count as dropping into its
 * parent.
 *
 * ## Keyboard
 *
 * Space or Enter picks up the focused item; the arrow keys move it, along the list and across
 * zones; Space drops and Escape cancels. Built in rather than added later, because a board that can
 * only be operated by dragging is a board some people cannot operate at all — and because the
 * events are identical, a consumer gets it for nothing.
 *
 * ## Items that contain form controls: `[data-we-handle]`
 *
 * By default the whole item is the grab area, which is right for a card or a nav row. It is wrong
 * the moment an item contains a text field: dragging to select text would start a drag, and — worse
 * — the keyboard pickup would read a **space typed into an input** as "pick this up", so the field
 * could not accept spaces at all.
 *
 * So two rules, both no-ops for an item without form controls:
 *
 * - Mark one or more descendants `data-we-handle`, and only a press that begins inside a handle
 *   starts a drag. An item with no handle keeps dragging from anywhere, so existing consumers are
 *   unaffected.
 * - A Space or Enter that originates in a text-entry element (`input`, `textarea`, `select`,
 *   `contenteditable`, including inside a component's shadow root) is typing, never a pickup. This
 *   applies whether or not the item declares handles, because an unfocusable-by-design input that
 *   swallows spaces is a bug in every consumer that could hit it.
 *
 * Make the handle itself focusable (a `we-button` will do) so the keyboard path stays open: Space
 * on a focused handle picks the row up exactly as it does on a plain item.
 *
 * @fires moved - detail: {@link SortableMoveDetail}, on every completed move
 * @fires reorder - detail: string[] — the destination's order, fired only when an item stayed in
 *   its own zone. A specialisation of `moved` for the common single-list case, kept because that is
 *   what a reorderable sidebar wants and it would otherwise have to filter every cross-zone move.
 */
@customElement('we-sortable')
export default class Sortable extends DesignSystemElement {
  static styles = [sharedStyles, CSS_STYLES];

  /** Flex direction of the sortable container. */
  @property({ type: String, reflect: true }) direction: 'vertical' | 'horizontal' = 'vertical';

  /** Gap between items — any valid CSS length, e.g. `'8px'` or `'var(--sidebar-gap)'`. */
  @property({ type: String, reflect: true }) gap: string = '';

  /**
   * This zone's identity, reported as `from`/`to` on a move.
   *
   * Defaults to empty, which is right for a lone list: a single-zone consumer never reads it.
   */
  @property({ type: String, reflect: true }) zone: string = '';

  /**
   * Which zones exchange items. Only zones sharing a group accept each other's.
   *
   * Empty means "this zone alone" — items can be reordered but never leave, which keeps a lone
   * sortable from silently becoming a drop target for an unrelated list on the same page.
   */
  @property({ type: String, reflect: true }) group: string = '';

  /** Refuse incoming items while still allowing its own to be dragged out. */
  @property({ type: Boolean, reflect: true }) locked = false;

  // ── Drag state (plain vars — not reactive, they don't drive rendering) ─────

  private _dragging: Element | null = null;
  private _ghost: Ghost | null = null;
  private _indicator: DropLine | null = null;
  /** The zone the pointer is currently over — may not be this one. */
  private _target: Sortable | null = null;
  private _dropIndex = -1;
  private _ghostOffsetX = 0;
  private _ghostOffsetY = 0;
  /** Abandons the press being watched — see `watchPointerDrag`. */
  private _stopWatch: (() => void) | null = null;

  /** Keyboard drag: the item picked up, and where it currently sits. */
  private _held: { item: Element; zone: Sortable; index: number } | null = null;

  // ── Slot helpers ──────────────────────────────────────────────────────────

  private get _slot(): HTMLSlotElement | null {
    return this.shadowRoot?.querySelector('slot') ?? null;
  }

  private _getItems(): Element[] {
    return (this._slot?.assignedElements() ?? []).map((el) => this._resolveItem(el));
  }

  /**
   * The element a slotted child actually *is*, once layout-transparent wrappers are seen through.
   *
   * Needed because this primitive was unusable from a template. The schema renderer wraps every
   * node in a `display: contents` div, so `assignedElements()` hands back wrappers rather than the
   * nodes an author wrote: no `data-we-id` on them, and — having no box — a zero rect, which broke
   * both halves of a drag at once.
   *
   * Resolving to the identified descendant fixes both, because `display: contents` promotes its
   * children to be the container's real flex items: the element carrying the id is also the element
   * carrying the geometry.
   */
  private _resolveItem(el: Element): Element {
    if (el.hasAttribute('data-we-id')) return el;
    return el.querySelector('[data-we-id]') ?? el;
  }

  private _getItemId(el: Element): string {
    return el.getAttribute('data-we-id') ?? '';
  }

  // ── Grab areas (see the `[data-we-handle]` note in the class doc) ──────────

  /**
   * Whether a gesture that arrived through `path` is allowed to drag `item`.
   *
   * An item declaring no handle drags from anywhere — the default, and what every consumer written
   * before handles existed relies on. One that declares handles drags only from them.
   */
  private _mayDrag(item: Element, path: EventTarget[]): boolean {
    if (!item.querySelector('[data-we-handle]')) return true;
    return path.some((node) => node instanceof Element && node.hasAttribute('data-we-handle'));
  }

  /** An element that owns its own text input: a space keypress there is typing, never a pickup. */
  private _isTextEntry(node: EventTarget): boolean {
    if (!(node instanceof HTMLElement)) return false;
    return (
      node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' || node.isContentEditable
    );
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connectedCallback() {
    super.connectedCallback();
    zones.add(this);
  }

  firstUpdated() {
    this.addEventListener('pointerdown', this._onPointerDown);
    this.addEventListener('keydown', this._onKeyDown);
    // Items are focusable so a keyboard user can reach one to pick it up. Done here rather than
    // asked of every consumer, since an unfocusable item is an inaccessible list by default.
    this._markItemsFocusable();
    this._slot?.addEventListener('slotchange', () => this._markItemsFocusable());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    zones.remove(this);
    this._endDrag();
  }

  private _markItemsFocusable() {
    for (const item of this._getItems()) {
      if (!item.hasAttribute('tabindex')) item.setAttribute('tabindex', '0');
    }
  }

  // ── Zone matching ─────────────────────────────────────────────────────────

  /** Whether this zone will take that item, given where it came from. */
  private _accepts(origin: Sortable, dragged: Element): boolean {
    if (this.locked) return false;
    if (this === origin) return true;
    // An empty group is a closed list: reorderable, but never a destination for anything else.
    if (!this.group || this.group !== origin.group) return false;
    // Never into its own subtree. Because nesting is DOM containment, this is the whole of cycle
    // prevention — no knowledge of the consumer's data required.
    return !dragged.contains(this);
  }

  /**
   * The zone under a point, innermost first.
   *
   * Innermost matters for nesting: a nested list sits inside its parent's rectangle, so both
   * contain the pointer and only the deeper one is the intended target.
   */
  private _zoneAt(x: number, y: number, dragged: Element): Sortable | null {
    return zones.at(x, y, (zone) => zone._accepts(this, dragged));
  }

  // ── Pointer ───────────────────────────────────────────────────────────────

  private _onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    // Somebody deeper in the tree has taken this press — a `we-draggable` card inside a row, say.
    // Two gesture systems acting on one press is two drags, and the inner one asked first.
    if (dragSession.isClaimed(e)) return;
    const path = e.composedPath();
    const dragged = this._getItems().find((item) => path.includes(item));
    if (!dragged || !this._mayDrag(dragged, path)) return;
    dragSession.claimPress(e);

    this._stopWatch = watchPointerDrag(e, {
      capture: this,
      onStart: (start) => this._startDrag(dragged, start),
      onMove: (move) => this._onDragMove(move),
      onEnd: () => this._onDragEnd(),
      onCancel: () => this._endDrag(),
    });
  };

  private _startDrag(dragged: Element, e: PointerEvent) {
    // Pointer capture (done by the watcher) is what keeps moves arriving after the pointer leaves
    // this element — which is exactly what a cross-zone drag does, and why hit-testing is done
    // against coordinates rather than by listening on each zone.
    this._dragging = dragged;
    this._target = this;
    this._dropIndex = this._getItems().indexOf(dragged);

    const rect = (dragged as HTMLElement).getBoundingClientRect();
    this._ghostOffsetX = e.clientX - rect.left;
    this._ghostOffsetY = e.clientY - rect.top;

    // A clone rather than a chip: the items here are plain light-DOM rows, and what is being moved
    // is the thing you are looking at. See `GhostSpec` for why a clone is not the general answer.
    this._ghost = createGhost({ kind: 'clone', source: dragged as HTMLElement, rect });
    this._indicator = createDropLine();

    (dragged as HTMLElement).style.opacity = '0.3';
  }

  private _onDragMove(e: PointerEvent) {
    if (!this._dragging || !this._ghost) return;

    this._ghost.moveTo(e.clientX - this._ghostOffsetX, e.clientY - this._ghostOffsetY);

    // Falling back to the origin when the pointer is over nothing keeps a drag that wanders off the
    // board from silently becoming a drop into whatever it last touched.
    const target = this._zoneAt(e.clientX, e.clientY, this._dragging) ?? this;
    if (target !== this._target) {
      this._target?.removeAttribute('data-drop-target');
      this._target = target;
      if (target !== this) target.setAttribute('data-drop-target', '');
    }

    this._dropIndex = target._indexAt(e.clientX, e.clientY, this._dragging);
    /*
      The indicator draws against the list *without* the dragged item, so it needs the same
      dragged-inclusive → dragged-exclusive conversion the drop itself gets in _onPointerUp.
      Unconverted, the two spaces agree when dragging up and differ by one when dragging down —
      the line sat one row below where the drop would actually land, so a downward drag had to be
      taken a row too far before the line reached the place already meant.
    */
    const items = this._getItems();
    const fromIndex = items.indexOf(this._dragging);
    const shownIndex = target === this && this._dropIndex > fromIndex ? this._dropIndex - 1 : this._dropIndex;
    // `_commit` refuses a drop back where it started, so nothing marks that spot either: a line
    // there promises a move the release will not make.
    const staysPut = target === this && Math.max(0, Math.min(shownIndex, items.length - 1)) === fromIndex;
    if (staysPut) this._indicator?.hide();
    else target._updateIndicator(this._indicator, shownIndex, this._dragging);
  }

  /** Where in this zone a pointer at (x, y) would drop, by comparing against each item's centre. */
  private _indexAt(x: number, y: number, dragged: Element): number {
    const items = this._getItems();
    const isVertical = this.direction === 'vertical';
    for (let i = 0; i < items.length; i++) {
      if (items[i] === dragged) continue;
      const rect = items[i].getBoundingClientRect();
      const centre = isVertical ? (rect.top + rect.bottom) / 2 : (rect.left + rect.right) / 2;
      if ((isVertical ? y : x) < centre) return i;
    }
    return items.length;
  }

  private _updateIndicator(indicator: DropLine | null, dropIndex: number, dragged: Element) {
    if (!indicator) return;
    const items = this._getItems().filter((item) => item !== dragged);
    const isVertical = this.direction === 'vertical';
    const containerRect = this.getBoundingClientRect();

    // An empty zone has no item to hang the line off, so it draws across the zone itself —
    // otherwise dropping into an empty column shows no feedback at all, which reads as "not
    // allowed" rather than "allowed and empty".
    if (items.length === 0) {
      indicator.place({
        left: containerRect.left + 8,
        top: containerRect.top + 8,
        width: Math.max(containerRect.width - 16, 0),
        height: DROP_LINE_THICKNESS,
      });
      return;
    }

    const clamped = Math.min(dropIndex, items.length);
    const atEnd = clamped >= items.length;
    const pivot = atEnd ? items[items.length - 1] : items[clamped];
    const r = pivot.getBoundingClientRect();
    // Centred on the edge it marks, so the line does not read as belonging to the item on one
    // side of the gap.
    const half = DROP_LINE_THICKNESS / 2;

    if (isVertical) {
      indicator.place({
        left: containerRect.left,
        top: (atEnd ? r.bottom : r.top) - half,
        width: containerRect.width,
        height: DROP_LINE_THICKNESS,
      });
    } else {
      indicator.place({
        top: containerRect.top,
        left: (atEnd ? r.right : r.left) - half,
        height: containerRect.height,
        width: DROP_LINE_THICKNESS,
      });
    }
  }

  private _onDragEnd() {
    if (!this._dragging) {
      this._endDrag();
      return;
    }
    const dragged = this._dragging;
    const target = this._target ?? this;
    /*
      Two index spaces meet here, and conflating them is the bug this conversion exists to avoid.

      `_indexAt` counts insertion points in the list *including* the item being dragged — "before
      items[i]" — because that is what the pointer is actually between. `_commit` wants a position
      among the *other* items, since the dragged one is removed first. Within one zone those differ
      by one for every drop below the item's own place.

      The keyboard path already speaks the second space, which is why it passes its index straight
      through and this one does not.
    */
    const fromIndex = this._getItems().indexOf(dragged);
    const position = target === this && this._dropIndex > fromIndex ? this._dropIndex - 1 : this._dropIndex;
    this._endDrag();
    this._commit(dragged, target, position);
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────

  private _onKeyDown = (e: KeyboardEvent) => {
    const path = e.composedPath();
    const focused = this._getItems().find((item) => path.includes(item));

    if (e.key === 'Escape' && this._held) {
      this._releaseHold();
      e.preventDefault();
      return;
    }

    if (e.key === ' ' || e.key === 'Enter') {
      if (this._held) {
        const { item, zone, index } = this._held;
        this._releaseHold();
        this._commit(item, zone, index);
      } else if (focused && !path.some((node) => this._isTextEntry(node)) && this._mayDrag(focused, path)) {
        this._held = { item: focused, zone: this, index: this._getItems().indexOf(focused) };
        (focused as HTMLElement).style.opacity = '0.3';
        this.setAttribute('data-drop-target', '');
      } else {
        return;
      }
      e.preventDefault();
      return;
    }

    if (!this._held) return;

    const isVertical = this.direction === 'vertical';
    const along = isVertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    const across = isVertical ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];

    if (along.includes(e.key)) {
      const delta = e.key === along[0] ? -1 : 1;
      // Positions among the *other* items — the space `_commit` takes. In its own zone the item is
      // one of them, so the last position is one less than the count.
      const others = this._held.zone._getItems().length - (this._held.zone === this ? 1 : 0);
      this._held.index = Math.max(0, Math.min(others, this._held.index + delta));
      e.preventDefault();
    } else if (across.includes(e.key)) {
      // Across zones in registry order — the order they connected, which for a board is the order
      // its columns were rendered.
      const compatible = zones.list().filter((zone) => zone._accepts(this, this._held!.item));
      const at = compatible.indexOf(this._held.zone);
      const next = compatible[at + (e.key === across[0] ? -1 : 1)];
      if (next) {
        this._held.zone.removeAttribute('data-drop-target');
        this._held.zone = next;
        this._held.index = Math.min(this._held.index, next._getItems().length - (next === this ? 1 : 0));
        next.setAttribute('data-drop-target', '');
      }
      e.preventDefault();
    }
  };

  private _releaseHold() {
    if (!this._held) return;
    (this._held.item as HTMLElement).style.opacity = '';
    this._held.zone.removeAttribute('data-drop-target');
    this.removeAttribute('data-drop-target');
    this._held = null;
  }

  // ── Commit ────────────────────────────────────────────────────────────────

  /**
   * Turn a completed gesture into an event.
   *
   * Both the pointer and keyboard paths end here, so the two produce identical events and a
   * consumer never learns which was used.
   */
  private _commit(dragged: Element, target: Sortable, position: number) {
    const id = this._getItemId(dragged);
    if (!id) return;

    const sameZone = target === this;
    const fromIndex = this._getItems().indexOf(dragged);

    // Destination order after the move, computed from ids rather than by moving DOM — the list is
    // rendered from data, and the data has not changed yet.
    const ids = target
      ._getItems()
      .filter((item) => item !== dragged)
      .map((item) => this._getItemId(item));
    const insertAt = Math.max(0, Math.min(position, ids.length));
    ids.splice(insertAt, 0, id);

    // A drop back where it started is not a move. Worth catching here rather than in every
    // consumer, since a click that drifts four pixels would otherwise write to the backend.
    if (sameZone && insertAt === fromIndex) return;

    const detail: SortableMoveDetail = {
      id,
      from: this.zone,
      to: target.zone,
      index: insertAt,
      ids,
    };
    this.dispatchEvent(new CustomEvent('moved', { detail, bubbles: true, composed: true }));

    // The single-list specialisation. A reorderable sidebar wants the new order and nothing else,
    // and would otherwise have to filter out every cross-zone move to get it.
    if (sameZone) {
      this.dispatchEvent(new CustomEvent('reorder', { detail: ids, bubbles: true, composed: true }));
    }
  }

  private _endDrag() {
    if (this._dragging) {
      (this._dragging as HTMLElement).style.opacity = '';
      this._dragging = null;
    }
    this._target?.removeAttribute('data-drop-target');
    this._target = null;
    this._ghost?.destroy();
    this._ghost = null;
    this._indicator?.destroy();
    this._indicator = null;
    this._dropIndex = -1;
    const stop = this._stopWatch;
    this._stopWatch = null;
    stop?.();
  }

  render() {
    const dir = this.direction === 'vertical' ? 'column' : 'row';
    const gapStyle = this.gap ? `gap:${this.gap}` : '';
    return html`
      <div part="container" style="display:flex;flex-direction:${dir};${gapStyle}">
        <slot></slot>
      </div>
    `;
  }
}
