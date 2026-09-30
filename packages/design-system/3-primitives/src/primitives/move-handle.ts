import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { LayoutElement } from '../shared/design-system-element';

/**
 * A grip that reports how far it has been dragged, on both axes, and nothing else.
 *
 * The sibling of `we-resize-handle`, and deliberately the same shape of contract: it emits
 * `movestart`, `move` and `moveend`, each carrying `{ dx, dy }` — pixels moved **since the drag
 * began**, signed in screen direction. It never moves anything itself.
 *
 * ## Why it does not own the position
 *
 * For the same reason the resize handle does not own a size: what a drag *means* is never the grip's
 * business. The host's docks snap to eight targets, clamp into the content region, and give up
 * displacing content when dragged off an edge; a floating editor palette would want none of that. A
 * grip that set `left` and `top` could serve one consumer and no other.
 *
 * Delta-from-start rather than incremental, again matching the resize handle: every consumer would
 * otherwise have to accumulate, and one of them would get it wrong after a dropped event.
 *
 * ## Why a primitive rather than a `pointerdown` on the panel
 *
 * Pointer capture. A panel being dragged moves out from under the pointer, so without capture the
 * drag ends the moment the cursor leaves the grip — which happens on the first frame. That is
 * imperative DOM work, which is what a Lit primitive is for, and doing it here means the host's dock
 * frame stays a schema fragment.
 *
 * ## Keyboard
 *
 * Arrow keys move by `step`, and each press is emitted as a whole gesture — start, move, end — so a
 * consumer that captures an origin on `movestart` and commits on `moveend` works unchanged with no
 * key-repeat bookkeeping. Without this a panel could be moved only by pointer, which for the shell's
 * docks would mean a panel some people cannot move at all.
 */
const CSS_STYLES = css`
  :host {
    --we-move-handle-host-display: flex;
    align-items: center;
    justify-content: center;
    touch-action: none;
    cursor: grab;
  }

  :host([dragging]) {
    cursor: grabbing;
  }

  [part='base'] {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    /* Faint at rest and firm under the pointer, like the resize handle's line: a grip that shouts
       all the time is chrome on top of chrome, and this one sits over content. */
    color: var(--we-move-handle-color, var(--we-role-text-faint));
    transition: color 120ms ease;
  }

  :host(:hover) [part='base'],
  :host([dragging]) [part='base'],
  :host(:focus-visible) [part='base'] {
    color: var(--we-move-handle-active-color, var(--we-role-text));
  }

  :host(:focus-visible) {
    outline: 2px solid var(--we-ring-color);
    outline-offset: -2px;
  }
`;

@customElement('we-move-handle')
export default class MoveHandle extends LayoutElement {
  static styles = CSS_STYLES;

  /** Pixels moved per arrow-key press. */
  @property({ type: Number }) step = 24;

  /** Reflected so the grip can stay lit for the whole drag, not just while hovered. */
  @property({ type: Boolean, reflect: true }) dragging = false;

  /** Read by assistive technology, since a grip with no text is otherwise an unlabelled button. */
  @property({ type: String }) label = 'Move';

  private startX = 0;
  private startY = 0;

  /**
   * Every event carries the delta *and* where the pointer is.
   *
   * The delta is what a consumer normally wants, and stays the headline. `x` and `y` are the pointer
   * in viewport coordinates, for the one thing a delta cannot express: putting something *under* the
   * cursor rather than moving it by an amount. The shell needs it when a maximised panel is dragged
   * — the panel has to shrink back to its old size beneath the pointer, and where that lands depends
   * on where along a full-width titlebar it was grabbed.
   *
   * Reporting it does not make this a positioner: it still moves nothing and decides nothing. It is
   * the same information a consumer could read from a `pointermove` it is not receiving, because the
   * capture is here.
   */
  private emit(name: 'movestart' | 'move' | 'moveend', dx: number, dy: number, x: number, y: number): void {
    this.dispatchEvent(new CustomEvent(name, { detail: { dx, dy, x, y }, bubbles: true, composed: true }));
  }

  private onPointerDown = (event: PointerEvent) => {
    // Left button only; a right-click mid-drag would otherwise start a second one.
    if (event.button !== 0) return;
    event.preventDefault();
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.dragging = true;
    this.setPointerCapture(event.pointerId);
    this.emit('movestart', 0, 0, event.clientX, event.clientY);
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.dragging) return;
    this.emit('move', event.clientX - this.startX, event.clientY - this.startY, event.clientX, event.clientY);
  };

  private endDrag = (event: PointerEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.hasPointerCapture(event.pointerId)) this.releasePointerCapture(event.pointerId);
    this.emit('moveend', event.clientX - this.startX, event.clientY - this.startY, event.clientX, event.clientY);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-this.step, 0],
      ArrowRight: [this.step, 0],
      ArrowUp: [0, -this.step],
      ArrowDown: [0, this.step],
    };
    const move = moves[event.key];
    if (!move) return;

    event.preventDefault();
    // The grip's own centre stands in for the pointer, which is the honest answer for a gesture that
    // has none — and it is where the "pointer" is, in the sense the consumer means: on the handle.
    const box = this.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    this.emit('movestart', 0, 0, x, y);
    this.emit('move', move[0], move[1], x + move[0], y + move[1]);
    this.emit('moveend', move[0], move[1], x + move[0], y + move[1]);
  };

  connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasAttribute('role')) this.setAttribute('role', 'button');
    if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '0');
    this.setAttribute('aria-label', this.label);
    this.addEventListener('pointerdown', this.onPointerDown);
    this.addEventListener('pointermove', this.onPointerMove);
    this.addEventListener('pointerup', this.endDrag);
    this.addEventListener('pointercancel', this.endDrag);
    this.addEventListener('keydown', this.onKeyDown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('pointerdown', this.onPointerDown);
    this.removeEventListener('pointermove', this.onPointerMove);
    this.removeEventListener('pointerup', this.endDrag);
    this.removeEventListener('pointercancel', this.endDrag);
    this.removeEventListener('keydown', this.onKeyDown);
  }

  updated(changed: Map<PropertyKey, unknown>): void {
    super.updated(changed);
    if (changed.has('label')) this.setAttribute('aria-label', this.label);
  }

  render() {
    return html`<div part="base">
      <slot><we-icon name="dots-six" size="sm"></we-icon></slot>
    </div>`;
  }
}
