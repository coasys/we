import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { CardVariant } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  direction: 'column',
  bg: 'neutral-0',
  r: 'md',
  border: '1px solid var(--we-color-neutral-200)',
  overflow: 'hidden',
};

const VARIANT_DEFAULTS: Record<string, Partial<DesignSystemProps>> = {
  elevated: { border: 'none', shadow: '200' },
  outlined: { bg: 'transparent' },
  filled: { border: 'none', bg: 'neutral-100' },
};

const styles = css`
  [part='header'] {
    padding: var(--we-space-400) var(--we-space-400) 0;
  }

  [part='body'] {
    padding: var(--we-space-400);
    flex: 1;
  }

  [part='footer'] {
    padding: 0 var(--we-space-400) var(--we-space-400);
  }
`;

@customElement('we-card')
export default class Card extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) variant: CardVariant = '';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Card & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const variantDefaults = this.variant ? (VARIANT_DEFAULTS[this.variant] ?? {}) : {};
    return mergeProps(usedProps, mergeProps(variantDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  private _hasSlot(name: string): boolean {
    return this.querySelector(`[slot="${name}"]`) !== null;
  }

  render() {
    const inline = this.styles || {};
    return html`
      <div part="base" style=${styleMap(inline)}>
        ${this._hasSlot('header') ? html`<div part="header"><slot name="header"></slot></div>` : nothing}
        <div part="body"><slot></slot></div>
        ${this._hasSlot('footer') ? html`<div part="footer"><slot name="footer"></slot></div>` : nothing}
      </div>
    `;
  }
}
