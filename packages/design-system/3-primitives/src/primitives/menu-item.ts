import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { MenuItemVariant } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  cursor: 'pointer',
  bg: 'transparent',
  color: 'text-muted',
  px: '300',
  py: '200',
  ax: 'start',
  ay: 'center',
  gap: '300',
  hoverProps: {
    bg: 'page',
    color: 'text',
  },
};

const VARIANT_DEFAULTS: Partial<Record<MenuItemVariant, Partial<DesignSystemProps>>> = {
  danger: {
    color: 'danger-text',
    hoverProps: { bg: 'danger-surface', color: 'danger-text' },
  },
};

const styles = css`
  :host {
  }

  [part='base'] {
    all: unset;
    box-sizing: border-box;
    display: flex;
    text-decoration: none;
  }
`;

/**
 * Single actionable item inside a we-menu.
 * Supports selected, active, and danger states.
 */
@customElement('we-menu-item')
export default class MenuItem extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Boolean, reflect: true }) selected = false;
  @property({ type: Boolean, reflect: true }) active = false;
  @property({ type: String, reflect: true }) variant: MenuItemVariant = 'default';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof MenuItem & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const variantDefaults = VARIANT_DEFAULTS[this.variant] ?? {};
    return mergeProps(usedProps, mergeProps(variantDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  @state()
  _value = '';

  @state()
  _label = '';

  get label() {
    return this._label || this.getAttribute('label') || this.innerText;
  }

  set label(val) {
    this._label = val;
    this.setAttribute('label', val);
  }

  get value() {
    return this._value || this.getAttribute('value') || this.innerText;
  }

  set value(val) {
    this._value = val;
    this.setAttribute('value', val);
  }

  private _handleClick() {
    this.dispatchEvent(
      new CustomEvent('select', { detail: { value: this.value, label: this.label }, bubbles: true, composed: true }),
    );
  }

  private _handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this._handleClick();
    }
  }

  render() {
    const inline = this.styles || {};
    return html`<div
      part="base"
      role="menuitem"
      tabindex="0"
      @click=${this._handleClick}
      @keydown=${this._handleKeyDown}
      style=${styleMap(inline)}
    >
      <slot name="start"></slot>
      <slot></slot>
      <slot name="end"></slot>
    </div>`;
  }
}
