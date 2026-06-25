import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  ay: 'center',
  gap: '300',
  width: '100%',
  color: 'neutral-800',
  fontSize: '400',
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { fontSize: '200' },
  sm: { fontSize: '300' },
  md: { fontSize: '400' },
  lg: { fontSize: '500' },
  xl: { fontSize: '500' },
};

const TRACK_HEIGHT: Record<ComponentSize, string> = {
  xs: '3px',
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '10px',
};

const THUMB_SIZE: Record<ComponentSize, string> = {
  xs: '12px',
  sm: '14px',
  md: '18px',
  lg: '22px',
  xl: '26px',
};

const styles = css`
  [part='track-wrapper'] {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
  }

  input[part='native'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    background: transparent;
    cursor: pointer;
    margin: 0;
  }

  input[part='native']::-webkit-slider-runnable-track {
    height: var(--track-height);
    border-radius: var(--we-radius-pill);
    background: var(--we-color-neutral-200);
  }

  input[part='native']::-moz-range-track {
    height: var(--track-height);
    border-radius: var(--we-radius-pill);
    background: var(--we-color-neutral-200);
  }

  input[part='native']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: var(--thumb-size);
    height: var(--thumb-size);
    border-radius: var(--we-radius-full);
    background: var(--we-color-primary-500);
    border: 2px solid white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    margin-top: calc((var(--thumb-size) - var(--track-height)) / -2);
  }

  input[part='native']::-moz-range-thumb {
    width: var(--thumb-size);
    height: var(--thumb-size);
    border-radius: var(--we-radius-full);
    background: var(--we-color-primary-500);
    border: 2px solid white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  :host([disabled]) {
    opacity: 0.5;
    pointer-events: none;
  }
`;

@customElement('we-slider')
export default class Slider extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 100;
  @property({ type: Number }) step = 1;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: String }) name = '';
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Boolean }) showValue = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Slider & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  /** Fires continuously while dragging — does NOT persist to `this.value`. */
  private _onInput(e: Event) {
    e.stopPropagation();
    const val = Number((e.target as HTMLInputElement).value);
    this.dispatchEvent(new CustomEvent('input', { detail: val, bubbles: true, composed: true }));
  }

  /** Fires once when the user releases — updates `this.value` and dispatches `change`. */
  private _onChange(e: Event) {
    e.stopPropagation();
    const val = Number((e.target as HTMLInputElement).value);
    this.value = val;
    this.dispatchEvent(new CustomEvent('change', { detail: val, bubbles: true, composed: true }));
  }

  render() {
    const trackH = TRACK_HEIGHT[this.size];
    const thumbS = THUMB_SIZE[this.size];

    return html`
      <div part="base" style=${styleMap(this.styles || {})}>
        <div part="track-wrapper">
          <input
            part="native"
            type="range"
            min=${this.min}
            max=${this.max}
            step=${this.step}
            .value=${String(this.value)}
            ?disabled=${this.disabled}
            @input=${this._onInput}
            @change=${this._onChange}
            style=${styleMap({
              '--track-height': trackH,
              '--thumb-size': thumbS,
            })}
          />
        </div>
        ${this.showValue ? html`<span part="value">${this.value}</span>` : null}
      </div>
    `;
  }
}
