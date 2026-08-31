import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { AlertAppearance, ComponentVariant } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  ay: 'start',
  gap: '300',
  px: '400',
  py: '300',
  r: '400',
  fontSize: '300',
};

/*
  Two appearances of the same five meanings — see `AlertAppearance` for why both exist.

  `soft` is the tinted panel this has always painted. `accent` drops the tint and says the same
  thing with a thick edge, for a run of alerts rather than one: a column of eight tinted panels is
  eight competing rectangles, and in a dark theme the warning tint in particular reads as brown
  before it reads as a warning.
*/
export const ALERT_APPEARANCE_DEFAULTS: Record<
  AlertAppearance,
  Record<ComponentVariant, Partial<DesignSystemProps>>
> = {
  soft: {
    // `surfaceSunken`, not `page`: an alert is a tinted panel, and the three status variants beside
    // it are tints. `page` won this slot only because neutral-50 happened to be the value here.
    neutral: { bg: 'surface-sunken', color: 'text' },
    primary: { bg: 'accent-muted', color: 'accent-text' },
    success: { bg: 'success-surface', color: 'success-text' },
    warning: { bg: 'warning-surface', color: 'warning-text' },
    danger: { bg: 'danger-surface', color: 'danger-text' },
  },
  /*
    `text`, not the status colour, for every one of these. The edge is what carries the status; the
    words are ordinary words and want the contrast the body text has. Colouring them too would give
    a paragraph of `warning-text` on a plain surface, which is the least legible arrangement of the
    three and the one the tint was hiding.
  */
  accent: {
    neutral: { bg: 'surface', color: 'text' },
    primary: { bg: 'surface', color: 'text' },
    success: { bg: 'surface', color: 'text' },
    warning: { bg: 'surface', color: 'text' },
    danger: { bg: 'surface', color: 'text' },
  },
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

/** The role whose FILL an `accent` edge is drawn in — the status at full strength, not its tint. */
export const ALERT_VARIANT_FILL: Record<ComponentVariant, string> = {
  neutral: 'border-strong',
  primary: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

/**
 * The border for one variant in one appearance.
 *
 * `accent` returns a `border-left` alone rather than a `border` plus an override, because the two
 * spellings would both be in the same inline style object and the winner would be property order.
 */
const borderStyle = (variant: ComponentVariant, appearance: AlertAppearance) =>
  appearance === 'accent'
    ? { borderLeft: `var(--we-alert-accent-width, 3px) solid var(--we-role-${ALERT_VARIANT_FILL[variant]})` }
    : { border: VARIANT_BORDER[variant] };

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
  @property({ type: String, reflect: true }) appearance: AlertAppearance = 'soft';
  @property({ type: Boolean }) dismissible = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Alert & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const appearance = ALERT_APPEARANCE_DEFAULTS[this.appearance] ?? ALERT_APPEARANCE_DEFAULTS.soft;
    const variantDefaults = appearance[this.variant] ?? {};
    return mergeProps(usedProps, mergeProps(variantDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  private _dismiss() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  render() {
    const icon = ALERT_VARIANT_ICONS[this.variant];
    const accent = this.appearance === 'accent';
    // Under `accent` the words are `text`, so the icon is the only thing left carrying the status
    // as colour. Empty means inherit, which is what `soft` wants — there the whole panel is tinted.
    const iconColor = accent ? ALERT_VARIANT_FILL[this.variant] : '';

    return html`
      <div
        part="base"
        role="alert"
        style=${styleMap({ ...borderStyle(this.variant, this.appearance), ...this.styles })}
      >
        <we-icon name=${icon} size="20px" color=${iconColor}></we-icon>
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
