import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import sharedStyles from '../shared/styles';
import { BadgeSize, BadgeVariant } from '../types';

const styles = css`
  :host {
    --we-badge-border-radius: var(--we-border-radius);
    --we-badge-bg: var(--we-color-ui-100);
    --we-badge-color: var(--we-color-ui-500);
    --we-badge-font-size: var(--we-font-size-400);
    --we-badge-padding: var(--we-space-200) var(--we-space-300);
  }
  :host([size='sm']) {
    --we-badge-font-size: var(--we-font-size-300);
    --we-badge-padding: var(--we-space-100) var(--we-space-200);
  }
  :host([size='lg']) {
    --we-badge-font-size: var(--we-font-size-500);
    --we-badge-padding: var(--we-space-300) var(--we-space-500);
  }
  :host([variant='primary']) {
    --we-badge-bg: var(--we-color-primary-100);
    --we-badge-color: var(--we-color-primary-600);
  }
  :host([variant='success']) {
    --we-badge-bg: var(--we-color-success-100);
    --we-badge-color: var(--we-color-success-600);
  }
  :host([variant='warning']) {
    --we-badge-bg: var(--we-color-warning-100);
    --we-badge-color: var(--we-color-warning-600);
  }
  :host([variant='danger']) {
    --we-badge-bg: var(--we-color-danger-100);
    --we-badge-color: var(--we-color-danger-600);
  }
  [part='base'] {
    font-size: var(--we-badge-font-size);
    border-radius: var(--we-badge-border-radius);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--we-badge-padding);
    background: var(--we-badge-bg);
    color: var(--we-badge-color);
  }
`;

@customElement('we-badge')
export default class Badge extends LitElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) variant: BadgeVariant = '';
  @property({ type: String, reflect: true }) size: BadgeSize = '';
  @property({ type: Object }) styles?: Record<string, any>;

  render() {
    const inlineStyles = this.styles || {};
    return html`<span part="base" style=${styleMap(inlineStyles)}>
      <slot></slot>
    </span>`;
  }
}
