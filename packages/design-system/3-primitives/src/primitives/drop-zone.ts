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
    The outline says *which* zone a release would land in. Subtle on purpose, and the same statement
    we-sortable makes with the same attribute name — on a page with both, they must not read as two
    different things.
  */
  :host([data-we-drop-target]) [part='base'] {
    outline: 2px solid var(--we-role-accent, #93c5fd);
    outline-offset: 2px;
    border-radius: var(--we-radius-400, 8px);
  }

  /*
    While *anything* is being dragged that this zone would take. Quieter than the target state: it
    answers "where could this go", which is the question somebody holding a card is actually asking,
    and without it a zone that is off-screen or collapsed is undiscoverable.
  */
  :host([data-we-drop-armed]) [part='base'] {
    outline: 2px dashed var(--we-role-border-strong, #cbd5e1);
    outline-offset: 2px;
    border-radius: var(--we-radius-400, 8px);
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
 * @fires dropped - detail: the `DragPayload`, on a completed drop
 * @fires dropenter / dropleave - so a zone can open, highlight, or scroll itself
 */
@customElement('we-drop-zone')
export default class DropZone extends LayoutElement {
  static styles = [CSS_STYLES];

  /** Entity names this zone takes, comma-separated. Empty means anything. */
  @property({ type: String, reflect: true }) accepts = '';

  /** Refuse everything, while still rendering. For a panel that is read-only or still loading. */
  @property({ type: Boolean, reflect: true }) disabled = false;

  /**
   * Whether to show the quiet "you could drop here" outline while any acceptable drag is running.
   *
   * On by default: a target nobody can see is a target nobody uses.
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

  private _zone(): DragZone {
    return {
      el: this,
      accepts: (payload) => this._accepts(payload),
      onEnter: () => this.dispatchEvent(new CustomEvent('dropenter', { bubbles: true, composed: true })),
      onLeave: () => this.dispatchEvent(new CustomEvent('dropleave', { bubbles: true, composed: true })),
      onDrop: ({ payload }) =>
        this.dispatchEvent(new CustomEvent('dropped', { detail: payload, bubbles: true, composed: true })),
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
