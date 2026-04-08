import {
  arrow,
  autoUpdate,
  computePosition,
  flip,
  offset,
  Placement as FloatingPlacement,
  shift,
} from '@floating-ui/dom';
import type { Placement } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';

import { LayoutElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

let tooltipIdCounter = 0;

const CSS_STYLES = css`
  :host {
    --we-tooltip-host-display: inline-block;
    position: relative;
  }

  [part='trigger'] {
    display: inline-block;
  }

  [part='tooltip'] {
    display: none;
    position: absolute;
    z-index: 999;
    whitespace: nowrap;
    font-size: var(--we-font-size-400, 14px);
    font-weight: 500;
    padding: var(--we-space-300, 8px) var(--we-space-300, 8px);
    background: #222;
    color: white;
    border-radius: var(--we-border-radius, 4px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    pointer-events: none;
  }

  :host([open]) [part='tooltip'] {
    display: block;
    pointer-events: auto;
  }

  [part='arrow'],
  [part='arrow']::before {
    position: absolute;
    width: 8px;
    height: 8px;
    background: inherit;
  }

  [part='arrow'] {
    visibility: hidden;
  }

  [part='arrow']::before {
    visibility: visible;
    content: '';
    transform: rotate(45deg);
  }
`;

@customElement('we-tooltip')
export default class Tooltip extends LayoutElement {
  static styles = [sharedStyles, CSS_STYLES];

  private _tooltipId = `we-tooltip-${++tooltipIdCounter}`;

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String, reflect: true }) title = '';
  @property({ type: String, reflect: true }) placement: Placement = 'top';

  @query('[part="tooltip"]') tooltipEl!: HTMLElement;
  @query('[part="trigger"]') triggerEl!: HTMLElement;
  @query('[part="arrow"]') arrowEl!: HTMLElement;

  @state() private cleanup?: () => void;

  firstUpdated() {
    this.addEventListener('mouseenter', this.show);
    this.addEventListener('mouseleave', this.hide);
    this.addEventListener('focusin', this.show);
    this.addEventListener('focusout', this.hide);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanup?.();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('open')) {
      if (this.open) this.openTooltip();
      else this.closeTooltip();
      this.dispatchEvent(new CustomEvent('toggle', { bubbles: true, composed: true }));
    }
  }

  private async updatePosition() {
    if (!this.triggerEl || !this.tooltipEl || !this.arrowEl) return;

    // Convert 'auto' to 'top' for Floating UI compatibility
    const floatingPlacement = this.placement.startsWith('auto') ? 'top' : (this.placement as FloatingPlacement);

    const { x, y, placement, middlewareData } = await computePosition(this.triggerEl, this.tooltipEl, {
      placement: floatingPlacement,
      middleware: [offset(10), flip(), shift({ padding: 8 }), arrow({ element: this.arrowEl })],
    });

    // Position tooltip
    Object.assign(this.tooltipEl.style, { left: `${x}px`, top: `${y}px` });

    // Position arrow
    if (middlewareData.arrow) {
      const { x: arrowX, y: arrowY } = middlewareData.arrow;
      const staticSide = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }[placement.split('-')[0]]!;

      Object.assign(this.arrowEl.style, {
        left: arrowX != null ? `${arrowX}px` : '',
        top: arrowY != null ? `${arrowY}px` : '',
        right: '',
        bottom: '',
        [staticSide]: '-4px',
      });
    }
  }

  private openTooltip() {
    if (!this.triggerEl || !this.tooltipEl) return;

    // Auto-update position on scroll/resize
    this.cleanup = autoUpdate(this.triggerEl, this.tooltipEl, () => this.updatePosition());
  }

  private closeTooltip() {
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = undefined;
    }
  }

  private show = () => {
    this.open = true;
  };

  private hide = () => {
    this.open = false;
  };

  render() {
    return html`
      <span part="trigger" aria-describedby=${this._tooltipId}><slot></slot></span>
      <span part="tooltip" id=${this._tooltipId} role="tooltip">
        ${this.title}
        <span part="arrow"></span>
      </span>
    `;
  }
}
