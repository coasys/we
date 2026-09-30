import { tokenVar } from '@we/design-utils';
import { componentHeight } from '@we/tokens';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { LayoutElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize } from '../types';

const styles = css`
  :host {
    --we-spinner-host-display: inline-flex;
    --we-spinner-size: var(--we-size-md);
    --we-spinner-stroke: 2px;
    --we-spinner-color: var(--we-role-accent);
  }

  :host([size='xs']) {
    --we-spinner-size: var(--we-size-xs);
    --we-spinner-stroke: 1px;
  }

  :host([size='sm']) {
    --we-spinner-size: var(--we-size-sm);
    --we-spinner-stroke: 2px;
  }

  :host([size='md']) {
    --we-spinner-size: var(--we-size-md);
    --we-spinner-stroke: 2px;
  }

  :host([size='lg']) {
    --we-spinner-size: var(--we-size-lg);
    --we-spinner-stroke: 4px;
  }

  :host([size='xl']) {
    --we-spinner-size: var(--we-size-xl);
    --we-spinner-stroke: 4px;
  }

  .lds-ring {
    display: inline-block;
    position: relative;
    width: var(--we-spinner-size);
    height: var(--we-spinner-size);
  }

  .lds-ring div {
    box-sizing: border-box;
    display: block;
    position: absolute;
    width: var(--we-spinner-size);
    height: var(--we-spinner-size);
    border: var(--we-spinner-stroke) solid var(--we-spinner-color);
    border-radius: 50%;
    animation: lds-ring 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
    border-color: var(--we-spinner-color) transparent transparent transparent;
    /* Phase, not zero. See --we-spinner-phase below. */
    animation-delay: var(--we-spinner-phase, 0ms);
  }

  .lds-ring div:nth-child(1) {
    animation-delay: calc(var(--we-spinner-phase, 0ms) - 0.45s);
  }

  .lds-ring div:nth-child(2) {
    animation-delay: calc(var(--we-spinner-phase, 0ms) - 0.3s);
  }

  .lds-ring div:nth-child(3) {
    animation-delay: calc(var(--we-spinner-phase, 0ms) - 0.15s);
  }

  @keyframes lds-ring {
    0% {
      transform: rotate(0deg);
    }

    100% {
      transform: rotate(360deg);
    }
  }
`;

@customElement('we-spinner')
export default class Spinner extends LayoutElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) size: ComponentSize | (string & {}) = 'md';
  @property({ type: String, reflect: true }) color = '';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  updated(props: Map<string, unknown>) {
    super.updated(props);

    // Handle color prop
    if (props.has('color') && this.color) {
      // Allow currentColor to pass through directly
      if (this.color === 'currentColor') {
        this.style.setProperty('--we-spinner-color', 'currentColor');
      } else {
        this.style.setProperty('--we-spinner-color', tokenVar('color', this.color, this.color));
      }
    }

    // Handle custom size values (e.g., "20px", "2rem")
    if (props.has('size') && this.size && !(this.size in componentHeight)) {
      this.style.setProperty('--we-spinner-size', this.size);
    }
  }

  /**
   * Where in the 1.2s cycle this spinner starts, as a negative delay.
   *
   * Locked to the wall clock rather than to mount time, so every spinner is at the same point in
   * the cycle at the same moment — including one in a document that did not exist a second ago.
   * Switching accounts reloads the window, and a fresh spinner starting from zero next to the
   * remembered image of one that had been mid-rotation reads as a jump. `Date.now()` is continuous
   * across that reload, so this one picks up exactly where the last would have been, and the gap
   * looks like the spinner was briefly hidden rather than restarted.
   *
   * A side effect worth having: two spinners mounted seconds apart now turn in step.
   */
  private get _phase(): string {
    return `${-(Date.now() % 1200)}ms`;
  }

  render() {
    const inline = { '--we-spinner-phase': this._phase, ...(this.styles || {}) };
    return html`<div class="lds-ring" style=${styleMap(inline)}>
      <div></div>
      <div></div>
      <div></div>
      <div></div>
    </div>`;
  }
}
