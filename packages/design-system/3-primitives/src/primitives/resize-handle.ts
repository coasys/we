import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { LayoutElement } from '../shared/design-system-element';

const CSS_STYLES = css`
  :host {
    --we-resize-handle-host-display: block;
    position: relative;
    flex: none;
    touch-action: none;
    cursor: col-resize;
  }

  :host([orientation='horizontal']) {
    cursor: row-resize;
  }

  /* The hit area is deliberately larger than the line. A 1px target is a target you miss, and the
     grabbable width is not something the visual weight of the divider should decide. */
  [part='base'] {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Flush with one end of the hit area rather than centred in it. The hit area is deliberately wider
     than anything visible, so a centred line floats a few pixels inside whatever edge it belongs to —
     next to a panel that already has a border, that reads as a second line rather than as that one. */
  :host([align='start']) [part='base'] {
    align-items: flex-start;
    justify-content: flex-start;
  }

  :host([align='end']) [part='base'] {
    align-items: flex-end;
    justify-content: flex-end;
  }

  /*
     Nothing at rest, and that is the default rather than a special case.

     A permanently visible line between a panel and the content beside it reads as a scrollbar,
     because that is the only other thin vertical strip anybody puts there — and the panel almost
     always has a border of its own already, so the two together are one line that looks wrong. The
     affordance is the cursor, which appears the moment the pointer is anywhere near; the line then
     confirms what the cursor promised.

     Overridable both ways: a consumer wanting a permanent divider sets --we-resize-handle-line.
  */
  [part='line'] {
    background: var(--we-resize-handle-line, transparent);
    transition: background 120ms ease;
  }

  :host(:not([orientation='horizontal'])) [part='line'] {
    width: var(--we-resize-handle-thickness, 1px);
    height: 100%;
  }

  :host([orientation='horizontal']) [part='line'] {
    width: 100%;
    height: var(--we-resize-handle-thickness, 1px);
  }

  :host(:hover) [part='line'],
  :host([dragging]) [part='line'] {
    background: var(--we-resize-handle-line-active, var(--we-color-primary-500));
  }

  /* Keyboard users get the same affordance: the handle is focusable and the focus ring is the line
     itself thickening, so there is no second visual language for the same control. */
  :host(:focus-visible) {
    outline: none;
  }

  :host(:focus-visible) [part='line'] {
    background: var(--we-resize-handle-line-active, var(--we-color-primary-500));
    box-shadow: 0 0 0 1px var(--we-resize-handle-line-active, var(--we-color-primary-500));
  }
`;

/**
 * A drag target that reports how far it has moved, and nothing else.
 *
 * ## Why it reports a delta rather than owning a size
 *
 * The obvious design is a handle that resizes its neighbour. It is the wrong one, because "what does
 * this drag mean" is never the handle's business: the editor's panel rails grow *leftwards* from a
 * width that starts at zero when the panel is closed, clamp at a minimum, and close the panel again
 * below a threshold — while a docked call panel grows from whichever edge it is attached to. A
 * handle that owned the size could serve one of those and not the other.
 *
 * So it emits `resizestart`, `resize` and `resizeend`, each carrying `delta`: pixels moved along its
 * axis **since the drag began**, signed in screen direction (right and down positive). The consumer
 * captures its own starting size and applies whatever sign and limits it has. Delta-from-start
 * rather than incremental, because every consumer would otherwise have to accumulate, and one of
 * them would get it wrong after a dropped event.
 *
 * ## Why a primitive rather than a hook
 *
 * There were two implementations of this before it existed and they diverged in ways nobody chose:
 * the editor's is mouse-only, so it does not work on a touchscreen at all, and its rail is a plain
 * div — not focusable, so there is no way to resize a panel from the keyboard. Pointer events and a
 * `separator` role fix both once, for every consumer, in the layer where imperative DOM work belongs.
 *
 * @example
 * ```html
 * <we-resize-handle
 *   @resizestart=${() => (start = width)}
 *   @resize=${(e) => (width = clamp(start - e.detail.delta))}
 * ></we-resize-handle>
 * ```
 *
 * @fires resizestart - detail: `{ delta: 0 }` — a drag began; capture your current size here
 * @fires resize - detail: `{ delta: number }` — pixels moved since the drag began, screen-signed
 * @fires resizeend - detail: `{ delta: number }` — the drag finished; a delta of 0 was a click
 */
