import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import { BadgeSize, BadgeVariant } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  bg: 'neutral-100',
  color: 'neutral-500',
  fontSize: '400',
  fontWeight: '400',
  r: 'sm',
  px: '300',
  py: '200',
  ax: 'center',
  ay: 'center',
};

const VARIANT_DEFAULTS: Record<string, Partial<DesignSystemProps>> = {
  primary: { bg: 'primary-100', color: 'primary-600' },
  success: { bg: 'success-100', color: 'success-600' },
  warning: { bg: 'warning-100', color: 'warning-600' },
  danger: { bg: 'danger-100', color: 'danger-600' },
};

const SIZE_DEFAULTS: Record<string, Partial<DesignSystemProps>> = {
  sm: { fontSize: '300', px: '200', py: '100' },
  lg: { fontSize: '500', px: '500', py: '300' },
};

const styles = css`
  :host {
    --we-badge-host-display: inline-flex;
  }
`;

@customElement('we-badge')
export default class Badge extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) variant: BadgeVariant = '';
  @property({ type: String, reflect: true }) size: BadgeSize = '';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Badge & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const variantDefaults = this.variant ? (VARIANT_DEFAULTS[this.variant] ?? {}) : {};
    const sizeDefaults = this.size ? (SIZE_DEFAULTS[this.size] ?? {}) : {};
    return mergeProps(
      usedProps,
      mergeProps(variantDefaults, mergeProps(sizeDefaults, DEFAULT_PROPS)),
    ) as Partial<DesignSystemProps>;
  }

  render() {
    const inline = this.styles || {};
    return html`<span part="base" style=${styleMap(inline)}>
      <slot></slot>
    </span>`;
  }
}
