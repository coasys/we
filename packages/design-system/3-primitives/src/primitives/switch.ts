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

const TRACK_SIZES: Record<ComponentSize, { width: string; height: string; thumb: string }> = {
  xs: { width: '24px', height: '14px', thumb: '10px' },
  sm: { width: '28px', height: '16px', thumb: '12px' },
  md: { width: '36px', height: '20px', thumb: '16px' },
  lg: { width: '44px', height: '24px', thumb: '20px' },
  xl: { width: '52px', height: '28px', thumb: '24px' },
};

const styles = css`
  [part='track'] {
    position: relative;
    border-radius: var(--we-radius-pill);
    background: var(--we-color-neutral-300);
    transition: background var(--we-transition-200, 150ms) ease;
    flex-shrink: 0;
  }

  :host([checked]) [part='track'] {
    background: var(--we-color-primary-500);
  }

  [part='thumb'] {
    position: absolute;
    top: 2px;
    left: 2px;
    border-radius: var(--we-radius-full);
    background: white;
    transition: transform var(--we-transition-200, 150ms) ease;
    box-shadow: 0 1px 3px color-mix(in srgb, var(--we-role-shadow-color) 20%, transparent);
  }

  :host([checked]) [part='thumb'] {
    transform: translateX(100%);
  }

  :host([disabled]) {
    opacity: 0.5;
    cursor: default;
    pointer-events: none;
  }

  input[part='native'] {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
    padding: 0;
    margin: -1px;
  }

  [part='off-label'],
  [part='on-label'] {
    transition: opacity var(--we-transition-200, 150ms) ease;
    cursor: pointer;
    user-select: none;
    font-size: var(--we-font-size-200);
  }

  [part='off-label'] {
    opacity: 1;
  }

  :host([checked]) [part='off-label'] {
    opacity: 0.4;
  }

  [part='on-label'] {
    opacity: 0.4;
  }

  :host([checked]) [part='on-label'] {
    opacity: 1;
  }
`;

@customElement('we-switch')
export default class Switch extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: String }) name = '';
  @property({ type: String }) value = '';
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: String }) labelOff = '';
  @property({ type: String }) labelOn = '';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Switch & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  private _toggle() {
    if (this.disabled) return;
    this.checked = !this.checked;
    this.dispatchEvent(new CustomEvent('change', { detail: this.checked, bubbles: true, composed: true }));
  }

  render() {
    const sizes = TRACK_SIZES[this.size];
    return html`
      <div part="base" style=${styleMap(this.styles || {})} @click=${this._toggle}>
        <input
          part="native"
          type="checkbox"
          role="switch"
          .checked=${this.checked}
          ?disabled=${this.disabled}
          aria-checked=${this.checked ? 'true' : 'false'}
        />
        ${this.labelOff ? html`<span part="off-label">${this.labelOff}</span>` : ''}
        <div part="track" style=${styleMap({ width: sizes.width, height: sizes.height })}>
          <div part="thumb" style=${styleMap({ width: sizes.thumb, height: sizes.thumb })}></div>
        </div>
        ${this.labelOn ? html`<span part="on-label">${this.labelOn}</span>` : ''}
      </div>
    `;
  }
}
