import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize, ComponentVariant } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  r: 'pill',
  bg: 'neutral-200',
};

const VARIANT_COLORS: Record<ComponentVariant, string> = {
  neutral: 'var(--we-color-neutral-500)',
  primary: 'var(--we-color-primary-500)',
  success: 'var(--we-color-success-500)',
  warning: 'var(--we-color-warning-500)',
  danger: 'var(--we-color-danger-500)',
};

const SIZE_HEIGHTS: Record<ComponentSize, string> = {
  xs: '2px',
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
};

const styles = css`
  [part='base'] {
    overflow: hidden;
  }

  [part='fill'] {
    height: 100%;
    border-radius: inherit;
    transition: width 0.3s ease;
  }
`;

@customElement('we-progress-bar')
export default class ProgressBar extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Number }) value = 0;
  @property({ type: Number }) max = 100;
  @property({ type: String, reflect: true }) variant: ComponentVariant = 'primary';
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof ProgressBar & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    return mergeProps(usedProps, DEFAULT_PROPS) as Partial<DesignSystemProps>;
  }

  render() {
    const pct = Math.min(100, Math.max(0, (this.value / this.max) * 100));
    const height = SIZE_HEIGHTS[this.size];
    const fillColor = VARIANT_COLORS[this.variant];

    return html`
      <div
        part="base"
        role="progressbar"
        aria-valuenow=${this.value}
        aria-valuemin="0"
        aria-valuemax=${this.max}
        style=${styleMap({ height, ...this.styles })}
      >
        <div part="fill" style=${styleMap({ width: `${pct}%`, background: fillColor })}></div>
      </div>
    `;
  }
}
