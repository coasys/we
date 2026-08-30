import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentVariant } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  ay: 'start',
  gap: '300',
  px: '400',
  py: '300',
  r: '400',
  fontSize: '300',
};

const VARIANT_DEFAULTS: Record<ComponentVariant, Partial<DesignSystemProps>> = {
  // `surfaceSunken`, not `page`: an alert is a tinted panel, and the three status variants beside
  // it are tints. `page` won this slot only because neutral-50 happened to be the value here.
  neutral: { bg: 'surface-sunken', color: 'text' },
  primary: { bg: 'accent-muted', color: 'accent-text' },
  success: { bg: 'success-surface', color: 'success-text' },
  warning: { bg: 'warning-surface', color: 'warning-text' },
  danger: { bg: 'danger-surface', color: 'danger-text' },
};

/**
 * One icon per variant, exported so the theme suite can assert it.
 *
 * This is what makes a status readable to someone who cannot tell red from green: WCAG 1.4.1 asks
 * that colour never be the only visual means of conveying information, and for a palette built on
 * red and green that redundancy is the whole answer — the colours themselves cannot be pulled apart
 * without ceasing to be red and green.
 */
export const ALERT_VARIANT_ICONS: Record<ComponentVariant, string> = {
  neutral: 'info',
  primary: 'info',
  success: 'check-circle',
  warning: 'warning',
  danger: 'x-circle',
};

/*
  A tint of the status colour, mixed rather than pinned to a scale position.

  `neutral` already named a role and the other four did not, which is the tell. A `-200` is one
  theme's idea of a light red: it follows the hue and polarity parameters and cannot follow a theme
  that *pins* `danger`, and the contrast corrections at apply time skip it entirely. `color-mix`
  against the role is how the rest of the system builds a step it has no role for — the same move
  a control's hover and pressed states make.
*/
const tinted = (role: string) => `1px solid color-mix(in srgb, var(--we-role-${role}) 30%, transparent)`;

const VARIANT_BORDER: Record<ComponentVariant, string> = {
  neutral: '1px solid var(--we-role-border)',
  primary: tinted('accent'),
  success: tinted('success'),
  warning: tinted('warning'),
  danger: tinted('danger'),
};

const styles = css`
  [part='dismiss'] {
    all: unset;
    cursor: pointer;
    margin-left: auto;
    opacity: 0.6;
    transition: opacity var(--we-transition-200, 150ms) ease;
    flex-shrink: 0;
  }

  [part='dismiss']:hover {
    opacity: 1;
  }

  [part='content'] {
    flex: 1;
  }
`;

@customElement('we-alert')
export default class Alert extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) variant: ComponentVariant = 'primary';
  @property({ type: Boolean }) dismissible = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Alert & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const variantDefaults = VARIANT_DEFAULTS[this.variant] ?? {};
    return mergeProps(usedProps, mergeProps(variantDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  private _dismiss() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  render() {
    const icon = ALERT_VARIANT_ICONS[this.variant];
    const border = VARIANT_BORDER[this.variant];

    return html`
      <div part="base" role="alert" style=${styleMap({ border, ...this.styles })}>
        <we-icon name=${icon} size="20px"></we-icon>
        <div part="content"><slot></slot></div>
        ${
          this.dismissible
            ? html`<button part="dismiss" aria-label="Dismiss" @click=${this._dismiss}>
                <we-icon name="x" size="16px"></we-icon>
              </button>`
            : nothing
        }
      </div>
    `;
  }
}
