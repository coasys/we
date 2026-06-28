import type { DesignSystemProps } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'block',
  r: '400',
  px: '400',
  py: '200',
  color: 'neutral-600',
  fontSize: '300',
};

const styles = css`
  [part='base'] {
    border-left: 3px solid var(--we-color-neutral-300);
    margin: 0;
    font-style: italic;
  }
`;

@customElement('we-blockquote')
export default class Blockquote extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  render() {
    return html`
      <blockquote part="base" style=${styleMap(this.styles || {})}>
        <slot></slot>
      </blockquote>
    `;
  }
}
