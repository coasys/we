import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize, ComponentVariant } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  bg: 'neutral-100',
  color: 'neutral-500',
  fontSize: '300',
  fontWeight: '400',
  r: '400',
  px: '400',
  cursor: 'default',
  ax: 'center',
  ay: 'center',
};

const VARIANT_DEFAULTS: Record<ComponentVariant, Partial<DesignSystemProps>> = {
  neutral: { bg: 'neutral-100', color: 'neutral-500' },
  primary: { bg: 'primary-100', color: 'primary-600' },
  success: { bg: 'success-100', color: 'success-600' },
  warning: { bg: 'warning-100', color: 'warning-600' },
  danger: { bg: 'danger-100', color: 'danger-600' },
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { px: '200', fontSize: '100', height: 'var(--we-component-height-xs)', gap: '100' },
  sm: { px: '300', fontSize: '200', height: 'var(--we-component-height-sm)', gap: '200' },
  md: { px: '400', fontSize: '300', height: 'var(--we-component-height-md)' },
  lg: { px: '500', fontSize: '500', height: 'var(--we-component-height-lg)' },
  xl: { px: '500', fontSize: '500', height: 'var(--we-component-height-xl)' },
};

const styles = css`
  :host {
    --we-badge-host-display: inline-flex;
  }

  /* Provide icon sizing context for slotted we-icon children */
  :host([size='xs']) {
    --we-context-icon-size: var(--we-size-xxs);
  }
  :host([size='sm']) {
    --we-context-icon-size: var(--we-size-xs);
  }
  :host([size='md']) {
    --we-context-icon-size: var(--we-size-sm);
  }
  :host([size='lg']) {
    --we-context-icon-size: var(--we-size-md);
  }
  :host([size='xl']) {
    --we-context-icon-size: var(--we-size-lg);
  }
`;

@customElement('we-badge')
export default class Badge extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) variant: ComponentVariant = 'neutral';
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getRawProps() {
    return { ...SIZE_DEFAULTS[this.size], ...super.getRawProps() };
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Badge & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const variantDefaults = VARIANT_DEFAULTS[this.variant] ?? {};
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
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
