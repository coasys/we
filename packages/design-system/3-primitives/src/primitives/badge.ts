import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize, ComponentVariant } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  bg: 'surface-sunken',
  color: 'text-muted',
  fontSize: '300',
  fontWeight: '400',
  r: '400',
  cursor: 'default',
  ax: 'center',
  ay: 'center',
};

const VARIANT_DEFAULTS: Record<ComponentVariant, Partial<DesignSystemProps>> = {
  neutral: { bg: 'surface-sunken', color: 'text-muted' },
  primary: { bg: 'accent-muted', color: 'primary-600' },
  success: { bg: 'success-100', color: 'success-text' },
  warning: { bg: 'warning-100', color: 'warning-text' },
  danger: { bg: 'danger-100', color: 'danger-text' },
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { fontSize: '100', height: 'calc(var(--we-component-height-xs) + var(--we-theme-control-height-offset, 0px))' },
  sm: { fontSize: '200', height: 'calc(var(--we-component-height-sm) + var(--we-theme-control-height-offset, 0px))' },
  md: { fontSize: '300', height: 'calc(var(--we-component-height-md) + var(--we-theme-control-height-offset, 0px))' },
  lg: { fontSize: '500', height: 'calc(var(--we-component-height-lg) + var(--we-theme-control-height-offset, 0px))' },
  xl: { fontSize: '500', height: 'calc(var(--we-component-height-xl) + var(--we-theme-control-height-offset, 0px))' },
};

const styles = css`
  :host {
    --we-badge-host-display: inline-flex;
  }

  /* Provide icon sizing context and size-specific padding/gap for slotted we-icon children */
  :host([size='xs']) {
    --we-context-icon-size: var(--we-size-xxs);
    --we-badge-size-padding-x: var(--we-space-200);
    --we-badge-size-gap: var(--we-space-100);
  }
  :host([size='sm']) {
    --we-context-icon-size: var(--we-size-xs);
    --we-badge-size-padding-x: var(--we-space-300);
    --we-badge-size-gap: var(--we-space-200);
  }
  :host([size='md']) {
    --we-context-icon-size: var(--we-size-sm);
    --we-badge-size-padding-x: var(--we-space-400);
  }
  :host([size='lg']) {
    --we-context-icon-size: var(--we-size-md);
    --we-badge-size-padding-x: var(--we-space-500);
  }
  :host([size='xl']) {
    --we-context-icon-size: var(--we-size-lg);
    --we-badge-size-padding-x: var(--we-space-500);
  }

  [part='base'] {
    /* Padding cascade: explicit prop (full shorthand) → component theme → group density → size default (x-only) */
    padding: var(
      --we-badge-padding,
      0
        var(
          --we-theme-badge-padding-x,
          var(--we-theme-control-padding-x, var(--we-badge-size-padding-x, var(--we-space-400)))
        )
    );
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
