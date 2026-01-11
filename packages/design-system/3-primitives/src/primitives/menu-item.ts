import type { DesignSystemProps } from '@we/design-system-types';
import { css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  cursor: 'pointer',
  bg: 'transparent',
  color: 'ui-600',
  px: '500',
  py: '200',
  ax: 'start',
  ay: 'center',
  gap: '300',
  height: 'md',
  hoverProps: {
    bg: 'ui-50',
    color: 'ui-700',
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

@customElement('we-menu-item')
export default class MenuItem extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Boolean, reflect: true }) selected = false;
  @property({ type: Boolean, reflect: true }) active = false;
  @property({ attribute: false }) onClick: (event: MouseEvent) => void = () => {};
  @property({ type: Object }) styles?: Record<string, any>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
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

  render() {
    const inline = this.styles || {};
    return html`<div part="base" role="menuitem" style=${styleMap(inline)}>
      <slot name="start"></slot>
      <slot></slot>
      <slot name="end"></slot>
    </div>`;
  }
}
