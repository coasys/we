import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { SelectSize } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  ay: 'center',
  px: '300',
  py: '200',
  fontSize: '400',
  bg: 'neutral-75',
  r: '300',
  color: 'neutral-1000',
  hoverProps: { bg: 'neutral-100' },
  focusProps: { bg: 'neutral-100', shadow: '0 0 0 2px var(--we-color-primary-500)' },
};

const SIZE_DEFAULTS: Record<SelectSize, Partial<DesignSystemProps>> = {
  sm: { px: '200', py: '100', fontSize: '300' },
  md: { px: '300', py: '200', fontSize: '400' },
  lg: { px: '400', py: '300', fontSize: '500' },
};

const styles = css`
  [part='select'] {
    flex: 1;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    outline: none;
    padding: 0;
    min-width: 0;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }

  [part='select-wrapper'] {
    display: flex;
    align-items: center;
    width: 100%;
    position: relative;
  }

  [part='arrow'] {
    position: absolute;
    right: 0;
    pointer-events: none;
    color: var(--we-color-neutral-500);
    display: flex;
    align-items: center;
  }
`;

@customElement('we-select')
export default class Select extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) value = '';
  @property({ type: String, reflect: true }) name = '';
  @property({ type: String, reflect: true }) placeholder = '';
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Array }) options: (string | { label: string; value: string })[] = [];
  @property({ type: String, reflect: true }) size: SelectSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Select & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  focus() {
    this.renderRoot.querySelector('select')?.focus();
  }

  private _handleChange(e: Event) {
    e.stopPropagation();
    this.value = (e.target as HTMLSelectElement)?.value;
    this.dispatchEvent(new CustomEvent('change', { detail: this.value, bubbles: true, composed: true }));
  }

  private _handleFocus() {
    this.dispatchEvent(new CustomEvent('focus', { bubbles: true, composed: true }));
  }

  private _handleBlur() {
    this.dispatchEvent(new CustomEvent('blur', { bubbles: true, composed: true }));
  }

  private _normalizeOption(opt: string | { label: string; value: string }) {
    return typeof opt === 'string' ? { label: opt, value: opt } : opt;
  }

  render() {
    const inline = this.styles || {};
    return html`
      <div part="base" style=${styleMap(inline)}>
        <div part="select-wrapper">
          <select
            part="select"
            .value=${this.value}
            ?disabled=${this.disabled}
            ?required=${this.required}
            @change=${this._handleChange}
            @focus=${this._handleFocus}
            @blur=${this._handleBlur}
          >
            ${this.placeholder && !this.value
              ? html`<option value="" disabled selected>${this.placeholder}</option>`
              : nothing}
            ${(this.options || []).map((opt) => {
              const { label, value } = this._normalizeOption(opt);
              return html`<option value=${value} ?selected=${value === this.value}>${label}</option>`;
            })}
          </select>
          <span part="arrow">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 4.5 6 7.5 9 4.5"></polyline>
            </svg>
          </span>
        </div>
      </div>
    `;
  }
}
