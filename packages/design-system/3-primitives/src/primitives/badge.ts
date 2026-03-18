import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { LayoutVisualTypographyElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import { BadgeSize, BadgeVariant } from '../types';

const styles = css`
  :host {
    --we-badge-host-display: inline-flex;
    --we-badge-display: inline-flex;
    --we-badge-radius: var(--we-border-radius);
    --we-badge-bg: var(--we-color-ui-100);
    --we-badge-color: var(--we-color-ui-500);
    --we-badge-font-size: var(--we-font-size-400);
    --we-badge-font-weight: 400;
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
    align-items: center;
    justify-content: center;
    padding: var(--we-badge-padding);
  }
`;

@customElement('we-badge')
export default class Badge extends LayoutVisualTypographyElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) variant: BadgeVariant = '';
  @property({ type: String, reflect: true }) size: BadgeSize = '';
  @property({ type: String, reflect: true }) bg = '';
  @property({ type: String, reflect: true }) color = '';
  @property({ type: String, reflect: true }) weight = '';
  @property({ type: Object }) styles?: Record<string, any>;

  updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);

    if (changedProperties.has('weight')) {
      if (this.weight) {
        this.style.setProperty('--we-badge-font-weight', this.weight);
      } else {
        this.style.removeProperty('--we-badge-font-weight');
      }
    }
  }

  render() {
    const inlineStyles = this.styles || {};
    return html`<span part="base" style=${styleMap(inlineStyles)}>
      <slot></slot>
    </span>`;
  }
}
