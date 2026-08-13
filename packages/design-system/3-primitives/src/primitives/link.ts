import type { DesignSystemProps } from '@we/design-types';
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import { safeHref } from '../shared/safe-href';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'inline',
  color: 'primary-600',
  cursor: 'pointer',
};

const styles = css`
  [part='base'] {
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: opacity var(--we-transition-200, 150ms) ease;
  }

  [part='base']:hover {
    text-decoration-thickness: 2px;
  }

  :host([disabled]) {
    opacity: 0.5;
    cursor: default;
    pointer-events: none;
  }
`;

@customElement('we-link')
export default class Link extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String }) href = '';
  @property({ type: String }) target = '';
  @property({ type: String }) rel = '';
  @property({ type: String }) download = '';
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  render() {
    return html`
      <a
        part="base"
        href=${safeHref(this.href) || nothing}
        target=${this.target || nothing}
        rel=${this.target === '_blank' ? this.rel || 'noopener noreferrer' : this.rel || nothing}
        download=${this.download || nothing}
        aria-disabled=${this.disabled ? 'true' : 'false'}
        style=${styleMap(this.styles || {})}
      >
        <slot></slot>
      </a>
    `;
  }
}
