import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import type { Placement } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';

import { LayoutElement } from '../shared/design-system-element';

const CSS_STYLES = css`
  [popover] {
    border: none;
    padding: 0;
    margin: 0;
  }

  [part='trigger'] {
    cursor: pointer;
  }

  [part='content'] {
    background: none;
  }
`;

@customElement('we-popover')
export default class Popover extends LayoutElement {
  static styles = CSS_STYLES;

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) placement: Placement = 'bottom';

  @query('[popover]') popoverElement!: HTMLElement;
  @query('[part="trigger"]') triggerElement!: HTMLElement;

  private cleanup?: () => void;

  firstUpdated() {
    if (this.triggerElement) this.triggerElement.addEventListener('click', () => (this.open = !this.open));
    this.addEventListener('keydown', this._onKeyDown);
  }

  private _onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.open) {
      this.open = false;
    }
  };

  private async updatePosition() {
    if (!this.triggerElement || !this.popoverElement) return;

    const { x, y } = await computePosition(this.triggerElement, this.popoverElement, {
      placement: this.placement,
      middleware: [offset(8), flip(), shift({ padding: 8 })],
    });

    Object.assign(this.popoverElement.style, { left: `${x}px`, top: `${y}px` });
  }

  private openPopover() {
    if (!this.triggerElement || !this.popoverElement) return;

    try {
      this.popoverElement.showPopover();
      this.cleanup = autoUpdate(this.triggerElement, this.popoverElement, () => this.updatePosition());
    } catch (err) {
      console.warn('Popover error:', err);
    }
  }

  private closePopover() {
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = undefined;
    }

    if (this.popoverElement?.matches(':popover-open')) {
      try {
        this.popoverElement.hidePopover();
      } catch (err) {
        console.warn('Popover hide error:', err);
      }
    }
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('open')) this.open ? this.openPopover() : this.closePopover();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanup?.();
  }

  render() {
    return html`
      <div part="trigger" aria-expanded=${this.open ? 'true' : 'false'}>
        <slot name="trigger"></slot>
      </div>

      <div part="content" popover="auto" @toggle=${(e: Event) => (this.open = (e as ToggleEvent).newState === 'open')}>
        <slot name="content"></slot>
      </div>
    `;
  }
}
