import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { NumberInputSize } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'inline-flex',
  ay: 'center',
  r: '400',
  border: '1px solid var(--we-color-neutral-300)',
  bg: 'white',
  fontSize: '400',
  color: 'neutral-800',
};

const SIZE_DEFAULTS: Record<NumberInputSize, Partial<DesignSystemProps>> = {
  sm: { fontSize: '300', height: '32px' },
  md: { fontSize: '400', height: '40px' },
  lg: { fontSize: '500', height: '48px' },
};

const styles = css`
  input[part='native'] {
    all: unset;
    text-align: center;
    width: 3em;
    font: inherit;
    color: inherit;
    -moz-appearance: textfield;
  }

  input[part='native']::-webkit-outer-spin-button,
  input[part='native']::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  [part='stepper'] {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    width: 32px;
    flex-shrink: 0;
    opacity: 0.6;
    transition: opacity 0.15s ease;
    user-select: none;
  }

  [part='stepper']:hover {
    opacity: 1;
  }

  :host([disabled]) {
    opacity: 0.5;
    pointer-events: none;
  }
`;

@customElement('we-number-input')
export default class NumberInput extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = -Infinity;
  @property({ type: Number }) max = Infinity;
  @property({ type: Number }) step = 1;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: String }) name = '';
  @property({ type: String, reflect: true }) size: NumberInputSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof NumberInput & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  private _clamp(val: number) {
    return Math.min(this.max, Math.max(this.min, val));
  }

  private _emit(val: number) {
    const clamped = this._clamp(val);
    this.value = clamped;
    this.dispatchEvent(new CustomEvent('change', { detail: clamped, bubbles: true, composed: true }));
  }

  private _decrement() {
    this._emit(this.value - this.step);
  }

  private _increment() {
    this._emit(this.value + this.step);
  }

  private _onInput(e: Event) {
    e.stopPropagation();
    const val = Number((e.target as HTMLInputElement).value);
    if (!Number.isNaN(val)) this._emit(val);
  }

  render() {
    return html`
      <div part="base" style=${styleMap(this.styles || {})}>
        <button part="stepper" aria-label="Decrease" @click=${this._decrement} ?disabled=${this.disabled}>
          <we-icon name="minus" size="16px"></we-icon>
        </button>
        <input
          part="native"
          type="number"
          .value=${String(this.value)}
          min=${this.min}
          max=${this.max}
          step=${this.step}
          ?disabled=${this.disabled}
          @input=${this._onInput}
        />
        <button part="stepper" aria-label="Increase" @click=${this._increment} ?disabled=${this.disabled}>
          <we-icon name="plus" size="16px"></we-icon>
        </button>
      </div>
    `;
  }
}
