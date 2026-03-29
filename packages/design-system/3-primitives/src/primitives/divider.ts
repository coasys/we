import type { DesignSystemProps } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {};

const styles = css`
  [part='base'] {
    border: none;
    margin: 0;
  }

  :host([orientation='horizontal']) [part='base'] {
    width: 100%;
    border-top: 1px solid var(--we-color-neutral-200);
  }

  :host(:not([orientation])) [part='base'],
  :host([orientation='']) [part='base'] {
    width: 100%;
    border-top: 1px solid var(--we-color-neutral-200);
  }

  :host([orientation='vertical']) [part='base'] {
    height: 100%;
    border-left: 1px solid var(--we-color-neutral-200);
  }
`;

@customElement('we-divider')
export default class Divider extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) orientation: 'horizontal' | 'vertical' = 'horizontal';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  render() {
    return html`
      <hr part="base" role="separator" aria-orientation=${this.orientation} style=${styleMap(this.styles || {})} />
    `;
  }
}
