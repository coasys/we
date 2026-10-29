import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { AlertVariant, ToneName } from '../types';

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
  Two styles of one family — see `AlertVariant` for why both exist — and the family is the tone.

  `soft` is the tinted panel this has always painted. `edge` drops the tint and says the same thing
  with a thick edge, for a run of alerts rather than one: a column of eight tinted panels is eight
  competing rectangles, and in a dark theme the warning tint in particular reads as brown before it
  reads as a warning.

  A toned alert draws with the accent's roles, which its `tone` has re-pointed at the family, so one
  table serves every family, the palette included. Untoned is the accent, as it always was; only
  `neutral` has a table of its own, since a neutral alert is a sunken well rather than a tint.
*/
export const ALERT_VARIANT_DEFAULTS: Record<
  AlertVariant,
  { neutral: Partial<DesignSystemProps>; toned: Partial<DesignSystemProps> }
> = {
  soft: {
    // `surfaceSunken`, not `page`: an alert is a tinted panel, and the toned ones beside it are
    // tints. `page` won this slot only because neutral-50 happened to be the value here.
    neutral: { bg: 'surface-sunken', color: 'text' },
    toned: { bg: 'accent-soft', color: 'accent-text' },
  },
  /*
    `text`, not the family's colour. The edge is what carries the status; the words are ordinary
    words and want the contrast the body text has. Colouring them too would give a paragraph of
    `warning-text` on a plain surface, which is the least legible arrangement of the three and the
    one the tint was hiding.
  */
  edge: {
    neutral: { bg: 'surface', color: 'text' },
    toned: { bg: 'surface', color: 'text' },
  },
};

/**
 * One icon per status tone, exported so the theme suite can assert it. A palette hue or the accent
 * has no status to name, so it takes `info`.
 *
 * This is what makes a status readable to someone who cannot tell red from green: WCAG 1.4.1 asks
 * that colour never be the only visual means of conveying information, and for a palette built on
 * red and green that redundancy is the whole answer — the colours themselves cannot be pulled apart
 * without ceasing to be red and green.
 */
export const ALERT_TONE_ICONS: Record<'neutral' | 'accent' | 'success' | 'warning' | 'danger', string> = {
  neutral: 'info',
  accent: 'info',
  success: 'check-circle',
  warning: 'warning',
  danger: 'x-circle',
};

/**
 * Whether it interrupts. `alert` is an assertive live region: a screen reader stops what it is
 * reading to say it, the moment it appears — right for a failure or a warning somebody must not
 * miss, and wrong for a note inside a dialog they have just opened, which it read out over the
 * dialog's own title. Everything else is `status`, which is spoken when the reader is free.
 */
export const announces = (tone: ToneName | undefined): boolean => tone === 'warning' || tone === 'danger';

const iconFor = (tone: ToneName | undefined): string =>
  ALERT_TONE_ICONS[(tone ?? 'accent') as keyof typeof ALERT_TONE_ICONS] ?? 'info';

/*
  A tint of the family, mixed rather than pinned to a scale position.

  A `-200` is one theme's idea of a light red: it follows the hue and polarity parameters and cannot
  follow a theme that *pins* `danger`, and the contrast corrections at apply time skip it entirely.
  `color-mix` against the role is how the rest of the system builds a step it has no role for — the
  same move a control's hover and pressed states make.
*/
const TONED_BORDER = '1px solid color-mix(in srgb, var(--we-role-accent) 30%, transparent)';
const NEUTRAL_BORDER = '1px solid var(--we-role-border)';

/** The role an `edge` is drawn in — the family at full strength, never its tint or its text. */
export const ALERT_EDGE_FILL = { neutral: 'border-strong', toned: 'accent' } as const;

/**
 * The border for one tone in one variant.
 *
 * `edge` returns a `border-left` alone rather than a `border` plus an override, because the two
 * spellings would both be in the same inline style object and the winner would be property order.
 */
const borderStyle = (neutral: boolean, variant: AlertVariant) =>
  variant === 'edge'
    ? {
        borderLeft: `var(--we-alert-accent-width, 3px) solid var(--we-role-${
          ALERT_EDGE_FILL[neutral ? 'neutral' : 'toned']
        })`,
      }
    : { border: neutral ? NEUTRAL_BORDER : TONED_BORDER };

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

  @property({ type: String, reflect: true }) variant: AlertVariant = 'soft';
  @property({ type: Boolean }) dismissible = false;
  /**
   * The glyph it leads with, where its tone's would not say what it is about — an app, a person, a
   * calendar. Absent, the tone's (`ALERT_TONE_ICONS`), which is what carries a status to somebody who
   * cannot tell the tints apart; so give a warning or a danger its own icon only with care.
   */
  @property({ type: String }) icon = '';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Alert & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const table = ALERT_VARIANT_DEFAULTS[this.variant] ?? ALERT_VARIANT_DEFAULTS.soft;
    const variantDefaults = this.tone === 'neutral' ? table.neutral : table.toned;
    return mergeProps(usedProps, mergeProps(variantDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  private _dismiss() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  render() {
    const neutral = this.tone === 'neutral';
    const icon = this.icon || iconFor(this.tone);
    // Under `edge` the words are `text`, so the icon is the only thing left carrying the status as
    // colour. Empty means inherit, which is what `soft` wants — there the whole panel is tinted.
    const iconColor = this.variant === 'edge' ? ALERT_EDGE_FILL[neutral ? 'neutral' : 'toned'] : '';

    return html`
      <div
        part="base"
        role=${announces(this.tone) ? 'alert' : 'status'}
        style=${styleMap({ ...borderStyle(neutral, this.variant), ...this.styles })}
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
