import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize, ComponentVariant } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  r: 'pill',
  bg: 'control-surface',
};

/*
  The bar itself. Roles rather than scale positions, because these are meanings a theme pins — a
  theme setting `accent` expects its primary progress bar to follow — and because the corrections
  at apply time measure a role against what is behind it and skip a scale position entirely.

  `neutral` takes `border-strong`: the trough is already `control-surface`, so the fill has to be a
  neutral distinguishable from it, and that is the role for an emphasised neutral.
*/
const VARIANT_COLORS: Record<ComponentVariant, string> = {
  neutral: 'var(--we-role-border-strong)',
  primary: 'var(--we-role-accent)',
  success: 'var(--we-role-success)',
  warning: 'var(--we-role-warning)',
  danger: 'var(--we-role-danger)',
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
    transition: width var(--we-transition-300, 250ms) ease;
  }
`;

@customElement('we-progress-bar')
export default class ProgressBar extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Number }) value = 0;
  @property({ type: Number }) max = 100;
  @property({ type: String, reflect: true }) variant: ComponentVariant = 'primary';
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  /**
   * What is progressing. Announced with the percentage, and without it a screen reader says only
   * "40%" of nothing at all — `role="progressbar"` carries a value and no subject.
   *
   * Left empty the element drops the role rather than exposing a nameless one, which is the honest
   * degradation: a bar with no name is decorative as far as the accessibility tree is concerned, and
   * announcing an anonymous number is worse than announcing nothing. Set it wherever the bar means
   * something — an upload, an import, a model download.
   */
  @property({ type: String }) label = '';
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
        role=${this.label ? 'progressbar' : nothing}
        aria-label=${this.label || nothing}
        aria-valuenow=${this.label ? this.value : nothing}
        aria-valuemin=${this.label ? '0' : nothing}
        aria-valuemax=${this.label ? this.max : nothing}
        style=${styleMap({ height, ...this.styles })}
      >
        <div part="fill" style=${styleMap({ width: `${pct}%`, background: fillColor })}></div>
      </div>
    `;
  }
}