@customElement('we-resize-handle')
export default class ResizeHandle extends LayoutElement {
  static styles = CSS_STYLES;

  /**
   * Which way the handle is dragged.
   *
   * `vertical` is a vertical bar dragged horizontally — the one that resizes a width, and by far the
   * common case, so it is the default. Named after the bar rather than the motion because that is
   * what `role="separator"`'s `aria-orientation` means, and having the two disagree would be worse
   * than either name being slightly ambiguous alone.
   */
  @property({ type: String, reflect: true }) orientation: 'vertical' | 'horizontal' = 'vertical';

  /**
   * Where the visible line sits within the hit area.
   *
   * The hit area has to be wider than the line — a 1px target is a target you miss — so the two are
   * not the same box, and which end of it the line belongs at depends on what the handle is next to.
   * Sitting against a panel's own border, `start` or `end` puts the line *on* that border so it
   * reads as the border thickening; `center` is right for a handle between two panes with no border
   * of their own.
   */
  @property({ type: String, reflect: true }) align: 'start' | 'center' | 'end' = 'center';

  /** Pixels moved per arrow-key press. */
  @property({ type: Number }) step = 16;

  /** Reflected so the line can stay highlighted for the whole drag, not just while hovered. */
  @property({ type: Boolean, reflect: true }) dragging = false;

  private startCoord = 0;

  private get axisIsX(): boolean {
    return this.orientation !== 'horizontal';
  }

  private emit(name: 'resizestart' | 'resize' | 'resizeend', delta: number): void {
    this.dispatchEvent(new CustomEvent(name, { detail: { delta }, bubbles: true, composed: true }));
  }

  private onPointerDown = (event: PointerEvent) => {
    // Left button only; a right-click during a drag would otherwise start a second one.
    if (event.button !== 0) return;
    event.preventDefault();
    this.startCoord = this.axisIsX ? event.clientX : event.clientY;
    this.dragging = true;
    // Capture, so the drag survives the pointer leaving a handle that is only a few pixels wide —
    // which it does immediately, because the thing being resized moves out from under it.
    this.setPointerCapture(event.pointerId);
    this.emit('resizestart', 0);
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.dragging) return;
    const coord = this.axisIsX ? event.clientX : event.clientY;
    this.emit('resize', coord - this.startCoord);
  };

  private endDrag = (event: PointerEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.hasPointerCapture(event.pointerId)) this.releasePointerCapture(event.pointerId);
    const coord = this.axisIsX ? event.clientX : event.clientY;
    this.emit('resizeend', coord - this.startCoord);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    const decrease = this.axisIsX ? 'ArrowLeft' : 'ArrowUp';
    const increase = this.axisIsX ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== decrease && event.key !== increase) return;

    event.preventDefault();
    const delta = event.key === increase ? this.step : -this.step;
    // A whole keyboard resize is one complete gesture: consumers that capture a starting size on
    // `resizestart` and commit on `resizeend` work unchanged, with no key-repeat bookkeeping.
    this.emit('resizestart', 0);
    this.emit('resize', delta);
    this.emit('resizeend', delta);
  };

  connectedCallback(): void {
    super.connectedCallback();
    // `separator` with a tabindex is the ARIA pattern for a resizable splitter. Without it this is a
    // div that only a mouse can reach — which is what both hand-rolled versions were.
    if (!this.hasAttribute('role')) this.setAttribute('role', 'separator');
    if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '0');
    this.setAttribute('aria-orientation', this.orientation);
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
    if (changed.has('orientation')) this.setAttribute('aria-orientation', this.orientation);
  }

  render() {
    return html`<div part="base"><div part="line"></div></div>`;
  }
}
