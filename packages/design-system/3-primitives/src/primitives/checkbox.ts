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
  color: 'text',
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
    border: 2px solid var(--we-role-border-strong);
    border-radius: var(--we-radius-200);
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--we-transition-200, 150ms) ease;
    flex-shrink: 0;
  }

  :host([checked]) [part='control'] {
    background: var(--we-role-accent);
    border-color: var(--we-role-accent);
  }

  :host([disabled]) {
    opacity: 0.5;
    cursor: default;
    pointer-events: none;
  }

  [part='check'] {
    display: none;
    width: 10px;
    height: 10px;
    color: white;
  }

  :host([checked]) [part='check'] {
    display: block;
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

@customElement('we-checkbox')
export default class Checkbox extends DesignSystemElement {
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
    const ctor = this.constructor as typeof Checkbox & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  private _toggle(e?: Event) {
    e?.preventDefault();
    if (this.disabled) return;
    this.checked = !this.checked;
    this.dispatchEvent(new CustomEvent('change', { detail: this.checked, bubbles: true, composed: true }));
  }

  private _handleKeyDown(e: KeyboardEvent) {
    if (e.key === ' ') {
      e.preventDefault();
      this._toggle();
    }
  }

  render() {
    const inline = this.styles || {};
    return html`
      <label part="base" style=${styleMap(inline)} @click=${this._toggle} @keydown=${this._handleKeyDown}>
        <input
          part="input"
          type="checkbox"
          .checked=${this.checked}
          ?disabled=${this.disabled}
          tabindex="-1"
          aria-hidden="true"
        />
        <span part="control" role="checkbox" aria-checked=${this.checked ? 'true' : 'false'} tabindex="0">
          <svg part="check" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="2.5 6 5 8.5 9.5 3.5"></polyline>
          </svg>
        </span>
        <span part="label"><slot></slot></span>
      </label>
    `;
  }
}
