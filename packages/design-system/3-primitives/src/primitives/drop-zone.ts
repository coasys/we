import { DRAG_CHANGE_EVENT, type DragPayload, dragSession, type DragZone } from '@we/drag';
import { css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { LayoutElement } from '../shared/design-system-element';

const CSS_STYLES = css`
  :host {
    --we-drop-zone-host-display: block;
    display: var(--we-drop-zone-host-display, block);
    position: relative;
  }

  /*
    The feedback is painted INSIDE the zone, on a pseudo-element inset to its own bounds.

    It was an outline with outline-offset: 2px on [part='base'], which draws 2px *outside* the box —
    and every zone that matters is inside something that clips: a docked panel sets overflow hidden,
    a breadcrumb strip sets overflow-x auto, a list sits in a scroll area. So the ring was there and
    shaved off on exactly the sides that mattered, which reads as no feedback at all rather than as
    clipped feedback. Anything drawn within the host's own bounds cannot be clipped by an ancestor
    without the content being clipped too.

    On :host rather than [part='base'] because the host is the box the session measured for
    hit-testing. A ring around anything else would be a promise about a different rectangle.
  */
  :host::after {
    content: '';
    position: absolute;
    inset: 0;
    /*
      The shape of whatever is clipping this, when it says so.

      A zone that fills a rounded, overflow-hidden container — a docked panel is the case — has
      square corners of its own, so a square ring inside a 16px radius gets its corners shaved off
      exactly where the curve is. The container is the only thing that knows its own shape, so it
      publishes it: the dock frame sets --we-drop-zone-radius on the region it hands a module, and
      anything else falls back to a radius of its own.
    */
    border-radius: var(--we-drop-zone-radius, var(--we-radius-400, 8px));
    pointer-events: none;
    opacity: 0;
    transition:
      opacity var(--we-animation-transition-200, 150ms) ease,
      background-color var(--we-animation-transition-200, 150ms) ease;
  }

  /*
    Armed: a drag this zone would take is running somewhere. Deliberately faint, and deliberately
    rare — see the noArm property. It answers "this panel is a place things go", which is worth
    saying once about a container and not at all about each of the rows inside it.
  */
  :host([data-we-drop-armed])::after {
    opacity: 1;
    box-shadow: inset 0 0 0 1px var(--we-role-accent, #93c5fd);
  }

  /*
    Target: releasing now lands here. A tinted wash as well as a ring, because at this point the
    question is no longer "where could this go" but "is it going *there*" — and a ring alone is hard
    to attribute when zones are nested three deep, as they are in a folder inside a panel.

    A wash mixed toward transparent, NOT the accent-muted role. This paints over the zone's
    contents, so an opaque fill hides them: covering a whole panel with a flat colour is the one
    thing a drop indicator must not do, since what is already in there is what you are deciding
    against. The dock's snap targets can use the solid role because they float over empty screen.

    color-mix toward transparent rather than an opacity on the box, for the same reason the panel
    frame's glass does it that way: opacity would fade the ring along with the fill, and the ring is
    the part that has to stay legible.
  */
  :host([data-we-drop-target])::after {
    opacity: 1;
    box-shadow: inset 0 0 0 2px var(--we-role-accent, #93c5fd);
    background: color-mix(in srgb, var(--we-role-accent, #93c5fd) 14%, transparent);
  }

  @media (prefers-reduced-motion: reduce) {
    :host::after {
      transition: none;
    }
  }
`;

/**
 * Anything a `we-draggable` can be dropped into.
 *
 * The receiving half of the pair, and the same rung: two custom elements and an existing `$action`,
 * so a template can make a region a drop target without a code change.
 *
 * ```json
 * { "type": "we-drop-zone",
 *   "props": { "accepts": "CollectionBlock,Space,Agent",
 *              "onDropped": { "$action": "modules.pocket.gather", "args": [{ "$": "event.detail" }] } },
 *   "children": [ "…the panel…" ] }
 * ```
 *
 * ## It emits intent, it never mutates
 *
 * Exactly `we-sortable`'s rule, and for the same reason: what a drop *means* differs. A panel writes
 * a record, a composer inserts a block, a board records a position. A primitive that assumed one of
 * those would be useless to the others.
 *
 * ## `accepts` is a list of entity names, as a string
 *
 * A comma-separated string rather than an array because that is what an HTML attribute is, and
 * because a schema writing `"accepts": "CollectionBlock,Space"` needs no expression. Empty means
 * "anything", which is right for a general-purpose tray and wrong for a composer — say what you
 * take.
 *
 * ## Zones nest, and the innermost one wins
 *
 * A folder inside a panel, a card inside a board. Hit-testing picks the innermost accepting zone
 * and fires exactly one drop — and these events **do not bubble**, so that decision survives the
 * DOM. See `_zone` for what happened when they did.
 *
 * Give every nested zone `noArm`, so picking something up speaks once about the container rather
 * than once about every row inside it.
 *
 * @fires dropped - detail: the `DragPayload`, on a completed drop. Does not bubble
 * @fires dropenter / dropleave - so a zone can open, highlight, or scroll itself. Do not bubble
 */
@customElement('we-drop-zone')
export default class DropZone extends LayoutElement {
  static styles = [CSS_STYLES];

  /** Entity names this zone takes, comma-separated. Empty means anything. */
  @property({ type: String, reflect: true }) accepts = '';

  /** Refuse everything, while still rendering. For a panel that is read-only or still loading. */
  @property({ type: Boolean, reflect: true }) disabled = false;

  /**
   * Suppress the quiet "you could drop here" ring shown while any acceptable drag is running.
   *
   * Arming is on by default, because a target nobody can see is a target nobody uses. **Set this on
   * every zone nested inside another one.** Arming answers "where could this go", and that is a
   * question about a *container*: a Pocket three folders deep armed nine nested rectangles the
   * moment a card was picked up, which read as an error state and buried the one thing worth
   * saying. A zone with `noArm` still highlights when the pointer is actually over it, which is the
   * different — and by then more useful — question of whether it is going *there*.
   */
  @property({ type: Boolean }) noArm = false;

  @state() private _armed = false;

  private _unregister: (() => void) | null = null;

  connectedCallback() {
    super.connectedCallback();
    this._unregister = dragSession.registerZone(this._zone());
    document.addEventListener(DRAG_CHANGE_EVENT, this._onDragChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unregister?.();
    this._unregister = null;
    document.removeEventListener(DRAG_CHANGE_EVENT, this._onDragChange);
    this.removeAttribute('data-we-drop-armed');
  }

  /**
   * These events do **not** bubble, and that is the whole point.
   *
   * They used to, and a drop into a folder inside the Pocket then wrote the item twice — once into
   * the folder, and once into the folder being looked at, because the inner zone's `dropped` rose
   * through the DOM to the panel's own zone, whose handler is an ordinary listener on its element.
   * Two records from one drop, in two places, with nothing to say which was meant.
   *
   * The session has already decided: hit-testing picks the innermost accepting zone and fires
   * exactly one `onDrop`. The event is *addressed* to that zone, so an ancestor receiving it is not
   * a feature that happens to be inconvenient here — it is the session's decision being undone by
   * DOM mechanics. Nesting zones is the ordinary case (a folder in a panel, a card in a board), so
   * this had to be right in the primitive rather than worked around at each call site.
   *
   * `composed` still matters: the listener sits on the host, and a consumer inside another
   * component's shadow root must be able to hear its own zone.
   */
  private _zone(): DragZone {
    const emit = (name: string, detail?: unknown) =>
      this.dispatchEvent(new CustomEvent(name, { detail, bubbles: false, composed: true }));

    return {
      el: this,
      accepts: (payload) => this._accepts(payload),
      onEnter: () => emit('dropenter'),
      onLeave: () => emit('dropleave'),
      onDrop: ({ payload }) => emit('dropped', payload),
    };
  }

  private _accepts(payload: DragPayload): boolean {
    if (this.disabled) return false;
    if (!this.accepts.trim()) return true;
    const allowed = this.accepts
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    return payload.items.every((item) => allowed.includes(item.ref.entity));
  }

  /**
   * Arm while an acceptable drag is running.
   *
   * Read off the session at the moment it changes rather than polled: the session announces on
   * `document`, so a zone mounted mid-drag still learns about the drag in flight when the next one
   * starts, and one unmounted mid-drag simply stops listening.
   */
  private _onDragChange = () => {
    const payload = dragSession.active();
    const armed = !this.noArm && !!payload && this._accepts(payload);
    if (armed === this._armed) return;
    this._armed = armed;
    if (armed) this.setAttribute('data-we-drop-armed', '');
    else this.removeAttribute('data-we-drop-armed');
  };

  render() {
    return html`<div part="base"><slot></slot></div>`;
  }
}
