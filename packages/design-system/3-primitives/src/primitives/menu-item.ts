import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import sharedStyles from '../shared/styles';

const styles = css`
  :host {
    --we-menu-item-gap: var(--we-space-300);
    --we-menu-item-border-left: none;
    --we-menu-item-border-radius: none;
    --we-menu-item-height: var(--we-size-md);
    --we-menu-item-bg: transparent;
    --we-menu-item-color: var(--we-color-ui-600);
    --we-menu-item-padding: 0 var(--we-space-500) 0 var(--we-space-500);
    --we-menu-item-font-weight: 500;
    --we-menu-item-font-size: var(--we-font-size-500);
  }
  :host(:hover) {
    --we-menu-item-color: var(--we-color-ui-700);
    --we-menu-item-bg: var(--we-color-ui-50);
  }
  :host([active]) {
    --we-menu-item-bg: var(--we-color-ui-50);
    --we-menu-item-color: var(--we-color-ui-600);
  }
  :host([selected]) {
    --we-menu-item-bg: var(--we-color-primary-100);
    --we-menu-item-color: var(--we-color-primary-700);
  }
  :host([size='sm']) {
    --we-menu-item-gap: var(--we-space-300);
    --we-menu-item-font-size: var(--we-font-size-400);
    --we-menu-item-height: var(--we-size-sm);
  }
  :host([size='lg']) {
    --we-menu-item-gap: var(--we-space-400);
    --we-menu-item-height: var(--we-size-lg);
  }
  :host([size='xl']) {
    --we-menu-item-gap: var(--we-space-500);
    --we-menu-item-height: var(--we-size-xl);
  }
  :host(:last-of-type) [part='base'] {
    margin-bottom: 0;
  }
  [part='base'] {
    display: flex;
    align-items: center;
    gap: var(--we-menu-item-gap);
    border-radius: var(--we-menu-item-border-radius);
    background: var(--we-menu-item-bg);
    text-decoration: none;
    cursor: pointer;
    font-size: var(--we-menu-item-font-size);
    height: var(--we-menu-item-height);
    padding: var(--we-menu-item-padding);
    color: var(--we-menu-item-color);
    font-weight: var(--we-menu-item-font-weight);
    border-left: var(--we-menu-item-border-left);
  }
  [part='content'] {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

@customElement('we-menu-item')
export default class MenuItem extends LitElement {
  static styles = [sharedStyles, styles];

  @property({ type: Boolean, reflect: true }) selected = false;
  @property({ type: Boolean, reflect: true }) active = false;
  @property({ attribute: false }) onClick: (event: MouseEvent) => void = () => {};
  @property({ type: Object }) styles?: Record<string, any>;

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
    const inlineStyles = this.styles || {};
    return html`<div part="base" role="menuitem" style=${styleMap(inlineStyles)}>
      <slot name="start"></slot>
      <div part="content">
        <slot></slot>
      </div>
      <slot name="end"></slot>
    </div>`;
  }
}
