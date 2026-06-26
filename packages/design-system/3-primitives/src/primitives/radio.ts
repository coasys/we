import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'inline-flex',
  ay: 'center',
  gap: '200',
  cursor: 'pointer',
  fontSize: '300',
  color: 'neutral-800',
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { fontSize: '100', gap: '100' },
  sm: { fontSize: '200', gap: '100' },
  md: { fontSize: '300', gap: '200' },
  lg: { fontSize: '400', gap: '300' },
  xl: { fontSize: '400', gap: '400' },
};

const styles = css`
  [part='control'] {
    width: 18px;
    height: 18px;
    border: 2px solid var(--we-color-neutral-400);
    border-radius: 50%;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  :host([checked]) [part='control'] {
    border-color: var(--we-color-primary-500);
  }

  [part='dot'] {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--we-color-primary-500);
    display: none;
  }

  :host([checked]) [part='dot'] {
    display: block;
  }

  :host([disabled]) {
    opacity: 0.5;
    cursor: default;
    pointer-events: none;
  }

  [part='input'] {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }
`;

@customElement('we-radio')
export default class Radio extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: String, reflect: true }) name = '';
  @property({ type: String, reflect: true }) value = '';
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Radio & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  private _select() {
    if (this.disabled || this.checked) return;
    this.checked = true;
    this.dispatchEvent(new CustomEvent('change', { detail: this.value, bubbles: true, composed: true }));
  }

  private _handleKeyDown(e: KeyboardEvent) {
    if (e.key === ' ') {
      e.preventDefault();
      this._select();
    }
  }

  render() {
    const inline = this.styles || {};
    return html`
      <label part="base" style=${styleMap(inline)} @click=${this._select} @keydown=${this._handleKeyDown}>
        <input
          part="input"
          type="radio"
          .checked=${this.checked}
          .value=${this.value}
          name=${this.name}
          ?disabled=${this.disabled}
          tabindex="-1"
          aria-hidden="true"
        />
        <span part="control" role="radio" aria-checked=${this.checked ? 'true' : 'false'} tabindex="0">
          <span part="dot"></span>
        </span>
        <span part="label"><slot></slot></span>
      </label>
    `;
  }
}
