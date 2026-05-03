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
`;

/**
 * Drag-to-reorder container primitive.
 *
 * Usage: wrap a list of elements that each have a `data-we-id` attribute.
 * Fires a `we-reorder` CustomEvent<string[]> on drop with the new ordered
 * array of IDs.
 *
 * @fires reorder - detail: string[] — new ordered array of `data-we-id` values
 */
@customElement('we-sortable')
export default class Sortable extends DesignSystemElement {
  static styles = [sharedStyles, CSS_STYLES];

  /** Flex direction of the sortable container. */
  @property({ type: String, reflect: true }) direction: 'vertical' | 'horizontal' = 'vertical';

  /** Gap between items — any valid CSS length, e.g. `'8px'` or `'var(--sidebar-gap)'`. */
  @property({ type: String, reflect: true }) gap: string = '';

  // ── Drag state (plain vars — not signals, don't drive rendering) ──────────

  /** The element being dragged, once a drag has started. */
  private _dragging: Element | null = null;

  /** Clone of the dragged element following the pointer. */
  private _ghost: HTMLElement | null = null;

  /** Drop position indicator line. */
  private _indicator: HTMLElement | null = null;

  /** Current computed drop index in the full items array. */
  private _dropIndex = -1;

  private _ghostOffsetX = 0;
  private _ghostOffsetY = 0;

  /** Pre-drag state while waiting for the movement threshold. */
  private _pending: { pointerId: number; startX: number; startY: number; dragged: Element } | null = null;

  // ── Slot helpers ──────────────────────────────────────────────────────────

  private get _slot(): HTMLSlotElement | null {
    return this.shadowRoot?.querySelector('slot') ?? null;
  }

  private _getItems(): Element[] {
    return this._slot?.assignedElements() ?? [];
  }

  private _getItemId(el: Element): string {
    return el.getAttribute('data-we-id') ?? '';
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  firstUpdated() {
    this.addEventListener('pointerdown', this._onPointerDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._endDrag();
  }

  // ── Pointer event handlers ────────────────────────────────────────────────

  private _onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;

    // Walk the composed path to find which slotted direct child was hit.
    // composedPath() includes slotted light-DOM elements so this works across
    // the Shadow DOM boundary.
    const path = e.composedPath();
    const items = this._getItems();
    const dragged = items.find((item) => path.includes(item));
    if (!dragged) return;

    this._pending = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dragged };
    this.addEventListener('pointermove', this._onPointerMove);
    this.addEventListener('pointerup', this._onPointerUp);
    this.addEventListener('pointercancel', this._onPointerCancel);
  };

  private _startDrag(dragged: Element, e: PointerEvent) {
    // Route all subsequent pointer events here even if the pointer leaves the element.
    this.setPointerCapture(e.pointerId);

    this._dragging = dragged;
    this._dropIndex = this._getItems().indexOf(dragged);

    const rect = (dragged as HTMLElement).getBoundingClientRect();
    this._ghostOffsetX = e.clientX - rect.left;
    this._ghostOffsetY = e.clientY - rect.top;

    this._createGhost(dragged as HTMLElement, rect);
    this._createIndicator();

    (dragged as HTMLElement).style.opacity = '0.3';
    this._pending = null;
  }

  private _createGhost(source: HTMLElement, rect: DOMRect) {
    const ghost = source.cloneNode(true) as HTMLElement;
    ghost.style.cssText = [
      `position:fixed`,
      `left:${rect.left}px`,
      `top:${rect.top}px`,
      `width:${rect.width}px`,
      `height:${rect.height}px`,
      `pointer-events:none`,
      `opacity:0.85`,
      `z-index:9999`,
      `box-shadow:0 4px 16px rgba(0,0,0,0.2)`,
      `border-radius:6px`,
      `margin:0`,
    ].join(';');
    document.body.appendChild(ghost);
    this._ghost = ghost;
  }

  private _createIndicator() {
    const el = document.createElement('div');
    el.style.cssText = [
      `position:fixed`,
      `pointer-events:none`,
      `z-index:9998`,
      `background:var(--we-color-primary-500,#3b82f6)`,
      `border-radius:2px`,
      `opacity:0`,
    ].join(';');
    document.body.appendChild(el);
    this._indicator = el;
  }

  private _onPointerMove = (e: PointerEvent) => {
    // Threshold check — don't start a drag until the pointer has moved > 4px.
    if (this._pending) {
      const dx = e.clientX - this._pending.startX;
      const dy = e.clientY - this._pending.startY;
      if (Math.sqrt(dx * dx + dy * dy) > 4) {
        this._startDrag(this._pending.dragged, e);
      } else {
        return;
      }
    }

    if (!this._dragging || !this._ghost) return;

    // Move ghost
    this._ghost.style.left = `${e.clientX - this._ghostOffsetX}px`;
    this._ghost.style.top = `${e.clientY - this._ghostOffsetY}px`;

    // Compute new drop index by comparing pointer position to each item's centre.
    // We skip the dragged item (it stays in-place at reduced opacity) so its
    // own rect doesn't confuse the target calculation.
    const items = this._getItems();
    const isVertical = this.direction === 'vertical';
    let newDrop = items.length; // default: after last item

    for (let i = 0; i < items.length; i++) {
      if (items[i] === this._dragging) continue;
      const rect = items[i].getBoundingClientRect();
      const center = isVertical ? (rect.top + rect.bottom) / 2 : (rect.left + rect.right) / 2;
      if ((isVertical ? e.clientY : e.clientX) < center) {
        newDrop = i;
        break;
      }
    }

    this._dropIndex = newDrop;
    this._updateIndicator(items, newDrop);
  };

  private _updateIndicator(items: Element[], dropIndex: number) {
    if (!this._indicator || items.length === 0) return;

    const isVertical = this.direction === 'vertical';
    const containerRect = this.getBoundingClientRect();

    let pivotEl: Element;
    let edge: 'start' | 'end';

    if (dropIndex <= 0) {
      pivotEl = items[0];
      edge = 'start';
    } else if (dropIndex >= items.length) {
      pivotEl = items[items.length - 1];
      edge = 'end';
    } else {
      pivotEl = items[dropIndex];
      edge = 'start';
    }

    const r = pivotEl.getBoundingClientRect();

    if (isVertical) {
      const y = edge === 'start' ? r.top : r.bottom;
      Object.assign(this._indicator.style, {
        left: `${containerRect.left}px`,
        top: `${y - 1}px`,
        width: `${containerRect.width}px`,
        height: '2px',
        opacity: '1',
      });
    } else {
      const x = edge === 'start' ? r.left : r.right;
      Object.assign(this._indicator.style, {
        top: `${containerRect.top}px`,
        left: `${x - 1}px`,
        height: `${containerRect.height}px`,
        width: '2px',
        opacity: '1',
      });
    }
  }

  private _onPointerUp = () => {
    if (!this._dragging) {
      // Tap without drag — just clean up the pending state
      this._endDrag();
      return;
    }

    const items = this._getItems();
    const dragIndex = items.indexOf(this._dragging);
    const dropIndex = this._dropIndex;

    this._endDrag();

    // No-op: pointer released at the original position
    if (dragIndex === -1 || dropIndex === dragIndex || dropIndex === dragIndex + 1) return;

    // Compute new order: remove the dragged item from its original position and
    // insert it at the (adjusted) drop index.
    const ids = items.map((el) => this._getItemId(el));
    const [removed] = ids.splice(dragIndex, 1);
    const insertAt = dropIndex > dragIndex ? dropIndex - 1 : dropIndex;
    ids.splice(insertAt, 0, removed);

    this.dispatchEvent(new CustomEvent('reorder', { detail: ids, bubbles: true, composed: true }));
  };

  private _onPointerCancel = () => {
    this._endDrag();
  };

  private _endDrag() {
    if (this._dragging) {
      (this._dragging as HTMLElement).style.opacity = '';
      this._dragging = null;
    }
    this._ghost?.remove();
    this._ghost = null;
    this._indicator?.remove();
    this._indicator = null;
    this._dropIndex = -1;
    this._pending = null;
    this.removeEventListener('pointermove', this._onPointerMove);
    this.removeEventListener('pointerup', this._onPointerUp);
    this.removeEventListener('pointercancel', this._onPointerCancel);
  }

  // ── Render ────────────────────────────────────────────────────────────────

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
