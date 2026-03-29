import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'grid',
  gap: '400',
};

const styles = css`
  [part='base'] {
    width: 100%;
  }
`;

@customElement('we-grid')
export default class Grid extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Number }) columns = 1;
  @property({ type: String }) minChildWidth = '';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Grid & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    return mergeProps(usedProps, DEFAULT_PROPS) as Partial<DesignSystemProps>;
  }

  render() {
    const gridTemplate = this.minChildWidth
      ? `repeat(auto-fill, minmax(${this.minChildWidth}, 1fr))`
      : `repeat(${this.columns}, 1fr)`;

    const inline = { ...this.styles, 'grid-template-columns': gridTemplate };
    return html`<div part="base" style=${styleMap(inline)}><slot></slot></div>`;
  }
}
