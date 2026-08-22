import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  fontFamily: 'var(--we-font-mono)',
  fontSize: '200',
  r: '300',
};

const MODE_DEFAULTS: Record<'inline' | 'block', Partial<DesignSystemProps>> = {
  inline: { display: 'inline', bg: 'surface-sunken', color: 'text', px: '100', py: '50' },
  block: {
    display: 'block',
    // A block of code reads as a terminal: dark in every theme. Scale tokens can't say
    // that — the parametric lightness ramp inverts with the theme, so `neutral-900`
    // rendered this near-white in dark mode. Pinning the lightness and keeping only
    // hue/saturation parametric holds the terminal look while still tinting with the
    // theme (same move as the dark theme's tooltip inversion).
    bg: 'hsl(var(--we-color-neutral-hue) var(--we-color-neutral-saturation) 14%)',
    color: 'hsl(var(--we-color-neutral-hue) var(--we-color-neutral-saturation) 92%)',
    px: '400',
    py: '300',
  },
};

const styles = css`
  [part='base'] code {
    font-family: inherit;
  }

  :host([block]) [part='base'] {
    overflow-x: auto;
    white-space: pre;
  }
`;

@customElement('we-code')
export default class Code extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Boolean, reflect: true }) block = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getRawProps() {
    const modeDefaults = MODE_DEFAULTS[this.block ? 'block' : 'inline'];
    return { ...modeDefaults, ...super.getRawProps() };
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Code & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const modeDefaults = MODE_DEFAULTS[this.block ? 'block' : 'inline'];
    return mergeProps(usedProps, mergeProps(modeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  render() {
    if (this.block) {
      return html` <pre part="base" style=${styleMap(this.styles || {})}><code><slot></slot></code></pre> `;
    }
    return html` <code part="base" style=${styleMap(this.styles || {})}><slot></slot></code> `;
  }
}
